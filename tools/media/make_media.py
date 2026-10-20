"""README screenshots of the extension, on staged pages with sample data (never real CivitAI or
HuggingFace content, never your library).

How: a local HTTPS server answers for civitai.com and huggingface.co (headless Edge started with
--host-resolver-rules pointing those names at it, and --ignore-certificate-errors for its throwaway
certificate), serving neutral sample pages and API answers; a fake Model Librarian answers on
127.0.0.1:8211. The extension runs unchanged against both.

  python tools/media/make_media.py [--out docs/images]

Needs: Microsoft Edge, Python with aiohttp, websockets and Pillow (ComfyUI's environment has them),
openssl on PATH (Git for Windows has it), and port 443 free on 127.0.0.1.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets
from aiohttp import web
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(os.path.dirname(HERE))
SAMPLES = os.path.join(HERE, "samples")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9334
ML_PORT = 8211
ML = f"http://127.0.0.1:{ML_PORT}"
GB, MB = 1024 ** 3, 1024 ** 2
DAY = 86400
PAID_UNTIL = time.strftime("%Y-%m-%dT15:00:00Z", time.gmtime(time.time() + 5 * DAY))

# ---------------------------------------------------------------- sample data
SYSTEM = {"gpu": "cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync", "vram_total": 12 * GB, "capability": "8.9", "budget": int(10.5 * GB),
          "fast": {"fp8": True, "nvfp4": False, "mxfp8": False, "int8": True},
          "formats": ["float8_e4m3fn", "int8_tensorwise", "convrot_w4a4", "nvfp4"], "loaders": {"gguf": True, "nunchaku": True}}


def file(fid, name, gb_size, fmt="SafeTensor", fp=None, primary=True, ftype="Diffusion Model"):
    return {"id": fid, "name": name, "sizeKB": gb_size * GB / 1024, "primary": primary, "type": ftype,
            "metadata": {"format": fmt, "fp": fp}, "hashes": {}, "downloadUrl": f"https://civitai.com/api/download/models/{fid}"}


MODELS = {
    3001: {"id": 3001, "name": "Aurora Diffusion", "type": "Checkpoint", "creator": {"username": "sample_artist"}, "modelVersions": [
        {"id": 30011, "name": "v3 INT4", "baseModel": "Krea 2", "files": [file(301, "aurora_v3_int4.safetensors", 6.9, fp="int4")]},
        {"id": 30012, "name": "v3 NVFP4", "baseModel": "Krea 2", "files": [file(302, "aurora_v3_nvfp4.safetensors", 7.2, fp="nvfp4")]},
        {"id": 30013, "name": "v3 Q4 GGUF", "baseModel": "Krea 2", "files": [file(303, "aurora_v3_Q4_K_M.gguf", 7.8, fmt="GGUF")]},
        {"id": 30014, "name": "v3 FP8", "baseModel": "Krea 2", "files": [file(304, "aurora_v3_fp8_scaled.safetensors", 12.2, fp="fp8")]},
    ]},
    3002: {"id": 3002, "name": "Ink Wash Style", "type": "LORA", "creator": {"username": "sample_artist"}, "modelVersions": [
        {"id": 30021, "name": "v1", "baseModel": "Krea 2", "paidAccess": {"permanent": False, "endsAt": PAID_UNTIL},
         "files": [file(321, "ink_wash_v1.safetensors", 0.21, ftype="Model")]},
    ]},
}
CARDS = [(3001, "Aurora Diffusion", "have"), (3002, "Ink Wash Style", None), (3003, "Paper Lantern", "update"), (3004, "Neon Rim Light", None),
         (3005, "Glass Garden", "have"), (3006, "Harbor Lights", None), (3007, "Velvet Portrait", None), (3008, "Lumen XL", "have"),
         (3009, "Soft Pastel", None), (3010, "Tide Pool", None), (3011, "Ember Glow", None), (3012, "Quiet Forest", "have")]


def art(n: int, w: int | None = None) -> bytes:
    with Image.open(os.path.join(SAMPLES, f"{(n - 1) % 16 + 1}.png")) as im:
        if w:
            im = im.resize((w, int(w * im.height / im.width)))
        buf = io.BytesIO()
        im.convert("RGB").save(buf, "JPEG", quality=88)
        return buf.getvalue()


def data_url(n: int, w: int = 256) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(art(n, w)).decode()


RECIPE = {
    "recipe": {"schema": "recipe/1", "title": "Lighthouse at dusk",
               "prompt": {"positive": "a lighthouse on a cliff at dusk, paper cut style, layered paper, soft pastel palette, crashing waves, seagulls",
                          "negative": "blurry, lowres"},
               "settings": {"seed": 42, "steps": 8, "cfg": 1}},
    "thumb": None,
    "items": [
        {"kind": "checkpoint", "name": "Aurora Diffusion", "version": "v3 INT4", "status": "present", "local": "Krea 2/aurora_v3_int4.safetensors"},
        {"kind": "lora", "name": "Paper Cut Style", "version": "v2", "weight": 0.8, "status": "missing",
         "download": {"url": "https://civitai.com/api/download/models/3301", "folder": "loras", "rel": "Krea 2/paper_cut_style_v2.safetensors", "size": int(218 * MB)}},
        {"kind": "lora", "name": "Ink Wash Style", "version": "v1", "weight": 0.45, "status": "missing", "available_at": PAID_UNTIL,
         "note": f"Paid early access on CivitAI until {time.strftime('%d %b %Y', time.gmtime(time.time() + 5 * DAY))}: until then the download needs a purchase there",
         "download": {"url": "https://civitai.com/api/download/models/321", "folder": "loras", "rel": "Krea 2/ink_wash_v1.safetensors", "size": int(0.21 * GB)}},
        {"kind": "vae", "name": "qwen_image_vae", "status": "present", "local": "qwen_image_vae.safetensors"},
    ],
}

# ---------------------------------------------------------------- staged pages
PAGE_CSS = """body{margin:0;background:#101114;color:#e6e6ea;font:14px/1.5 system-ui,'Segoe UI',sans-serif}
header{height:52px;display:flex;align-items:center;gap:16px;padding:0 24px;border-bottom:1px solid #24262d;background:#15161a}
header b{font-size:16px} header span{color:#8b8d96} main{padding:24px 32px;max-width:1180px}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px} .card{display:block;position:relative;border-radius:12px;overflow:hidden;background:#1b1c21;color:#e6e6ea;text-decoration:none}
.card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block} .card div{padding:8px 10px;font-weight:600}
.hero{display:flex;gap:28px} .hero img{width:430px;border-radius:12px} .meta{flex:1} .tag{display:inline-block;padding:2px 9px;border-radius:999px;background:#24262d;margin:0 6px 6px 0;font-size:12px}
.prompt{background:#1b1c21;border-radius:10px;padding:12px 14px;color:#c9cad1} h1{margin:6px 0 10px;font-size:26px}
.file{display:flex;justify-content:space-between;background:#1b1c21;border-radius:10px;padding:10px 14px;margin:6px 0}"""


def page(title: str, body: str, site: str = "Sample model site") -> web.Response:
    html = f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title><style>{PAGE_CSS}</style></head>" \
           f"<body><header><b>{site}</b><span>screenshot sample data</span></header><main>{body}</main></body></html>"
    return web.Response(text=html, content_type="text/html")


async def civitai(request: web.Request):
    p = request.path
    if p.startswith("/samples/"):
        n = int(p.rsplit("/", 1)[1].split(".")[0])
        return web.Response(body=art(n, 420), content_type="image/jpeg")
    if p.startswith("/api/v1/models/"):
        m = MODELS.get(int(p.rstrip("/").rsplit("/", 1)[1]))
        return web.json_response(m) if m else web.json_response({"error": "not found"}, status=404)
    if p == "/models":
        cards = "".join(f'<a class="card" href="/models/{i}/{n.lower().replace(" ", "-")}"><img src="/samples/{k + 1}.jpg" alt="{n}"><div>{n}</div></a>'
                        for k, (i, n, _) in enumerate(CARDS))
        return page("Models", f"<h1>Models</h1><div class='grid'>{cards}</div>")
    if p.startswith("/models/"):
        mid = int(p.split("/")[2])
        m = MODELS.get(mid, MODELS[3001])
        imgs = "".join(f"<img src='/samples/{k}.jpg' style='width:140px;border-radius:10px;margin-right:8px'>" for k in (3, 7, 11))
        return page(m["name"], f"<div class='hero'><img src='/samples/{mid % 16 + 1}.jpg'><div class='meta'><span class='tag'>{m['type']}</span>"
                               f"<span class='tag'>{m['modelVersions'][0]['baseModel']}</span><h1>{m['name']}</h1><p>Sample model page for the extension's screenshots.</p>"
                               f"<div>{imgs}</div></div></div>")
    if p.startswith("/images/"):
        return page("Image", f"<div class='hero'><img src='/samples/5.jpg'><div class='meta'><h1>Lighthouse at dusk</h1>"
                             f"<div class='prompt'>{RECIPE['recipe']['prompt']['positive']}</div>"
                             f"<p><span class='tag'>Aurora Diffusion</span><span class='tag'>Paper Cut Style</span><span class='tag'>Ink Wash Style</span></p></div></div>")
    return web.Response(status=404)


async def huggingface(request: web.Request):
    if "/blob/" in request.path:
        name = request.path.rsplit("/", 1)[1]
        return page(name, f"<h1>sample-org/aurora-diffusion</h1><div class='file'><b>{request.path.split('/blob/main/')[1]}</b><span>4.89 GB</span></div>"
                          "<p>Sample repository page for the extension's screenshots.</p>", site="Sample model hub")
    return web.Response(status=404)


async def sites(request: web.Request):
    host = (request.host or "").split(":")[0]
    return await (huggingface(request) if host == "huggingface.co" else civitai(request))


# ---------------------------------------------------------------- the sample Model Librarian
JOB_STARTED = time.time()


async def ml(request: web.Request):
    p = request.path.replace("/api/sm-fetcher", "/sm-fetcher")
    body = await request.json() if request.can_read_body else {}
    if p == "/sm-fetcher/ext/hello":
        return web.json_response({"app": "model-librarian", "version": "1.15.3", "models_root": "D:\\ComfyUI\\models", "free_bytes": 412 * GB,
                                  "civitai_key": True, "active_downloads": 1, "system": SYSTEM})
    if p == "/sm-fetcher/ext/lookup":
        models = {str(i): {"status": st, "files": 1, "update": {"version_id": 1, "name": "v2"} if st == "update" else None}
                  for i, _, st in CARDS if st}
        return web.json_response({"versions": {str(v): {"status": "missing"} for v in body.get("version_ids") or []}, "hashes": {},
                                  "models": {str(i): models.get(str(i), {"status": "missing"}) for i in body.get("model_ids") or []}})
    if p == "/sm-fetcher/ext/companions":
        return web.json_response({"family": "Krea 2", "source": "image_krea2_turbo_t2i", "companions": [
            {"folder": "text_encoders", "name": "qwen3vl_4b_fp8_scaled.safetensors", "url": "https://huggingface.co/x", "have": "qwen3vl_4b_fp8_scaled.safetensors", "alt": None, "size": int(4.88 * GB)},
            {"folder": "vae", "name": "qwen_image_vae.safetensors", "url": "https://huggingface.co/x", "have": None, "alt": None, "size": None}]})
    if p == "/sm-fetcher/recipe/analyze":
        return web.json_response({**RECIPE, "thumb": data_url(5)})
    if p == "/sm-fetcher/ext/download-url":
        return web.json_response({"status": "planned", "file": "sample_te_fp8.safetensors", "size": int(4.89 * GB), "sha256": "ab" * 32,
                                  "folder": body.get("folder"), "rel": "sample_te_fp8.safetensors"})
    if p == "/sm-fetcher/ext/jobs":
        done = min(0.62, 0.55 + (time.time() - JOB_STARTED) / 600)
        return web.json_response({"jobs": [{"id": "job-1", "status": "downloading", "done": int(7.4 * GB * done), "total": int(7.4 * GB), "speed": 48 * MB,
                                            "dest": "D:\\ComfyUI\\models\\diffusion_models\\Krea 2\\aurora_v3_int4.safetensors"}]})
    if p in ("/sm-fetcher/ext/download", "/sm-fetcher/download", "/sm-fetcher/ext/companion-download"):
        return web.json_response({"status": "started", "job": {"id": "job-x", "status": "queued", "done": 0, "total": 0}})
    if p == "/prompto/status":
        return web.json_response({"capture_kinds": ["prompt", "recipe"]})
    return web.json_response({"error": "not staged"}, status=404)


# ---------------------------------------------------------------- the browser
class CDP:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def call(self, method, **params):
        self.n += 1
        my = self.n
        await self.ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            m = json.loads(await self.ws.recv())
            if m.get("id") == my:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})

    async def js(self, expr):
        r = await self.call("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(str(r["exceptionDetails"])[:300])
        return r["result"].get("value")

    async def wait(self, expr, timeout=30):
        t = time.time()
        while time.time() - t < timeout:
            try:
                if await self.js(f"!!({expr})"):
                    return
            except RuntimeError:
                pass
            await asyncio.sleep(0.25)
        raise RuntimeError(f"timed out: {expr}")


def cdp_json(path, method="GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}{path}", method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


async def tab(url, width=1280, height=900, scale=2):
    t = cdp_json(f"/json/new?{url}", method="PUT")
    ws = await websockets.connect(t["webSocketDebuggerUrl"], max_size=None)
    c = CDP(ws)
    await c.call("Page.enable")
    await c.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=scale, mobile=False)
    await c.call("Page.reload")
    return ws, c


R = "document.getElementById('model-librarian-ext').shadowRoot"


async def shot(c, path, rect=None, pad=14):
    clip = None
    if rect:
        clip = {"x": max(0, rect["x"] - pad), "y": max(0, rect["y"] - pad), "width": rect["width"] + 2 * pad, "height": rect["height"] + 2 * pad, "scale": 1}
    r = await c.call("Page.captureScreenshot", format="png", **({"clip": clip} if clip else {}))
    open(path, "wb").write(base64.b64decode(r["data"]))
    print("  wrote", os.path.relpath(path, EXT))


async def panel_rect(c):
    return await c.js(f"(() => {{ const r = {R}.querySelector('.panel').getBoundingClientRect(); return {{x: r.x, y: r.y, width: r.width, height: r.height}}; }})()")


async def open_panel(c, ready):
    await c.wait(f"{R}?.querySelector('.pill')", 30)
    await c.js(f"{R}.querySelector('.pill').click()")
    await c.wait(ready, 30)
    await asyncio.sleep(0.6)


async def capture(out: str):
    profile = tempfile.mkdtemp(prefix="ml_ext_edge_")
    edge = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={profile}",
                             f"--load-extension={EXT}", f"--disable-extensions-except={EXT}", "--no-first-run",
                             "--host-resolver-rules=MAP civitai.com 127.0.0.1, MAP huggingface.co 127.0.0.1",
                             "--ignore-certificate-errors", "--window-size=1280,900", "about:blank"])
    try:
        sw = None
        for _ in range(80):
            try:
                sw = next((t for t in cdp_json("/json/list") if t["type"] == "service_worker" and t["url"].endswith("/background.js")), None)
            except OSError:
                pass
            if sw:
                break
            await asyncio.sleep(0.25)
        ext_id = sw["url"].split("/")[2]
        mws, m = await tab(f"chrome-extension://{ext_id}/popup.html", 380, 1000)
        await m.wait("document.readyState === 'complete'", 10)
        await m.js(f"chrome.runtime.sendMessage({{ type: 'settings', base: '{ML}' }})")

        # the model page: best file for the GPU, what it also needs
        ws, c = await tab("https://civitai.com/models/3001/aurora-diffusion?modelVersionId=30011")
        await open_panel(c, f"{R}.querySelector('.rec') && {R}.querySelector('.needs .row .state, .needs .row button.dl')")
        await shot(c, os.path.join(out, "panel-best.png"), await panel_rect(c))
        await ws.close()

        # a paid-for-now model: get it on the day it's free
        ws, c = await tab("https://civitai.com/models/3002/ink-wash-style")
        await open_panel(c, f"[...{R}.querySelectorAll('button')].some((b) => b.textContent.startsWith('Get it on'))")
        await shot(c, os.path.join(out, "panel-waiting.png"), await panel_rect(c))
        await ws.close()

        # an image: every model it used
        ws, c = await tab("https://civitai.com/images/1001")
        await open_panel(c, f"{R}.querySelectorAll('.item').length >= 4")
        await shot(c, os.path.join(out, "image-panel.png"), await panel_rect(c))
        await ws.close()

        # model cards with badges
        ws, c = await tab("https://civitai.com/models", 1280, 760)
        await c.wait("document.querySelectorAll('.ml-badge').length >= 5", 30)
        await asyncio.sleep(0.5)
        g = await c.js("(() => { const r = document.querySelector('.grid').getBoundingClientRect(); return {x: r.x, y: r.y - 52, width: r.width, height: r.height + 52}; })()")
        await shot(c, os.path.join(out, "badges.png"), g, pad=18)
        await ws.close()

        # a HuggingFace file page
        ws, c = await tab("https://huggingface.co/sample-org/aurora-diffusion/blob/main/split_files/text_encoders/sample_te_fp8.safetensors")
        await open_panel(c, f"{R}.querySelector('.item button.dl, .item .state')")
        await shot(c, os.path.join(out, "hf-panel.png"), await panel_rect(c))
        await ws.close()

        # the popup: downloading, done, waiting for its day
        now = int(time.time() * 1000)
        queue = [
            {"key": "30011:301", "versionId": 30011, "fileId": 301, "title": "Aurora Diffusion — v3 INT4", "file": "aurora_v3_int4.safetensors", "size": int(7.4 * GB),
             "status": "downloading", "jobId": "job-1", "base": ML, "done": int(7.4 * GB * 0.6), "total": int(7.4 * GB), "speed": 48 * MB,
             "dest": "D:\\ComfyUI\\models\\diffusion_models\\Krea 2\\aurora_v3_int4.safetensors", "added": now - 60000, "updated": now, "attempts": 0,
             "pageUrl": "https://civitai.com/models/3001"},
            {"key": "c:qwen_image_vae.safetensors", "kind": "companion", "name": "qwen_image_vae.safetensors", "folder": "vae", "title": "VAE for Aurora Diffusion",
             "file": "qwen_image_vae.safetensors", "size": int(242 * MB), "status": "done", "done": int(242 * MB), "total": int(242 * MB),
             "dest": "D:\\ComfyUI\\models\\vae\\qwen_image_vae.safetensors", "added": now - 120000, "updated": now, "attempts": 0, "pageUrl": ""},
            {"key": "30021:321", "versionId": 30021, "fileId": 321, "title": "Ink Wash Style — v1", "file": "ink_wash_v1.safetensors", "size": int(0.21 * GB),
             "status": "scheduled", "notBefore": int(time.mktime(time.strptime(PAID_UNTIL, "%Y-%m-%dT%H:%M:%SZ")) * 1000) + 15 * 60000,
             "why": RECIPE["items"][2]["note"], "added": now - 30000, "updated": now, "attempts": 0, "pageUrl": "https://civitai.com/models/3002"},
        ]
        await m.js(f"chrome.storage.local.set({{ queue: {json.dumps(queue)} }})")
        await m.js("location.reload(); true")
        await m.wait("document.querySelectorAll('#queue .item').length === 3 && document.querySelector('#conn').innerText.includes('Connected')", 15)
        await asyncio.sleep(1)
        h = await m.js("document.querySelector('#settings').getBoundingClientRect().top")
        await shot(m, os.path.join(out, "popup.png"), {"x": 0, "y": 0, "width": 380, "height": h}, pad=0)
        await m.js("document.getElementById('settings').open = true; true")
        await m.wait("document.querySelectorAll('#targets label').length >= 2", 15)
        await asyncio.sleep(0.5)
        r = await m.js("(() => { const r = document.getElementById('settings').getBoundingClientRect(); return {x: 0, y: r.top, width: 380, height: r.height}; })()")
        await shot(m, os.path.join(out, "popup-settings.png"), r, pad=0)
        await mws.close()
    finally:
        edge.terminate()
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*ml_ext_edge_*' } | "
                        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], capture_output=True)
        time.sleep(1)
        shutil.rmtree(profile, ignore_errors=True)


async def main(out: str):
    os.makedirs(out, exist_ok=True)
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
        for app, port, sslctx in ((site_app, 443, ctx), (ml_app, ML_PORT, None)):
            r = web.AppRunner(app)
            await r.setup()
            await web.TCPSite(r, "127.0.0.1", port, ssl_context=sslctx).start()
            runners.append(r)
        await capture(out)
    finally:
        for r in runners:
            await r.cleanup()
        shutil.rmtree(certs, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(EXT, "docs", "images"))
    a = ap.parse_args()
    asyncio.run(main(a.out))
