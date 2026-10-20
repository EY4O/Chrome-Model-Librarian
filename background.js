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
const DEFAULT_SETTINGS = { base: "", saved: [], withNeeds: true, notify: true };

async function load() {
  const s = await chrome.storage.local.get({ queue: [], settings: {}, conn: { ok: false } });
  return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
}

async function saveSettings(patch) {
  return locked(async () => {
    const { settings } = await load();
    await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  });
}

// A desktop notification when a download finishes or fails (Settings: on by default).
async function notifyChanges(before, after) {
  const { settings } = await load();
  if (!settings.notify || !chrome.notifications) return;
  const was = new Map(before.map((x) => [x.key, x.status]));
  const changed = after.filter((x) => {
    const prev = was.get(x.key);
    return prev !== x.status && ["done", "error"].includes(x.status) && ["downloading", "queued"].includes(prev);
  });
  if (changed.length > 3) { // a collection's worth at once: one notice, not dozens
    const ok = changed.filter((x) => x.status === "done").length;
    chrome.notifications.create(`ml-batch-${Date.now()}`, { type: "basic", iconUrl: "icons/icon128.png",
      title: ok === changed.length ? `${ok} downloads finished` : `${ok} downloaded, ${changed.length - ok} failed`,
      message: "Details are in the toolbar popup.", priority: ok === changed.length ? 0 : 1 });
    return;
  }
  for (const x of changed) {
    chrome.notifications.create(`ml-${x.key}-${Date.now()}`, {
      type: "basic", iconUrl: "icons/icon128.png",
      title: x.status === "done" ? "Downloaded" : "Download failed",
      message: `${x.title || x.file}${x.status === "error" && x.error ? `: ${x.error}` : x.dest ? `
${x.dest}` : ""}`,
      priority: x.status === "error" ? 1 : 0,
    });
  }
}

// Every change to stored state goes through here, one at a time (clicks, the pump and the popup race otherwise).
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

function withQueue(fn) {
  return locked(async () => {
    const { queue } = await chrome.storage.local.get({ queue: [] });
    const out = await fn(queue);
    if (out && out.queue) {
      await chrome.storage.local.set({ queue: out.queue });
      updateBadge(out.queue);
    }
    return out;
  });
}

function updateBadge(queue) {
  const b = Q.badge(queue);
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
}

// ---------------------------------------------------------------- no Origin header on our own localhost requests
// Requests to ComfyUI wait for this: without the rule, a local ComfyUI refuses them.
let rulesReady = null;
function setupRules() {
  rulesReady = rulesReady || applyRules();
  return rulesReady;
}

async function applyRules() {
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
    const again2 = () => { rerun = null; return pump(); };
    rerun = rerun || pumping.then(again2, again2); // also after a pass that failed
    return rerun;
  }
  pumping = (async () => {
    try { await pumpOnce(); } finally { pumping = null; }
  })();
  return pumping;
}

