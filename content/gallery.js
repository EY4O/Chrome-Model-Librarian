// Saving pictures for Model Librarian Gallery, on the sites the extension knows: a save button on the pictures you
// rest the mouse on, and the answers the right-click menu and the popup's "Save from this page" ask for. Each
// site's reader finds the full picture (not the preview shown), who made it, the post's title and its tags; the
// service worker saves the picture into Downloads\Model Librarian Gallery with that as a note beside it.
(() => {
  if (window.__mlGallery) return;
  window.__mlGallery = true;

  const host = location.hostname;
  const MIN = 150;  // pictures smaller than this (avatars, icons) get no button
  const ext = (u, d = ".jpg") => { const m = String(u).split(/[?#]/)[0].match(/\.([A-Za-z0-9]{2,5})$/); return m ? "." + m[1].toLowerCase() : d; };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const meta = (p, doc = document) => doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || "";
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n"); return d.textContent.trim(); };
  const json = async (url) => { const r = await fetch(url, { credentials: "include" }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  const page = async (url) => new DOMParser().parseFromString(await (await fetch(url, { credentials: "include" })).text(), "text/html");
  const abs = (u, base = location.href) => { try { return new URL(u, base).toString(); } catch { return u; } };

  // ---------------------------------------------------------------- the readers: a post -> its pictures, with what's known
  const pixiv = {
    // the picture's own artwork first (its link, or its file's name), the page's only for the page's own pictures
    id: (img) => (img?.closest("a[href*='/artworks/']")?.getAttribute("href").match(/\/artworks\/(\d+)/) || [])[1]
      || (img?.src.match(/\/(\d+)_p\d+/) || [])[1] || (location.pathname.match(/\/artworks\/(\d+)/) || [])[1],
    async post(id) {
      const [{ body: b }, { body: pages }] = await Promise.all([json(`/ajax/illust/${id}`), json(`/ajax/illust/${id}/pages`)]);
      return pages.map((p) => ({ src: p.urls.original, thumb: p.urls.small || p.urls.thumb_mini, name: p.urls.original.split("/").pop(), page: `https://www.pixiv.net/artworks/${id}`,
        site: "pixiv", post: id, artist: b.userName, artist_url: `https://www.pixiv.net/users/${b.userId}`, title: b.illustTitle || b.title,
        description: plain(b.illustComment || b.description), tags: (b.tags?.tags || []).map((t) => t.tag) }));
    },
    async one(img) {
      const id = this.id(img);
      if (!id) return null;
      const all = await this.post(id);
      const n = Number((img.src.match(/_p(\d+)/) || [])[1] || 0);
      return [all[n] || all[0]];
    },
    async all() { const id = this.id(); return id ? this.post(id) : []; },
  };

  const x = {
    article: (img) => img.closest("article"),
    status(art) {
      const a = [...art.querySelectorAll("a[href*='/status/']")].find((l) => l.querySelector("time")) || art.querySelector("a[href*='/status/']");
      const m = a && a.getAttribute("href").match(/^\/([^/]+)\/status\/(\d+)/);
      return m ? { handle: m[1], id: m[2], when: a.querySelector("time")?.getAttribute("datetime") } : null;
    },
    items(art) {
      const s = this.status(art);
      if (!s) return [];
      const words = text(art.querySelector("[data-testid='tweetText']"));
      // (a quoted post sits inside as a card, a link of its own: its pictures are its author's, not this post's)
      const imgs = [...art.querySelectorAll("img[src*='pbs.twimg.com/media/']")].filter((img) => !img.closest("div[role='link']"));
      return imgs.map((img, i) => {
        const u = new URL(img.src);
        u.searchParams.set("name", "orig");
        const fmt = u.searchParams.get("format") || "jpg";
        const p = (n) => String(n).padStart(2, "0");
        const d = s.when ? new Date(s.when) : null;
        const stamp = d ? `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` : "00000000_000000";
        return { src: u.toString(), thumb: img.src, name: `${s.handle}-${s.id}-${stamp}-img${i + 1}.${fmt}`, page: `https://x.com/${s.handle}/status/${s.id}`,
          site: "x", post: s.id, artist: s.handle, artist_url: `https://x.com/${s.handle}`, title: words.slice(0, 200), description: words.length > 200 ? words : "",
          tags: (words.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.slice(1)) };
      });
    },
    async one(img) { const art = this.article(img); if (!art) return null; const all = this.items(art); return [all.find((i) => i.thumb === img.src) || all[0]].filter(Boolean); },
    async all() {
      const m = location.pathname.match(/\/status\/(\d+)/);
      const arts = [...document.querySelectorAll("article")];
      const main = m ? arts.find((a) => this.status(a)?.id === m[1]) : null;
      return (main ? [main] : arts).flatMap((a) => this.items(a));
    },
  };

  const deviantart = {
    async read(url, doc) {
      const m = new URL(url).pathname.match(/^\/([^/]+)\/art\/(.+?)-(\d+)\/?$/);
      if (!m) return [];
      const [, artist, slug, id] = m;
      const img = doc === document ? document.querySelector("img[property='contentUrl'], img[fetchpriority='high']") : null;
      const src = (img && img.src) || meta("og:image", doc);
      if (!src) return [];
      const title = meta("og:title", doc).replace(/ by .+? on DeviantArt$/i, "") || slug.replace(/-/g, " ");
      return [{ src, thumb: src, name: `${slug.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_by_${artist.toLowerCase()}_d${Number(id).toString(36)}${ext(src)}`,
        page: `https://www.deviantart.com/${artist}/art/${slug}-${id}`, site: "deviantart", post: id, artist, artist_url: `https://www.deviantart.com/${artist}`,
        title, description: meta("og:description", doc), tags: [...doc.querySelectorAll("a[href*='/tag/']")].map(text).filter((t) => t && t.length < 60) }];
    },
    async one(img) {
      const link = img.closest("a[href*='/art/']");
      if (/\/art\//.test(location.pathname) && (!link || abs(link.href) === location.href)) return this.read(location.href, document);
      return link ? this.read(abs(link.href), await page(link.href)) : null;
    },
    async all() { return /\/art\//.test(location.pathname) ? this.read(location.href, document) : []; },
  };

  // Danbooru and e621 say it all as JSON; Gelbooru, Safebooru, yande.re and Konachan are read from the post's page
  const booru = {
    tag: (doc, type) => [...doc.querySelectorAll(`li.tag-type-${type}`)].map((li) => text([...li.querySelectorAll("a[href*='tags=']")].pop())).filter(Boolean),
    named(md5, e, artist, character) {
      const t = (s) => String(s || "").replace(/\s+/g, "_").replace(/[^\w()'-]+/g, "").slice(0, 60);
      return artist ? `__${character ? t(character) + "_" : ""}drawn_by_${t(artist)}__${md5}${e}` : `${md5}${e}`;
    },
    async danbooru(id) {
      const p = await json(`/posts/${id}.json`);
      const artist = (p.tag_string_artist || "").split(" ")[0];
      return [{ src: p.file_url, thumb: p.preview_file_url || p.file_url, name: this.named(p.md5, "." + p.file_ext, artist, (p.tag_string_character || "").split(" ")[0]),
        page: `https://danbooru.donmai.us/posts/${id}`, site: "danbooru", post: String(id), artist: artist.replace(/_/g, " "),
        artist_url: artist ? `https://danbooru.donmai.us/artists/show_or_new?name=${encodeURIComponent(artist)}` : undefined,
        tags: [p.tag_string_character, p.tag_string_copyright, p.tag_string_general].join(" ").split(" ").filter(Boolean).map((t) => t.replace(/_/g, " ")) }];
    },
    async e621(id) {
      const { post: p } = await json(`/posts/${id}.json`);
      const artist = (p.tags.artist || []).find((a) => !["conditional_dnp", "sound_warning", "unknown_artist"].includes(a)) || "";
      return [{ src: p.file.url, thumb: p.preview?.url || p.file.url, name: this.named(p.file.md5, "." + p.file.ext, artist), page: `https://e621.net/posts/${id}`,
        site: "e621", post: String(id), artist: artist.replace(/_/g, " "), description: p.description || "",
        tags: [...(p.tags.character || []), ...(p.tags.species || []), ...(p.tags.general || [])].map((t) => t.replace(/_/g, " ")) }];
    },
    page(doc, url, site) {  // a Gelbooru-like or Moebooru post page
      const orig = doc.querySelector("#highres, a#png, a.original-file-unchanged, a.original-file-changed")?.getAttribute("href")
        || [...doc.querySelectorAll("a")].find((a) => /original image/i.test(a.textContent))?.getAttribute("href")
        || doc.querySelector("#image")?.getAttribute("src") || meta("og:image", doc);
      if (!orig) return [];
      const id = new URL(url).searchParams.get("id") || (url.match(/\/post\/show\/(\d+)/) || [])[1];
      const artist = this.tag(doc, "artist")[0] || "";
      const src = abs(orig, url);
      const md5 = (src.match(/([0-9a-f]{32})/) || [])[1];
      return [{ src, thumb: src, name: md5 ? this.named(md5, ext(src), artist, this.tag(doc, "character")[0]) : undefined, page: url, site, post: id,
        artist: artist.replace(/_/g, " "), tags: [...this.tag(doc, "character"), ...this.tag(doc, "copyright"), ...this.tag(doc, "general")].map((t) => t.replace(/_/g, " ")) }];
    },
    site: () => ({ "danbooru.donmai.us": "danbooru", "e621.net": "e621", "gelbooru.com": "gelbooru", "safebooru.org": "safebooru", "yande.re": "yandere",
      "konachan.com": "konachan", "konachan.net": "konachan" })[host],
    idOf(href) {
      const u = new URL(href, location.href);
      return u.searchParams.get("id") || (u.pathname.match(/\/posts?\/(?:show\/)?(\d+)/) || [])[1];
    },
    async read(id, href) {
      const s = this.site();
      if (s === "danbooru") return this.danbooru(id);
      if (s === "e621") return this.e621(id);
      return this.page(href === location.href ? document : await page(href), href, s);
    },
    async one(img) {
      const link = img.closest("a[href]");
      const here = this.idOf(location.href);
      if (here && (!link || this.idOf(link.href) === here || /#|javascript:/.test(link.getAttribute("href")))) return this.read(here, location.href);
      const id = link && this.idOf(link.href);
      return id ? this.read(id, abs(link.href)) : null;
    },
    async all() { const id = this.idOf(location.href); return id ? this.read(id, location.href) : []; },
  };

  const pawchive = {
    where: (url) => (new URL(url, location.href).pathname.match(/^\/([a-z]+)\/user\/([^/]+)\/post\/([^/]+)/) || []).slice(1),
    async read(url) {
      const [service, user, id] = this.where(url);
      if (!id) return [];
      const doc = url === location.href ? document : await page(url);
      const p = await json(`/api/v1/${service}/user/${user}/post/${id}`);
      const artist = text(doc.querySelector(".post__user-name")) || meta("og:title", doc).replace(/^.* by (.+?) from .*$/, "$1");
      const pic = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
      const links = new Map([...doc.querySelectorAll("a.fileThumb, a[href*='/data/']")].map((a) => [new URL(a.href).pathname, a.href]));
      return [p.file, ...(p.attachments || [])].filter((f) => f && f.path && pic.test(f.name || f.path)).map((f) => ({
        src: links.get(`/data${f.path}`) || `https://n${f.node || 2}.pawchive.pw/data${f.path}?f=${encodeURIComponent(f.name)}`,
        thumb: `https://img.pawchive.pw/thumbnail/data${f.path}`, name: f.name, page: `https://pawchive.pw/${service}/user/${user}/post/${id}`,
        site: "pawchive", post: id, artist, artist_url: `https://pawchive.pw/${service}/user/${user}`, title: p.title, description: plain(p.content),
        tags: Array.isArray(p.tags) ? p.tags : [] }));
    },
    async one(img) {
      const here = this.where(location.href).length ? location.href : null;
      const link = img.closest("a[href*='/post/']");
      const all = await this.read(here || (link && abs(link.href)) || "");
      const path = (img.src.match(/\/data(\/[^?]+)/) || [])[1];
      return here ? [all.find((i) => path && i.src.includes(path)) || all[0]].filter(Boolean) : all;
    },
    async all() { return this.where(location.href).length ? this.read(location.href) : []; },
  };

  const READERS = { "www.pixiv.net": pixiv, "x.com": x, "twitter.com": x, "mobile.twitter.com": x, "www.deviantart.com": deviantart, "pawchive.pw": pawchive,
    "danbooru.donmai.us": booru, "e621.net": booru, "gelbooru.com": booru, "safebooru.org": booru, "yande.re": booru, "konachan.com": booru, "konachan.net": booru };
  const reader = READERS[host];
  if (!reader) return;

  // a picture the reader can't place (an odd page): itself, with the page it's on
  const plainItem = (img) => ({ src: img.currentSrc || img.src, thumb: img.src, page: location.href, title: document.title });
  async function itemsFor(img) {
    try {
      const got = await reader.one(img);
      if (got && got.length) return got;
    } catch (e) { console.warn("Model Librarian: couldn't read this post", e); }
    return [plainItem(img)];
  }

  // ---------------------------------------------------------------- the save button on a picture
  const box = document.createElement("div");
  const root = box.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; }
    button { position: fixed; z-index: 2147483000; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px 0 8px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,.18); background: rgba(18,19,24,.88); color: #f2f2f4; font: 600 12px system-ui, "Segoe UI", sans-serif; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,.4); }
    button:hover { background: #2f7cf6; border-color: #2f7cf6; }
    button[hidden] { display: none; }
    img { width: 16px; height: 16px; }
  </style><button type="button" hidden title="Save to Downloads\\Model Librarian Gallery, with its artist, title and tags, for the Gallery to file">
    <img alt=""><span>Save</span></button>`;
  const btn = root.querySelector("button");
  root.querySelector("img").src = chrome.runtime.getURL("icons/icon32.png");
  const label = root.querySelector("span");
  let target = null, hideTimer = null;
  document.documentElement.append(box);

  const place = () => {
    if (!target || !target.isConnected) return hide();
    const r = target.getBoundingClientRect();
    if (r.width < MIN || r.height < MIN || r.bottom < 0 || r.top > innerHeight) return hide();
    btn.style.top = `${Math.max(8, r.top + 8)}px`;
    btn.style.left = `${Math.min(innerWidth - 110, r.right - 92)}px`;
    btn.hidden = false;
  };
  const hide = () => { btn.hidden = true; target = null; };
  document.addEventListener("mouseover", (e) => {
    const img = e.target.closest?.("img");
    if (img && img !== target && img.naturalWidth >= MIN) { clearTimeout(hideTimer); target = img; label.textContent = "Save"; place(); }
  }, true);
  document.addEventListener("mouseout", (e) => {
    if (e.target === target && e.relatedTarget !== box) hideTimer = setTimeout(hide, 250);
  }, true);
  btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  btn.addEventListener("mouseleave", () => { hideTimer = setTimeout(hide, 250); });
  addEventListener("scroll", () => { if (!btn.hidden) place(); }, { passive: true, capture: true });
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const img = target;
    if (!img) return;
    label.textContent = "Saving…";
    const items = await itemsFor(img);
    const r = await chrome.runtime.sendMessage({ type: "gallerySave", items }).catch((err) => ({ error: err.message }));
    label.textContent = r && r.saved ? (r.saved > 1 ? `Saved ${r.saved}` : "Saved ✓") : "Didn't save";
    btn.title = r && r.error ? r.error : btn.title;
  });

  // ---------------------------------------------------------------- what the right-click menu and the popup ask
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "galleryItemsFor") {  // the picture right-clicked (by its address)
      const img = [...document.images].find((i) => i.src === msg.src || i.currentSrc === msg.src);
      (img ? itemsFor(img) : Promise.resolve([{ src: msg.src, thumb: msg.src, page: location.href, title: document.title }])).then(reply);
      return true;
    }
    if (msg?.type === "galleryPage") {  // every picture of the post on the page
      reader.all().then((items) => reply({ items, known: true }), (e) => reply({ items: [], known: true, error: e.message }));
      return true;
    }
    return false;
  });
})();
