import test from "node:test";
import assert from "node:assert/strict";
import { CHAR_NOTE, charFile, charFileName, classify, draftCharacter, draftsFor, fetchDanbooru, fetchE621, fetchLook, importOf, isGeneral, nameFromTag,
  norm, pictureFrom, postFromGroups, postOf } from "../lib/booru.js";

// a made-up character, never a real one
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("the post pages it knows", () => {
  assert.deepEqual(postOf("https://danbooru.donmai.us/posts/4242?q=x"), { site: "danbooru", host: "https://danbooru.donmai.us", id: "4242" });
  assert.deepEqual(postOf("https://safebooru.donmai.us/posts/7"), { site: "safebooru", host: "https://safebooru.donmai.us", id: "7" });
  assert.deepEqual(postOf("https://e621.net/posts/9"), { site: "e621", host: "https://e621.net", id: "9" });
  assert.deepEqual(postOf("https://gelbooru.com/index.php?page=post&s=view&id=55"), { site: "gelbooru", host: "https://gelbooru.com", id: "55", page: true });
  assert.equal(postOf("https://safebooru.org/index.php?page=post&s=view&id=55").site, "safebooru");
  assert.equal(postOf("https://danbooru.donmai.us/posts?tags=x"), null);
  assert.equal(postOf("https://gelbooru.com/index.php?page=post&s=list&tags=x"), null);
  assert.equal(postOf("https://example.com/posts/1"), null);
  assert.equal(postOf("nonsense"), null);
});

test("Danbooru and e621 posts through their JSON", async () => {
  const asked = [];
  const p = await fetchDanbooru(postOf("https://danbooru.donmai.us/posts/4242"), async (url, opts) => {
    asked.push([url, opts]);
    return json({ id: 4242, rating: "g", tag_string_character: "aurelia_(lighthouse_tales)", tag_string_copyright: "lighthouse_tales",
      tag_string_general: "1girl silver_hair white_dress smile", preview_file_url: "https://cdn.donmai.us/preview/a.jpg" });
  });
  assert.equal(asked[0][1].credentials, "omit", "never with your Danbooru cookies");
  assert.deepEqual([p.characters, p.copyrights, p.general.slice(0, 2), p.url, p.rating], [["aurelia (lighthouse tales)"], ["lighthouse tales"],
    ["1girl", "silver hair"], "https://danbooru.donmai.us/posts/4242", "g"]);
  await assert.rejects(fetchDanbooru(postOf("https://danbooru.donmai.us/posts/1"), async () => json({}, 429)), /429/);
  const e = await fetchE621(postOf("https://e621.net/posts/9"), async (url) => {
    assert.match(url, /_client=ModelLibrarian/);
    return json({ post: { id: 9, rating: "s", tags: { character: ["nova_(starfall)"], species: ["mammal", "red_fox"], general: ["solo"], copyright: [] } } });
  });
  assert.deepEqual([e.species, e.general], [["red fox"], ["red fox", "solo"]], "species without the family tree, as appearance");
});

test("a Gelbooru-style page's tag groups", () => {
  const p = postFromGroups(postOf("https://gelbooru.com/index.php?page=post&s=view&id=55"),
    { character: ["lumen"], copyright: [], general: ["night", "blue_hair"], rating: "General", preview: "javascript:x" });
  assert.deepEqual([p.characters, p.general, p.rating, p.preview], [["lumen"], ["night", "blue hair"], "general", null]);
});

test("only posts rated for everyone give a picture", () => {
  assert.equal(isGeneral({ site: "danbooru", rating: "g", url: "https://danbooru.donmai.us/posts/1" }), true);
  assert.equal(isGeneral({ site: "danbooru", rating: "s", url: "https://danbooru.donmai.us/posts/1" }), false, "Danbooru's s is sensitive");
  assert.equal(isGeneral({ site: "safebooru", rating: "g", url: "https://safebooru.donmai.us/posts/1" }), true);
  assert.equal(isGeneral({ site: "e621", rating: "s" }), true, "e621's s is safe");
  assert.equal(isGeneral({ site: "e621", rating: "q" }), false);
  assert.equal(isGeneral({ site: "gelbooru", rating: "general" }), true);
  assert.equal(isGeneral({ site: "safebooru", rating: "safe", url: "https://safebooru.org/index.php?id=1" }), true);
  assert.equal(isGeneral({ site: "gelbooru", rating: "" }), false, "not known: no picture");
});

