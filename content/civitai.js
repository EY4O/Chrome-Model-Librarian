// A "Model Librarian" panel on CivitAI model pages: the version on the page, its files, and
// a Download button per file. Clicks go to the extension's queue, which hands them to Model
// Librarian in ComfyUI (now, or as soon as ComfyUI is running). CivitAI is a single-page
// app, so the panel follows the address; the model's details come from CivitAI's API (via
// the extension), not from the page markup. Everything lives in a shadow root, so the
// site's styles and ours never mix.
(() => {
  if (window.__mlCivitai) return;
  window.__mlCivitai = true;

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8e8ea; }
    .pill { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 10px; border-radius: 999px; border: 1px solid #3a3d46;
      background: rgba(22,23,28,.92); color: #e8e8ea; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35); font: 600 12.5px system-ui, sans-serif; }
    .pill:hover { border-color: #2f7cf6; }
    .pill img, .head img { width: 18px; height: 18px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #777; flex: none; }
    .dot.ok { background: #3fb950; } .dot.wait { background: #d29922; }
    .panel { width: 360px; max-height: 70vh; overflow: auto; border-radius: 12px; border: 1px solid #3a3d46; background: rgba(22,23,28,.97);
      box-shadow: 0 12px 32px rgba(0,0,0,.45); }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2f37; font-weight: 600; }
    .head .x { margin-left: auto; background: none; border: 0; color: #9a9aa3; font-size: 18px; cursor: pointer; line-height: 1; }
    .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
    .name { font-weight: 600; font-size: 14px; }
    .dim { color: #9a9aa3; font-size: 12px; }
    .warn { color: #e3b341; font-size: 12px; }
    .err { color: #f0727e; font-size: 12px; }
    select { width: 100%; background: #111216; color: #e8e8ea; border: 1px solid #3a3d46; border-radius: 8px; padding: 6px 8px; font: inherit; }
    .file { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #2c2f37; border-radius: 9px; background: #191a20; }
    .file .meta { flex: 1; min-width: 0; }
    .file .fn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button.dl { flex: none; border: 0; border-radius: 8px; padding: 6px 12px; background: #2f7cf6; color: white; font: 600 12px system-ui, sans-serif; cursor: pointer; }
    button.dl:hover { background: #4a8ff8; }
    button.dl.ghost { background: #2c2f37; color: #e8e8ea; }
    .state { flex: none; font-size: 12px; text-align: right; min-width: 92px; }
    .ok { color: #3fb950; } .q { color: #e3b341; }
    .bar { height: 4px; border-radius: 2px; background: #2c2f37; overflow: hidden; margin-top: 4px; }
    .bar > div { height: 100%; background: #2f7cf6; }
    .fit { font-size: 11.5px; margin-top: 3px; }
    .fit.good { color: #7ee2a8; } .fit.slow { color: #e3b341; } .fit.no { color: #f0727e; }
    .file.best { border-color: #2f7cf6; }
    .tag { display: inline-block; font-size: 10.5px; font-weight: 700; color: #fff; background: #2f7cf6; border-radius: 5px; padding: 0 5px; margin-right: 5px; }
    .rec { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 9px; background: rgba(47,124,246,.12); border: 1px solid rgba(47,124,246,.45); font-size: 12px; }
    .rec b { color: #fff; }
    .rec button { margin-left: auto; flex: none; border: 0; border-radius: 7px; padding: 4px 9px; background: #2f7cf6; color: #fff; font: 600 11.5px system-ui, sans-serif; cursor: pointer; }
  `;

  const ICON = chrome.runtime.getURL("icons/icon32.png");
  const host = document.createElement("div");
  host.id = "model-librarian-ext";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  root.append(style, wrap);

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
  const send = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r)); }
    catch (e) { res({ error: String(e.message || e) }); } // the extension was reloaded: this page needs a refresh
  });

  const s = { page: null, key: null, open: false, info: null, error: null, versionId: null, queue: [], conn: { ok: false } };

  function page() {
    const m = location.pathname.match(/^\/models\/(\d+)/);
    if (!m) return null;
    const v = new URLSearchParams(location.search).get("modelVersionId");
    return { host: location.hostname.replace(/^www\./, ""), modelId: Number(m[1]), versionId: v && /^\d+$/.test(v) ? Number(v) : null };
  }

  async function loadModel() {
    const p = s.page;
    s.info = null;
    s.error = null;
    render();
    const r = await send({ type: "model", page: p });
    if (s.page !== p) return; // navigated away meanwhile
    if (r && r.model) {
      s.info = r;
      s.conn = r.conn || s.conn;
      const ids = r.model.versions.map((v) => v.id);
      s.versionId = ids.includes(p.versionId) ? p.versionId : ids[0] || null;
    } else s.error = (r && r.error) || "Couldn't read this model";
    render();
  }

  function stateOf(v, f) {
    const key = (fid) => `${v.id}:${fid || "primary"}`;
    const item = s.queue.find((x) => x.key === key(f.id)) || (f.primary ? s.queue.find((x) => x.key === key(null)) : null);
    if (item) return item;
    const owned = s.info?.owned?.[String(v.id)]?.status;
    if (owned === "have" && f.primary) return { status: "have" };
    if (owned === "downloading" && f.primary) return { status: "downloading", done: 0, total: 0 };
    return null;
  }

  async function download(v, f) {
    const m = s.info.model;
    const r = await send({ type: "enqueue", item: {
      versionId: v.id, fileId: f.id, title: `${m.name} — ${v.name}`, file: f.name, size: f.size,
      pageUrl: `https://${s.page.host}/models/${m.id}?modelVersionId=${v.id}`,
    } });
    if (r && r.error) { s.error = r.error; render(); }
  }

  function fileRow(v, f) {
    const st = stateOf(v, f);
    let right;
    if (!st) {
      right = h("button", { class: "dl", onclick: () => download(v, f) }, "Download");
    } else if (st.status === "queued") {
      right = h("div", { class: "state q", title: s.conn.ok ? "Being handed to Model Librarian" : "Starts as soon as ComfyUI is running" },
        s.conn.ok ? "Sending…" : "Queued");
    } else if (st.status === "downloading") {
      const pct = st.total ? Math.floor((100 * st.done) / st.total) : 0;
      right = h("div", { class: "state" }, st.total ? `${pct}%` : "Starting…", h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })));
    } else if (st.status === "done" || st.status === "have") {
      right = h("div", { class: "state ok", title: st.dest || "" }, st.status === "done" ? "✓ Downloaded" : "✓ In your library");
    } else if (st.status === "error" || st.status === "cancelled") {
      right = h("button", { class: "dl ghost", title: st.error || "Cancelled", onclick: () => send({ type: "retry", key: st.key }) }, "Retry");
    }
    const fit = s.info.fits && s.info.fits[f.id];
    const best = s.info.rec && s.info.rec.fileId === f.id;
    const mark = { good: "✓", slow: "◐", no: "✗" }[fit && fit.verdict] || "";
    return h("div", { class: "file" + (best ? " best" : "") },
      h("div", { class: "meta" },
        h("div", { class: "fn", title: f.name }, best ? h("span", { class: "tag" }, "★ Best for you") : null, f.name || "file"),
        h("div", { class: "dim" }, [f.label, fmtSize(f.size), f.primary ? "primary" : null].filter(Boolean).join(" · ")),
        fit && fit.notes.length ? h("div", { class: "fit " + fit.verdict, title: fit.notes.join("\n") }, `${mark} ${fit.notes.join(" · ")}`) : null,
        st && st.status === "error" ? h("div", { class: "err" }, st.error) : null),
      right);
  }

  function versionMark(v) {
    const rec = s.info.rec;
    if (rec && rec.versionId === v.id) return "★ ";
    const order = { good: 3, slow: 2, no: 1 };
    let best = null;
    for (const f of v.files) {
      const fit = s.info.fits && s.info.fits[f.id];
      if (fit && (!best || order[fit.verdict] > order[best])) best = fit.verdict;
    }
    return { good: "✓ ", slow: "◐ ", no: "✗ " }[best] || "";
  }

  function render() {
    wrap.replaceChildren();
    if (!s.page) return void host.remove();
    if (!host.isConnected) document.documentElement.append(host);
    const dot = h("span", { class: "dot " + (s.conn.ok ? "ok" : "wait"), title: s.conn.ok ? `ComfyUI at ${s.conn.base}` : (s.conn.error || "ComfyUI isn't running") });
    if (!s.open) {
      wrap.append(h("button", { class: "pill", onclick: () => { s.open = true; render(); } }, h("img", { src: ICON, alt: "" }), "Download with Model Librarian", dot));
      return;
    }
    const body = h("div", { class: "body" });
    if (s.error && !s.info) body.append(h("div", { class: "err" }, s.error));
    else if (!s.info) body.append(h("div", { class: "dim" }, "Reading the model…"));
    else {
      const m = s.info.model;
      const v = m.versions.find((x) => x.id === s.versionId) || m.versions[0];
      body.append(h("div", { class: "name" }, m.name), h("div", { class: "dim" }, [m.type, m.creator && `by ${m.creator}`].filter(Boolean).join(" · ")));
      if (!m.downloadable) body.append(h("div", { class: "warn" }, `A ${m.type || "file of this kind"} isn't a model ComfyUI loads, so Model Librarian doesn't download it.`));
      else if (!v) body.append(h("div", { class: "dim" }, "This model has no versions to download."));
      else {
        const rec = s.info.rec;
        const rv = rec && m.versions.find((x) => x.id === rec.versionId);
        const rf = rv && rv.files.find((x) => x.id === rec.fileId);
        if (rv && rf) {
          body.append(h("div", { class: "rec", title: ((s.info.fits[rf.id] || {}).notes || []).join("\n") },
            h("div", null, `★ Best for your ${s.info.gpu}: `, h("b", null, rv.name), ` · ${fmtSize(rf.size)}`),
            rv.id !== v.id ? h("button", { onclick: () => { s.versionId = rv.id; render(); } }, "Show") : null));
        }
        if (m.versions.length > 1) {
          body.append(h("select", { onchange: (e) => { s.versionId = Number(e.target.value); render(); } },
            m.versions.map((x) => h("option", { value: x.id, selected: x.id === v.id }, `${versionMark(x)}${x.name}${x.baseModel ? ` · ${x.baseModel}` : ""}`))));
        } else body.append(h("div", { class: "dim" }, `${v.name}${v.baseModel ? ` · ${v.baseModel}` : ""}`));
        if (v.earlyAccess) body.append(h("div", { class: "warn" }, "Early access: the download may need a purchase and your CivitAI key in Model Librarian."));
        const rank = (f) => (rec && rec.fileId === f.id ? 0 : { good: 1, slow: 2, no: 3 }[(s.info.fits[f.id] || {}).verdict] || 2);
        body.append(...[...v.files].sort((a, b) => rank(a) - rank(b)).map((f) => fileRow(v, f)));
        if (s.info.needsUpdate) body.append(h("div", { class: "dim" }, "Update Model Librarian to 1.12.0 or newer to see which file suits your PC."));
        else if (!s.conn.ok) body.append(h("div", { class: "dim" }, "With ComfyUI running, the panel also shows which file suits your PC."));
        if (!s.conn.ok) body.append(h("div", { class: "dim" }, `${s.conn.error || "ComfyUI isn't running"}. Downloads wait in the extension and start when it is.`));
        else if (s.conn.civitaiKey === false) body.append(h("div", { class: "dim" }, "Tip: some models need your CivitAI key, set in Model Librarian's Settings."));
      }
      if (s.error) body.append(h("div", { class: "err" }, s.error));
    }
    wrap.append(h("div", { class: "panel" },
      h("div", { class: "head" }, h("img", { src: ICON, alt: "" }), "Model Librarian", dot,
        h("button", { class: "x", title: "Close", onclick: () => { s.open = false; render(); } }, "×")),
      body));
  }

  function sync() {
    const p = page();
    const key = p ? `${p.host}/${p.modelId}/${p.versionId || ""}` : null;
    if (key === s.key) return;
    const sameModel = p && s.page && p.modelId === s.page.modelId;
    s.key = key;
    s.page = p;
    if (!p) return render();
    if (sameModel && s.info) { // another version of the same model: no new lookup
      if (s.info.model.versions.some((v) => v.id === p.versionId)) s.versionId = p.versionId;
      return render();
    }
    loadModel();
  }

  chrome.storage.local.get({ queue: [], conn: { ok: false } }, (st) => { s.queue = st.queue; s.conn = st.conn; render(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.queue) s.queue = ch.queue.newValue || [];
    if (ch.conn) {
      const was = s.conn.ok;
      s.conn = ch.conn.newValue || { ok: false };
      if (!was && s.conn.ok && s.page && s.info) loadModel(); // connected now: library status and fit
    }
    render();
  });
  sync();
  // pushState from the page's own scripts isn't visible here, so watch the address.
  if (window.navigation) navigation.addEventListener("navigatesuccess", () => setTimeout(sync, 50));
  setInterval(sync, 800);
})();
