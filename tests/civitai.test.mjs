import test from "node:test";
import assert from "node:assert/strict";
import { parseModelPage, normalizeModel, fileLabel, fetchModel, fmtSize } from "../lib/civitai.js";

test("model pages on every CivitAI host", () => {
  assert.deepEqual(parseModelPage("https://civitai.com/models/12345/paper-cut?modelVersionId=678"), { host: "civitai.com", modelId: 12345, versionId: 678 });
  assert.deepEqual(parseModelPage("https://civitai.red/models/9"), { host: "civitai.red", modelId: 9, versionId: null });
  assert.deepEqual(parseModelPage("https://www.civitai.com/models/9?modelVersionId=abc"), { host: "civitai.com", modelId: 9, versionId: null });
  assert.equal(parseModelPage("https://civitai.com/images/123"), null);
  assert.equal(parseModelPage("https://example.com/models/1"), null);
  assert.equal(parseModelPage("not a url"), null);
});

const MODEL = {
  id: 1, name: "Aurora", type: "Checkpoint", creator: { username: "maker" },
  modelVersions: [{
    id: 21, name: "v4", baseModel: "SDXL 1.0",
    files: [
      { id: 202, name: "aurora_pruned.safetensors", sizeKB: 2048, primary: false, type: "Pruned Model", metadata: { format: "SafeTensor", fp: "fp16", size: "pruned" } },
      { id: 201, name: "aurora.safetensors", sizeKB: 6144, primary: true, type: "Model", metadata: { format: "SafeTensor", fp: "fp32", size: "full" } },
      { id: 203, name: "aurora_vae.safetensors", sizeKB: 300, type: "VAE", metadata: { format: "SafeTensor" } },
      { id: 204, name: "dataset.zip", sizeKB: 10, type: "Training Data", metadata: { format: "Other" } },
    ],
  }, { id: 20, name: "v3", baseModel: "SDXL 1.0", earlyAccessEndsAt: "2999-01-01T00:00:00Z", files: [] }],
};

test("versions and files: primary first, training data left out, sizes in bytes", () => {
  const m = normalizeModel(MODEL);
  assert.equal(m.downloadable, true);
  assert.equal(m.creator, "maker");
  const v = m.versions[0];
  assert.deepEqual(v.files.map((f) => f.id), [201, 202, 203]);
  assert.equal(v.files[0].size, 6144 * 1024);
  assert.equal(v.files[0].label, "safetensors · fp32 · full");
  assert.equal(v.files[1].label, "safetensors · fp16 · pruned");
  assert.equal(v.files[2].label, "VAE · safetensors");
  assert.equal(m.versions[1].earlyAccess, true);
  assert.equal(normalizeModel({ id: 2, type: "Workflows", modelVersions: [] }).downloadable, false);
});

test("a pruned file without a size tag still says pruned", () => {
  assert.equal(fileLabel({ type: "Pruned Model", metadata: { format: "SafeTensor", fp: "fp16" } }), "safetensors · fp16 · pruned");
  assert.equal(fileLabel({}), "file");
});

test("the page's own host first, civitai.com when that fails", async () => {
  const asked = [];
  const fake = async (url) => {
    asked.push(new URL(url).hostname);
    if (url.includes("civitai.red")) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => MODEL };
  };
  const m = await fetchModel("civitai.red", 1, fake);
  assert.deepEqual(asked, ["civitai.red", "civitai.com"]);
  assert.equal(m.name, "Aurora");
  await assert.rejects(fetchModel("civitai.com", 1, async () => ({ ok: false, status: 404 })), /doesn't have this model/);
});

test("sizes", () => {
  assert.equal(fmtSize(512), "512 B");
  assert.equal(fmtSize(6.5 * 1024 ** 3), "6.5 GB");
  assert.equal(fmtSize(null), "");
});

test("paid and early access are named before the click", async () => {
  const { accessNote } = await import("../lib/civitai.js");
  const now = Date.parse("2026-10-20T00:00:00Z");
  assert.match(accessNote({ paidAccess: { permanent: false, endsAt: "2026-10-25T15:05:35.501Z" } }, now), /^Paid early access on CivitAI until 25 Oct 2026/);
  assert.match(accessNote({ paidAccess: { permanent: true } }, now), /^A paid model/);
  assert.equal(accessNote({ paidAccess: { endsAt: "2026-01-01T00:00:00Z" } }, now), null);
  assert.match(accessNote({ earlyAccessEndsAt: "2026-11-01T00:00:00Z" }, now), /^Early access/);
  assert.equal(accessNote({}, now), null);
});