test("a character's look: solo general posts first, else all, cached for a week", async () => {
  const asked = [];
  const fake = async (url) => {
    asked.push(decodeURIComponent(url));
    const solo = /solo/.test(decodeURIComponent(url));
    return json({ post_count: solo ? 3 : 120, related_tags: [{ tag: { name: "silver_hair" }, frequency: 0.9 }] });
  };
  const cache = {};
  const look = await fetchLook("Aurelia (Lighthouse Tales)", cache, fake, 1000);
  assert.equal(asked.length, 2, "too few solo posts: asked again without solo");
  assert.match(asked[0], /query=aurelia_\(lighthouse_tales\) solo rating:g/);
  assert.deepEqual([look.postCount, look.solo, look.tags[0].name], [120, false, "silver hair"]);
  await fetchLook("aurelia_(lighthouse_tales)", cache, fake, 2000);
  assert.equal(asked.length, 2, "the cache answers the same tag, however it's written");
  await fetchLook("aurelia_(lighthouse_tales)", cache, fake, 1000 + 8 * 864e5);
  assert.equal(asked.length, 4, "a week later Danbooru is asked again");
});

test("tags sorted into appearance, outfit and skip", () => {
  assert.equal(classify("silver_hair"), "appearance");
  assert.equal(classify("hair ribbon"), "outfit", "an accessory, though it says hair");
  assert.equal(classify("smile"), "skip");
  assert.equal(classify("1girl"), "count");
  assert.equal(classify("night"), "skip");
  assert.equal(nameFromTag("aurelia_(lighthouse_tales)"), "Aurelia");
  assert.equal(norm(" Silver_Hair  x"), "silver hair x");
});

const POST = { site: "danbooru", id: "4242", url: "https://danbooru.donmai.us/posts/4242", rating: "g",
  characters: ["aurelia (lighthouse tales)"], copyrights: ["lighthouse tales"], general: ["1girl", "silver hair", "white dress", "smile", "lighthouse"] };
const LOOK = { postCount: 310, solo: true, tags: [{ name: "1girl", freq: 0.95 }, { name: "long hair", freq: 0.8 }, { name: "blue eyes", freq: 0.6 },
  { name: "straw hat", freq: 0.45 }, { name: "freckles", freq: 0.3 }, { name: "smile", freq: 0.7 }] };

test("a draft from the post and the character's look", () => {
  const d = draftCharacter("aurelia (lighthouse tales)", POST, { "aurelia (lighthouse tales)": LOOK });
  const by = (b) => d.buckets.filter((x) => x.b === b).map((x) => x.t);
  assert.deepEqual(by("appearance"), ["1girl", "long hair", "blue eyes", "silver hair"]);
  assert.deepEqual(by("outfit"), ["straw hat", "white dress"]);
  assert.ok(by("skip").includes("freckles") && by("skip").includes("smile") && by("skip").includes("lighthouse"), "the rest, to promote by hand");
  assert.deepEqual([d.name, d.series, d.postCount, d.soloLook], ["Aurelia", "Lighthouse Tales", 310, true]);
  assert.equal(d.buckets.find((x) => x.t === "long hair").f, 0.8);
  const offline = draftCharacter("aurelia (lighthouse tales)", POST, {});
  assert.deepEqual(offline.buckets.filter((x) => x.b === "appearance").map((x) => x.t), ["silver hair"], "without Danbooru's look: the post alone");
});

test("two characters: a post's tag goes to whoever it belongs to", () => {
  const post = { ...POST, characters: ["aurelia (lighthouse tales)", "nova (starfall)"], general: ["silver hair", "red hair"] };
  const looks = { "aurelia (lighthouse tales)": { postCount: 9, tags: [{ name: "silver hair", freq: 0.9 }] }, "nova (starfall)": { postCount: 9, tags: [{ name: "red hair", freq: 0.8 }] } };
  const a = draftCharacter("aurelia (lighthouse tales)", post, looks);
  assert.equal(a.buckets.find((x) => x.t === "red hair").b, "skip");
  assert.equal(a.buckets.find((x) => x.t === "silver hair").b, "appearance");
});

test("drafts: the clicked one picked; one you have gets the post as an outfit", () => {
  const post = { ...POST, characters: ["aurelia (lighthouse tales)", "nova (starfall)"] };
  const ds = draftsFor(post, {}, [{ tag: "aurelia_(lighthouse_tales)", name: "Aurelia", outfits: ["default"] }], "nova_(starfall)");
  assert.deepEqual(ds.map((d) => [d.include, d.mode, d.outfitName, d.have && d.have.name]),
    [[false, "outfit", "post 4242", "Aurelia"], [true, "outfit", "default", null]], "(one you don't have yet is made: by its tag, never twice)");
});

