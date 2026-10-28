// Service worker: keeps the download queue, finds ComfyUI, hands downloads to Model Librarian
// and follows their progress. Clicks are stored first, so nothing is lost while ComfyUI is closed:
// the queue is sent when ComfyUI is reachable (checked every 30 s, when a ComfyUI tab opens,
// and right after each click).
import * as comfy from "./lib/comfy.js";
import * as Q from "./lib/queue.js";
import { fetchModel, normalizeModel } from "./lib/civitai.js";
import { assess, recommend, gpuName, needsTextEncoder, textEncoderOf } from "./lib/fit.js";
import { FOLDER, NOTE, fileNameFor, fullSize, noteFor } from "./lib/gallery.js";
import * as B from "./lib/booru.js";

const RULE_ID = 1;
const PIXIV_RULE = 2;  // Pixiv's originals only come with Pixiv as the referrer

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
      removeRuleIds: [RULE_ID, PIXIV_RULE],
      addRules: [{
        id: RULE_ID, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ["127.0.0.1", "localhost"], resourceTypes: ["xmlhttprequest"] },
      }, {
        id: PIXIV_RULE, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://www.pixiv.net/" }] },
        condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ["i.pximg.net"], resourceTypes: ["xmlhttprequest", "image"] },
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

// A collection queued model by model. Its state is in storage, so it carries on if the browser restarts this
// worker part-way (the next pump picks it up).
let collecting = false;
async function runCollect() {
  if (collecting) return;
  collecting = true;
  try {
    for (;;) {
      const { collect } = await chrome.storage.local.get({ collect: null });
      if (!collect || !collect.pending || !collect.pending.length) break;
      const { id, versionId } = collect.pending[0];
      let r;
      try {
        const b = await bestFile(collect.host, id, versionId);
        r = b.item ? { id, name: b.name, queued: (await withQueue((q) => Q.enqueue(q, b.item))).added } : { id, ...b };
      } catch (e) { r = { id, error: e.message }; }
      const { collect: now } = await chrome.storage.local.get({ collect: null });
      if (!now || now.started !== collect.started) break; // a newer one replaced it
      await chrome.storage.local.set({ collect: { ...now, pending: now.pending.slice(1), results: [...now.results, r] } });
      if (r.queued) pump();
    }
  } finally {
    collecting = false;
  }
}

async function pumpOnce() {
  await setupRules();
  chrome.storage.local.get({ collect: null }).then(({ collect }) => { if (collect && collect.pending && collect.pending.length) runCollect(); });
  await withQueue((q) => ({ queue: Q.prune(Q.wake(q)) })); // paid / early access ones whose day has come; old finished ones go
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
      // no answer in time (it may be busy, e.g. reading a big library): tried again, a few times
      res = { error: e.message, transient: e.status === 502 || e.status === 409 || e.status === -1 };
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
    } catch { // that ComfyUI isn't answering right now: tried again next time, and given up on after a while
      await withQueue(async (q) => { const next = Q.markUnreachable(q, b, Date.now()); await notifyChanges(q, next); return { queue: next }; });
    }
  }
  // while something is downloading, follow it closely (the 30 s alarm is the fallback)
  const { queue: after } = await chrome.storage.local.get({ queue: [] });
  clearTimeout(again);
  if (Q.active(after).length || Q.pending(after).length) again = setTimeout(pump, 2000);
}

// ---------------------------------------------------------------- model pages
// A model from CivitAI's public API, or, when that won't show it (mature, or only for signed-in users), from
// Model Librarian 1.21.0+, which asks CivitAI with your key. The key itself never reaches the extension.
async function fetchModelAny(host, modelId) {
  try {
    return await fetchModel(host, modelId);
  } catch (e) {
    const { conn } = await load();
    if (!conn.ok || !comfy.newer(conn.version || "0", "1.21.0")) throw e;
    try {
      return normalizeModel(await comfy.api(conn.base, `/ext/model?id=${encodeURIComponent(modelId)}&raw=1`, { timeout: 30000 }));
    } catch {
      throw e;
    }
  }
}

