// "+ Character" beside each character tag on a booru post (Danbooru, Gelbooru, Safebooru, e621): a panel on the page
// sorts that character's usual look into appearance, outfit and skip (from Danbooru's related tags and the post), and
// files it into Model Librarian's character list, or leaves it for the Gallery when ComfyUI isn't running. The service
// worker reads the post and Danbooru (lib/booru.js); a Gelbooru-style page sends the tag groups it shows.
(() => {
  if (window.__mlCharacters) return;
  window.__mlCharacters = true;
  const host = location.hostname.replace(/^www\./, "");
  const donmai = /(^|\.)donmai\.us$/.test(host);
  const e621 = /^(e621|e926)\.net$/.test(host);
  const q = new URLSearchParams(location.search);
  const isPost = donmai || e621 ? /^\/posts\/\d+/.test(location.pathname) : q.get("page") === "post" && q.get("s") === "view";
  if (!isPost) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const show = (t) => String(t || "").replace(/_/g, " ");

  // ---------------------------------------------------------------- what the page shows
  function tagFromRow(li) {
    const named = li.dataset.tagName || li.dataset.name;
    if (named) return named;
    const a = [...li.querySelectorAll('a[href*="tags="], a.search-tag')].pop();
    if (!a) return "";
    try { return new URL(a.getAttribute("href"), location.href).searchParams.get("tags") || a.textContent.trim(); } catch { return a.textContent.trim(); }
  }
  const characterRows = () => donmai || e621
    ? [...document.querySelectorAll(".character-tag-list li, li.tag-character, li[data-category='character']")]
    : [...document.querySelectorAll('li[class*="tag-type-character"]')];

  // Gelbooru-style tag rows (class tag-type-*), the rating and the picture: Danbooru and e621 are read through their JSON instead
  function groups() {
    const g = { character: [], copyright: [], general: [], rating: "", preview: "" };
    for (const li of document.querySelectorAll('li[class*="tag-type-"]')) {
      const type = (li.className.match(/tag-type-(\w+)/) || [])[1] || "general";
      const name = tagFromRow(li);
      if (name && g[type] && type !== "rating") g[type].push(name.replace(/_/g, " "));
    }
    const row = [...document.querySelectorAll("li, div")].find((el) => el.childElementCount < 3 && /^\s*Rating:\s*\w+/i.test(el.textContent));
    g.rating = row ? row.textContent.match(/^\s*Rating:\s*(\w+)/i)[1] : "";
    const img = document.querySelector("#image, #image-container img, img#img");
    g.preview = img ? img.currentSrc || img.src : "";
    return g;
  }

  // ---------------------------------------------------------------- the panel
  const box = document.createElement("div");
  const root = box.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; }
    .panel { position: fixed; z-index: 2147483001; top: 12px; right: 12px; bottom: 12px; width: 380px; max-width: calc(100vw - 24px); display: flex; flex-direction: column;
      background: #16171c; color: #e8e8ea; border: 1px solid #2f323b; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; transform: translateX(16px); opacity: 0; transition: transform .2s ease-out, opacity .2s ease-out; }
    .panel.open { transform: none; opacity: 1; }
    .panel[hidden] { display: none; }
    @media (prefers-reduced-motion: reduce) { .panel, .chip { transition: none; } }
    header, footer { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
    header { border-bottom: 1px solid #2f323b; font-size: 14px; }
    header img { width: 20px; height: 20px; }
    header h2 { margin: 0; font-size: 14px; flex: 1; outline: none; }
    footer { border-top: 1px solid #2f323b; flex-wrap: wrap; }
    .body { flex: 1; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
    .dim { color: #9a9aa3; font-size: 12px; }
    .err { color: #f0727e; font-size: 12px; }
    .ok { color: #3fb950; }
    .card { border: 1px solid #2f323b; border-radius: 10px; background: #1d1f25; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .card.off { opacity: .6; }
    .row { display: flex; align-items: center; gap: 8px; }
    .title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    label.f { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #9a9aa3; flex: 1; min-width: 0; }
    input[type=text] { background: #0f1014; color: #e8e8ea; border: 1px solid #2f323b; border-radius: 7px; padding: 6px 8px; font: inherit; min-width: 0; }
    input[type=text]:focus-visible, button:focus-visible, input[type=checkbox]:focus-visible { outline: 2px solid #2f7cf6; outline-offset: 1px; }
    input[type=checkbox] { margin: 0; accent-color: #2f7cf6; width: 15px; height: 15px; }
    button { border: 0; border-radius: 7px; padding: 6px 12px; background: #2f7cf6; color: #fff; font: 600 12px system-ui, sans-serif; cursor: pointer; }
    button:hover { filter: brightness(1.12); }
    button:disabled { opacity: .5; cursor: default; filter: none; }
    button.ghost { background: #2c2f37; color: #e8e8ea; }
    button.x { background: none; color: #9a9aa3; font-size: 18px; line-height: 1; padding: 2px 6px; }
    .seg { display: flex; border: 1px solid #2f323b; border-radius: 8px; overflow: hidden; }
    .seg button { flex: 1; border-radius: 0; background: transparent; color: #9a9aa3; font-weight: 500; padding: 5px 8px; }
    .seg button[aria-pressed=true] { background: #2c2f37; color: #e8e8ea; font-weight: 600; }
    .group { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #9a9aa3; margin-top: 2px; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .chip { display: inline-flex; gap: 4px; align-items: baseline; padding: 3px 9px; border-radius: 999px; border: 1px solid #2f323b; background: #24262d; color: #e8e8ea;
      font: 500 12px system-ui, sans-serif; transition: background .15s, border-color .15s; }
    .chip:hover { filter: none; border-color: #4a4f5c; }
    .chip i { font-style: normal; color: #9a9aa3; font-size: 11px; }
    .chip.appearance { background: rgba(47,124,246,.18); border-color: rgba(47,124,246,.45); }
    .chip.outfit { background: rgba(227,179,65,.15); border-color: rgba(227,179,65,.45); }
    .chip.skip { background: transparent; color: #9a9aa3; }
    .spacer { flex: 1; }
    .status { width: 100%; }
  </style><aside class="panel" hidden role="dialog" aria-modal="false" aria-labelledby="ml-chars-h">
    <header><img alt=""><h2 id="ml-chars-h" tabindex="-1">Add to your characters</h2><button type="button" class="x" data-act="close" aria-label="Close">×</button></header>
    <div class="body"></div>
    <footer><span class="status dim" role="status"></span><span class="spacer"></span><button type="button" class="ghost" data-act="close">Close</button><button type="button" data-act="save">Save</button></footer>
  </aside>`;
  root.querySelector("header img").src = chrome.runtime.getURL("icons/icon32.png");
  const panel = root.querySelector(".panel"), body = root.querySelector(".body"), status = root.querySelector(".status"), saveBtn = root.querySelector('[data-act="save"]');
  document.documentElement.append(box);

  const NEXT = { appearance: "outfit", outfit: "skip", skip: "appearance" };
  const MAX = 12;  // characters saved at once (the service worker's limit)
  const FIELDS = new Set(["name", "series", "outfitName"]);  // the only things an input on the panel sets
  let state = null; // {post, drafts, failed, skipped, busy, done}
  let opener = null;  // what had the focus when the panel opened: it gets it back
  // a message to the service worker; after the extension was updated this page's script can't reach it any more
  const send = (msg) => {
    try { return chrome.runtime.sendMessage(msg).catch((e) => ({ error: e.message })); }
    catch { return Promise.resolve({ error: "The extension was updated: reload this page" }); }
  };

  function chip(d, i, j) {
    const x = d.buckets[j];
    const pct = x.f == null ? "" : `<i>${Math.round(x.f * 100)}%</i>`;
    return `<button type="button" class="chip ${x.b}" data-act="move" data-i="${i}" data-j="${j}" aria-label="${esc(show(x.t))}: ${x.b}, click to move to ${NEXT[x.b]}">${esc(show(x.t))}${pct}</button>`;
  }
  function card(d, i) {
    const n = (b) => d.buckets.filter((x) => x.b === b).length;
    const chips = (b) => d.buckets.map((x, j) => (x.b === b ? chip(d, i, j) : "")).join("") || '<span class="dim">None</span>';
    const kv = [d.postCount ? `${d.postCount.toLocaleString()} ${d.soloLook ? "solo " : ""}posts on Danbooru` : "From this post only", d.have ? `you have ${esc(d.have.name)}` : ""].filter(Boolean).join(" · ");
    return `<section class="card${d.include ? "" : " off"}" aria-label="${esc(d.name)}">
      <label class="row"><input type="checkbox" data-act="pick" data-i="${i}" ${d.include ? "checked" : ""}><span class="title">${esc(d.name)}</span></label>
      <div class="dim">${esc(show(d.tag))} · ${kv}</div>
      ${d.include ? `
      ${d.have ? `<div class="seg" role="group" aria-label="What to do">${[["outfit", `Add as outfit to ${d.have.name}`], ["new", "New character"]].map(([v, l]) =>
        `<button type="button" data-act="mode" data-i="${i}" data-v="${v}" aria-pressed="${d.mode === v}">${esc(l)}</button>`).join("")}</div>` : ""}
      <div class="row">${!d.have || d.mode === "new" ? `<label class="f">Name<input type="text" data-field="name" data-i="${i}" value="${esc(d.name)}" spellcheck="false"></label>
        <label class="f">Series<input type="text" data-field="series" data-i="${i}" value="${esc(d.series)}" spellcheck="false"></label>` : ""}
        <label class="f">Outfit name<input type="text" data-field="outfitName" data-i="${i}" value="${esc(d.outfitName)}" spellcheck="false"></label></div>
      <div class="group">Appearance · ${n("appearance")}</div><div class="chips">${chips("appearance")}</div>
      <div class="group">Outfit · ${n("outfit")}</div><div class="chips">${chips("outfit")}</div>
      <div class="group">Skip · ${n("skip")}</div><div class="chips">${chips("skip")}</div>` : ""}
    </section>`;
  }
  function draw() {
    if (!state) return;
    const picked = state.drafts ? state.drafts.filter((d) => d.include).length : 0;
    saveBtn.hidden = !!state.done;
    saveBtn.disabled = !!state.busy || !picked || picked > MAX;
    saveBtn.textContent = state.busy === "saving" ? "Saving…" : picked > MAX ? `Up to ${MAX} at a time` : picked > 1 ? `Save ${picked} characters` : "Save";
    if (state.busy === "reading") { body.innerHTML = `<p class="dim">${e621 ? "Reading the post…" : "Reading the post and Danbooru…"}</p>`; return; }
    if (state.error) { body.innerHTML = `<p class="err">${esc(state.error)}</p>`; return; }
    if (state.done) {
      body.innerHTML = state.done.map((r) => `<div class="card"><div class="title">${esc(r.name)}</div><div class="${r.error ? "err" : "dim"}">${esc(r.error ||
        (r.where === "ml" ? (r.created ? "Added to your characters in Model Librarian." : "Added to your character in Model Librarian.")
          : r.why === "update" ? "Left for the Gallery, which adds it while it's open: this ComfyUI's Model Librarian is older than 1.24.0 (update it to file characters straight away)."
            : "Left for the Gallery: ComfyUI isn't running, so the Gallery adds it to your characters while it's open."))}</div></div>`).join("");
      return;
    }
    if (!state.drafts.length) { body.innerHTML = '<p class="dim">This post has no character tags.</p>'; return; }
    body.innerHTML = `${state.failed && state.failed.length ? `<p class="err">Danbooru didn't answer for ${esc(state.failed.map(show).join(", "))}: only this post's tags are sorted.</p>` : ""}
      ${state.skipped && state.skipped.length ? `<p class="dim">Not asked of Danbooru (a post with many characters): ${esc(state.skipped.map(show).join(", "))}. Their tags come from this post only.</p>` : ""}
      ${state.drafts.map(card).join("")}
      <p class="dim">Click a tag to move it: appearance → outfit → skip. The % is how often it's on the character's posts.</p>`;
  }

  async function open(tag) {
    if (panel.hidden) opener = document.activeElement;
    const mine = state = { busy: "reading", drafts: [] };
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("open"));
    status.textContent = "";
    draw();
    root.getElementById("ml-chars-h").focus();
    const msg = { type: "charDraft", url: location.href, tag };
    if (!donmai && !e621) msg.groups = groups();
    const r = await send(msg);
    if (state !== mine) return;  // (closed, or another opened, meanwhile)
    state = r && !r.error ? { post: r.post, drafts: r.drafts, failed: r.failed, skipped: r.skipped } : { error: (r && r.error) || "Couldn't read this post", drafts: [] };
    draw();
  }
  function close() {
    panel.classList.remove("open");
    panel.hidden = true;
    state = null;
    if (opener && opener.isConnected) opener.focus?.();
  }
  async function save() {
    const mine = state;
    const chosen = mine.drafts.filter((d) => d.include);
    if (!chosen.length || chosen.length > MAX) return;
    mine.busy = "saving";
    draw();
    const r = await send({ type: "charSave", post: mine.post, drafts: chosen });
    for (const x of (r && r.results) || []) if (!x.error) markButtons(x.tag);  // (saved, whatever the panel shows now)
    if (state !== mine) return;
    state.busy = null;
    if (!r || r.error) { status.textContent = (r && r.error) || "Couldn't save"; status.className = "status err"; draw(); return; }
    state.done = r.results;
    const ok = r.results.filter((x) => !x.error).length;
    status.textContent = ok ? `Saved ${ok} of ${r.results.length}` : "Nothing saved";
    status.className = `status ${ok ? "ok" : "err"}`;
    draw();
  }

  // what has the focus, found again after the panel is drawn again
  const keyOf = (el) => (el && el.dataset ? ["act", "i", "j", "v", "field"].map((k) => el.dataset[k] != null ? `[data-${k}="${el.dataset[k]}"]` : "").join("") : "");
  const keepFocus = (fn) => {
    const k = keyOf(root.activeElement);
    fn();
    if (k) root.querySelector(k)?.focus();
  };

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !state) return;
    const d = state.drafts && state.drafts[+el.dataset.i];
    const act = el.dataset.act;
    if (act === "close") return close();
    if (act === "save") return save();
    if (act === "move" && d) {
      const x = d.buckets[+el.dataset.j];
      x.b = NEXT[x.b];
      el.focus();
      keepFocus(draw);
    }
    if (act === "mode" && d) {
      d.mode = el.dataset.v;
      if (d.mode === "new" && d.have) d.outfitName = "default";
      else if (d.have) d.outfitName = `post ${state.post.id}`;
      el.focus();
      keepFocus(draw);
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.act === "pick" && state) { state.drafts[+el.dataset.i].include = el.checked; keepFocus(draw); }
  });
  root.addEventListener("input", (e) => {
    const el = e.target;
    if (FIELDS.has(el.dataset.field) && state && state.drafts[+el.dataset.i]) state.drafts[+el.dataset.i][el.dataset.field] = el.value;
  });
  // keys typed in the panel are the panel's: the site's own shortcuts (next post, edit tags...) don't see them
  root.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  for (const t of ["keyup", "keypress"]) root.addEventListener(t, (e) => e.stopPropagation());

  // ---------------------------------------------------------------- the buttons beside the tags
  const style = document.createElement("style");
  style.textContent = `.ml-char-add { margin-left: 6px; padding: 0 9px; height: 22px; border-radius: 999px; border: 1px solid #2f7cf6; background: transparent;
    color: inherit; font: 600 11px/20px system-ui, sans-serif; cursor: pointer; vertical-align: middle; opacity: .8; transition: opacity .15s, background .15s; }
    @media (prefers-reduced-motion: reduce) { .ml-char-add { transition: none; } }
    .ml-char-add:hover, .ml-char-add:focus-visible { opacity: 1; background: #2f7cf6; color: #fff; }
    .ml-char-add[data-state="done"] { border-color: #3fb950; opacity: 1; }`;
  document.head.append(style);
  function markButtons(tag) {
    for (const b of document.querySelectorAll(".ml-char-add")) if (b.dataset.tag && show(b.dataset.tag).toLowerCase() === show(tag).toLowerCase()) {
      b.dataset.state = "done";
      b.textContent = "✓ Character";
    }
  }
  function addButtons() {
    for (const li of characterRows()) {
      if (li.querySelector(".ml-char-add")) continue;
      const tag = tagFromRow(li);
      if (!tag) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ml-char-add";
      btn.dataset.tag = tag;
      btn.textContent = "+ Character";
      btn.title = `Add ${show(tag)} to your characters (Model Librarian)`;
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); opener = btn; open(tag); });
      li.append(btn);
    }
  }
  addButtons();

  // the right-click menu's "Add characters from this post" (when the page's tag list isn't one this knows)
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "charOpen") { open(null); reply({ ok: true }); }
    return false;
  });
})();
