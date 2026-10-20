// Service worker: keeps the download queue, finds ComfyUI, hands downloads to Model Librarian
// and follows their progress. Clicks are stored first, so nothing is lost while ComfyUI is closed:
// the queue is sent when ComfyUI is reachable (checked every 30 s, when a ComfyUI tab opens,
// and right after each click).
import * as comfy from "./lib/comfy.js";
import * as Q from "./lib/queue.js";
import { fetchModel } from "./lib/civitai.js";
import { assess, recommend, gpuName, needsTextEncoder, textEncoderOf } from "./lib/fit.js";

const RULE_ID = 1;

// ---------------------------------------------------------------- storage
async function load() {
  const s = await chrome.storage.local.get({ queue: [], settings: { base: "" }, conn: { ok: false } });
  return s;
}

// Every change to the queue goes through here, one at a time (clicks, the pump and the popup race otherwise).
let chain = Promise.resolve();
function withQueue(fn) {
  const run = chain.then(async () => {
    const { queue } = await chrome.storage.local.get({ queue: [] });
    const out = await fn(queue);
    if (out && out.queue) {
      await chrome.storage.local.set({ queue: out.queue });
      updateBadge(out.queue);
    }
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

function updateBadge(queue) {
  const b = Q.badge(queue);
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
}

// ---------------------------------------------------------------- no Origin header on our own localhost requests
async function setupRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [{
        id: RULE_ID, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ["127.0.0.1", "localhost"], resourceTypes: ["xmlhttprequest"] },
      }],
    });
  } catch (e) {
    console.warn("Model Librarian: couldn't set the localhost header rule", e);
  }
}

// ---------------------------------------------------------------- the pump
let pumping = null;
let rerun = null;
let again = null;

// One pass at a time. Asked again while one runs (e.g. the address just changed): one more pass
// runs right after it, and the caller waits for that one.
function pump() {
  if (pumping) {
    rerun = rerun || pumping.then(() => { rerun = null; return pump(); });
    return rerun;
  }
  pumping = (async () => {
    try { await pumpOnce(); } finally { pumping = null; }
  })();
  return pumping;
}

async function pumpOnce() {
  const { settings, queue } = await load();
  const conn = await comfy.detect(settings.base);
  conn.checked = Date.now();
  await chrome.storage.local.set({ conn });
  if (!conn.ok) return;
  for (const item of Q.pending(queue)) {
    let res;
    try {
      res = item.kind === "companion"
        ? await comfy.api(conn.base, "/ext/companion-download", { method: "POST", body: { base_model: item.baseModel, file_name: item.forFile, name: item.name } })
        : await comfy.api(conn.base, "/ext/download", { method: "POST", body: { version_id: item.versionId, file_id: item.fileId } });
    } catch (e) {
      if (e.status === 0) return; // ComfyUI went away: the item stays queued
      res = { error: e.message, transient: e.status === 502 || e.status === 409 };
    }
    await withQueue((q) => ({ queue: Q.applySend(q, item.key, res) }));
  }
  const { queue: now } = await chrome.storage.local.get({ queue: [] });
  const ids = Q.active(now).map((x) => x.jobId);
  if (ids.length) {
    try {
      const { jobs } = await comfy.api(conn.base, `/ext/jobs?ids=${ids.join(",")}`);
      await withQueue((q) => ({ queue: Q.applyJobs(q, jobs) }));
    } catch {}
  }
  // while something is downloading, follow it closely (the 30 s alarm is the fallback)
  const { queue: after } = await chrome.storage.local.get({ queue: [] });
  clearTimeout(again);
  if (Q.active(after).length || Q.pending(after).length) again = setTimeout(pump, 2000);
}

// ---------------------------------------------------------------- model pages
async function modelInfo(page) {
  const model = await fetchModel(page.host, page.modelId);
  const { conn } = await load();
  let owned = {};
  if (conn.ok) {
    try {
      owned = (await comfy.api(conn.base, "/ext/lookup", { method: "POST", body: { version_ids: model.versions.map((v) => v.id) } })).versions || {};
    } catch {}
  }
  // which file suits this PC (Model Librarian 1.12.0+ describes the system)
  const sys = conn.ok ? conn.system : null;
  const fits = {};
  const tes = {};
  if (sys) {
    // the text encoder each base model loads (Model Librarian 1.13.0+), looked up once per base model
    const firsts = new Map();
    for (const v of model.versions) {
      const f = v.files.find(needsTextEncoder);
      if (f && !firsts.has(v.baseModel)) firsts.set(v.baseModel, f.name);
    }
    await Promise.all([...firsts].map(async ([base, file]) => {
      const r = await companions(base, file);
      tes[base] = textEncoderOf(r && r.companions);
    }));
    for (const v of model.versions) {
      for (const f of v.files) {
        const a = assess(f, v.name, sys, { te: tes[v.baseModel] || null });
        fits[f.id] = { verdict: a.verdict, notes: a.notes, label: a.q.label };
      }
    }
  }
  return { model, owned, conn, fits, rec: recommend(model, sys, tes), gpu: sys ? gpuName(sys) : null, budget: sys ? sys.budget : null,
    needsUpdate: !!conn.ok && !sys };
}

// What a diffusion model also needs (text encoders, VAE), from ComfyUI's own workflow templates (Model Librarian 1.13.0+).
async function companions(baseModel, fileName) {
  const { conn } = await load();
  if (!conn.ok) return { companions: [], offline: true };
  try {
    return await comfy.api(conn.base, "/ext/companions", { method: "POST", body: { base_model: baseModel, file_name: fileName } });
  } catch (e) {
    return { companions: [], error: e.status === 404 || e.status === 405 ? "update" : e.message };
  }
}

// ---------------------------------------------------------------- messages from the page and the popup
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg && msg.type) {
      case "model": return modelInfo(msg.page);
      case "companions": return companions(msg.baseModel, msg.fileName);
      case "enqueue": {
        const out = await withQueue((q) => Q.enqueue(q, msg.item));
        pump();
        return { ok: true, item: out.item, added: out.added };
      }
      case "state": return load();
      case "retry": await withQueue((q) => ({ queue: Q.retry(q, msg.key) })); pump(); return { ok: true };
      case "remove": await withQueue((q) => ({ queue: Q.remove(q, msg.key) })); return { ok: true };
      case "clear": await withQueue((q) => ({ queue: Q.clearFinished(q) })); return { ok: true };
      case "settings": {
        const base = msg.base ? comfy.normalizeBase(msg.base) : "";
        await chrome.storage.local.set({ settings: { base } });
        await pump();
        return load();
      }
      case "pump": await pump(); return load();
      default: return { error: "unknown message" };
    }
  })().then(reply, (e) => reply({ error: String(e && e.message || e) }));
  return true; // answers asynchronously
});

// ---------------------------------------------------------------- wake-ups
chrome.runtime.onInstalled.addListener(() => { setupRules(); pump(); });
chrome.runtime.onStartup.addListener(() => { setupRules(); pump(); });
chrome.alarms.create("pump", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "pump") pump(); });
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && tab.url && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(tab.url)) pump();
});
chrome.storage.local.get({ queue: [] }).then(({ queue }) => updateBadge(queue));
setupRules();