test("what's filed: Model Librarian's import, and the file left for the Gallery", () => {
  const d = { ...draftCharacter("aurelia (lighthouse tales)", POST, { "aurelia (lighthouse tales)": LOOK }), name: " Aurelia ", outfitName: "Summer", mode: "new" };
  const imp = importOf(d, POST);
  assert.deepEqual(imp, { tag: "aurelia_(lighthouse_tales)", name: "Aurelia", series: "Lighthouse Tales",
    appearance: ["1girl", "long hair", "blue eyes", "silver hair"], outfit: { name: "summer", tags: ["straw hat", "white dress"] }, mode: "new",
    source: { site: "danbooru", post: "4242", url: "https://danbooru.donmai.us/posts/4242", post_count: 310, solo: true } });
  assert.equal(charFileName("aurelia_(lighthouse_tales)", 5), "aurelia_(lighthouse_tales) 5" + CHAR_NOTE);
  assert.equal(charFileName('a:/b?"', 5), "a b 5" + CHAR_NOTE, "a name Windows takes");
  assert.equal(charFileName("..", 5), "character 5" + CHAR_NOTE);
  assert.deepEqual(charFile(imp, null), { v: 1, character: imp, picture: null });
});

test("a crossover post: the series the tag names, not the first copyright", () => {
  const post = { ...POST, characters: ["nova (starfall)"], copyrights: ["lighthouse tales", "starfall"] };
  assert.equal(draftCharacter("nova (starfall)", post, {}).series, "Starfall");
  assert.equal(draftCharacter("aurelia", { ...post, characters: ["aurelia"] }, {}).series, "Lighthouse Tales", "no brackets: the first");
});

test("a file name Chrome takes, and pictures only from the boorus' own servers", () => {
  assert.equal(charFileName("a~b\u200bc\u007fd", 5), "a b c d 5" + CHAR_NOTE);
  assert.equal(pictureFrom("https://cdn.donmai.us/preview/a.jpg"), "https://cdn.donmai.us/preview/a.jpg");
  assert.equal(pictureFrom("https://static1.e926.net/data/a.jpg"), "https://static1.e926.net/data/a.jpg");
  assert.equal(pictureFrom("https://img3.gelbooru.com/samples/a.jpg"), "https://img3.gelbooru.com/samples/a.jpg");
  assert.equal(pictureFrom("https://evil.example/donmai.us/a.jpg"), null);
  assert.equal(pictureFrom("http://cdn.donmai.us/a.jpg"), null);
});

test("Danbooru's 429 is told apart (no more asking for a while)", async () => {
  await assert.rejects(fetchLook("x", {}, async () => json({}, 429)), (e) => e.status === 429);
});

test("a name in either order, and linking to one of yours", async () => {
  const { nameKey, noteCharacters } = await import("../lib/booru.js");
  assert.equal(nameKey("vale_lumen"), nameKey("Lumen Vale"));
  assert.equal(nameKey("lumen vale (lighthouse tales)"), nameKey("Lumen Vale"));
  const post = { ...POST, characters: ["vale lumen"] };
  const mine = { id: "chr_bbbb0001", tag: "", name: "Lumen Vale", aliases: [], outfits: [] };
  const [d] = draftsFor(post, {}, [mine, { id: "chr_cccc0002", tag: "", name: "Nova", outfits: [] }], null);
  assert.deepEqual([d.mode, d.link && d.link.id, d.suggest, d.outfitName], ["link", "chr_bbbb0001", ["chr_bbbb0001"], "default"], "yours by name, linked at first");
  const imp = importOf(d, post);
  assert.deepEqual([imp.mode, imp.target, imp.tag], ["link", "chr_bbbb0001", "vale_lumen"]);
  const [d2] = draftsFor(post, {}, [{ ...mine, tag: "someone_else" }], null);
  assert.deepEqual([d2.mode, d2.link], ["outfit", null], "one with a tag of its own isn't suggested");
  assert.equal(importOf({ ...d2, mode: "link" }, post).mode, "outfit", "link without one picked: filed by its tag");
  const [n] = noteCharacters({ ...POST, characters: ["aurelia (lighthouse tales)"] });
  assert.deepEqual(Object.keys(n), ["tag", "name", "series", "appearance", "outfit"]);
  assert.equal(n.tag, "aurelia_(lighthouse_tales)");
  assert.equal(n.name, "Aurelia");
});

test("known by an alias too, and New over one of yours by name is new", async () => {
  const { hasTag } = await import("../lib/booru.js");
  const k = { tag: "nova_(starfall)", aliases: ["vale lumen"] };
  assert.ok(hasTag(k, "vale_lumen") && hasTag(k, "nova (starfall)") && !hasTag(k, "aurelia") && !hasTag({ tag: "" }, ""));
  const post = { ...POST, characters: ["vale lumen"] };
  const [d] = draftsFor(post, {}, [k], null);
  assert.ok(d.have, "linked before to one with a tag of its own: you have it");
  const [n] = draftsFor(post, {}, [{ id: "chr_bbbb0001", tag: "", name: "Lumen Vale", outfits: [] }], null);
  assert.equal(importOf({ ...n, mode: "outfit" }, post).mode, "new", "New picked over the suggestion");
  assert.equal(importOf(n, post).mode, "link");
});
