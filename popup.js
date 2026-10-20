// The toolbar popup: is ComfyUI there, the download queue with progress, and the ComfyUI address.
import { fmtSize } from "./lib/civitai.js";
import { isLoopback, normalizeBase, originPattern } from "./lib/comfy.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

const STATUS = {
  queued: (x, conn) => h("span", { class: "warn" }, conn.ok ? "Sending to Model Librarian…" : "Queued: starts when ComfyUI is running"),
  downloading: (x) => {
    const pct = x.total ? Math.floor((100 * x.done) / x.total) : 0;
    return h("span", null, x.total ? `${pct}% · ${fmtSize(x.done)} of ${fmtSize(x.total)}${x.speed ? ` · ${fmtSize(x.speed)}/s` : ""}` : "Starting…");
  },
  done: () => h("span", { class: "ok" }, "✓ Downloaded and verified"),
  have: () => h("span", { class: "ok" }, "✓ Already in your library"),
  cancelled: () => h("span", { class: "dim" }, "Cancelled in Model Librarian"),
  error: (x) => h("span", { class: "err" }, x.error || "Failed"),
};

function render({ queue, conn, settings }) {
  $("dot").className = "dot " + (conn.ok ? "ok" : "wait");
  $("conn").replaceChildren(conn.ok
    ? h("div", null, h("span", { class: "ok" }, "● "), `Connected to ComfyUI at ${conn.base}`, h("div", { class: "dim" },
        `Model Librarian ${conn.version}${conn.freeBytes != null ? ` · ${fmtSize(conn.freeBytes)} free in the models folder` : ""}`,
        conn.civitaiKey ? null : " · no CivitAI key set (some models need one)"))
    : h("div", null, h("span", { class: "warn" }, "● "), conn.error || "Looking for ComfyUI…",
        h("div", { class: "dim" }, "Downloads you click wait here and start as soon as ComfyUI is running with Model Librarian."),
        h("div", { class: "row", style: "margin-top:6px" }, h("button", { class: "small ghost", onclick: check }, "Check now"))));
  $("notify").checked = settings.notify !== false;
  $("withNeeds").checked = settings.withNeeds !== false;
  drawTargets(settings);
  const list = [...queue].sort((a, b) => b.added - a.added);
  $("clear").hidden = !queue.some((x) => ["done", "have", "cancelled"].includes(x.status));
  $("queue").replaceChildren(...(list.length ? list.map((x) => item(x, conn)) : [h("div", { class: "empty" }, "Nothing yet. Open a model on CivitAI and press Download with Model Librarian.")]));
}

function item(x, conn) {
  const pct = x.total ? Math.floor((100 * x.done) / x.total) : 0;
  return h("div", { class: "item" },
    h("div", { class: "row" },
      h("div", { class: "title", style: "flex:1" }, x.pageUrl ? h("a", { href: x.pageUrl, target: "_blank", title: x.title }, x.title) : x.title),
      ["error", "cancelled"].includes(x.status) ? h("button", { class: "small", onclick: () => send({ type: "retry", key: x.key }).then(refresh) }, "Retry") : null,
      x.status !== "downloading" ? h("button", { class: "link", title: "Remove from the list", onclick: () => send({ type: "remove", key: x.key }).then(refresh) }, "×") : null),
    h("div", { class: "file dim", title: x.file }, [x.file, fmtSize(x.size)].filter(Boolean).join(" · ")),
    x.status === "downloading" ? h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })) : null,
    (STATUS[x.status] || STATUS.error)(x, conn),
    x.dest && ["done", "have", "downloading"].includes(x.status) ? h("code", null, x.dest) : null);
}

// The ComfyUIs to choose from: "find it", what's answering on the usual ports, and saved addresses.
let found = [];
function drawTargets(settings) {
  const radio = (value, label, note, forget) => h("label", null,
    h("input", { type: "radio", name: "target", checked: (settings.base || "") === value, onchange: () => send({ type: "settings", base: value }).then(render) }),
    label, note ? h("span", { class: "dim" }, note) : null,
    forget ? h("button", { class: "link", title: "Forget this address", onclick: (e) => { e.preventDefault(); send({ type: "settings", forget: value }).then(render); } }, "×") : null);
  const bases = [...new Set([...found.filter((f) => f.ok).map((f) => f.base), ...(settings.saved || [])])];
  $("targets").replaceChildren(radio("", "Find it", "first one answering"),
    ...bases.map((b) => {
      const f = found.find((x) => x.base === b);
      return radio(b, b.replace(/^https?:\/\//, ""), f ? (f.ok ? `Model Librarian ${f.version}` : "not answering") : "", (settings.saved || []).includes(b));
    }));
}
async function scan() { found = await send({ type: "scan" }); refresh(); }

async function drawLater() {
  const { saved = [] } = await chrome.storage.local.get({ saved: [] });
  $("later").hidden = !saved.length;
  $("laterList").replaceChildren(...saved.map((x) => h("div", { class: "row" },
    h("a", { href: x.url, target: "_blank", style: "color:inherit;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, x.name),
    h("span", { class: "dim" }, x.type || ""),
    h("button", { class: "link", title: "Remove", onclick: () => send({ type: "saveForLater", remove: true, entry: x }).then(drawLater) }, "×"))));
}

async function refresh() { render(await send({ type: "state" })); drawLater(); }
async function check() { render(await send({ type: "pump" })); }

$("clear").onclick = () => send({ type: "clear" }).then(refresh);
$("save").onclick = async () => {
  let base = "";
  try { base = normalizeBase($("base").value); } catch { return alert("That isn't an address. Example: http://127.0.0.1:8188"); }
  if (base && !isLoopback(base)) {
    // another PC: the extension needs permission to reach it (asked once, from this click)
    const ok = await chrome.permissions.request({ origins: [originPattern(base)] });
    if (!ok) return;
  }
  $("base").value = "";
  render(await send({ type: "settings", base }));
  scan();
};
$("notify").onchange = (e) => send({ type: "settings", notify: e.target.checked });
$("withNeeds").onchange = (e) => send({ type: "settings", withNeeds: e.target.checked });
chrome.storage.onChanged.addListener((_c, area) => { if (area === "local") refresh(); });
refresh();
check();
scan();
