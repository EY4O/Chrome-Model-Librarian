// Characters from booru posts (Prompto's import, brought back): read a post, learn each character's usual look from
// Danbooru's related tags, sort tags into appearance, outfit and skip, and shape what's filed into Model Librarian's
// character list (characters.json: ComfyUI-Model-Librarian's smf/charstore.py says what it takes). No DOM here, so the
// service worker and the tests can use it.

// never with your cookies, and never waiting forever (Danbooru's related tags can be slow)
const NO_COOKIES = () => ({ credentials: "omit", ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {}) });
export const LOOK_THRESHOLD = 0.4; // share of a character's posts a tag must appear on
const MAYBE_THRESHOLD = 0.25; // shown in Skip so it can be promoted
const MIN_SOLO_POSTS = 25;
export const LOOK_DAYS = 7; // a character's look is asked of Danbooru once a week
export const CHAR_NOTE = ".mlchar.json"; // a character left for the Gallery, in Downloads\Model Librarian Gallery

export const displayName = (n) => (/[a-z0-9]/i.test(n) && !/^[\W_]+$/.test(n) ? n.replace(/_/g, " ") : n);
export const norm = (t) => String(t || "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
const split = (s) => (s || "").split(" ").filter(Boolean).map(displayName);
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ---------- Posts ----------
// {site, host, id} for a post page this knows, else null. Danbooru (and its Safebooru) and e621 by their JSON;
// Gelbooru and Safebooru.org from the page's own tag lists.
export function postOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.replace(/^www\./, "");
  const m = u.pathname.match(/^\/posts\/(\d+)/);
  if (/^(danbooru|safebooru)\.donmai\.us$/.test(h) && m) return { site: h.startsWith("safebooru") ? "safebooru" : "danbooru", host: u.origin, id: m[1] };
  if (/^(e621|e926)\.net$/.test(h) && m) return { site: h.split(".")[0], host: u.origin, id: m[1] };
  if (/^(gelbooru\.com|safebooru\.org)$/.test(h) && u.searchParams.get("page") === "post" && u.searchParams.get("s") === "view" && /^\d+$/.test(u.searchParams.get("id") || ""))
    return { site: h === "gelbooru.com" ? "gelbooru" : "safebooru", host: u.origin, id: u.searchParams.get("id"), page: true };
  return null;
}

export async function fetchDanbooru(where, fetchFn = fetch) {
  const fields = "id,tag_string_character,tag_string_copyright,tag_string_general,preview_file_url,rating";
  const res = await fetchFn(`${where.host}/posts/${where.id}.json?only=${fields}`, NO_COOKIES());
  if (!res.ok) throw new Error(`Danbooru answered ${res.status}`);
  const p = await res.json();
  return {
    site: where.site, id: String(p.id), url: `${where.host}/posts/${p.id}`, rating: p.rating || "",
    characters: split(p.tag_string_character), copyrights: split(p.tag_string_copyright), general: split(p.tag_string_general),
    preview: p.preview_file_url || null,
  };
}

// e621 lists a species with its whole family tree; only the specific names help a prompt.
const E621_TAXONOMY = new Set(["mammal", "felid", "feline", "felis", "canid", "canine", "canis", "vulpine", "avian", "bird", "reptile",
  "scalie", "lizard", "squamate", "equid", "equine", "bovid", "bovine", "cervid", "leporid", "lagomorph", "rodent", "murid", "murine",
  "mustelid", "musteline", "procyonid", "ursid", "pantherine", "primate", "haplorhine", "marine", "fish", "amphibian", "arthropod", "insect"]);

