import test from "node:test";
import assert from "node:assert/strict";
import * as Q from "../lib/queue.js";

const item = (v, f, extra = {}) => ({ versionId: v, fileId: f, title: "Paper Cut — v1", file: "paper_cut.safetensors", size: 1000, ...extra });

test("clicks are queued once; a failed one can be queued again", () => {
  let { queue, added } = Q.enqueue([], item(11, 101), 1);
  assert.equal(added, true);
  assert.equal(queue[0].status, "queued");
  assert.equal(queue[0].key, "11:101");
  ({ queue, added } = Q.enqueue(queue, item(11, 101), 2));
  assert.equal(added, false, "a second click on the same file doesn't add it twice");
  queue = Q.applySend(queue, "11:101", { error: "Needs a login" }, 3);
  assert.equal(queue[0].status, "error");
  ({ queue, added } = Q.enqueue(queue, item(11, 101), 4));
  assert.equal(added, true);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "queued");
});

test("Model Librarian's answers: started, already here, and errors", () => {
  let { queue } = Q.enqueue([], item(11, 101));
  ({ queue } = Q.enqueue(queue, item(21, 202)));
  ({ queue } = Q.enqueue(queue, item(31, null)));
  queue = Q.applySend(queue, "11:101", { status: "started", dest: "D:/models/loras/Illustrious/paper_cut.safetensors", job: { id: "j1", done: 0, total: 1000 } });
  queue = Q.applySend(queue, "21:202", { status: "have", rel: "SDXL/aurora.safetensors" });
  queue = Q.applySend(queue, "31:primary", { error: "CivitAI lookup failed: timeout", transient: true });
  const by = Object.fromEntries(queue.map((x) => [x.key, x]));
  assert.equal(by["11:101"].status, "downloading");
  assert.equal(by["11:101"].jobId, "j1");
  assert.equal(by["21:202"].status, "have");
  assert.equal(by["21:202"].dest, "SDXL/aurora.safetensors");
  assert.equal(by["31:primary"].status, "queued", "a passing CivitAI hiccup is tried again");
  assert.equal(by["31:primary"].attempts, 1);
  assert.deepEqual(Q.pending(queue).map((x) => x.key), ["31:primary"]);
  assert.deepEqual(Q.active(queue).map((x) => x.key), ["11:101"]);
});

test("a hiccup that keeps failing is reported after a few tries", () => {
  let { queue } = Q.enqueue([], item(31, null));
  for (let i = 0; i < Q.MAX_ATTEMPTS; i++) queue = Q.applySend(queue, "31:primary", { error: "timeout", transient: true });
  assert.equal(queue[0].status, "error");
  assert.equal(queue[0].error, "timeout");
});

test("progress, completion and failures from Model Librarian's jobs", () => {
  let { queue } = Q.enqueue([], item(11, 101));
  ({ queue } = Q.enqueue(queue, item(12, 102)));
  ({ queue } = Q.enqueue(queue, item(13, 103)));
  queue = Q.applySend(queue, "11:101", { status: "started", job: { id: "a" } });
  queue = Q.applySend(queue, "12:102", { status: "started", job: { id: "b" } });
  queue = Q.applySend(queue, "13:103", { status: "downloading", job: { id: "c" } });
  queue = Q.applyJobs(queue, [
    { id: "a", status: "downloading", done: 400, total: 1000, speed: 50 },
    { id: "b", status: "done", done: 1000, total: 1000, dest: "D:/x.safetensors" },
    { id: "c", status: "error", error: "SHA256 mismatch" },
  ]);
  const by = Object.fromEntries(queue.map((x) => [x.key, x]));
  assert.equal(by["11:101"].done, 400);
  assert.equal(by["11:101"].status, "downloading");
  assert.equal(by["12:102"].status, "done");
  assert.equal(by["12:102"].dest, "D:/x.safetensors");
  assert.equal(by["13:103"].status, "error");
  assert.equal(by["13:103"].error, "SHA256 mismatch");
  // jobs Model Librarian no longer lists (ComfyUI restarted) leave the item as it was
  assert.deepEqual(Q.applyJobs(queue, []), queue);
});