async function modelInfo(page) {
  const model = await fetchModelAny(page.host, page.modelId);
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

// The file to get for a model when there's no time to choose (a collection, an update, a right-click): the
// best for this PC, else the newest version's primary file. versionId: that version (an update, a version link).
async function bestFile(host, modelId, versionId = null) {
  const info = await modelInfo({ host, modelId });
  const m = info.model;
  if (!m.downloadable) return { skip: `${m.type || "This"} isn't a model ComfyUI loads`, name: m.name };
  const asked = versionId ? m.versions.find((x) => x.id === Number(versionId)) : null;
  if (versionId && !asked) return { skip: "That version isn't on CivitAI any more", name: m.name };
  const v = asked || (info.rec && m.versions.find((x) => x.id === info.rec.versionId)) || m.versions.find((x) => x.files.length);
  const f = v && ((info.rec && info.rec.versionId === v.id && v.files.find((x) => x.id === info.rec.fileId)) || v.files.find((x) => x.primary) || v.files[0]);
  if (!f) return { skip: "No file to download" };
  if ((info.owned[String(v.id)] || {}).status === "have") return { have: true, name: m.name };
  return { item: { versionId: v.id, fileId: f.id, title: `${m.name} — ${v.name}`, file: f.name, size: f.size,
    pageUrl: `https://${host}/models/${m.id}?modelVersionId=${v.id}` }, name: m.name, best: !!info.rec };
}

// ---------------------------------------------------------------- saving pictures for Model Librarian Gallery
// Each picture goes into Downloads\Model Librarian Gallery, and beside it <its name>.mlg.json: the page it's from, the
// artist, the title and the tags, which the Gallery's New downloads reads as it files it. Nothing needs the Gallery to be
// open. Chrome's download bubble is kept quiet meanwhile (two files a picture would fill it).
function downloaded(id, timeout = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    // (asked every few seconds too: a call to Chrome keeps this worker alive through a slow download, where waiting
    // for an event alone may see it stopped; and an event missed is caught)
    const poll = setInterval(() => check().catch(() => {}), 5000);
    const done = (fn, v) => { chrome.downloads.onChanged.removeListener(watch); clearTimeout(t); clearInterval(poll); fn(v); };
    const check = async () => {
      const [d] = await chrome.downloads.search({ id });
      if (!d) return done(reject, new Error("The download went away"));
      if (d.state === "complete") return done(resolve, d);
      if (d.state === "interrupted") return done(reject, new Error(d.error ? `Couldn't download it (${d.error.toLowerCase().replace(/_/g, " ")})` : "Couldn't download it"));
    };
    const watch = (delta) => { if (delta.id === id && delta.state) check(); };
    const t = setTimeout(() => done(reject, new Error("The download took too long")), timeout);
    chrome.downloads.onChanged.addListener(watch);
    check();
  });
}