// e621 asks browser-based tools to name themselves with _client, since a browser can't set its own User-Agent.
// Species tags describe the character's body, so they join the general tags.
export async function fetchE621(where, fetchFn = fetch) {
  const res = await fetchFn(`${where.host}/posts/${where.id}.json?_client=${encodeURIComponent("ModelLibrarian/1.0 (by EY4O)")}`, NO_COOKIES());
  if (!res.ok) throw new Error(`${new URL(where.host).hostname} answered ${res.status}`);
  const p = (await res.json()).post;
  const t = p.tags || {};
  const list = (k) => (t[k] || []).map(displayName);
  const species = list("species").filter((x) => !E621_TAXONOMY.has(x));
  return {
    site: where.site, id: String(p.id), url: `${where.host}/posts/${p.id}`, rating: p.rating || "",
    characters: list("character"), copyrights: list("copyright"), species, general: [...species, ...list("general")],
    preview: (p.preview && p.preview.url) || null,
  };
}

// A Gelbooru-style page sends the tag groups it shows (its rating and a picture too).
export function postFromGroups(where, g) {
  const list = (k) => (Array.isArray(g[k]) ? g[k] : []).map((x) => displayName(String(x))).filter(Boolean).slice(0, 400);
  return {
    site: where.site, id: String(where.id), url: `${where.host}/index.php?page=post&s=view&id=${where.id}`, rating: String(g.rating || "").toLowerCase(),
    characters: list("character"), copyrights: list("copyright"), general: list("general"),
    preview: /^https:\/\//.test(g.preview || "") ? g.preview : null,
  };
}

// The servers a post's preview may come from (a Gelbooru-style page says where its picture is: nowhere else is asked).
const PICTURE_HOSTS = /^https:\/\/([a-z0-9-]+\.)?(donmai\.us|e621\.net|e926\.net|gelbooru\.com|safebooru\.org)\//i;
export const pictureFrom = (url) => (PICTURE_HOSTS.test(String(url || "")) ? url : null);

// Only a picture from a post rated for everyone becomes a character's picture.
export function isGeneral(post) {
  const r = String(post.rating || "").toLowerCase();
  if (post.site === "danbooru" || (post.site === "safebooru" && /donmai/.test(post.url))) return r === "g";
  if (post.site === "e621" || post.site === "e926") return r === "s";
  return r === "general" || r === "safe";
}

// ---------- A character's look ----------
// Tags that show up on most of the character's general-audience posts. Solo posts come first, so a character usually
// drawn with someone else doesn't inherit their hair; with too few solo posts it falls back to all posts.
async function related(query, fetchFn) {
  const res = await fetchFn(`https://danbooru.donmai.us/related_tag.json?query=${encodeURIComponent(query)}&category=general&limit=40`, NO_COOKIES());
  if (!res.ok) throw Object.assign(new Error(`Danbooru answered ${res.status}`), { status: res.status });
  const d = await res.json();
  return {
    postCount: d.post_count || 0,
    tags: (d.related_tags || []).map((r) => ({ name: displayName(r.tag.name), freq: r.frequency })),
  };
}

export async function fetchLook(tag, cache, fetchFn = fetch, now = Date.now()) {
  const key = norm(tag);
  const hit = cache && cache[key];
  if (hit && now - hit.at < LOOK_DAYS * 864e5) return hit;
  const base = key.replace(/ /g, "_");
  let look = { ...(await related(`${base} solo rating:g`, fetchFn)), solo: true };
  if (look.postCount < MIN_SOLO_POSTS) look = { ...(await related(`${base} rating:g`, fetchFn)), solo: false };
  look.at = now;
  if (cache) cache[key] = look;
  return look;
}

