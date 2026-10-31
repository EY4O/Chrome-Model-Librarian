// Saving pictures for Model Librarian Gallery: the names they're saved under, the full-size address of a picture
// shown smaller, and the note saved beside each (<name>.mlg.json: the page, the artist, the title, the tags), which
// the Gallery's New downloads reads. Pure functions, shared by the service worker and the tests.

export const FOLDER = "Model Librarian Gallery";  // inside Downloads: the Gallery offers what's here for filing
export const NOTE = ".mlg.json";
const IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|heic)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

// the sites the extension knows well: the full picture, the artist, the tags (and a save button on their pictures)
export const SITES = {
  pixiv: ["www.pixiv.net"],
  x: ["x.com", "twitter.com", "mobile.twitter.com"],
  deviantart: ["www.deviantart.com"],
  danbooru: ["danbooru.donmai.us"],
  gelbooru: ["gelbooru.com"],
  safebooru: ["safebooru.org"],
  yandere: ["yande.re"],
  konachan: ["konachan.com", "konachan.net"],
  e621: ["e621.net"],
  pawchive: ["pawchive.pw"],
};

export function siteOf(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  return Object.keys(SITES).find((k) => SITES[k].includes(host)) || null;
}

// a name Windows takes (no \ / : * ? " < > |, no trailing dot or space), not too long, keeping its extension
export function safeName(name, fallback = "picture", ext2 = ".jpg") {
  let s = String(name || "").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  const m = s.match(/(\.[A-Za-z0-9]{1,5})$/);
  let ext = m ? m[1].toLowerCase() : "";
  let stem = (m ? s.slice(0, -m[1].length) : s).replace(/^[. ]+|[. ]+$/g, "").trim();  // (Chrome refuses a name starting with a dot)
  if (!IMAGE.test(ext) && !VIDEO.test(ext)) { stem = m ? `${stem} ${ext.slice(1)}`.trim() : stem; ext = ext2; }  // only a picture's or a video's
  if (!stem || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem)) stem = fallback;  // (CON.anything is Windows' too)
  return stem.slice(0, 120) + ext;
}

// the extension of a picture from its address (or what it says it is), for a name that has none
export function extOf(url, fallback = ".jpg") {
  try {
    const u = new URL(url);
    const f = u.searchParams.get("format");
    if (f && /^(jpg|jpeg|png|webp|gif)$/i.test(f)) return "." + f.toLowerCase();
    const m = u.pathname.match(/\.([A-Za-z0-9]{2,5})$/);
    if (m && (IMAGE.test("." + m[1]) || VIDEO.test("." + m[1]))) return "." + m[1].toLowerCase();
  } catch {}
  return fallback;
}

// the picture itself, not the smaller one a page shows: X's original size; others are found by the site readers
export function fullSize(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.hostname === "pbs.twimg.com" && u.pathname.startsWith("/media/")) {
    u.searchParams.set("name", "orig");
    if (!u.searchParams.get("format")) {
      const m = u.pathname.match(/\.(jpg|png|webp)$/i);
      if (m) { u.pathname = u.pathname.slice(0, -m[0].length); u.searchParams.set("format", m[1].toLowerCase()); }
    }
    return u.toString();
  }
  if (u.hostname === "img.pawchive.pw" && u.pathname.startsWith("/thumbnail/data/")) {  // a thumbnail: the file (on n2, the node most are on)
    return `https://n2.pawchive.pw${u.pathname.replace(/^\/thumbnail/, "")}`;
  }
  return url;
}

// the name a picture is saved under: the site's own kind of name where the Gallery reads one (12345_p0.png, ..._by_artist_d1a2b3c,
// __..._drawn_by_artist__md5, artist-id-date-img1), else the post and a number, else the picture's own name
export function fileNameFor(item, index = 0) {
  const ext = extOf(item.src, item.ext || ".jpg");
  if (item.name) return safeName(IMAGE.test(item.name) || VIDEO.test(item.name) ? item.name : item.name + ext, "picture", ext);
  let fromUrl = "";
  try { fromUrl = decodeURIComponent(new URL(item.src).pathname.split("/").pop() || ""); } catch {}
  if (item.post) return safeName(`${item.site || "post"}_${item.post}${index ? `_${index + 1}` : ""}${ext}`);
  return safeName(IMAGE.test(fromUrl) || VIDEO.test(fromUrl) ? fromUrl : (fromUrl || "picture") + ext);
}

