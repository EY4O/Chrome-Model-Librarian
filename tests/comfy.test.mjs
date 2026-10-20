import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBase, isLoopback, originPattern, candidates, newer, api, detect, MIN_ML } from "../lib/comfy.js";

const res = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("addresses", () => {
  assert.equal(normalizeBase("127.0.0.1:8188/"), "http://127.0.0.1:8188");
  assert.equal(normalizeBase(" https://box.tailnet.ts.net:8188/some/page "), "https://box.tailnet.ts.net:8188");
  assert.equal(normalizeBase(""), "");
  assert.equal(isLoopback("http://localhost:8000"), true);
  assert.equal(isLoopback("http://100.64.0.2:8188"), false);
  assert.equal(originPattern("http://100.64.0.2:8188"), "http://100.64.0.2/*");
  assert.deepEqual(candidates(""), ["http://127.0.0.1:8188", "http://127.0.0.1:8000", "http://127.0.0.1:8189"]);
  assert.deepEqual(candidates("localhost:9000"), ["http://localhost:9000"]);
});

test("versions", () => {
  assert.equal(newer("1.11.0", "1.11.0"), true);
  assert.equal(newer("1.12.1", "1.11.0"), true);
  assert.equal(newer("1.10.9", "1.11.0"), false);
  assert.equal(newer("2.0", "1.11.0"), true);
});

test("api: JSON back, errors carry Model Librarian's message and the status", async () => {
  const ok = await api("http://127.0.0.1:8188", "/ext/hello", {}, async (url) => {
    assert.equal(url, "http://127.0.0.1:8188/sm-fetcher/ext/hello");
    return res(200, { app: "model-librarian" });
  });
  assert.equal(ok.app, "model-librarian");
  await assert.rejects(api("http://x", "/ext/download", { method: "POST", body: {} }, async () => res(404, { error: "CivitAI doesn't have that version" })),
    (e) => e.status === 404 && /doesn't have that version/.test(e.message));
  await assert.rejects(api("http://x", "/ext/hello", {}, async () => { throw new TypeError("Failed to fetch"); }), (e) => e.status === 0);
  // 403 with no ComfyUI tab to run it in (no chrome.* in Node): says what to do
  await assert.rejects(api("http://127.0.0.1:8188", "/ext/hello", {}, async () => res(403, "")), (e) => e.status === 403 && /--enable-cors-header/.test(e.message));
});

test("detect: the first port with Model Librarian, or why not", async () => {
  const up = { "http://127.0.0.1:8000": res(200, { app: "model-librarian", version: "1.11.0", civitai_key: true, free_bytes: 5 }) };
  let r = await detect("", async (url) => up[new URL(url).origin] || Promise.reject(new TypeError("refused")));
  assert.deepEqual(r, { ok: true, base: "http://127.0.0.1:8000", version: "1.11.0", civitaiKey: true, freeBytes: 5 });
  r = await detect("", async (url) => (url.startsWith("http://127.0.0.1:8188") ? res(404, "Not Found") : Promise.reject(new TypeError("refused"))));
  assert.equal(r.ok, false);
  assert.match(r.error, /without Model Librarian/);
  r = await detect("", async () => res(200, { app: "model-librarian", version: "1.9.0" }));
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(`update it to ${MIN_ML.replace(/\./g, "\\.")}`));
  r = await detect("http://127.0.0.1:9999", async () => { throw new TypeError("refused"); });
  assert.equal(r.error, "ComfyUI isn't running at http://127.0.0.1:9999");
});