// a site that only gives its originals with itself as the referrer (a download can't send one: Chrome won't let it)
const REFERRED = /^https:\/\/i\.pximg\.net\//;
let offscreen = null;  // the page being made (two saves at once wait for the same one)
async function hold(url) {
  if (!(await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length) {
    offscreen ||= chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Hold a picture fetched with its site's referrer for the downloader" })
      .catch((e) => { if (!/single offscreen/i.test(e.message)) throw e; }).finally(() => { offscreen = null; });
    await offscreen;
  }
  const r = await chrome.runtime.sendMessage({ target: "offscreen", type: "hold", url });
  if (!r || r.error) throw new Error(r && r.error ? `Couldn't get it: ${r.error}` : "Couldn't get it");
  return r.url;
}

let quiet = 0;  // saves under way: the download bubble comes back when the last one ends
chrome.downloads.setUiOptions?.({ enabled: true }).catch(() => {});  // (a worker stopped mid-save left it off: back on as it starts again)
async function hush(on) {
  quiet += on ? 1 : -1;
  try { await chrome.downloads.setUiOptions({ enabled: quiet <= 0 }); } catch {}
}

// a booru post's characters, for the notes: each as + Character would file it (the post read once for its pictures)
async function withCharacters(list) {
  const posts = new Map();
  for (const it of list) {
    if (!Array.isArray(it.characters) || !it.characters.length || typeof it.characters[0] !== "string") continue;
    const where = B.postOf(String(it.page || ""));
    const tags = it.characters;
    try {
      if (!where || where.page || E_SITES.includes(where.site)) throw new Error("not Danbooru");
      if (!posts.has(where.id)) posts.set(where.id, B.fetchDanbooru(where));
      it.characters = B.noteCharacters(await posts.get(where.id));
    } catch {
      it.characters = tags.slice(0, 12).map((t) => ({ tag: t, name: B.nameFromTag(t) }));  // (Danbooru didn't answer: its name, sorted later)
    }
  }
}

// after a save from a post: the characters in it you don't have yet, offered on the page (content/booru.js)
async function offerCharacters(tabId, list) {
  if (tabId == null) return;
  const tags = [...new Set(list.flatMap((it) => (Array.isArray(it.characters) ? it.characters.map((c) => c.tag) : [])))];
  if (!tags.length) return;
  const known = await knownCharacters().catch(() => []);
  const missing = tags.filter((t) => !known.some((k) => B.norm(k.tag) === B.norm(t)));
  if (missing.length) chrome.tabs.sendMessage(tabId, { type: "charOffer", tags: missing }).catch(() => {});
}

async function gallerySave(items, tabId) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && /^https?:\/\//.test(String(it.src || ""))).slice(0, 200).map((it) => ({ ...it }));
  if (!list.length) return { saved: 0, failed: [], error: "Nothing to save" };
  await withCharacters(list);
  await setupRules();
  await hush(true);
  let saved = 0;
  const failed = [];
  try {
    for (const [i, raw] of list.entries()) {
      const it = { ...raw, src: fullSize(raw.src) };
      try {
        const held = REFERRED.test(it.src) ? await hold(it.src) : null;  // (Pixiv: fetched with its referrer, then downloaded from here)
        const release = () => { if (held) chrome.runtime.sendMessage({ target: "offscreen", type: "release", url: held }).catch(() => {}); };
        const id = await chrome.downloads.download({ url: held || it.src, filename: `${FOLDER}/${fileNameFor(it, list.length > 1 && !it.name ? i : 0)}`,
          conflictAction: "uniquify", saveAs: false }).catch((e) => { release(); throw e; });
        const d = await downloaded(id).finally(release);
        const base = d.filename.split(/[\\/]/).pop();
        const note = JSON.stringify(noteFor(it));
        const noteId = await chrome.downloads.download({ url: `data:application/json;charset=utf-8,${encodeURIComponent(note)}`,
          filename: `${FOLDER}/${base}${NOTE}`, conflictAction: "overwrite", saveAs: false });
        await downloaded(noteId);
        chrome.downloads.erase({ id: noteId }).catch(() => {});  // (out of Chrome's list: they're the Gallery's now)
        chrome.downloads.erase({ id }).catch(() => {});
        saved++;
      } catch (e) {
        failed.push({ src: it.src, error: e.message });
      }
    }
  } finally {
    await hush(false);
  }
  if (saved) offerCharacters(tabId, list);
  return { saved, failed, error: !saved && failed.length ? failed[0].error : undefined };
}

// The pictures of the page in the tab: a known site's reader says (the post's pictures, full size, with their artist);
// elsewhere, the big pictures on the page (the popup asks, so the tab can be read: activeTab).
async function galleryPage(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "galleryPage" });
    if (r && r.items && r.items.length) return r;
  } catch {} // no reader on this page
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const seen = new Set();
    return [...document.images].filter((i) => i.naturalWidth >= 300 && i.naturalHeight >= 200 && /^https?:/.test(i.currentSrc || i.src))
      .map((i) => ({ src: i.currentSrc || i.src, thumb: i.src, page: location.href, title: document.title }))
      .filter((x) => !seen.has(x.src) && seen.add(x.src)).slice(0, 100);
  } }).catch(() => [{}]);
  return { items: result || [], known: false };
}

// a picture right-clicked: what the site's reader knows of it, else the picture and its page
async function saveImage(src, tab) {
  let items = null;
  if (tab && tab.id != null) items = await chrome.tabs.sendMessage(tab.id, { type: "galleryItemsFor", src }).catch(() => null);
  if (!Array.isArray(items) || !items.length) items = [{ src, page: tab && tab.url, title: tab && tab.title }];
  const r = await gallerySave(items, tab && tab.id);
  chrome.notifications?.create(`ml-gallery-${Date.now()}`, { type: "basic", iconUrl: "icons/icon128.png",
    title: r.saved ? `Saved for Model Librarian Gallery${r.saved > 1 ? ` (${r.saved})` : ""}` : "Didn't save it",
    message: r.saved ? `${items[0].artist ? `By ${items[0].artist}. ` : ""}It's in the Gallery's New downloads, ready to file.` : String(r.error || "") });
}

