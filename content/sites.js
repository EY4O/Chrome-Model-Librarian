// A "Model Librarian" panel on HuggingFace file pages and CivArchive pages.
//  - HuggingFace: the file on the page, into the ComfyUI folder you pick (guessed from its path and name).
//  - CivArchive: every file the page links by SHA256: already yours, or its live copies (CivitAI re-uploads,
//    HuggingFace mirrors) planned into the right folder by Model Librarian; other hosts as links. On a model
//    page, CivitAI's own download is offered first (CivArchive mirrors CivitAI's ids).
// Like the CivitAI panel, it lives in a shadow root and follows the address (both sites are single-page apps).
(() => {
  if (window.__mlSites) return;
  window.__mlSites = true;

  const FOLDERS = ["checkpoints", "diffusion_models", "loras", "text_encoders", "vae", "clip_vision", "controlnet", "upscale_models",
    "embeddings", "model_patches", "audio_encoders", "style_models"];
  const MODEL_EXT = /\.(safetensors|sft|gguf|ckpt|pt|pth|bin)$/i;

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8e8ea; }
    .pill { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 10px; border-radius: 999px; border: 1px solid #3a3d46;
      background: rgba(22,23,28,.92); color: #e8e8ea; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35); font: 600 12.5px system-ui, sans-serif; }
    .pill:hover { border-color: #2f7cf6; }
    img.ic { width: 18px; height: 18px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #777; flex: none; }
    .dot.ok { background: #3fb950; } .dot.wait { background: #d29922; }
    .panel { width: 380px; max-height: 70vh; overflow: auto; border-radius: 12px; border: 1px solid #3a3d46; background: rgba(22,23,28,.97); box-shadow: 0 12px 32px rgba(0,0,0,.45); }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2f37; font-weight: 600; }
    .head .x { margin-left: auto; background: none; border: 0; color: #9a9aa3; font-size: 18px; cursor: pointer; }
    .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
    .dim { color: #9a9aa3; font-size: 12px; } .warn { color: #e3b341; font-size: 12px; } .err { color: #f0727e; font-size: 12px; } .ok { color: #3fb950; }
    .item { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #2c2f37; border-radius: 9px; background: #191a20; }
    .item .meta { flex: 1; min-width: 0; } .fn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    button.dl { flex: none; border: 0; border-radius: 8px; padding: 6px 12px; background: #2f7cf6; color: white; font: 600 12px system-ui, sans-serif; cursor: pointer; }
    button.dl.ghost { background: #2c2f37; color: #e8e8ea; }
    a.lnk { color: #7fb0ff; font-size: 12px; }
    select { background: #111216; color: #e8e8ea; border: 1px solid #3a3d46; border-radius: 7px; padding: 4px 6px; font: inherit; }
    .state { flex: none; font-size: 12px; } .q { color: #e3b341; }
  `;
  const ICON = chrome.runtime.getURL("icons/icon32.png");
  const host = document.createElement("div");
  host.id = "model-librarian-ext";
  const root = host.attachShadow({ mode: "open" });
  const wrap = Object.assign(document.createElement("div"), { className: "wrap" });
  root.append(Object.assign(document.createElement("style"), { textContent: CSS }), wrap);

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  };
  const fmtSize = (b) => {
    if (!b) return "";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`;
  };
  // after the extension is updated or reloaded, this page's script is cut off from it: say so once, plainly
  const STALE_MSG = "Model Librarian for Chrome was updated: reload this page to use it again.";
  const send = (msg) => new Promise((res) => {
    if (!chrome.runtime?.id) return res({ error: STALE_MSG });
    try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? { error: /context invalidated/i.test(chrome.runtime.lastError.message) ? STALE_MSG : chrome.runtime.lastError.message } : r)); }
    catch (e) { res({ error: /context invalidated/i.test(String(e.message || e)) ? STALE_MSG : String(e.message || e) }); }
  });

  // A model file's ComfyUI folder, guessed from its path (Comfy-Org repos use the folder names) and name.
  function guessFolder(path) {
    const p = path.toLowerCase();
    const seg = FOLDERS.find((f) => p.split("/").includes(f)) || (p.split("/").includes("unet") ? "diffusion_models" : p.split("/").includes("clip") ? "text_encoders" : null);
    if (seg) return seg;
    const n = p.split("/").pop();
    if (/vae/.test(n)) return "vae";
    if (/lora|lycoris|locon/.test(n)) return "loras";
    if (/(^|[_-])(t5|umt5|clip_[lg]|qwen.*vl|gemma|llama|text_?enc)/.test(n)) return "text_encoders";
    if (/controlnet|control_/.test(n)) return "controlnet";
    if (/esrgan|upscale|\dx[_-]/.test(n)) return "upscale_models";
    if (n.endsWith(".gguf")) return "diffusion_models";
    return "checkpoints";
  }

  const s = { page: null, key: null, open: false, queue: [], conn: { ok: false }, folder: null, plan: null, files: {}, retries: {}, error: null };

  function page() {
    if (location.hostname === "huggingface.co") {
      const m = location.pathname.match(/^\/([^/]+\/[^/]+)\/(blob|resolve)\/([^/]+)\/(.+)$/);
      if (!m || !MODEL_EXT.test(m[4])) return null;
      let path = m[4];
      try { path = decodeURIComponent(m[4]); } catch {} // a malformed %-escape: the path as it is
      return { site: "hf", url: `https://huggingface.co/${m[1]}/blob/${m[3]}/${m[4]}`, repo: m[1], path, name: path.split("/").pop() };
    }
    if (/(^|\.)civarchive\.com$/.test(location.hostname)) {
      const shaPath = location.pathname.match(/^\/sha256\/([0-9a-f]{64})/i);
      const model = location.pathname.match(/^\/models\/(\d+)/);
      const v = new URLSearchParams(location.search).get("modelVersionId");
      if (!shaPath && !model) return null;
      return { site: "ca", sha: shaPath ? shaPath[1].toLowerCase() : null, modelId: model ? Number(model[1]) : null, versionId: v && /^\d+$/.test(v) ? Number(v) : null };
    }
    return null;
  }

  const keyOfUrl = (url, folder) => `u:${url}|${folder}`.toLowerCase();
  const planKey = (d) => `p:${d.folder}/${d.rel}`.toLowerCase();
  const stateLabel = (q, fallback) => {
    if (!q) return fallback;
    if (q.status === "downloading") return h("span", { class: "state" }, q.total ? `${Math.floor((100 * q.done) / q.total)}%` : "Starting…");
    if (q.status === "queued") return h("span", { class: "state q" }, s.conn.ok ? "Sending…" : "Queued");
    if (q.status === "done" || q.status === "have") return h("span", { class: "state ok", title: q.dest || "" }, q.status === "done" ? "✓ Downloaded" : "✓ In your library");
    if (q.status === "error" || q.status === "cancelled") return h("button", { class: "dl ghost", title: q.error || "Cancelled", onclick: () => send({ type: "retry", key: q.key }) }, "Retry");
    if (q.status === "scheduled") return h("span", { class: "state q", title: q.why || "" }, `⏰ ${new Date(q.notBefore).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
    return fallback;
  };

  // ---------------------------------------------------------------- HuggingFace
  async function planHf() {
    const p = s.page;
    s.plan = null;
    render();
    const r = await send({ type: "urlPlan", url: p.url, folder: s.folder });
    if (s.page === p) { s.plan = r; render(); }
  }

  function hfBody(body) {
    const p = s.page;
    const q = s.queue.find((x) => x.key === keyOfUrl(p.url, s.folder));
    const plan = s.plan || {};
    body.append(h("div", { class: "item" },
      h("div", { class: "meta" }, h("div", { class: "fn", title: p.path }, p.name), h("div", { class: "dim" }, p.repo, plan.size ? ` · ${fmtSize(plan.size)}` : ""),
        plan.error ? h("div", { class: "err" }, plan.error) : null),
      stateLabel(q, plan.status === "have" ? h("span", { class: "state ok" }, "✓ In your library")
        : h("button", { class: "dl", onclick: () => send({ type: "enqueue", item: { kind: "url", url: p.url, folder: s.folder, title: `${p.repo}: ${p.name}`, file: p.name, size: plan.size || null, pageUrl: p.url } }) }, "Download"))));
    body.append(h("div", { class: "row", style: "display:flex;align-items:center;gap:8px" }, h("span", { class: "dim" }, "Into"),
      h("select", { onchange: (e) => { s.folder = e.target.value; planHf(); } }, FOLDERS.map((f) => h("option", { value: f, selected: f === s.folder }, f))),
      h("span", { class: "dim" }, `/${p.name}`)));
    body.append(h("div", { class: "dim" }, "The folder is a guess from the file's path and name: change it if it's wrong. The SHA256 HuggingFace lists is checked."));
  }

  // ---------------------------------------------------------------- CivArchive
  function shasOnPage() {
    const found = new Map();
    if (s.page.sha) found.set(s.page.sha, document.title.replace(/\s*[-|·].*$/, "") || s.page.sha.slice(0, 12));
    for (const a of document.querySelectorAll('a[href*="/sha256/"]')) {
      const m = a.getAttribute("href").match(/\/sha256\/([0-9a-f]{64})/i);
      if (m && !found.has(m[1].toLowerCase())) found.set(m[1].toLowerCase(), (a.textContent || "").trim().slice(0, 80) || m[1].slice(0, 12));
    }
    return [...found].slice(0, 12);
  }

  function lookupFiles() {
    for (const [sha] of shasOnPage()) {
      if (s.files[sha]) continue;
      s.files[sha] = { loading: true };
      send({ type: "civarchive", sha256: sha }).then((r) => {
        s.files[sha] = r || { error: "No answer" };
        if (!r || r.error) { // asked again later, waiting longer each time (not every 15 s for ever)
          const tries = (s.retries[sha] = (s.retries[sha] || 0) + 1);
          if (tries <= 5) setTimeout(() => { if (s.files[sha] === r || !r) delete s.files[sha]; }, 15000 * 2 ** (tries - 1));
        }
        render();
      });
    }
  }

  function caBody(body) {
    const p = s.page;
    if (p.versionId) {
      const key = `${p.versionId}:primary`;
      const q = s.queue.find((x) => x.key === key);
      body.append(h("div", { class: "item" },
        h("div", { class: "meta" }, h("div", { class: "fn" }, "From CivitAI"), h("div", { class: "dim" }, "If CivitAI still has this version (CivArchive mirrors its ids)")),
        stateLabel(q, h("button", { class: "dl", onclick: () => send({ type: "enqueue", item: { versionId: p.versionId, title: `CivitAI version ${p.versionId}`, pageUrl: location.href } }) }, "Download"))));
    }
    const shas = shasOnPage();
    if (!shas.length) body.append(h("div", { class: "dim" }, "No files with a SHA256 on this page yet."));
    for (const [sha, label] of shas) {
      const r = s.files[sha] || { loading: true };
      const rows = [];
      if (r.loading) rows.push(h("div", { class: "dim" }, "Asking Model Librarian…"));
      else if (r.error) rows.push(h("div", { class: "err" }, r.error));
      else if (r.status === "have") rows.push(h("div", { class: "ok" }, `✓ In your library: ${r.folder}/${r.rel}`));
      else if (r.status === "unknown" || r.status === "none") rows.push(h("div", { class: "dim" }, "No live copy to download."));
      for (const d of r.downloads || []) {
        const q = s.queue.find((x) => x.key === planKey(d));
        rows.push(h("div", { class: "item" }, h("div", { class: "meta" }, h("div", { class: "fn" }, `Copy on ${d.via}`), h("div", { class: "dim" }, `${d.folder}/${d.rel}${d.size ? ` · ${fmtSize(d.size)}` : ""}`)),
          stateLabel(q, h("button", { class: "dl", onclick: () => send({ type: "enqueue", item: { kind: "plan", download: d, title: r.name ? `${r.name}${r.version ? ` — ${r.version}` : ""}` : d.rel, file: d.rel.split("/").pop(), size: d.size, pageUrl: location.href } }) }, "Download"))));
      }
      for (const l of r.links || []) rows.push(h("a", { class: "lnk", href: l.url, target: "_blank", rel: "noopener noreferrer" }, `Copy on ${l.via} ↗`));
      body.append(h("div", { style: "display:flex;flex-direction:column;gap:5px;padding-top:6px;border-top:1px solid #2c2f37" },
        h("div", { class: "fn", title: sha }, r.name || label, r.removed ? h("span", { class: "warn" }, " · removed from CivitAI") : null), ...rows));
    }
  }

  // ---------------------------------------------------------------- the panel
  function render() {
    if (root.activeElement && root.activeElement.tagName === "SELECT") { // don't close a list someone has open
      root.activeElement.addEventListener("blur", () => render(), { once: true });
      return;
    }
    wrap.replaceChildren();
    if (!s.page) return void host.remove();
    if (!host.isConnected) document.documentElement.append(host);
    const dot = h("span", { class: "dot " + (s.conn.ok ? "ok" : "wait"), title: s.conn.ok ? `ComfyUI at ${s.conn.base}` : (s.conn.error || "ComfyUI isn't running") });
    if (!s.open) {
      wrap.append(h("button", { class: "pill", onclick: () => { s.open = true; if (s.page.site === "hf") planHf(); else lookupFiles(); render(); } },
        h("img", { class: "ic", src: ICON, alt: "" }), "Download with Model Librarian", dot));
      return;
    }
    const body = h("div", { class: "body" });
    if (!s.conn.ok) body.append(h("div", { class: "dim" }, `${s.conn.error || "ComfyUI isn't running"}. Downloads wait in the extension and start when it is.`));
    if (s.page.site === "hf") hfBody(body); else caBody(body);
    if (s.error) body.append(h("div", { class: "err" }, s.error));
    wrap.append(h("div", { class: "panel" }, h("div", { class: "head" }, h("img", { class: "ic", src: ICON, alt: "" }), "Model Librarian", dot,
      h("button", { class: "x", title: "Close", onclick: () => { s.open = false; render(); } }, "×")), body));
  }

  function sync() {
    const p = page();
    const key = p ? JSON.stringify(p) : null;
    if (key === s.key) { if (s.open && p && p.site === "ca") { lookupFiles(); } return; }
    Object.assign(s, { key, page: p, plan: null, files: {}, error: null, folder: p && p.site === "hf" ? guessFolder(p.path) : null });
    if (s.open && p) { if (p.site === "hf") planHf(); else lookupFiles(); }
    render();
  }

  chrome.storage.local.get({ queue: [], conn: { ok: false } }, (st) => { Object.assign(s, { queue: st.queue, conn: st.conn }); render(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.queue) s.queue = ch.queue.newValue || [];
    if (ch.conn) {
      const was = s.conn.ok;
      s.conn = ch.conn.newValue || { ok: false };
      if (!was && s.conn.ok && s.open && s.page) { s.files = {}; if (s.page.site === "hf") planHf(); else lookupFiles(); } // connected now: ask again
    }
    render();
  });
  sync();
  if (window.navigation) navigation.addEventListener("navigatesuccess", () => setTimeout(sync, 50));
  setInterval(sync, 1000);
})();
