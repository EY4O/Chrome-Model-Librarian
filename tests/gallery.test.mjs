import test from "node:test";
import assert from "node:assert/strict";
import { booruName, deviationName, extOf, fileNameFor, fullSize, noteFor, plain, safeName, siteOf, tweetName } from "../lib/gallery.js";

test("the sites it knows, by their pages' addresses", () => {
  assert.equal(siteOf("https://www.pixiv.net/en/artworks/12345678"), "pixiv");
  assert.equal(siteOf("https://x.com/someone/status/1"), "x");
  assert.equal(siteOf("https://twitter.com/someone/status/1"), "x");
  assert.equal(siteOf("https://danbooru.donmai.us/posts/7654321"), "danbooru");
  assert.equal(siteOf("https://konachan.net/post/show/1"), "konachan");
  assert.equal(siteOf("https://pawchive.pw/patreon/user/1/post/2"), "pawchive");
  assert.equal(siteOf("https://example.com/a.png"), null);
  assert.equal(siteOf("not an address"), null);
});

test("names Windows takes", () => {
  assert.equal(safeName('a: "b" <c>?.PNG'), "a b c.png");
  assert.equal(safeName("con.jpg"), "picture.jpg", "a name Windows keeps for itself");
  assert.equal(safeName("trailing. .jpg"), "trailing.jpg");
  assert.equal(safeName("x".repeat(300) + ".png").length, 124);
  assert.equal(safeName(".. .. x.png"), "x.png", "Chrome refuses a name starting with a dot");
  assert.equal(safeName("con.foo.png"), "picture.png", "CON.anything is Windows' own");
  assert.equal(safeName("setup.exe"), "setup exe.jpg", "only a picture's or a video's extension: nothing that waits for approval");
  assert.equal(fileNameFor({ src: "https://example.com/a.webp", name: "page.html" }), "page.html.webp", "a name that isn't a picture's gets the picture's extension");
});

test("the full-size picture, not the preview", () => {
  assert.equal(fullSize("https://pbs.twimg.com/media/GAbc123?format=jpg&name=small"), "https://pbs.twimg.com/media/GAbc123?format=jpg&name=orig");
  assert.equal(fullSize("https://pbs.twimg.com/media/GAbc123.png"), "https://pbs.twimg.com/media/GAbc123?name=orig&format=png");
  assert.equal(fullSize("https://img.pawchive.pw/thumbnail/data/33/32/3332.gif"), "https://n2.pawchive.pw/data/33/32/3332.gif");
  assert.equal(fullSize("https://example.com/pic.jpg"), "https://example.com/pic.jpg");
});

test("the names it saves under: ones the Gallery reads who made it from", () => {
  assert.equal(extOf("https://pbs.twimg.com/media/X?format=png&name=orig"), ".png");
  assert.equal(extOf("https://example.com/a/b"), ".jpg");
  assert.equal(fileNameFor({ src: "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/12345678_p0.png", name: "12345678_p0.png" }), "12345678_p0.png");
  assert.equal(fileNameFor({ src: "https://example.com/x?id=3", site: "pawchive", post: "99" }, 2), "pawchive_99_3.jpg");
  assert.equal(fileNameFor({ src: "https://example.com/files/sunset.webp" }), "sunset.webp");
  assert.equal(booruName("0123456789abcdef0123456789abcdef", ".png", "mika art", "hatsune_miku vocaloid"),
    "__hatsune_miku_drawn_by_mika_art__0123456789abcdef0123456789abcdef.png");
  assert.equal(booruName("0123456789abcdef0123456789abcdef", ".png", ""), "0123456789abcdef0123456789abcdef.png");
  assert.equal(tweetName("inkling_jp", "1712345678901234567", "2024-04-05T10:11:12.000Z", 1, ".jpg"), "inkling_jp-1712345678901234567-20240405_101112-img1.jpg");
  assert.equal(deviationName("Sunset-Study", "SomeArtist", "987654321", ".png"), `sunset_study_by_someartist_d${(987654321).toString(36)}.png`);
});

test("the note beside each picture: only what's known", () => {
  const n = noteFor({ src: "https://x/y.png", page: "https://www.pixiv.net/artworks/1", site: "pixiv", post: 1, artist: " Mika ", title: "", tags: ["a", "b", "a", ""] });
  assert.deepEqual(Object.keys(n).sort(), ["artist", "page", "post", "saved", "site", "src", "tags", "v"]);
  assert.equal(n.artist, "Mika");
  assert.equal(n.post, "1");
  assert.deepEqual(n.tags, ["a", "b"]);
  assert.equal(plain("<p>Hello<br>there &amp; you</p>"), "Hello\nthere & you");
});
