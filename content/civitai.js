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
    .needs { display: flex; flex-direction: column; gap: 5px; padding-top: 4px; border-top: 1px solid #2c2f37; }
    .needs .row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .needs .row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .needs .h { font-size: 12px; font-weight: 600; }
    .item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid #2c2f37; border-radius: 9px; background: #191a20; }
    .item .meta { flex: 1; min-width: 0; }
    .kind { font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: #9a9aa3; letter-spacing: .4px; }
    .prompt { font-size: 12px; color: #c9c9cf; max-height: 54px; overflow: hidden; }
    .acts { display: flex; flex-wrap: wrap; gap: 6px; }
    .choices { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .choices button { padding: 0; border: 1px solid #2c2f37; border-radius: 7px; background: #111; cursor: pointer; aspect-ratio: 1; overflow: hidden; position: relative; }
    .choices img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .choices .nometa { position: absolute; inset: auto 0 0 0; font-size: 9.5px; background: rgba(0,0,0,.7); color: #e3b341; }
    .thumb { width: 54px; height: 54px; object-fit: cover; border-radius: 7px; flex: none; }
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

  const s = { page: null, key: null, open: false, info: null, error: null, versionId: null, queue: [], conn: { ok: false }, needs: {},
    recipe: null, imageUrl: null, saved: false, prompto: null, withNeeds: true, later: [], collected: null };

  function page() {
    const host = location.hostname.replace(/^www\./, "");
    const col = location.pathname.match(/^\/collections\/(\d+)/);
    if (col) return { kind: "collection", host, id: Number(col[1]), url: `https://${host}/collections/${col[1]}` };
    const im = location.pathname.match(/^\/(images|posts)\/(\d+)/);
    if (im) return { kind: im[1] === "images" ? "image" : "post", host, id: Number(im[2]), url: `https://${host}/${im[1]}/${im[2]}` };
    const m = location.pathname.match(/^\/models\/(\d+)/);
    if (!m) return null;
    const v = new URLSearchParams(location.search).get("modelVersionId");
    return { kind: "model", host, modelId: Number(m[1]), versionId: v && /^\d+$/.test(v) ? Number(v) : null };
  }

  // ---------------------------------------------------------------- an image or post: every model it used
  async function loadRecipe(url) {
    const p = s.page;
    Object.assign(s, { recipe: null, error: null, saved: false, sentPrompto: false, imageUrl: url });
    render();
    const r = await send({ type: "recipe", url });
    if (s.page !== p) return;
    if (r && (r.recipe || r.choices)) s.recipe = r;
    else s.error = (r && r.error) || "Couldn't read this image's generation data";
    if (s.prompto === null) send({ type: "promptoStatus" }).then((x) => { s.prompto = !!(x && x.recipe); render(); });
    render();
  }

  const KINDS = { checkpoint: "Checkpoint", lora: "LoRA", vae: "VAE", embedding: "Embedding", unet: "Diffusion model", upscaler: "Upscaler" };
  const planKey = (d) => `p:${d.folder}/${d.rel}`.toLowerCase();
  const itemState = (it) => (it.download ? s.queue.find((x) => x.key === planKey(it.download)) : null);

  const freeLater = (it) => !!(it.available_at && Date.parse(it.available_at) > Date.now());

  function getItem(it, later = false) {
    return send({ type: "enqueue", item: { kind: "plan", download: it.download, title: `${KINDS[it.kind] || it.kind}: ${it.name}${it.version ? ` (${it.version})` : ""}`,
      file: it.download.rel.split("/").pop(), size: it.download.size || null, pageUrl: it.page_url || it.download.page_url || "",
      ...(later && freeLater(it) ? { notBefore: Date.parse(it.available_at) + AFTER_FREE, why: it.note } : {}) } });
  }

  function recipeRow(it) {
    const q = itemState(it);
    let right;
    if (it.status === "present" || (q && ["done", "have"].includes(q.status))) right = h("span", { class: "state ok", title: it.local || "" }, "✓ In your library");
    else if (q && q.status === "downloading") right = h("span", { class: "state" }, q.total ? `${Math.floor((100 * q.done) / q.total)}%` : "Starting…");
    else if (q && q.status === "queued") right = h("span", { class: "state q" }, s.conn.ok ? "Sending…" : "Queued");
    else if (q && q.status === "scheduled") right = h("div", { class: "state q", title: q.why || "" }, `⏰ ${day(q.notBefore)}`,
      h("div", null, h("button", { class: "dl ghost", style: "padding:2px 8px;margin-top:3px", onclick: () => send({ type: "retry", key: q.key }) }, "Try now")));
    else if (q && q.status === "error") right = h("div", { class: "acts" },
      h("button", { class: "dl ghost", title: q.error || "", onclick: () => send({ type: "retry", key: q.key }) }, "Retry"),
      freeLater(it) ? h("button", { class: "dl", onclick: () => send({ type: "schedule", key: q.key, until: it.available_at, why: it.note }) }, `Wait for ${day(it.available_at)}`) : null);
    else if (it.download && freeLater(it)) right = h("div", { class: "acts" },
      h("button", { class: "dl", title: `Waits in the downloads list and starts by itself after ${day(it.available_at)}`, onclick: () => getItem(it, true) }, `Get it on ${day(it.available_at)}`),
      h("button", { class: "dl ghost", title: "If you've bought it on CivitAI", onclick: () => getItem(it) }, "Try now"));
    else if (it.download) right = h("button", { class: "dl", onclick: () => getItem(it) }, "Download");
    else right = h("span", { class: "state dim", title: it.note || "" }, "Not available");
    return h("div", { class: "item" },
      h("div", { class: "meta" },
        h("div", { class: "kind" }, KINDS[it.kind] || it.kind, it.weight != null && it.kind === "lora" ? ` · ${it.weight}` : ""),
        h("div", { class: "fn", title: it.name }, it.name, it.version ? h("span", { class: "dim" }, ` · ${it.version}`) : null),
        it.download ? h("div", { class: "dim" }, [`${it.download.folder}/${it.download.rel}`, fmtSize(it.download.size)].filter(Boolean).join(" · ")) : null,
        it.note ? h("div", { class: it.status === "unavailable" || /purchase/i.test(it.note) ? "warn" : "dim" }, it.note) : null,
        q && q.status === "error" ? h("div", { class: "err" }, q.error) : null),
      right);
  }

  function recipeBody(body) {
    if (s.error && !s.recipe) return body.append(h("div", { class: "err" }, s.error),
      s.page.kind === "post" && s.imageUrl !== s.page.url ? h("button", { class: "dl ghost", onclick: () => loadRecipe(s.page.url) }, "Back to the post's images") : null);
    if (!s.recipe) return body.append(h("div", { class: "dim" }, s.conn.ok ? "Reading the image's generation data…" : (s.conn.error || "ComfyUI isn't running") + ". Model Librarian reads the image when it is."));
    const r = s.recipe;
    if (r.choices) {
      return body.append(h("div", { class: "name" }, "Which image?"), h("div", { class: "dim" }, "Pick one to see the models it used."),
        h("div", { class: "choices" }, r.choices.slice(0, 24).map((c) => h("button", { title: c.has_meta ? "" : "No generation data", onclick: () => loadRecipe(c.url) },
          c.thumb ? h("img", { src: c.thumb, alt: "" }) : "?", c.has_meta ? null : h("span", { class: "nometa" }, "no data")))));
    }
    const rec = r.recipe || {};
    const items = r.items || [];
    const missing = items.filter((it) => it.status !== "present" && it.download && !itemState(it) && !freeLater(it));
    body.append(h("div", { class: "row", style: "display:flex;gap:8px;align-items:center" },
      r.thumb ? h("img", { class: "thumb", src: r.thumb, alt: "" }) : null,
      h("div", { style: "min-width:0" }, h("div", { class: "name" }, rec.title || "This image's recipe"),
        h("div", { class: "prompt", title: (rec.prompt && rec.prompt.positive) || "" }, (rec.prompt && rec.prompt.positive) || "(no prompt)"))));
    if (!items.length) body.append(h("div", { class: "dim" }, "No models are named in its generation data."));
    body.append(...items.map(recipeRow));
    body.append(h("div", { class: "acts" },
      missing.length ? h("button", { class: "dl", onclick: () => missing.forEach((it) => getItem(it)) }, `Get ${missing.length === 1 ? "the missing model" : `all ${missing.length} missing`}`) : null,
      h("button", { class: "dl ghost", disabled: s.saved, onclick: async () => {
        const x = await send({ type: "saveRecipe", recipe: rec, thumb: r.thumb || null });
        if (x && x.error) s.error = x.error; else s.saved = true;
        render();
      } }, s.saved ? "✓ Saved in Recipes" : "Save as recipe"),
      s.prompto ? h("button", { class: "dl ghost", disabled: s.sentPrompto, onclick: async () => {
        const { comfy, ...plain } = rec;
        const x = await send({ type: "prompto", recipe: plain, thumb: r.thumb || null });
        if (x && x.error) s.error = x.error; else s.sentPrompto = true;
        render();
      } }, s.sentPrompto ? "✓ Sent to Prompto" : "Send to Prompto") : null,
      s.page.kind === "post" ? h("button", { class: "dl ghost", onclick: () => loadRecipe(s.page.url) }, "Other images") : null));
    if (s.error) body.append(h("div", { class: "err" }, s.error));
    if (!s.conn.ok) body.append(h("div", { class: "dim" }, "Downloads wait in the extension and start when ComfyUI is running."));
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

  const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const AFTER_FREE = 15 * 60 * 1000;

  async function download(v, f, later = false) {
    const m = s.info.model;
    const r = await send({ type: "enqueue", item: {
      versionId: v.id, fileId: f.id, title: `${m.name} — ${v.name}`, file: f.name, size: f.size,
      pageUrl: `https://${s.page.host}/models/${m.id}?modelVersionId=${v.id}`,
      ...(later && v.accessUntil ? { notBefore: Date.parse(v.accessUntil) + AFTER_FREE, why: v.access } : {}),
    } });
    if (r && r.error) { s.error = r.error; render(); return; }
    // the text encoder and VAE it needs, with it (unless switched off, or you have them in some precision)
    const main = mainFile(v);
    if (s.withNeeds && main && main.id === f.id) {
      const n = s.needs[`${v.baseModel}|${f.name}`];
      for (const c of missingNeeds(n && n.companions)) getCompanion(v, f, c);
    }
  }

  const missingNeeds = (list) => (list || []).filter((c) => !c.have && !c.alt && !s.queue.some((x) => x.key === `c:${c.name.toLowerCase()}`));

  function setWithNeeds(on) {
    s.withNeeds = on;
    send({ type: "settings", withNeeds: on });
    render();
  }

  function fileRow(v, f) {
    const st = stateOf(v, f);
    let right;
    if (!st && v.accessUntil) { // paid / early access for now: wait for it, or try now (bought it?)
      right = h("div", { class: "acts" },
        h("button", { class: "dl", title: `Waits in the downloads list and starts by itself after ${day(v.accessUntil)}`, onclick: () => download(v, f, true) }, `Get it on ${day(v.accessUntil)}`),
        h("button", { class: "dl ghost", title: "If you've bought it on CivitAI", onclick: () => download(v, f) }, "Try now"));
    } else if (!st) {
      right = h("button", { class: "dl", onclick: () => download(v, f) }, "Download");
    } else if (st.status === "scheduled") {
      right = h("div", { class: "state q", title: st.why || "" }, `⏰ ${day(st.notBefore)}`,
        h("div", null, h("button", { class: "dl ghost", style: "padding:2px 8px;margin-top:3px", onclick: () => send({ type: "retry", key: st.key }) }, "Try now")));
    } else if (st.status === "queued") {
      right = h("div", { class: "state q", title: s.conn.ok ? "Being handed to Model Librarian" : "Starts as soon as ComfyUI is running" },
        s.conn.ok ? "Sending…" : "Queued");
    } else if (st.status === "downloading") {
      const pct = st.total ? Math.floor((100 * st.done) / st.total) : 0;
      right = h("div", { class: "state" }, st.total ? `${pct}%` : "Starting…", h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })));
    } else if (st.status === "done" || st.status === "have") {
      right = h("div", { class: "state ok", title: st.dest || "" }, st.status === "done" ? "✓ Downloaded" : "✓ In your library");
    } else if (st.status === "error" || st.status === "cancelled") {
      right = h("div", { class: "acts" },
        h("button", { class: "dl ghost", title: st.error || "Cancelled", onclick: () => send({ type: "retry", key: st.key }) }, "Retry"),
        v.accessUntil ? h("button", { class: "dl", title: `Retried by itself after ${day(v.accessUntil)}`, onclick: () => send({ type: "schedule", key: st.key, until: v.accessUntil, why: v.access }) }, `Wait for ${day(v.accessUntil)}`) : null);
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

  // What a diffusion model also needs (text encoders, VAE), from ComfyUI's own workflow templates.
  const mainFile = (v) => v.files.find((f) => f.type === "Diffusion Model" || /\.gguf$/i.test(f.name || ""));
  function needsFor(v) {
    const f = mainFile(v);
    if (!f || !s.conn.ok) return null;
    const key = `${v.baseModel}|${f.name}`;
    if (!(key in s.needs)) {
      s.needs[key] = null; // loading
      send({ type: "companions", baseModel: v.baseModel, fileName: f.name }).then((r) => { s.needs[key] = r || { companions: [] }; render(); });
    }
    return { key, file: f, data: s.needs[key] };
  }

  function needsSection(v) {
    const n = needsFor(v);
    if (!n) return null;
    if (!n.data) return h("div", { class: "needs" }, h("div", { class: "dim" }, "Checking what else it needs…"));
    if (n.data.error === "update") return h("div", { class: "needs" }, h("div", { class: "dim" }, "Update Model Librarian to 1.13.0 to see the text encoder and VAE it needs."));
    const list = n.data.companions || [];
    if (!list.length) return null;
    const rows = list.map((c) => {
      const item = s.queue.find((x) => x.key === `c:${c.name.toLowerCase()}`);
      let right;
      if (item && item.status === "downloading") right = h("span", { class: "state" }, item.total ? `${Math.floor((100 * item.done) / item.total)}%` : "Starting…");
      else if (item && item.status === "queued") right = h("span", { class: "state q" }, s.conn.ok ? "Sending…" : "Queued");
      else if (c.have || (item && ["done", "have"].includes(item.status))) right = h("span", { class: "state ok", title: c.have || "" }, "✓ In your library");
      else if (item && item.status === "error") right = h("button", { class: "dl ghost", title: item.error || "", onclick: () => send({ type: "retry", key: item.key }) }, "Retry");
      else right = h("button", { class: "dl", onclick: () => getCompanion(v, n.file, c) }, "Download");
      return h("div", { class: "row" },
        h("div", { class: "nm", title: `${c.folder}/${c.name}${c.alt ? `\nYou have ${c.alt}, the same model in another precision` : ""}` },
          h("span", { class: "dim" }, c.folder === "vae" ? "VAE " : c.folder === "clip_vision" ? "CLIP vision " : "Text encoder "), c.name,
          c.alt && !c.have ? h("div", { class: "dim" }, `≈ you have ${c.alt.split(/[\\/]/).pop()} (other precision)`) : null),
        right);
    });
    const missing = missingNeeds(list);
    return h("div", { class: "needs" },
      h("div", { class: "row" }, h("span", { class: "h" }, "Also needs"),
        h("span", { class: "dim", style: "flex:1" }, `from ComfyUI's ${n.data.family || ""} template`),
        missing.length > 1 ? h("button", { class: "dl ghost", onclick: () => missing.forEach((c) => getCompanion(v, n.file, c)) }, `Get ${missing.length}`) : null),
      ...rows,
      missing.length ? h("label", { class: "row dim", style: "cursor:pointer;gap:6px" },
        h("input", { type: "checkbox", checked: s.withNeeds, onchange: (e) => setWithNeeds(e.target.checked) }),
        "Get the missing ones when I download the model") : null);
  }

  async function getCompanion(v, f, c) {
    const r = await send({ type: "enqueue", item: {
      kind: "companion", name: c.name, folder: c.folder, baseModel: v.baseModel, forFile: f.name,
      title: `${c.folder === "vae" ? "VAE" : c.folder === "clip_vision" ? "CLIP vision" : "Text encoder"} for ${s.info.model.name}`,
      file: c.name, pageUrl: c.url,
    } });
    if (r && r.error) { s.error = r.error; render(); }
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
    if (root.activeElement && root.activeElement.tagName === "SELECT") { // don't close a list someone has open
      root.activeElement.addEventListener("blur", () => render(), { once: true });
      return;
    }
    wrap.replaceChildren();
    if (!s.page) return void host.remove();
    if (!host.isConnected) document.documentElement.append(host);
    const dot = h("span", { class: "dot " + (s.conn.ok ? "ok" : "wait"), title: s.conn.ok ? `ComfyUI at ${s.conn.base}` : (s.conn.error || "ComfyUI isn't running") });
    const isModel = s.page.kind === "model";
    const isCollection = s.page.kind === "collection";
    if (!s.open) {
      wrap.append(h("button", { class: "pill", onclick: () => { s.open = true; if (!isModel && !isCollection && !s.recipe && !s.error) loadRecipe(s.imageUrl || s.page.url); render(); } },
        h("img", { src: ICON, alt: "" }), isModel ? "Download with Model Librarian" : isCollection ? "Get this collection with Model Librarian" : "Get its models with Model Librarian", dot));
      return;
    }
    const body = h("div", { class: "body" });
    if (isCollection) collectionBody(body);
    else if (!isModel) recipeBody(body);
    else if (s.error && !s.info) body.append(h("div", { class: "err" }, s.error));
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
        if (v.access) body.append(h("div", { class: "warn" }, `${v.access}. Your CivitAI key in Model Librarian is enough once you've bought it.`));
        else if (v.earlyAccess) body.append(h("div", { class: "warn" }, "Early access: the download may need a purchase and your CivitAI key in Model Librarian."));
        const rank = (f) => (rec && rec.fileId === f.id ? 0 : { good: 1, slow: 2, no: 3 }[(s.info.fits[f.id] || {}).verdict] || 2);
        body.append(...[...v.files].sort((a, b) => rank(a) - rank(b)).map((f) => fileRow(v, f)));
        const needs = needsSection(v);
        if (needs) body.append(needs);
        if (s.info.needsUpdate) body.append(h("div", { class: "dim" }, "Update Model Librarian to 1.12.0 or newer to see which file suits your PC."));
        else if (!s.conn.ok) body.append(h("div", { class: "dim" }, "With ComfyUI running, the panel also shows which file suits your PC."));
        if (!s.conn.ok) body.append(h("div", { class: "dim" }, `${s.conn.error || "ComfyUI isn't running"}. Downloads wait in the extension and start when it is.`));
        else if (s.conn.civitaiKey === false) body.append(h("div", { class: "dim" }, "Tip: some models need your CivitAI key, set in Model Librarian's Settings."));
      }
      if (s.error) body.append(h("div", { class: "err" }, s.error));
    }
    wrap.append(h("div", { class: "panel" },
      h("div", { class: "head" }, h("img", { src: ICON, alt: "" }), "Model Librarian", dot, isModel ? laterButton() : null,
        h("button", { class: "x", style: isModel ? "margin-left:4px" : "", title: "Close", onclick: () => { s.open = false; render(); } }, "×")),
      body));
  }

  function sync() {
    const p = page();
    const key = !p ? null : p.kind === "model" ? `${p.host}/${p.modelId}/${p.versionId || ""}` : `${p.kind}/${p.id}`;
    if (key === s.key) return;
    const sameModel = p && s.page && p.kind === "model" && s.page.kind === "model" && p.modelId === s.page.modelId;
    s.key = key;
    s.page = p;
    if (!p) return render();
    if (p.kind === "collection") { s.collected = null; return render(); }
    if (p.kind !== "model") { // read when the panel is opened (it asks Model Librarian, which asks CivitAI)
      Object.assign(s, { recipe: null, error: null, saved: false, imageUrl: p.url });
      if (s.open) loadRecipe(p.url);
      return render();
    }
    if (sameModel && s.info) { // another version of the same model: no new lookup
      if (s.info.model.versions.some((v) => v.id === p.versionId)) s.versionId = p.versionId;
      return render();
    }
    loadModel();
  }

  chrome.storage.local.get({ queue: [], conn: { ok: false }, settings: {}, saved: [] }, (st) => {
    Object.assign(s, { queue: st.queue, conn: st.conn, withNeeds: st.settings.withNeeds !== false, later: st.saved });
    render();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.queue) s.queue = ch.queue.newValue || [];
    if (ch.saved) s.later = ch.saved.newValue || [];
    if (ch.settings) s.withNeeds = (ch.settings.newValue || {}).withNeeds !== false;
    if (ch.conn) {
      const was = s.conn.ok;
      s.conn = ch.conn.newValue || { ok: false };
      if (!was && s.conn.ok && s.page && s.page.kind === "model" && s.info) { s.needs = {}; loadModel(); } // connected now: library status, fit, companions
      if (!was && s.conn.ok && s.page && s.page.kind !== "model" && s.open && !s.recipe) loadRecipe(s.imageUrl || s.page.url);
    }
    render();
  });
  // ---------------------------------------------------------------- a collection: every model on the page
  function cardsOnPage() {
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="/models/"]')) {
      if (!a.querySelector("img, video") || a.closest("#model-librarian-ext")) continue;
      const m = a.getAttribute("href").match(/\/models\/(\d+)/);
      if (!m || seen.has(m[1])) continue;
      const name = (a.getAttribute("aria-label") || a.querySelector("img")?.alt || a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70);
      seen.set(m[1], name || `Model ${m[1]}`);
    }
    return [...seen];
  }

  function collectionBody(body) {
    const cards = cardsOnPage();
    const missing = cards.filter(([id]) => { const st = known.get(id); return !st || st.status === "missing"; });
    body.append(h("div", { class: "name" }, "This collection"),
      h("div", { class: "dim" }, `${cards.length} model${cards.length === 1 ? "" : "s"} on the page${missing.length ? `, ${missing.length} not in your library` : ""}. Scroll to load more first: only the ones shown count.`));
    if (missing.length) {
      body.append(h("button", { class: "dl", disabled: s.collected === "working", onclick: async () => {
        s.collected = "working";
        render();
        const r = await send({ type: "getModels", host: s.page.host, modelIds: missing.map(([id]) => id) });
        s.collected = (r && r.results) || [];
        render();
      } }, s.collected === "working" ? "Queueing…" : `Get all ${missing.length} missing (best file for your PC)`));
    }
    if (Array.isArray(s.collected)) {
      const q = s.collected.filter((x) => x.queued).length, have = s.collected.filter((x) => x.have).length;
      const skipped = s.collected.filter((x) => x.skip || x.error);
      body.append(h("div", { class: "dim" }, `${q} queued${have ? `, ${have} already yours` : ""}${skipped.length ? `, ${skipped.length} skipped` : ""}. Progress is in the toolbar popup.`),
        ...skipped.slice(0, 6).map((x) => h("div", { class: "warn" }, `${x.name || `Model ${x.id}`}: ${x.skip || x.error}`)));
    }
    body.append(...cards.slice(0, 40).map(([id, name]) => {
      const st = known.get(id);
      return h("div", { class: "item" }, h("div", { class: "meta" }, h("div", { class: "fn", title: name }, name)),
        h("span", { class: "state " + (st && st.status !== "missing" ? "ok" : "dim") }, !st ? "…" : st.status === "have" ? "✓ Have" : st.status === "update" ? "↑ Update" : ""));
    }));
  }

  // ---------------------------------------------------------------- save for later
  function laterButton() {
    const m = s.info && s.info.model;
    if (!m) return null;
    const on = s.later.some((x) => x.modelId === m.id);
    return h("button", { class: "x", style: "margin-left:auto;font-size:15px", title: on ? "Saved for later (click to remove)" : "Save for later",
      onclick: () => send({ type: "saveForLater", remove: on, entry: { modelId: m.id, name: m.name, type: m.type, url: `https://${s.page.host}/models/${m.id}` } }) }, on ? "★" : "☆");
  }

  // ---------------------------------------------------------------- badges on CivitAI's model cards
  // A small "✓ Have" / "↑ Update" on every card linking to a model you have (by model id, from Model Librarian).
  const known = new Map();
  let asking = false;
  async function badges() {
    if (!s.conn.ok || asking) return;
    const cards = [...document.querySelectorAll('a[href*="/models/"]')].filter((a) => a.querySelector("img, video") && !a.closest("#model-librarian-ext"));
    const idOf = (a) => { const m = a.getAttribute("href").match(/\/models\/(\d+)/); return m ? m[1] : null; };
    const now = Date.now();
    const fresh = [...new Set(cards.map(idOf).filter((id) => id && !(known.get(id)?.at > now - 120000)))]; // asked again after 2 min
    if (fresh.length) {
      asking = true;
      const r = await send({ type: "badges", modelIds: fresh.slice(0, 100) });
      asking = false;
      if (r && !r.error) for (const id of fresh.slice(0, 100)) known.set(id, { ...((r[id]) || { status: "missing" }), at: now });
      if (s.open && s.page && s.page.kind === "collection") render();
    }
    for (const a of cards) {
      const st = known.get(idOf(a));
      const old = a.querySelector(":scope > .ml-badge");
      const want = st && (st.status === "have" || st.status === "update") ? st.status : null;
      if (!want) { if (old) old.remove(); continue; }
      if (old && old.dataset.s === want) continue;
      if (old) old.remove();
      if (getComputedStyle(a).position === "static") a.style.position = "relative";
      const b = document.createElement("span");
      b.className = "ml-badge";
      b.dataset.s = want;
      b.textContent = want === "have" ? "✓ Have" : "↑ Update";
      b.title = want === "have" ? `In your library (Model Librarian)${st.files > 1 ? `: ${st.files} files` : ""}` : `You have it; ${st.update ? st.update.name : "a newer version"} is out`;
      b.style.cssText = "position:absolute;top:8px;left:8px;z-index:20;pointer-events:none;padding:2px 7px;border-radius:999px;font:700 11px/16px system-ui,sans-serif;"
        + (want === "have" ? "background:rgba(22,101,52,.92);color:#dcfce7;" : "background:rgba(47,124,246,.95);color:#fff;");
      a.append(b);
    }
  }
  setInterval(badges, 1500);

  sync();
  // pushState from the page's own scripts isn't visible here, so watch the address.
  if (window.navigation) navigation.addEventListener("navigatesuccess", () => setTimeout(sync, 50));
  setInterval(sync, 800);
})();
