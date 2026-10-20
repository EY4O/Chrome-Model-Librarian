// Talking to Model Librarian inside ComfyUI.
//
// ComfyUI answers 403 to requests whose Origin isn't its own when it runs on a local
// address (127.0.0.1 / localhost), unless it was started with --enable-cors-header.
// The extension's own requests to those addresses go out without an Origin header
// (a declarativeNetRequest rule, set up in background.js), so they work with no
// ComfyUI tab open, which matters for Comfy Desktop (its own window, not a browser tab).
// If ComfyUI still refuses, the request runs inside an open ComfyUI tab instead,
// where it's same-origin (the way Prompto talks to ComfyUI).

export const DEFAULT_PORTS = [8188, 8000, 8189]; // ComfyUI, Comfy Desktop, a second ComfyUI
export const MIN_ML = "1.11.0";
const PREFIX = "/sm-fetcher";

export function normalizeBase(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  const u = new URL(/^https?:\/\//i.test(s) ? s : "http://" + s);
  return u.origin;
}

export const isLoopback = (base) => {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname); } catch { return false; }
};

// Host permission pattern for a base URL. Match patterns cover every port on a host.
export const originPattern = (base) => { const u = new URL(base); return `${u.protocol}//${u.hostname}/*`; };

export const candidates = (saved) => (saved ? [normalizeBase(saved)] : DEFAULT_PORTS.map((p) => `http://127.0.0.1:${p}`));

export function newer(a, b) { // a >= b, for "x.y.z" versions
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return true;
}

async function timed(fetchFn, url, opts = {}, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchFn(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// Runs the request inside an open ComfyUI tab at `base` (same-origin there). null when there's no tab.
async function viaTab(base, path, opts) {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) return null;
  let tabs = [];
  try { tabs = (await chrome.tabs.query({ url: originPattern(base) })).filter((t) => t.url && t.url.startsWith(base)); } catch {}
  if (!tabs.length) return null;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id }, world: "MAIN",
    func: async (url, method, body) => {
      try {
        const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body || undefined });
        return { status: r.status, text: await r.text() };
      } catch (e) { return { status: 0, text: String(e && e.message || e) }; }
    },
    args: [PREFIX + path, opts.method || "GET", opts.body ? JSON.stringify(opts.body) : null],
  });
  return result;
}

// -> parsed JSON. Throws Error(message) with .status (0 = unreachable).
export async function api(base, path, opts = {}, fetchFn = fetch) {
  let status = 0, text = "";
  try {
    const res = await timed(fetchFn, base + PREFIX + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }, opts.timeout || 20000);
    status = res.status;
    text = await res.text();
  } catch (e) {
    throw Object.assign(new Error("ComfyUI isn't reachable"), { status: 0 });
  }
  if (status === 403) {
    const r = await viaTab(base, path, opts).catch(() => null);
    if (r) ({ status, text } = r);
    else throw Object.assign(new Error("ComfyUI refused the extension. Open ComfyUI in a tab, or start it with --enable-cors-header"), { status: 403 });
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (status < 200 || status >= 300) throw Object.assign(new Error((json && json.error) || `ComfyUI answered ${status}`), { status });
  return json;
}

// Which ComfyUI (if any) has Model Librarian, trying the saved address or the usual ports.
// -> {ok, base, version} | {ok:false, error, base?}
export async function detect(saved, fetchFn = fetch) {
  let best = null;
  for (const base of candidates(saved)) {
    try {
      const h = await api(base, "/ext/hello", { timeout: 2500 }, fetchFn);
      if (h && h.app === "model-librarian") {
        if (!newer(h.version, MIN_ML)) return { ok: false, base, error: `Model Librarian ${h.version} is too old: update it to ${MIN_ML} or newer` };
        return { ok: true, base, version: h.version, civitaiKey: !!h.civitai_key, freeBytes: h.free_bytes ?? null, system: h.system || null };
      }
    } catch (e) {
      if (e.status === 404) best = best || { ok: false, base, error: `ComfyUI is running at ${base}, but without Model Librarian ${MIN_ML} or newer` };
      else if (e.status === 403) best = best || { ok: false, base, error: e.message };
    }
  }
  return best || { ok: false, error: saved ? `ComfyUI isn't running at ${normalizeBase(saved)}` : "ComfyUI isn't running" };
}