// a Danbooru-style name: __<characters>_drawn_by_<artist>__<md5>.<ext> (the Gallery takes the artist from it)
export function booruName(md5, ext, artist, characters = "") {
  const tag = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^\w()'-]+/g, "").slice(0, 60);
  const chars = tag(String(characters || "").split(/\s+/)[0]);
  return artist ? `__${chars ? chars + "_" : ""}drawn_by_${tag(artist)}__${md5}${ext}` : `${md5}${ext}`;
}

// Twitter Media Downloader's kind of name: <handle>-<post id>-<yyyymmdd_hhmmss>-img<n>.<ext>
export function tweetName(handle, id, when, n, ext) {
  const d = when ? new Date(when) : null;
  const p = (x) => String(x).padStart(2, "0");
  const stamp = d && !isNaN(d) ? `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` : "00000000_000000";
  return `${handle}-${id}-${stamp}-img${n}${ext}`;
}

// DeviantArt's own name for a download: <title>_by_<artist>_d<id in base 36>
export function deviationName(slug, artist, id, ext) {
  const t = String(slug || "art").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "art";
  return `${t}_by_${String(artist).toLowerCase()}_d${Number(id).toString(36)}${ext}`;
}

// the note saved beside a picture (only what's known). characters: a booru post's, each as + Character would file it
// ({tag, name, series, appearance, outfit}), for the Gallery to offer in New downloads
export function noteFor(item) {
  const text = (v, n) => (v == null ? undefined : String(v).trim().slice(0, n) || undefined);
  const tags = Array.isArray(item.tags) ? [...new Set(item.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 64) : undefined;
  const list = (v) => (Array.isArray(v) ? v.map((t) => String(t).trim()).filter(Boolean).slice(0, 64) : []);
  const characters = Array.isArray(item.characters) ? item.characters.filter((c) => c && typeof c === "object" && c.tag).slice(0, 12)
    .map((c) => ({ tag: text(c.tag, 200), name: text(c.name, 100), series: text(c.series, 100), appearance: list(c.appearance), outfit: list(c.outfit) })) : [];
  const out = { v: 1, page: text(item.page, 2000), src: text(item.src, 2000), site: text(item.site, 40), post: text(item.post, 80),
    artist: text(item.artist, 100), artist_url: text(item.artist_url, 2000), title: text(item.title, 300), description: text(item.description, 3000),
    tags: tags && tags.length ? tags : undefined, characters: characters.length ? characters : undefined, saved: new Date().toISOString() };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

// HTML (a post's description) as plain text
export function plain(html) {
  return String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// A CivitAI image's recipe left for the Gallery when ComfyUI isn't running (<name>.mlrecipe.json in FOLDER): the
// Gallery reads the image from CivitAI and saves its recipe into Model Librarian's Recipes, then removes the file.
export const RECIPE_NOTE = ".mlrecipe.json";
const CIVITAI_IMAGE = /^https:\/\/(?:www\.)?(civitai\.(?:com|green|red))\/images\/(\d+)(?:[/?#]|$)/i;

// https://civitai.com/images/<id> for a CivitAI image's page (any of its sites), or null
export function civitaiImage(url) {
  const m = String(url || "").match(CIVITAI_IMAGE);
  return m ? `https://${m[1].toLowerCase()}/images/${m[2]}` : null;
}

export function recipeFileName(url, now = Date.now()) {
  const id = (civitaiImage(url) || "").split("/").pop() || "image";
  return `civitai-${id} ${now}${RECIPE_NOTE}`;
}

export function recipeNote(url, page) {
  const image = civitaiImage(url);
  const from = /^https:\/\/(?:www\.)?civitai\.(?:com|green|red)\//i.test(String(page || "")) ? String(page).slice(0, 2000) : image;  // (a post's page, say)
  return image ? { v: 1, url: image, page: from, saved: new Date().toISOString() } : null;
}