// ---------------------------------------------------------------- characters from booru posts
// "+ Character" on a post (content/booru.js): the post and each character's usual look are read here (lib/booru.js), the
// page's panel sorts them, and each is filed into Model Librarian's character list (1.24.0+). When ComfyUI isn't running,
// or its Model Librarian is older, it's left in Downloads\Model Librarian Gallery instead, for the Gallery to file.
const CHAR_POSTS = ["https://danbooru.donmai.us/posts/*", "https://safebooru.donmai.us/posts/*", "https://e621.net/posts/*", "https://e926.net/posts/*",
  "https://gelbooru.com/index.php*", "https://safebooru.org/index.php*"];
const E_SITES = ["e621", "e926"];
const LOOKS_ASKED = 6;   // characters of one post whose look is asked of Danbooru
const LOOKS_KEPT = 300;  // looks remembered (each for a week)

// your characters by tag: Model Librarian's list when it's there (else as last heard), and the ones left for the Gallery since
async function knownCharacters() {
  const r = await withComfy((base) => comfy.api(base, "/ext/characters", { timeout: 5000 }));
  let { charsKnown, charsLeft } = await chrome.storage.local.get({ charsKnown: [], charsLeft: [] });
  if (r && Array.isArray(r.characters)) {
    charsKnown = r.characters.map((c) => ({ id: c.id, tag: c.tag, name: c.name, aliases: c.aliases || [], series: c.series || "", outfits: c.outfits || [] }));
    charsLeft = charsLeft.filter((x) => !charsKnown.some((k) => B.norm(k.tag) === B.norm(x.tag)));  // (the Gallery has filed it)
    await chrome.storage.local.set({ charsKnown, charsLeft });
  }
  return [...charsKnown, ...charsLeft];
}

async function charDraft(msg) {
  const where = B.postOf(msg.url);
  if (!where) return { error: "This isn't a post Model Librarian can read" };
  const post = where.page ? B.postFromGroups(where, msg.groups || {}) : E_SITES.includes(where.site) ? await B.fetchE621(where) : await B.fetchDanbooru(where);
  const looks = {}, failed = [], skipped = [];
  if (!E_SITES.includes(post.site)) {  // (e621's characters aren't Danbooru's: the post alone says)
    const { looks: cache } = await chrome.storage.local.get({ looks: {} });
    for (const [k, v] of Object.entries(cache)) if (!v || Date.now() - v.at > B.LOOK_DAYS * 864e5) delete cache[k];
    // the one clicked first, then the others, up to LOOKS_ASKED (a group post would be many slow requests)
    const clicked = post.characters.filter((t) => msg.tag && B.norm(t) === B.norm(msg.tag));
    const order = [...clicked, ...post.characters.filter((t) => !clicked.includes(t))];
    let busy = false;
    for (const [i, t] of order.entries()) {
      if (i >= LOOKS_ASKED || busy) { skipped.push(t); continue; }
      try { looks[t] = await B.fetchLook(t, cache); } catch (e) { looks[t] = null; failed.push(t); busy = e.status === 429; }  // (too many requests: no more now)
    }
    const kept = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, LOOKS_KEPT);
    await chrome.storage.local.set({ looks: Object.fromEntries(kept) });
  }
  const known = await knownCharacters();
  return { post, drafts: B.draftsFor(post, looks, known, Array.isArray(msg.only) && msg.only.length ? msg.only : msg.tag), failed, skipped,
    known: known.filter((k) => k.id).map((k) => ({ id: k.id, name: k.name, aliases: k.aliases || [], series: k.series || "", tag: k.tag || "", outfits: k.outfits || [] })) };
}

