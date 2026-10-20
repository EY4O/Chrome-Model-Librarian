import test from "node:test";
import assert from "node:assert/strict";
import { quantOf, assess, recommend, gpuName } from "../lib/fit.js";

const GB = 1024 ** 3;
const f = (id, name, gbSize, md = {}, extra = {}) => ({ id, name, size: Math.round(gbSize * GB), primary: true, type: "Diffusion Model", metadata: md, ...extra });

// what Model Librarian reports for an RTX 4070 (Ada) with 12 GB, and an RTX 5090 (Blackwell)
const RTX4070 = { gpu: "cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync", vram_total: 12 * GB, budget: 10.5 * GB,
  fast: { fp8: true, nvfp4: false, mxfp8: false, int8: true }, formats: ["float8_e4m3fn", "int8_tensorwise", "convrot_w4a4", "nvfp4"], loaders: { gguf: true, nunchaku: true } };
const RTX5090 = { ...RTX4070, gpu: "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync", vram_total: 32 * GB, budget: 30.5 * GB, fast: { fp8: true, nvfp4: true, mxfp8: true, int8: true } };

// a slice of a real CivitAI model (Muse by Stable Yogi, Krea 2), format tags as CivitAI has them
const MUSE = {
  downloadable: true,
  versions: [
    { id: 40, name: "v4.0 INT4 Extended", files: [f(401, "museByStableYogi_v40INT4Extended.safetensors", 6.91, { format: "SafeTensor", fp: "int4" })] },
    { id: 41, name: "v4.0 NVFP4 Extended", files: [f(411, "museByStableYogi_v40NVFP4Extended.safetensors", 7.15, { format: "SafeTensor", fp: "nvfp4" })] },
    { id: 42, name: "v4.0 Q4 Extended", files: [f(421, "museByStableYogi_v40Q4Extended.gguf", 7.75, { format: "GGUF" })] },
    { id: 43, name: "v4.0 Q2 Extended", files: [f(431, "museByStableYogi_v40Q2Extended.gguf", 5.02, { format: "GGUF" })] },
    { id: 35, name: "v3.5 NVFP4 Extended", files: [f(351, "museByStableYogi_v35NVFP4Extended.safetensors", 7.15, { format: "SafeTensor", fp: "fp8" })] },
    { id: 36, name: "v3.5 Fp8 Extended", files: [f(361, "museByStableYogi_v35Fp8Extended.safetensors", 12.24, { format: "SafeTensor", fp: "fp8_scaled" })] },
    { id: 30, name: "v3.0 Turbo Int8", files: [
      f(301, "museByStableYogi_v30TurboInt8_fp8Scaled.safetensors", 12.84, { format: "SafeTensor", fp: "fp8_scaled" }),
      f(302, "museByStableYogi_v30TurboInt8_int8.safetensors", 12.57, { format: "SafeTensor", fp: "int8" }, { primary: false })] },
    { id: 10, name: "v1.0 Turbo Fp8", files: [
      f(101, "museByStableYogi_v10TurboFp8.safetensors", 11.94, { format: "SafeTensor", fp: "fp8" }),
      f(102, "museByStableYogi_v10TurboFp8_pruned_q80.gguf", 13.57, { format: "GGUF" }, { primary: false }),
      f(103, "museByStableYogi_v10TurboFp8_txt.safetensors", 8.27, { format: "SafeTensor", fp: "bf16" }, { primary: false, type: "Text Encoder" })] },
  ],
};

test("the format comes from the file name, not CivitAI's tag", () => {
  assert.deepEqual(quantOf(MUSE.versions[4].files[0]), { kind: "nvfp4", bits: 4, label: "NVFP4" }, "an NVFP4 file tagged fp8");
  assert.equal(quantOf(MUSE.versions[6].files[0]).kind, "fp8", "the last format word wins: ..._Int8_fp8Scaled is FP8");
  assert.equal(quantOf(MUSE.versions[6].files[1]).kind, "int8");
  assert.deepEqual(quantOf(MUSE.versions[2].files[0]), { kind: "gguf", bits: 4, label: "GGUF Q4" });
  assert.equal(quantOf(MUSE.versions[7].files[1]).label, "GGUF Q8", "q80 is Q8");
  assert.equal(quantOf({ name: "model-Q5_K_M.gguf" }).bits, 5);
  assert.equal(quantOf({ name: "plain.safetensors", metadata: { fp: "fp16" } }).kind, "fp16", "the tag when the name says nothing");
  assert.equal(quantOf({ name: "flux1-dev.safetensors" }, "v1 fp8").kind, "fp8", "or the version name");
  assert.equal(quantOf({ name: "x.safetensors" }).kind, null);
});

test("RTX 4070 12 GB: what fits, what runs slow, and why", () => {
  const int4 = assess(MUSE.versions[0].files[0], "", RTX4070);
  assert.equal(int4.verdict, "good");
  assert.match(int4.notes.join(" "), /fits in your 10\.5 GB/);
  const nvfp4 = assess(MUSE.versions[1].files[0], "", RTX4070);
  assert.equal(nvfp4.verdict, "slow");
  assert.match(nvfp4.notes.join(" "), /RTX 50/);
  const fp8 = assess(MUSE.versions[5].files[0], "", RTX4070);
  assert.equal(fp8.verdict, "slow", "12.2 GB doesn't fit a 10.5 GB budget");
  assert.match(fp8.notes.join(" "), /part of it runs from RAM/);
  const q2 = assess(MUSE.versions[3].files[0], "", RTX4070);
  assert.equal(q2.verdict, "good");
  assert.match(q2.notes.join(" "), /quality/);
  assert.ok(int4.score > q2.score && int4.score > nvfp4.score && int4.score > fp8.score);
});

test("missing loaders and unknown systems", () => {
  const noGguf = { ...RTX4070, loaders: { gguf: false, nunchaku: false } };
  assert.equal(assess(MUSE.versions[2].files[0], "", noGguf).verdict, "no");
  assert.match(assess(MUSE.versions[2].files[0], "", noGguf).notes[0], /ComfyUI-GGUF/);
  const oldComfy = { ...RTX4070, formats: ["float8_e4m3fn"], loaders: { gguf: true, nunchaku: false } };
  assert.equal(assess(MUSE.versions[0].files[0], "", oldComfy).verdict, "no");
  assert.equal(assess(MUSE.versions[0].files[0], "", null).verdict, "unknown");
});

test("the recommendation: best fit across versions, newest on ties, never a text encoder", () => {
  assert.deepEqual(recommend(MUSE, RTX4070), { versionId: 40, fileId: 401, score: assess(MUSE.versions[0].files[0], "", RTX4070).score, verdict: "good" });
  const r = recommend(MUSE, RTX5090);
  assert.equal(r.fileId, 361, "with 32 GB an 8-bit FP8 file wins over 4-bit ones (v3.5, the newest FP8)");
  assert.equal(recommend(MUSE, null), null);
  assert.equal(recommend({ ...MUSE, downloadable: false }, RTX4070), null);
  const onlyTe = { downloadable: true, versions: [{ id: 1, name: "v1", files: [MUSE.versions[7].files[2]] }] };
  assert.equal(recommend(onlyTe, RTX4070), null);
});

test("GPU names", () => {
  assert.equal(gpuName(RTX4070), "RTX 4070");
  assert.equal(gpuName({ gpu: "mps" }), "mps");
  assert.equal(gpuName(null), "your GPU");
});
