"""End-to-end check of the extension in headless Edge, on the staged pages of tools/media/make_media.py (sample
CivitAI pages and a recording sample Model Librarian; never real sites or your library):

  - "↑ Get update" on a card queues the newer version (without following the card's link), found through
    Model Librarian's lookup with your key when CivitAI's public API won't show the model
  - "Get all missing" on a collection runs in the background, with progress, to the end
  - the popup's Cancel cancels in Model Librarian; Retry carries on in Model Librarian when it still has the download
  - the right-click "Download with Model Librarian" menu is there

  python tests/e2e_features.py

Needs what make_media.py needs (Edge, aiohttp, websockets, openssl, port 443 free on 127.0.0.1).
"""
import asyncio
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time

from aiohttp import web

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "media"))
import make_media as M  # noqa: E402

CALLS = []
RAW_3003 = {"id": 3003, "name": "Paper Lantern", "type": "LORA", "creator": {"username": "sample_artist"}, "modelVersions": [
    {"id": 1, "name": "v2", "baseModel": "Krea 2", "files": [M.file(331, "paper_lantern_v2.safetensors", 0.2, ftype="Model")]},
    {"id": 2, "name": "v1", "baseModel": "Krea 2", "files": [M.file(332, "paper_lantern_v1.safetensors", 0.2, ftype="Model")]},
]}


async def ml(request: web.Request):
    p = request.path.replace("/api/sm-fetcher", "/sm-fetcher")
    body = await request.json() if request.can_read_body else {}
    CALLS.append((request.method, p, dict(request.query), body))
    if p == "/sm-fetcher/ext/hello":
        return web.json_response({"app": "model-librarian", "version": "1.21.0", "models_root": "D:\\ComfyUI\\models", "free_bytes": 412 * M.GB,
                                  "civitai_key": True, "active_downloads": 0, "system": M.SYSTEM})
    if p == "/sm-fetcher/ext/model" and request.query.get("raw"):
        return web.json_response(RAW_3003) if request.query.get("id") == "3003" else web.json_response({"error": "not found"}, status=404)
    if p.startswith("/sm-fetcher/jobs/") and p.endswith("/cancel"):
        return web.json_response({"ok": True})
    if p.startswith("/sm-fetcher/jobs/") and p.endswith("/retry"):
        return web.json_response({"job": {"id": "job-resumed", "status": "queued", "done": 0, "total": 0}})
    if p == "/sm-fetcher/ext/lookup":  # (the body is read above: answered here from the sample data)
        models = {str(i): {"status": st, "files": 1, "update": {"version_id": 1, "name": "v2"} if st == "update" else None} for i, _, st in M.CARDS if st}
        return web.json_response({"versions": {str(v): {"status": "missing"} for v in body.get("version_ids") or []}, "hashes": {},
                                  "models": {str(i): models.get(str(i), {"status": "missing"}) for i in body.get("model_ids") or []}})
    if p == "/sm-fetcher/ext/jobs":
        return web.json_response({"jobs": [{"id": i, "status": "downloading", "done": 1, "total": 10, "speed": 1} for i in (request.query.get("ids") or "").split(",") if i]})
    return await M.ml(request)


async def sites(request: web.Request):
    """The staged sites, plus a collection page (/collections/<id>) with the same sample cards."""
    if request.path.startswith("/collections/"):
        cards = "".join(f'<a class="card" href="/models/{i}/{n.lower().replace(" ", "-")}"><img src="/samples/{k + 1}.jpg" alt="{n}"><div>{n}</div></a>'
                        for k, (i, n, _) in enumerate(M.CARDS))
        return M.page("Collection", f"<h1>A collection</h1><div class='grid'>{cards}</div>")
    return await M.sites(request)


def called(method, path, **match):
    return [c for c in CALLS if c[0] == method and c[1] == path and all(c[3].get(k) == v for k, v in match.items())]


