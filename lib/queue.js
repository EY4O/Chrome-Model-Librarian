// The download queue, kept in chrome.storage. Pure functions (no chrome.*), so they can be tested.
//
// An item is one file of one CivitAI version:
//   queued       waiting in the extension (ComfyUI closed, or not sent yet)
//   downloading  handed to Model Librarian (jobId), progress from its jobs
//   done / have  finished, or already in the library
//   error        Model Librarian or CivitAI said no (with the reason); Retry puts it back in the queue
//   cancelled    cancelled in Model Librarian

export const FINISHED = ["done", "have", "cancelled"];
export const MAX_ATTEMPTS = 5; // CivitAI lookups that fail for a moment are tried again, then reported

export const keyOf = (versionId, fileId) => `${versionId}:${fileId || "primary"}`;

export function enqueue(queue, item, now = Date.now()) {
  const key = keyOf(item.versionId, item.fileId);
  const old = queue.find((x) => x.key === key);
  if (old && !["error", "cancelled"].includes(old.status)) return { queue, item: old, added: false };
  const fresh = {
    key, versionId: Number(item.versionId), fileId: item.fileId ? Number(item.fileId) : null,
    title: item.title || "", file: item.file || "", size: item.size || null, pageUrl: item.pageUrl || "",
    status: "queued", jobId: null, done: 0, total: item.size || 0, speed: 0, error: null, dest: null, attempts: 0,
    added: now, updated: now,
  };
  return { queue: [...queue.filter((x) => x.key !== key), fresh], item: fresh, added: true };
}

export const pending = (queue) => queue.filter((x) => x.status === "queued");
export const active = (queue) => queue.filter((x) => x.status === "downloading" && x.jobId);

const patch = (queue, key, fn) => queue.map((x) => (x.key === key ? { ...x, ...fn(x) } : x));

// What Model Librarian answered to /ext/download (or the error it raised).
export function applySend(queue, key, res, now = Date.now()) {
  return patch(queue, key, (x) => {
    if (res.error) {
      const transient = res.transient && x.attempts + 1 < MAX_ATTEMPTS;
      return { status: transient ? "queued" : "error", error: res.error, attempts: x.attempts + 1, updated: now };
    }
    const where = res.dest || res.rel || null;
    if (res.status === "have") return { status: "have", dest: where, error: null, updated: now };
    if (res.status === "started" || res.status === "downloading") {
      const j = res.job || {};
      return { status: "downloading", jobId: j.id || null, done: j.done || 0, total: j.total || x.total, dest: where, error: null, updated: now };
    }
    return { status: "error", error: `Unexpected answer: ${res.status || "nothing"}`, updated: now };
  });
}

// Progress from /ext/jobs.
export function applyJobs(queue, jobs, now = Date.now()) {
  const byId = new Map((jobs || []).map((j) => [j.id, j]));
  return queue.map((x) => {
    if (x.status !== "downloading" || !x.jobId) return x;
    const j = byId.get(x.jobId);
    if (!j) return x;
    const next = { done: j.done || 0, total: j.total || x.total, speed: j.speed || 0, dest: j.dest || x.dest, updated: now };
    if (j.status === "done") return { ...x, ...next, status: "done", done: next.total || next.done };
    if (j.status === "error") return { ...x, ...next, status: "error", error: j.error || "Download failed" };
    if (j.status === "cancelled") return { ...x, ...next, status: "cancelled" };
    return { ...x, ...next };
  });
}

export const retry = (queue, key, now = Date.now()) =>
  patch(queue, key, (x) => (x.status === "error" || x.status === "cancelled" ? { status: "queued", error: null, attempts: 0, jobId: null, updated: now } : {}));
export const remove = (queue, key) => queue.filter((x) => x.key !== key);
export const clearFinished = (queue) => queue.filter((x) => !FINISHED.includes(x.status));

export function counts(queue) {
  const c = { queued: 0, downloading: 0, finished: 0, error: 0 };
  for (const x of queue) {
    if (x.status === "queued") c.queued++;
    else if (x.status === "downloading") c.downloading++;
    else if (x.status === "error") c.error++;
    else c.finished++;
  }
  return c;
}

// The toolbar badge: what's still to do.
export function badge(queue) {
  const c = counts(queue);
  const n = c.queued + c.downloading;
  return { text: n ? String(n) : c.error ? "!" : "", color: c.error && !n ? "#d9534f" : c.queued && !c.downloading ? "#b7791f" : "#2f7cf6" };
}

// Status of a file on a model page: the queue first, then what the library said.
export function fileState(queue, versionId, fileId, primary, owned) {
  const item = queue.find((x) => x.key === keyOf(versionId, fileId)) || (primary ? queue.find((x) => x.key === keyOf(versionId, null)) : null);
  if (item) return item;
  if (owned === "have") return { status: "have" };
  if (owned === "downloading") return { status: "downloading", done: 0, total: 0 };
  return null;
}