async function pumpOnce() {
  await setupRules();
  await withQueue((q) => ({ queue: Q.wake(q) })); // paid / early access ones whose day has come
  const { settings, queue } = await load();
  const conn = await comfy.detect(settings.base);
  const { conn: prev } = await chrome.storage.local.get({ conn: {} });
  const { checked, ...prevSame } = prev || {};
  if (JSON.stringify(prevSame) !== JSON.stringify(conn)) await chrome.storage.local.set({ conn: { ...conn, checked: Date.now() } });
  if (!conn.ok) return;
  for (const item of Q.pending(queue)) {
    let res;
    try {
      if (item.kind === "url") {
        res = await comfy.api(conn.base, "/ext/download-url", { method: "POST", body: { url: item.url, folder: item.folder } });
      } else if (item.kind === "plan") { // planned by Model Librarian's recipe reader: its regular download
        const r = await comfy.api(conn.base, "/download", { method: "POST", body: { ...item.download, auto_place: item.download.folder === "checkpoints" } });
        res = { status: "started", job: r.job, dest: r.job && r.job.dest };
      } else res = item.kind === "companion"
        ? await comfy.api(conn.base, "/ext/companion-download", { method: "POST", body: { base_model: item.baseModel, file_name: item.forFile, name: item.name } })
        : await comfy.api(conn.base, "/ext/download", { method: "POST", body: { version_id: item.versionId, file_id: item.fileId } });
    } catch (e) {
      if (e.status === 0) return; // ComfyUI went away: the item stays queued
      res = { error: e.message, transient: e.status === 502 || e.status === 409 };
    }
    await withQueue(async (q) => { const next = Q.applySend(q, item.key, res, Date.now(), conn.base); await notifyChanges(q, next); return { queue: next }; });
  }
  const { queue: now } = await chrome.storage.local.get({ queue: [] });
  const byBase = new Map();
  for (const x of Q.active(now)) {
    const b = x.base || conn.base;
    byBase.set(b, [...(byBase.get(b) || []), x.jobId]);
  }
  for (const [b, ids] of byBase) { // each download is followed on the ComfyUI it went to
    try {
      const { jobs } = await comfy.api(b, `/ext/jobs?ids=${ids.join(",")}`);
      await withQueue(async (q) => { const next = Q.applyJobs(q, jobs, Date.now(), ids); await notifyChanges(q, next); return { queue: next }; });
    } catch {} // that ComfyUI isn't answering right now: try again next time
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

// Calls fn(base) with the connected ComfyUI, or says why it can't.
async function withComfy(fn) {
  await setupRules();
  let { conn } = await load();
  if (!conn.ok) { await pump(); ({ conn } = await load()); }
  if (!conn.ok) return { error: conn.error || "ComfyUI isn't running" };
  try { return await fn(conn.base); } catch (e) { return { error: e.message, status: e.status }; }
}

// Badges on CivitAI's model cards: have / update, by model id (remembered for two minutes).
const badgeCache = new Map();
async function badges(ids) {
  const now = Date.now();
  const want = [...new Set(ids.map(String))].filter((id) => !(badgeCache.get(id)?.at > now - 120000));
  if (want.length) {
    const r = await withComfy((base) => comfy.api(base, "/ext/lookup", { method: "POST", body: { model_ids: want } }));
    if (r && r.models) for (const id of want) badgeCache.set(id, { at: now, v: r.models[id] || { status: "missing" } });
  }
  return Object.fromEntries(ids.map(String).filter((id) => badgeCache.has(id)).map((id) => [id, badgeCache.get(id).v]));
}

// The file to get for a model when there's no time to choose (a collection): the best for this PC,
// else the newest version's primary file.
async function bestFile(host, modelId) {
  const info = await modelInfo({ host, modelId });
  const m = info.model;
  if (!m.downloadable) return { skip: `${m.type || "This"} isn't a model ComfyUI loads` };
  const v = (info.rec && m.versions.find((x) => x.id === info.rec.versionId)) || m.versions.find((x) => x.files.length);
  const f = v && ((info.rec && v.files.find((x) => x.id === info.rec.fileId)) || v.files.find((x) => x.primary) || v.files[0]);
  if (!f) return { skip: "No file to download" };
  if ((info.owned[String(v.id)] || {}).status === "have") return { have: true, name: m.name };
  return { item: { versionId: v.id, fileId: f.id, title: `${m.name} — ${v.name}`, file: f.name, size: f.size,
    pageUrl: `https://${host}/models/${m.id}?modelVersionId=${v.id}` }, name: m.name, best: !!info.rec };
}

// ---------------------------------------------------------------- messages from the page and the popup
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg && msg.type) {
      case "model": return modelInfo(msg.page);
      case "companions": return companions(msg.baseModel, msg.fileName);
      case "recipe": return withComfy((base) => comfy.api(base, "/recipe/analyze", { method: "POST", body: { url: msg.url }, timeout: 60000 }));
      case "saveRecipe": return withComfy((base) => comfy.api(base, "/recipes", { method: "POST", body: { recipe: msg.recipe, thumb: msg.thumb } }));
      case "promptoStatus": return withComfy(async (base) => {
        const st = await comfy.api(base, "/prompto/status", { raw: true }).catch(() => null);
        return { recipe: !!(st && Array.isArray(st.capture_kinds) && st.capture_kinds.includes("recipe")) };
      });
      case "prompto": return withComfy((base) => comfy.api(base, "/prompto/captures", { raw: true, method: "POST",
        body: { kind: "recipe", source: "Model Librarian for Chrome", title: msg.recipe.title || "Recipe", recipe: msg.recipe, thumb: msg.thumb } }));
      case "badges": return badges(msg.modelIds || []);
      case "getModels": { // a collection: each model's best file, queued
        const out = [];
        for (const id of (msg.modelIds || []).slice(0, 100)) {
          try {
            const r = await bestFile(msg.host, id);
            if (r.item) { const q = await withQueue((qq) => Q.enqueue(qq, r.item)); out.push({ id, queued: q.added, name: r.name }); }
            else out.push({ id, ...r });
          } catch (e) { out.push({ id, error: e.message }); }
        }
        pump();
        return { results: out };
      }
      case "saveForLater": return locked(async () => {
        const { saved = [] } = await chrome.storage.local.get({ saved: [] });
        const rest = saved.filter((x) => x.modelId !== msg.entry.modelId);
        await chrome.storage.local.set({ saved: msg.remove ? rest : [{ ...msg.entry, added: Date.now() }, ...rest].slice(0, 200) });
        return { ok: true };
      });
      case "urlPlan": return withComfy((base) => comfy.api(base, "/ext/download-url", { method: "POST", body: { url: msg.url, folder: msg.folder, dry_run: true } }));
      case "civarchive": return withComfy((base) => comfy.api(base, "/ext/civarchive", { method: "POST", body: { sha256: msg.sha256 }, timeout: 45000 }));
      case "enqueue": {
        const out = await withQueue((q) => Q.enqueue(q, msg.item));
        pump();
        return { ok: true, item: out.item, added: out.added };
      }
      case "state": return load();
      case "retry": await withQueue((q) => ({ queue: Q.retry(q, msg.key) })); pump(); return { ok: true };
      case "schedule": await withQueue((q) => ({ queue: Q.schedule(q, msg.key, msg.until, msg.why) })); return { ok: true };
      case "remove": await withQueue((q) => ({ queue: Q.remove(q, msg.key) })); return { ok: true };
      case "clear": await withQueue((q) => ({ queue: Q.clearFinished(q) })); return { ok: true };
      case "settings": { // any of base ("" = find it), saved, notify, withNeeds
        const patch = { ...msg };
        delete patch.type;
        if ("base" in patch) {
          patch.base = patch.base ? comfy.normalizeBase(patch.base) : "";
          const { settings } = await load();
          if (patch.base && !settings.saved.includes(patch.base)) patch.saved = [...settings.saved, patch.base];
        }
        if (patch.forget) {
          const { settings } = await load();
          patch.saved = settings.saved.filter((b) => b !== patch.forget);
          if (settings.base === patch.forget) patch.base = "";
          delete patch.forget;
        }
        await saveSettings(patch);
        await pump();
        return load();
      }
      case "scan": {
        await setupRules();
        const { settings } = await load();
        return comfy.detectAll(settings.saved);
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