test("retry, remove, clear finished, counts and the badge", () => {
  let { queue } = Q.enqueue([], item(1, 1));
  ({ queue } = Q.enqueue(queue, item(2, 2)));
  ({ queue } = Q.enqueue(queue, item(3, 3)));
  queue = Q.applySend(queue, "1:1", { status: "have" });
  queue = Q.applySend(queue, "2:2", { error: "nope" });
  assert.deepEqual(Q.counts(queue), { queued: 1, downloading: 0, finished: 1, error: 1, scheduled: 0 });
  assert.deepEqual(Q.badge(queue), { text: "1", color: "#b7791f" });
  queue = Q.retry(queue, "2:2");
  assert.equal(queue.find((x) => x.key === "2:2").status, "queued");
  queue = Q.clearFinished(queue);
  assert.deepEqual(queue.map((x) => x.key), ["2:2", "3:3"]);
  queue = Q.remove(queue, "3:3");
  queue = Q.applySend(queue, "2:2", { error: "nope" });
  assert.deepEqual(Q.badge(queue), { text: "!", color: "#d9534f" });
  assert.deepEqual(Q.badge([]), { text: "", color: "#2f7cf6" });
});

test("a file's state on the model page: the queue, then the library", () => {
  let { queue } = Q.enqueue([], item(11, 101));
  assert.equal(Q.fileState(queue, 11, 101, true, "missing").status, "queued");
  assert.equal(Q.fileState(queue, 12, 201, true, "have").status, "have");
  assert.equal(Q.fileState(queue, 12, 202, false, null), null);
  ({ queue } = Q.enqueue(queue, item(13, null)));
  assert.equal(Q.fileState(queue, 13, 301, true, null).status, "queued", "a primary-file click covers the primary file");
});

test("companions (a text encoder or VAE a model needs) queue under their own key", () => {
  const c = { kind: "companion", name: "qwen_image_vae.safetensors", folder: "vae", baseModel: "Krea 2 Turbo", forFile: "muse_v40INT4.safetensors", title: "VAE for Krea 2" };
  let { queue, item } = Q.enqueue([], c);
  assert.equal(item.key, "c:qwen_image_vae.safetensors");
  assert.equal(item.versionId, null);
  assert.equal(item.kind, "companion");
  assert.equal(item.folder, "vae");
  assert.equal(Q.enqueue(queue, { ...c, name: "QWEN_IMAGE_VAE.safetensors" }).added, false, "same file, any case: once");
  queue = Q.applySend(queue, item.key, { status: "started", job: { id: "j9" } });
  assert.equal(queue[0].status, "downloading");
});

test("paid / early access: scheduled for when it's free, then sent by itself", () => {
  const Q2 = Q;
  let { queue } = Q2.enqueue([], { versionId: 5, fileId: 50, title: "Ed Benes — v1", notBefore: Date.parse("2026-10-25T15:20:00Z"), why: "Paid early access until 25 Oct" });
  assert.equal(queue[0].status, "scheduled");
  assert.deepEqual(Q2.pending(queue), [], "not sent before its time");
  assert.equal(Q2.wake(queue, Date.parse("2026-10-24T00:00:00Z"))[0].status, "scheduled");
  assert.equal(Q2.wake(queue, Date.parse("2026-10-25T16:00:00Z"))[0].status, "queued", "woken once the time has come");
  assert.equal(Q2.counts(queue).scheduled, 1);
  assert.deepEqual(Q2.badge(queue), { text: "", color: "#2f7cf6" }, "waiting ones don't count as to-do");
  assert.equal(Q2.retry(queue, "5:50")[0].status, "queued", "Try now");

  // a refusal Model Librarian dates (job error + available_at) becomes a wait, not a failure
  ({ queue } = Q2.enqueue([], { versionId: 6, fileId: 60 }));
  queue = Q2.applySend(queue, "6:60", { status: "started", job: { id: "j6" } });
  queue = Q2.applyJobs(queue, [{ id: "j6", status: "error", error: "Paid early access until 25 Oct", available_at: "2999-10-25T15:05:35Z" }]);
  assert.equal(queue[0].status, "scheduled");
  assert.equal(queue[0].notBefore, Date.parse("2999-10-25T15:05:35Z") + Q2.AFTER_FREE);
  assert.equal(queue[0].why, "Paid early access until 25 Oct");
  // an old failure, scheduled by hand
  ({ queue } = Q2.enqueue([], { versionId: 7, fileId: 70 }));
  queue = Q2.applySend(queue, "7:70", { error: "CivitAI requires an API key" });
  queue = Q2.schedule(queue, "7:70", "2999-01-01T00:00:00Z");
  assert.equal(queue[0].status, "scheduled");
});

