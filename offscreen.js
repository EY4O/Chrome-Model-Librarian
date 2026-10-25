// A page with no window, for one thing a service worker can't do: hold a file fetched by the extension as a blob: URL
// for Chrome's downloader. Pixiv's originals only come with Pixiv as the referrer, which a download can't send, but a
// fetch from here can (the service worker's header rule sets it); the blob: URL then goes to chrome.downloads.
const held = new Map();
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // (only the extension's own service worker: its content scripts, inside web pages, share its id)
  if (sender.id !== chrome.runtime.id || sender.tab || !msg || msg.target !== "offscreen") return false;
  if (msg.type === "hold") {
    fetch(msg.url, { credentials: "omit" }).then(async (r) => {
      if (!r.ok) throw new Error(`The site said ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      held.set(url, true);
      reply({ url });
    }).catch((e) => reply({ error: e.message }));
    return true;
  }
  if (msg.type === "release") {
    if (held.delete(msg.url)) URL.revokeObjectURL(msg.url);
    reply({ ok: true });
  }
  return false;
});
