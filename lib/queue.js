// The download queue, kept in chrome.storage. Pure functions (no chrome.*), so they can be tested.
//
// An item is one file of one CivitAI version:
//   queued       waiting in the extension (ComfyUI closed, or not sent yet)
//   downloading  handed to Model Librarian (jobId), progress from its jobs
//   done / have  finished, or already in the library
//   error        Model Librarian or CivitAI said no (with the reason); Retry puts it back in the queue
//   cancelled    cancelled in Model Librarian
//   scheduled    paid / early access for now: waits until notBefore, then is sent like a queued one

export const FINISHED = ["done", "have", "cancelled"];
export const MAX_ATTEMPTS = 5; // CivitAI lookups that fail for a moment are tried again, then reported
export const AFTER_FREE = 15 * 60 * 1000; // a scheduled one is tried this long after it should be free
export const LOST_AFTER = 3; // polls in a row that a server doesn't list a job before it counts as lost
export const UNREACHABLE_AFTER = 10 * 60 * 1000; // a ComfyUI that stops answering this long: its downloads stop being followed
export const KEEP_FINISHED = 14 * 24 * 3600 * 1000; // finished ones are cleared from the list after this

export const keyOf = (versionId, fileId) => `${versionId}:${fileId || "primary"}`;

// A companion (a text encoder or VAE a diffusion model needs) has its own key: "c:<file name>".
export const companionKey = (name) => `c:${String(name).toLowerCase()}`;
// A model from an image's recipe (Model Librarian planned where it goes): "p:<folder>/<path>".
export const planKey = (d) => `p:${d.folder}/${d.rel}`.toLowerCase();
// A file page (HuggingFace) into the folder picked for it: "u:<url>|<folder>".
export const urlKey = (url, folder) => `u:${url}|${folder}`.toLowerCase();

export function enqueue(queue, item, now = Date.now()) {
  const key = item.kind === "companion" ? companionKey(item.name) : item.kind === "plan" ? planKey(item.download)
    : item.kind === "url" ? urlKey(item.url, item.folder) : keyOf(item.versionId, item.fileId);
  const old = queue.find((x) => x.key === key);
  if (old && !["error", "cancelled"].includes(old.status)) return { queue, item: old, added: false };
  const fresh = {
    key, versionId: item.versionId != null ? Number(item.versionId) : null, fileId: item.fileId ? Number(item.fileId) : null,
    ...(item.kind === "companion" ? { kind: "companion", name: item.name, folder: item.folder, baseModel: item.baseModel || "", forFile: item.forFile || "" } : {}),
    ...(item.kind === "plan" ? { kind: "plan", download: item.download } : {}),
    ...(item.kind === "url" ? { kind: "url", url: item.url, folder: item.folder } : {}),
    title: item.title || "", file: item.file || "", size: item.size || null, pageUrl: item.pageUrl || "",
    status: item.notBefore ? "scheduled" : "queued", notBefore: item.notBefore || null, why: item.why || null,
    jobId: null, done: 0, total: item.size || 0, speed: 0, error: null, dest: null, attempts: 0,
    added: now, updated: now,
  };
  return { queue: [...queue.filter((x) => x.key !== key), fresh], item: fresh, added: true };
}

export const pending = (queue) => queue.filter((x) => x.status === "queued");

// Scheduled ones whose time has come go back in the queue.
export const wake = (queue, now = Date.now()) =>
  queue.map((x) => (x.status === "scheduled" && x.notBefore && x.notBefore <= now ? { ...x, status: "queued", attempts: 0, jobId: null, updated: now } : x));

// Wait until `iso` (+15 min), e.g. "paid early access until 25 Oct", then try again by itself.
export const schedule = (queue, key, iso, why = null, now = Date.now()) =>
  queue.map((x) => (x.key === key ? { ...x, status: "scheduled", notBefore: Date.parse(iso) + AFTER_FREE, why: why || x.why || x.error, jobId: null, updated: now } : x));
export const active = (queue) => queue.filter((x) => x.status === "downloading" && x.jobId);

const patch = (queue, key, fn) => queue.map((x) => (x.key === key ? { ...x, ...fn(x) } : x));

// What Model Librarian answered to /ext/download (or the error it raised). `base`: the ComfyUI it went to
// (its jobs are followed there, even after the target is switched).
export function applySend(queue, key, res, now = Date.now(), base = null) {
  return patch(queue, key, (x) => {
    if (res.error) {
      const transient = res.transient && x.attempts + 1 < MAX_ATTEMPTS;
      return { status: transient ? "queued" : "error", error: res.error, attempts: x.attempts + 1, updated: now };
    }
    const where = res.dest || res.rel || null;
    // already there: the file you have (its folder/path), not where a new download would have gone
    if (res.status === "have") return { status: "have", dest: res.rel ? `${res.folder ? res.folder + "/" : ""}${res.rel}` : where, error: null, updated: now };
    if (res.status === "started" || res.status === "downloading") {
      const j = res.job || {};
      return { status: "downloading", jobId: j.id || null, base: base || x.base || null, misses: 0, done: j.done || 0, total: j.total || x.total, dest: where, error: null, updated: now };
    }
    return { status: "error", error: `Unexpected answer: ${res.status || "nothing"}`, updated: now };
  });
}