async def run(check):
    profile = tempfile.mkdtemp(prefix="ml_ext_edge_")
    edge = subprocess.Popen([M.EDGE, "--headless=new", f"--remote-debugging-port={M.CDP_PORT}", f"--user-data-dir={profile}",
                             f"--load-extension={M.EXT}", f"--disable-extensions-except={M.EXT}", "--no-first-run",
                             "--host-resolver-rules=MAP civitai.com 127.0.0.1, MAP huggingface.co 127.0.0.1",
                             "--ignore-certificate-errors", "--window-size=1280,900", "about:blank"])
    try:
        sw = None
        for _ in range(80):
            try:
                sw = next((t for t in M.cdp_json("/json/list") if t["type"] == "service_worker" and t["url"].endswith("/background.js")), None)
            except OSError:
                pass
            if sw:
                break
            await asyncio.sleep(0.25)
        ext_id = sw["url"].split("/")[2]
        pws, pop = await M.tab(f"chrome-extension://{ext_id}/popup.html", 380, 1000)
        await pop.wait("document.readyState === 'complete'", 10)
        await pop.js(f"chrome.runtime.sendMessage({{ type: 'settings', base: '{M.ML}' }})")
        queue = "chrome.storage.local.get({ queue: [] }).then((s) => s.queue)"


        # ---- a collection page: "↑ Get update" on a card
        ws, c = await M.tab("https://civitai.com/models")
        badge = "[...document.querySelectorAll('a[href*=\"/models/3003\"] .ml-badge')][0]"
        await c.wait(f"{badge} && {badge}.textContent.includes('Get update')", 30)
        url0 = await c.js("location.href")
        await c.js(f"{badge}.click()")
        await c.wait(f"{badge} && {badge}.textContent.includes('queued')", 20)
        q = await pop.js(queue)
        item = next((x for x in q if x.get("versionId") == 1), None)
        check(item is not None and await c.js("location.href") == url0, f"Get update: the newer version is queued, the card's link isn't followed ({item and item['title']})")
        check(any(x[1] == "/sm-fetcher/ext/model" and x[2].get("id") == "3003" for x in CALLS),
              "  found through Model Librarian (with your key) when CivitAI's public API doesn't show the model")
        for _ in range(40):
            if called("POST", "/sm-fetcher/ext/download", version_id=1):
                break
            await asyncio.sleep(0.25)
        check(bool(called("POST", "/sm-fetcher/ext/download", version_id=1)), "  and sent to Model Librarian")

        # ---- "Get all missing": a background job with progress, to the end
        await ws.close()
        ws, c = await M.tab("https://civitai.com/collections/77")
        await c.wait("document.querySelectorAll('.ml-badge').length >= 5", 30)
        await M.open_panel(c, f"[...{M.R}.querySelectorAll('button')].some((b) => b.textContent.startsWith('Get all'))")
        n_missing = await c.js(f"Number(([...{M.R}.querySelectorAll('button')].find((b) => /Get all \\d+ missing/.test(b.textContent)) || {{}}).textContent.match(/\\d+/)[0])")
        await c.js(f"[...{M.R}.querySelectorAll('button')].find((b) => /Get all \\d+ missing/.test(b.textContent)).click()")
        saw_progress = False
        for _ in range(240):
            st = await pop.js("chrome.storage.local.get({ collect: null }).then((s) => s.collect)")
            text = await c.js(f"{M.R}.querySelector('.body')?.innerText || ''")
            saw_progress = saw_progress or "Queueing models" in text
            if st and not st["pending"]:
                break
            await asyncio.sleep(0.25)
        check(st and st["total"] == n_missing and len(st["results"]) == n_missing and not st["pending"],
              f"collection: every missing model handled in the background ({len(st['results']) if st else 0} of {n_missing})")
        await asyncio.sleep(0.6)
        text = await c.js(f"{M.R}.querySelector('.body')?.innerText || ''")
        summary = next((l for l in text.splitlines() if re.match(r"^\d+ queued", l)), "")
        check(bool(summary), f"  the panel shows the outcome ({summary!r})")
        await ws.close()

        # ---- popup: Cancel in Model Librarian; Retry carries on there
        for _ in range(40):
            q = await pop.js(queue)
            item = next((x for x in q if x.get("versionId") == 1), None)
            if item and item["status"] == "downloading":
                break
            await asyncio.sleep(0.25)
        r = await pop.js(f"chrome.runtime.sendMessage({{ type: 'cancel', key: '{item['key']}' }})")
        q = await pop.js(queue)
        check(r.get("ok") and called("POST", f"/sm-fetcher/jobs/{item['jobId']}/cancel") and next(x for x in q if x["key"] == item["key"])["status"] == "cancelled",
              "popup Cancel: cancelled in Model Librarian, and here")
        swws = await M.websockets.connect(sw["webSocketDebuggerUrl"], max_size=None)
        swc = M.CDP(swws)
        await swc.js(f"""chrome.storage.local.get({{ queue: [] }}).then(({{ queue }}) => chrome.storage.local.set({{ queue: queue.map((x) => x.key === '{item['key']}'
            ? {{ ...x, status: 'error', jobId: 'job-broken', error: 'Interrupted (ComfyUI restarted)' }} : x) }}))""")
        r = await pop.js(f"chrome.runtime.sendMessage({{ type: 'retry', key: '{item['key']}' }})")
        q = await pop.js(queue)
        it = next(x for x in q if x["key"] == item["key"])
        check(r.get("resumed") and called("POST", "/sm-fetcher/jobs/job-broken/retry") and it["status"] == "downloading" and it["jobId"] == "job-resumed",
              f"popup Retry: carried on in Model Librarian ({it['status']}, {it['jobId']})")
        # ---- the right-click menu is registered
        menu = await swc.js("new Promise((r) => chrome.contextMenus.update('ml-download', {}, () => r(!chrome.runtime.lastError)))")
        check(menu, "right-click: the Download with Model Librarian menu is there")
        await swws.close()
        await pws.close()
    finally:
        edge.terminate()
        subprocess.run(["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*ml_ext_edge_*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], capture_output=True)
        time.sleep(1)
        shutil.rmtree(profile, ignore_errors=True)


async def main():
    fails = 0

    def check(ok, msg):
        nonlocal fails
        print(("PASS " if ok else "FAIL ") + msg)
        fails += 0 if ok else 1
    certs = tempfile.mkdtemp(prefix="ml_media_cert_")
    cert, key = os.path.join(certs, "cert.pem"), os.path.join(certs, "key.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
                    "-subj", "/CN=civitai.com", "-addext", "subjectAltName=DNS:civitai.com,DNS:huggingface.co"], check=True, capture_output=True)
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(cert, key)
    site_app = web.Application()
    site_app.router.add_route("GET", "/{tail:.*}", sites)
    ml_app = web.Application()
    ml_app.router.add_route("*", "/{tail:.*}", ml)
    runners = []
    try:
        for app, port, sslctx in ((site_app, 443, ctx), (ml_app, M.ML_PORT, None)):
            r = web.AppRunner(app)
            await r.setup()
            await web.TCPSite(r, "127.0.0.1", port, ssl_context=sslctx).start()
            runners.append(r)
        await run(check)
    finally:
        for r in runners:
            await r.cleanup()
        shutil.rmtree(certs, ignore_errors=True)
    print("\nFAILED: %d" % fails if fails else "\nALL PASSED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