// a post's preview as a small picture (256 px at most) for the character, as a data: URL
async function smallPicture(src) {
  const res = await fetch(src, { credentials: "omit" });
  if (!res.ok) throw new Error(`The site said ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

async function leaveForGallery(character, picture) {
  await hush(true);
  try {
    const json = JSON.stringify(B.charFile(character, picture));
    const id = await chrome.downloads.download({ url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
      filename: `${FOLDER}/${B.charFileName(character.tag)}`, conflictAction: "uniquify", saveAs: false });
    await downloaded(id);
    chrome.downloads.erase({ id }).catch(() => {});  // (out of Chrome's list: it's the Gallery's now)
  } finally {
    await hush(false);
  }
  const { charsLeft } = await chrome.storage.local.get({ charsLeft: [] });
  const outfits = character.outfit.tags.length ? [character.outfit.name] : [];
  await chrome.storage.local.set({ charsLeft: [{ tag: character.tag, name: character.name, outfits }, ...charsLeft].slice(0, 200) });
}

async function charSave(msg) {
  const post = msg.post || {};
  const where = B.postOf(String(post.url || ""));
  if (!where || !Array.isArray(msg.drafts)) return { error: "Nothing to save" };
  const from = { ...post, site: where.site, id: where.id };  // (the post's own address says which)
  const preview = B.pictureFrom(post.preview);  // (only from the booru's own picture servers)
  const picture = preview && B.isGeneral(from) ? await smallPicture(preview).catch(() => null) : null;
  const results = [];
  for (const d of msg.drafts.slice(0, 12)) {
    if (!d || !Array.isArray(d.buckets) || !d.tag) continue;
    const character = B.importOf(d, from);
    const r = await withComfy((base) => comfy.api(base, "/ext/characters", { method: "POST", body: { character, picture }, timeout: 15000 }));
    if (r && r.character) { results.push({ tag: character.tag, name: r.character.name, where: "ml", created: !!r.created }); continue; }
    // left for the Gallery only when ComfyUI isn't there (or its Model Librarian is too old to take it): any other answer
    // is said as it is (a timeout may have saved it after all: filing it twice would make two)
    const off = !r || r.status === undefined || r.status === 0, old = r && [404, 405].includes(r.status);
    if (!off && !old) {
      results.push({ tag: character.tag, name: character.name,
        error: r.status === -1 ? "Model Librarian didn't answer in time: it may have saved it anyway, so look in Character Select before trying again" : r.error || "Model Librarian couldn't save it" });
      continue;
    }
    try {
      await leaveForGallery(character, picture);
      results.push({ tag: character.tag, name: character.name, where: "gallery", why: old ? "update" : "off" });
    } catch (e) {
      results.push({ tag: character.tag, name: character.name, error: `Couldn't leave it for the Gallery: ${e.message}` });
    }
  }
  return { results };
}

// ---------------------------------------------------------------- messages from the page and the popup
const POPUP_ONLY = new Set(["settings", "clear", "remove", "scan", "galleryPage"]);
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || (msg && msg.target === "offscreen")) return false;
  // the extension's own pages (the popup, even opened in a tab) vs. its scripts running inside web pages
  const fromPage = !String(sender.url || "").startsWith(`chrome-extension://${chrome.runtime.id}/`);
  if (fromPage && msg && POPUP_ONLY.has(msg.type)) { reply({ error: "not from a page" }); return false; }
  if (fromPage && msg && msg.type === "enqueue" && msg.item && msg.item.kind === "plan" && !/^https:\/\//.test((msg.item.download || {}).url || "")) {
    reply({ error: "Only https:// downloads" }); return false;
  }
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
      case "getModels": { // a collection (or its updates): queued one by one in the background, progress in storage
        const items = (msg.items || (msg.modelIds || []).map((id) => ({ id }))).slice(0, 200).map((x) => ({ id: String(x.id), versionId: x.versionId || null }));
        await chrome.storage.local.set({ collect: { started: Date.now(), host: msg.host, page: msg.page || "", what: msg.what || "models",
          total: items.length, pending: items, results: [] } });
        runCollect();
        return { started: true, total: items.length };
      }
      case "getUpdate": { // the newer version a badge points at: its best file
        const r = await bestFile(msg.host, msg.modelId, msg.versionId);
        if (!r.item) return r;
        const q = await withQueue((qq) => Q.enqueue(qq, r.item));
        pump();
        return { queued: q.added, name: r.name, title: r.item.title };
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
      case "gallerySave": return gallerySave(msg.items, fromPage ? sender.tab && sender.tab.id : msg.tabId);
      case "charDraft": return charDraft(msg);
      case "charSave": return charSave(msg);
      case "charList": return withComfy((base) => comfy.api(base, "/ext/characters", { timeout: 5000 }));
      case "charLink": { // a LoRA you have, as one of your characters' (CivitAI's panel)
        if (!/^chr_[a-z0-9]{1,32}$/.test(String(msg.id || "")) || typeof msg.rel !== "string" || !msg.rel) return { error: "Nothing to link" };
        return withComfy((base) => comfy.api(base, `/characters/${msg.id}/lora`, { method: "POST", body: { name: msg.rel } }));
      }
      case "galleryPage": return galleryPage(msg.tabId);
      case "retry": { // in Model Librarian when it still has the download (it carries on from where it stopped)
        const { queue, conn } = await load();
        const x = queue.find((i) => i.key === msg.key);
        if (x && x.jobId && x.status === "error") {
          try {
            const r = await comfy.api(x.base || conn.base, `/jobs/${encodeURIComponent(x.jobId)}/retry`, { method: "POST" });
            if (r && r.job) { await withQueue((q) => ({ queue: Q.resumed(q, x.key, r.job) })); pump(); return { ok: true, resumed: true }; }
          } catch {} // not there any more: sent again from the start
        }
        await withQueue((q) => ({ queue: Q.retry(q, msg.key) }));
        pump();
        return { ok: true };
      }
      case "cancel": { // stop it in Model Librarian too, not just here
        const { queue, conn } = await load();
        const x = queue.find((i) => i.key === msg.key);
        if (x && x.jobId && x.status === "downloading") {
          try { await comfy.api(x.base || conn.base, `/jobs/${encodeURIComponent(x.jobId)}/cancel`, { method: "POST" }); }
          catch (e) { if (e.status !== 404) return { error: `Model Librarian didn't cancel it: ${e.message}` }; }
        }
        await withQueue((q) => ({ queue: Q.cancel(q, msg.key) }));
        return { ok: true };
      }
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
          // its permission goes too (loopback addresses are part of the extension itself)
          if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(patch.forget)) {
            chrome.permissions.remove({ origins: [patch.forget.replace(/\/$/, "") + "/*"] }).catch(() => {});
          }
          delete patch.forget;
        }
        await saveSettings(patch);
        pump(); // the popup isn't kept waiting for a whole send pass
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