// ---------- Sorting ----------
const EXPRESSION = /\b(holding|closed eyes|half-closed eyes|one eye closed|looking|open mouth|closed mouth|smile|smiling|grin|blush|tears|crying|frown|pout|expressionless|parted lips|tongue out|wink|sweat|surprised|angry|sad)\b/;
const OUTFIT = /\b(dress|shirt|skirt|jacket|coat|capelet|cape|cloak|hoodie|hooded|sweater|vest|uniform|kimono|yukata|apron|pants|shorts|jeans|leggings|pantyhose|thighhighs|kneehighs|socks|stockings|footwear|shoes|boots|sneakers|sandals|heels|gloves|mittens|sleeves|sleeveless|collar|necktie|tie|bowtie|ribbon|bow|hat|cap|beret|helmet|hood|headband|headwear|hairband|crown|tiara|wreath|earrings|necklace|choker|bracelet|jewelry|ring|glasses|eyewear|goggles|mask|scarf|belt|bag|armor|gauntlets|robe|swimsuit|bikini|leotard|bodysuit|suit|blazer|cardigan|camisole|tank top|crop top|serafuku|sailor collar|neckerchief|frills|lace|buttons|sash|obi|ornament|hairclip|scrunchie|brooch|wristband|armband|epaulettes|tricorne|clothes|clothing|outfit|costume|staff|sword|katana|weapon|wand)\b/;
const APPEARANCE = /\b(hair|bangs|sidelocks?|ahoge|braids?|braided|twintails|ponytail|bun|drills?|eyes|eyebrows|eyelashes|pupils|heterochromia|ears|tail|horns?|wings|halo|skin|skinned|tan|tanlines|freckles|mole|scar|fangs?|breasts|flat chest|muscular|abs|petite|elf|demon girl|cat girl|fox girl|dog girl|wolf girl|beard|stubble|mustache|facial hair|makeup|lipstick|eyeshadow|forehead|mature (female|male)|old (man|woman)|aged (up|down))\b/;
const COUNT = /^(\d|6\+)(girl|boy|other)s?$/;

export function classify(tag) {
  const t = norm(tag);
  if (COUNT.test(t)) return "count";
  if (EXPRESSION.test(t)) return "skip";
  if (OUTFIT.test(t)) return "outfit"; // before appearance: "hair ribbon" is an accessory
  if (APPEARANCE.test(t)) return "appearance";
  return "skip";
}

export const nameFromTag = (tag) => titleCase(displayName(tag).replace(/\s*\(.*\)$/, ""));
// a name for telling names apart: its words in any order, its series in brackets left out (vale_lumen = Lumen Vale)
export const nameKey = (s) => norm(s).replace(/-/g, " ").replace(/\s*\(.*\)$/, "").split(" ").filter(Boolean).sort().join(" ");
// one of yours with this tag: as its tag, or as one of its names (a post's character linked to one with a tag of its own)
export const hasTag = (k, tag) => !!norm(tag) && (norm(k.tag) === norm(tag) || (k.aliases || []).some((a) => norm(a) === norm(tag)));
const qualifier = (tag) => (displayName(tag).match(/\(([^)]+)\)$/) || [])[1] || "";
const freqMap = (look) => new Map((look ? look.tags : []).map((x) => [norm(x.name), x.freq]));

// The starting sort for one character. `looks` maps each character tag in the post to its look, or null when
// Danbooru couldn't say (offline, or a character it barely knows), in which case only the post is used.
export function draftCharacter(tag, post, looks) {
  const look = looks[tag] || null;
  const solo = post.characters.length <= 1;
  const freq = freqMap(look);
  const others = post.characters.filter((c) => c !== tag).map((c) => freqMap(looks[c]));
  // With several characters, a post tag goes to whoever Danbooru ties it to most.
  const mine = (t) => {
    const f = freq.get(norm(t)) || 0;
    return f >= 0.2 && others.every((o) => f >= (o.get(norm(t)) || 0));
  };
  const buckets = new Map(); // tag -> appearance | outfit | skip
  const put = (t, b) => { if (!buckets.has(t)) buckets.set(t, b); };

  if (look) {
    for (const x of look.tags) {
      const kind = classify(x.name);
      if (x.freq >= LOOK_THRESHOLD) {
        if (kind === "appearance" || kind === "outfit") put(x.name, kind);
        else if (kind === "count" && x.freq >= 0.5) put(x.name, "appearance");
      }
    }
  }
  if (solo) for (const t of post.species || []) put(t, "appearance"); // e621 species describe the character's body
  // From this post: everything when it's the only character, otherwise only the tags that are this character's more than the others'.
  for (const t of post.general) {
    const kind = classify(t);
    if ((kind === "appearance" || kind === "outfit") && (solo || mine(t))) put(t, kind);
  }
  for (const t of post.general) put(t, "skip");
  if (look) for (const x of look.tags) if (x.freq >= MAYBE_THRESHOLD && classify(x.name) !== "count") put(x.name, "skip");

  // the series: the post's copyright the tag names in brackets (a crossover post has several, A to Z), else its first
  const own = post.copyrights.find((c) => qualifier(tag) && norm(c) === norm(qualifier(tag)));
  const series = titleCase(own || post.copyrights[0] || qualifier(tag)) || "Original";
  return {
    tag, name: nameFromTag(tag), series,
    buckets: [...buckets].map(([t, b]) => ({ t, b, f: freq.has(norm(t)) ? freq.get(norm(t)) : null })),
    postCount: look ? look.postCount : 0, soloLook: !!(look && look.solo),
  };
}