// Progress from /ext/jobs. `asked`: the job ids that were asked of that server: one it keeps not
// listing (retried or cleared in Model Librarian itself) stops being followed after a few polls.
export function applyJobs(queue, jobs, now = Date.now(), asked = null) {
  const byId = new Map((jobs || []).map((j) => [j.id, j]));
  const askedSet = asked ? new Set(asked) : null;
  return queue.map((x) => {
    if (x.status !== "downloading" || !x.jobId) return x;
    const j = byId.get(x.jobId);
    if (!j) {
      if (!askedSet || !askedSet.has(x.jobId)) return x;
      const misses = (x.misses || 0) + 1;
      return misses >= LOST_AFTER
        ? { ...x, status: "error", misses, updated: now, error: "Model Librarian doesn't list this download any more (it was retried or cleared there). Retry starts it again." }
        : { ...x, misses };
    }
    const next = { done: j.done || 0, total: j.total || x.total, speed: j.speed || 0, dest: j.dest || x.dest };
    const same = ["done", "total", "speed", "dest"].every((k) => next[k] === x[k]) && j.status === x.status;
    next.updated = same ? x.updated : now; // nothing new: the item stays as it was (no rewrite of the whole queue)
    if (j.status === "done") return { ...x, ...next, status: "done", done: next.total || next.done, unreachableSince: null };
    if (j.status === "error" && /already exists/i.test(j.error || "")) // a copy finished in between: it's here
      return { ...x, ...next, status: "have", error: null, unreachableSince: null };
    if (j.status === "error" && j.available_at && Date.parse(j.available_at) > now) // free later: wait for it
      return { ...x, ...next, status: "scheduled", notBefore: Date.parse(j.available_at) + AFTER_FREE, why: j.error || null, error: null, jobId: null };
    if (j.status === "error") return { ...x, ...next, status: "error", error: j.error || "Download failed" };
    if (j.status === "cancelled") return { ...x, ...next, status: "cancelled" };
    if (j.status === "interrupted") // ComfyUI restarted mid-download: Retry carries on from where it stopped
      return { ...x, ...next, status: "error", error: "Interrupted (ComfyUI restarted). Retry carries on from where it stopped." };
    if (same && !x.misses && !x.unreachableSince) return x;
    return { ...x, ...next, misses: 0, unreachableSince: null };
  });
}

// A ComfyUI the queue's downloads went to isn't answering. After UNREACHABLE_AFTER they're reported,
// with Retry, instead of spinning (and keeping the extension awake) for ever.
export function markUnreachable(queue, base, now = Date.now()) {
  return queue.map((x) => {
    if (x.status !== "downloading" || !x.jobId || (x.base || null) !== (base || null)) return x;
    const since = x.unreachableSince || now;
    if (now - since >= UNREACHABLE_AFTER) {
      return { ...x, status: "error", unreachableSince: null, updated: now,
        error: `ComfyUI at ${base || "its address"} stopped answering, so this download isn't followed any more. Retry once it's back.` };
    }
    return x.unreachableSince ? x : { ...x, unreachableSince: now };
  });
}

// Finished ones older than KEEP_FINISHED go (the list, and chrome.storage, don't grow for ever).
export const prune = (queue, now = Date.now()) =>
  queue.filter((x) => !FINISHED.includes(x.status) || now - (x.updated || x.added || now) < KEEP_FINISHED);

// Cancelled here and in Model Librarian.
export const cancel = (queue, key, now = Date.now()) =>
  patch(queue, key, (x) => (["queued", "downloading", "scheduled"].includes(x.status) ? { status: "cancelled", speed: 0, updated: now } : {}));

// Retried in Model Librarian itself (it carries on from where the file stopped): followed as that job.
export const resumed = (queue, key, job, now = Date.now()) =>
  patch(queue, key, (x) => ({ status: "downloading", jobId: job.id || x.jobId, error: null, misses: 0, unreachableSince: null,
    done: job.done || 0, total: job.total || x.total, speed: 0, updated: now }));

export const retry = (queue, key, now = Date.now()) =>
  patch(queue, key, (x) => (["error", "cancelled", "scheduled"].includes(x.status) ? { status: "queued", error: null, attempts: 0, jobId: null, notBefore: null, updated: now } : {}));
export const remove = (queue, key) => queue.filter((x) => x.key !== key);
export const clearFinished = (queue) => queue.filter((x) => !FINISHED.includes(x.status));

export function counts(queue) {
  const c = { queued: 0, downloading: 0, finished: 0, error: 0, scheduled: 0 };
  for (const x of queue) {
    if (x.status === "queued") c.queued++;
    else if (x.status === "scheduled") c.scheduled++;
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