// ---------------------------------------------------------------- right-click a CivitAI model link
const LINKS = ["https://civitai.com/models/*", "https://civitai.green/models/*", "https://civitai.red/models/*"];
function setupMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ml-download", title: "Download with Model Librarian", contexts: ["link"], targetUrlPatterns: LINKS });
    chrome.contextMenus.create({ id: "ml-gallery", title: "Save to Model Librarian Gallery", contexts: ["image"] });
    chrome.contextMenus.create({ id: "ml-characters", title: "Add characters from this post", contexts: ["page"], documentUrlPatterns: CHAR_POSTS });
  });
}

async function downloadLink(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  const m = u.pathname.match(/^\/models\/(\d+)/);
  if (!m) return;
  let r;
  try { r = await bestFile(u.hostname, m[1], u.searchParams.get("modelVersionId")); } catch (e) { r = { error: e.message }; }
  let title, message;
  if (r.item) {
    const q = await withQueue((qq) => Q.enqueue(qq, r.item));
    pump();
    title = q.added ? "Queued for Model Librarian" : "Already in the download list";
    message = r.item.title + (r.best ? " (best file for your PC)" : "");
  } else if (r.have) { title = "Already in your library"; message = r.name || ""; }
  else { title = "Couldn't queue it"; message = `${r.name ? r.name + ": " : ""}${r.skip || r.error || ""}`; }
  chrome.notifications?.create(`ml-menu-${Date.now()}`, { type: "basic", iconUrl: "icons/icon128.png", title, message: String(message) });
}
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ml-download" && info.linkUrl) downloadLink(info.linkUrl);
  if (info.menuItemId === "ml-gallery" && info.srcUrl) saveImage(info.srcUrl, tab);
  if (info.menuItemId === "ml-characters" && tab && tab.id != null) openCharacters(tab, info.pageUrl || tab.url);
});

// "Add characters from this post": the page's panel; in a tab opened before the extension was (re)loaded, its script is
// put in first. A page that isn't a post (Gelbooru's lists share its post pages' address) is told so.
async function openCharacters(tab, url) {
  const say = (message) => chrome.notifications?.create(`ml-chars-${Date.now()}`, { type: "basic", iconUrl: "icons/icon128.png", title: "Add characters", message });
  if (!B.postOf(url)) return say("Open a post first: this page isn't one.");
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "charOpen" });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/booru.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "charOpen" });
    } catch (e) { say(`Couldn't open it here: ${e.message}`); }
  }
}

// ---------------------------------------------------------------- wake-ups
chrome.runtime.onInstalled.addListener(() => { setupRules(); setupMenu(); pump(); });
chrome.runtime.onStartup.addListener(() => { setupRules(); setupMenu(); pump(); });
chrome.alarms.create("pump", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "pump") pump(); });
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && tab.url && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(tab.url)) pump();
});
chrome.storage.local.get({ queue: [] }).then(({ queue }) => updateBadge(queue));
setupRules();