// ---------- What's filed ----------
// One character for Model Librarian's list: the tags left in Appearance and Outfit, the outfit's name, and whether it's
// added to the character you have (mode "outfit") or made anew ("new").
export function importOf(d, post) {
  const pick = (b) => d.buckets.filter((x) => x.b === b).map((x) => x.t);
  return {
    tag: String(d.tag).replace(/ /g, "_"), name: String(d.name || "").trim() || nameFromTag(d.tag), series: String(d.series || "").trim(),
    appearance: pick("appearance"), outfit: { name: String(d.outfitName || "").trim().toLowerCase() || "default", tags: pick("outfit") },
    // (New picked over one of yours by the same name: new, not linked to it after all)
    mode: d.mode === "new" || (!d.have && d.mode !== "link" && (d.suggest || []).length) ? "new" : d.mode === "link" && d.link ? "link" : "outfit",
    ...(d.mode === "link" && d.link ? { target: d.link.id } : {}),
    source: { site: post.site, post: post.id, url: post.url, post_count: d.postCount || 0, solo: !!d.soloLook },
  };
}

// The file a character is left in for the Gallery (when ComfyUI isn't running): a name Windows takes, ending in CHAR_NOTE.
export function charFileName(tag, now = Date.now()) {
  const stem = String(tag || "character").replace(/[\u0000-\u001f\u007f<>:"/\\|?*~\p{Cf}]+/gu, " ").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80) || "character";
  return `${stem} ${now}${CHAR_NOTE}`;
}

export const charFile = (character, picture) => ({ v: 1, character, picture: picture || null });

// A drafts list from a post: one draft per character, the clicked one (or ones) picked, each told whether you have it
// already. Each is added to the character with its tag (made when there's none) unless "New character" is picked for one
// you have. One you don't have, but have by its name in any order (one without a tag yet): linked to that one at first.
export function draftsFor(post, looks, known, clicked) {
  const only = clicked == null ? null : (Array.isArray(clicked) ? clicked : [clicked]).map(norm);
  return post.characters.map((tag) => {
    const d = draftCharacter(tag, post, looks);
    const have = (known || []).find((k) => hasTag(k, tag));
    const suggest = have ? [] : (known || []).filter((k) => k.id && !norm(k.tag) && [k.name, ...(k.aliases || [])].some((n) => nameKey(n) === nameKey(d.name)));
    const link = suggest[0] ? { id: suggest[0].id, name: suggest[0].name, outfits: suggest[0].outfits || [] } : null;
    return {
      ...d, include: !only || only.includes(norm(tag)),
      have: have ? { name: have.name, outfits: have.outfits || [] } : null,
      mode: link ? "link" : "outfit", link, suggest: suggest.map((k) => k.id),
      outfitName: have || (link && link.outfits.length) ? `post ${post.id}` : "default",
    };
  });
}

// A post's characters as a saved picture's note keeps them (lib/gallery.js noteFor): each sorted from the post alone,
// as + Character would file it new.
export function noteCharacters(post) {
  return post.characters.slice(0, 12).map((tag) => {
    const c = importOf(draftCharacter(tag, post, {}), post);
    return { tag: c.tag, name: c.name, series: c.series, appearance: c.appearance, outfit: c.outfit.tags };
  });
}