test("never stuck downloading: interrupted, lost, and followed on the ComfyUI it went to", () => {
  let { queue } = Q.enqueue([], item(1, 1));
  queue = Q.applySend(queue, "1:1", { status: "started", job: { id: "a" } }, 1, "http://127.0.0.1:8188");
  assert.equal(queue[0].base, "http://127.0.0.1:8188", "remembers which ComfyUI has the job");
  // ComfyUI restarted mid-download: Model Librarian marks it interrupted
  let q2 = Q.applyJobs(queue, [{ id: "a", status: "interrupted", done: 10, total: 100 }]);
  assert.equal(q2[0].status, "error");
  assert.match(q2[0].error, /Interrupted/);
  assert.equal(Q.retry(q2, "1:1")[0].status, "queued", "and Retry works on it");
  // retried or cleared in Model Librarian itself: no longer listed by the server it was asked
  q2 = queue;
  for (let i = 0; i < Q.LOST_AFTER - 1; i++) q2 = Q.applyJobs(q2, [], 1, ["a"]);
  assert.equal(q2[0].status, "downloading", "a missed poll or two is tolerated");
  q2 = Q.applyJobs(q2, [], 1, ["a"]);
  assert.equal(q2[0].status, "error", "then it stops being followed");
  assert.deepEqual(Q.active(q2), []);
  // a server that wasn't asked (unreachable) changes nothing
  assert.deepEqual(Q.applyJobs(queue, [], 1, ["other"]), queue);
  // listed again: the miss count resets
  q2 = Q.applyJobs(queue, [], 1, ["a"]);
  q2 = Q.applyJobs(q2, [{ id: "a", status: "downloading", done: 5, total: 100 }], 1, ["a"]);
  assert.equal(q2[0].misses, 0);
});

test("a ComfyUI that stops answering: its downloads are reported after a while, not followed for ever", () => {
  const t0 = 1_000_000;
  let q = [{ key: "a", status: "downloading", jobId: "j1", base: "http://pc:8188" }, { key: "b", status: "downloading", jobId: "j2", base: "http://other:8188" }];
  q = Q.markUnreachable(q, "http://pc:8188", t0);
  assert.equal(q[0].status, "downloading");
  assert.equal(q[0].unreachableSince, t0);
  assert.equal(q[1].unreachableSince, undefined);
  const same = Q.markUnreachable(q, "http://pc:8188", t0 + 1000);
  assert.equal(same[0], q[0]); // nothing to rewrite while it's waited for
  q = Q.markUnreachable(q, "http://pc:8188", t0 + Q.UNREACHABLE_AFTER);
  assert.equal(q[0].status, "error");
  assert.match(q[0].error, /stopped answering/);
  // answering again before then clears it
  const back = Q.applyJobs([{ key: "c", status: "downloading", jobId: "j3", unreachableSince: t0 }], [{ id: "j3", status: "downloading", done: 5, total: 10 }], t0 + 5);
  assert.equal(back[0].unreachableSince, null);
});

test("progress that didn't change leaves the queue as it was; a file that appeared meanwhile counts as had", () => {
  const item = { key: "a", status: "downloading", jobId: "j1", done: 5, total: 10, speed: 2, dest: "/m/x", updated: 1 };
  const out = Q.applyJobs([item], [{ id: "j1", status: "downloading", done: 5, total: 10, speed: 2, dest: "/m/x" }], 999);
  assert.equal(out[0], item);
  const had = Q.applyJobs([item], [{ id: "j1", status: "error", error: "A file with this name already exists at the destination" }], 999);
  assert.equal(had[0].status, "have");
});

test("already in the library: the file you have, and old finished items are cleared", () => {
  const q = Q.applySend([{ key: "a", status: "queued", attempts: 0 }], "a", { status: "have", dest: "/planned/new.safetensors", folder: "loras", rel: "Pony/old.safetensors" });
  assert.equal(q[0].dest, "loras/Pony/old.safetensors");
  const now = 100 * 24 * 3600 * 1000;
  const kept = Q.prune([{ key: "old", status: "done", updated: now - Q.KEEP_FINISHED - 1 }, { key: "new", status: "done", updated: now - 1000 }, { key: "err", status: "error", updated: 0 }], now);
  assert.deepEqual(kept.map((x) => x.key), ["new", "err"]);
});
