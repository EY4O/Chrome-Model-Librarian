"""End-to-end check of "+ Character" on booru posts, in headless Edge with the extension, on staged copies of Danbooru and
Gelbooru served from 127.0.0.1 (never the real sites), with a made-up character and a fake Model Librarian:

  - a "+ Character" button beside the post's character tag opens the panel, sorted from the post and Danbooru's related tags
  - a tag clicked moves from skip to appearance; Save files it into Model Librarian with a small picture (a general post)
  - a character you have already: the panel offers to add the post as an outfit
  - ComfyUI not running: the character is left in Downloads\\Model Librarian Gallery as <tag> <time>.mlchar.json, and
    the Gallery (beside this repo) files it into a made-up Model Librarian data folder
  - Gelbooru: the page's own tag groups and rating
  - CivitAI: a LoRA you have gets "Link to a character", which links it in Model Librarian

  python tests/e2e_characters.py

Needs what make_media.py needs (Edge, aiohttp, websockets, openssl, port 443 free on 127.0.0.1).
"""
import asyncio
import io
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import time

from aiohttp import web
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "media"))
import make_media as M  # noqa: E402

HOSTS = ["danbooru.donmai.us", "cdn.donmai.us", "gelbooru.com", "img3.gelbooru.com", "civitai.com"]
LORA_MODEL = {"id": 5001, "name": "Aurelia (Lighthouse Tales)", "type": "LORA", "creator": {"username": "sample_artist"}, "modelVersions": [
    {"id": 50011, "name": "v2", "baseModel": "Illustrious", "files": [M.file(501, "aurelia_v2.safetensors", 0.2, ftype="Model")]}]}
LINKED = []    # bodies posted to the fake Model Librarian's /characters/{id}/lora
SEEN = []      # (host, path, query) of every request to the staged sites
POSTED = []    # bodies posted to the fake Model Librarian's /ext/characters
HAVE = []      # what the fake Model Librarian has
TAG = "aurelia_(lighthouse_tales)"


def jpeg(color, size=(300, 420)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "JPEG")
    return out.getvalue()


def html(title, body):
    return web.Response(text=f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title></head><body style='margin:0;background:#111;color:#ddd'>{body}</body></html>",
                        content_type="text/html")


async def sites(request: web.Request):
    host, path = request.host.split(":")[0], request.path
    SEEN.append((host, path, request.query_string))
    if host == "danbooru.donmai.us":
        if path == "/posts/4242":
            return html("Post", f"""<aside><ul class='character-tag-list'><li class='tag-type-4' data-tag-name='{TAG}'>
                <a class='search-tag' href='/posts?tags={TAG}'>aurelia (lighthouse tales)</a></li></ul></aside>
                <img id='image' src='https://cdn.donmai.us/sample/a.jpg' width=600 height=800>""")
        if path == "/posts/4242.json":
            return web.json_response({"id": 4242, "rating": "g", "tag_string_character": TAG, "tag_string_copyright": "lighthouse_tales",
                                      "tag_string_general": "1girl solo silver_hair white_dress smile lighthouse", "preview_file_url": "https://cdn.donmai.us/preview/a.jpg"})
        if path == "/related_tag.json":
            return web.json_response({"post_count": 310, "related_tags": [{"tag": {"name": n}, "frequency": f} for n, f in
                                      (("1girl", 0.95), ("long_hair", 0.8), ("blue_eyes", 0.6), ("straw_hat", 0.45), ("freckles", 0.3), ("smile", 0.7))]})
    if host == "cdn.donmai.us":
        return web.Response(body=jpeg((70, 120, 200)), content_type="image/jpeg")
    if host == "gelbooru.com" and request.query.get("id") == "55":
        return html("Post", """<ul id='tag-list'><li class='tag-type-character'><a href='index.php?page=wiki&s=list&search=lumen'>?</a>
            <a href='index.php?page=post&s=list&tags=lumen_(nightglass)'>lumen (nightglass)</a></li>
            <li class='tag-type-copyright'><a href='index.php?page=post&s=list&tags=nightglass'>nightglass</a></li>
            <li class='tag-type-general'><a href='index.php?page=post&s=list&tags=blue_hair'>blue hair</a></li>
            <li class='tag-type-general'><a href='index.php?page=post&s=list&tags=scarf'>scarf</a></li>
            <li>Rating: General</li></ul>
            <img id='image' src='https://img3.gelbooru.com/samples/ab/cd/sample_x.jpg' width=600 height=800>""")
    if host == "img3.gelbooru.com":
        return web.Response(body=jpeg((40, 40, 120)), content_type="image/jpeg")
    if host == "civitai.com":
        if path.startswith("/api/v1/models/5001"):
            return web.json_response(LORA_MODEL)
        if path.startswith("/models/5001"):
            return html("Aurelia", "<h1>Aurelia (Lighthouse Tales)</h1><p>A sample LoRA page.</p>")
    return web.Response(status=404, text="not staged")


async def ml(request: web.Request):
    p = request.path.replace("/api/sm-fetcher", "/sm-fetcher")
    if p == "/sm-fetcher/ext/hello":
        return web.json_response({"app": "model-librarian", "version": "1.24.0", "models_root": "D:\\ComfyUI\\models", "free_bytes": 1 << 40,
                                  "civitai_key": True, "active_downloads": 0, "system": M.SYSTEM})
    if p == "/sm-fetcher/ext/lookup":
        b = await request.json()
        return web.json_response({"versions": {str(v): ({"status": "have", "folder": "loras", "rel": "chars/aurelia_v2.safetensors"} if v == 50011 else {"status": "missing"})
                                               for v in b.get("version_ids") or []}, "hashes": {}, "models": {}})
    if p.startswith("/sm-fetcher/characters/") and p.endswith("/lora") and request.method == "POST":
        b = await request.json()
        LINKED.append((p.split("/")[3], b))
        return web.json_response({"character": {"id": p.split("/")[3], "name": "Aurelia", "lora": {"name": b["name"], "trigger": ["aurelia_lt"]}}})
    if p == "/sm-fetcher/ext/characters" and request.method == "GET":
        return web.json_response({"characters": HAVE})
    if p == "/sm-fetcher/ext/characters" and request.method == "POST":
        b = await request.json()
        POSTED.append(b)
        c = b["character"]
        HAVE.append({"id": "chr_00000001", "tag": c["tag"], "name": c["name"], "outfits": [c["outfit"]["name"]], "has_image": bool(b.get("picture"))})
        return web.json_response({"character": {"id": "chr_00000001", "name": c["name"]}, "created": True})
    return web.json_response({"error": "not here"}, status=404)


PANEL = "[...document.querySelectorAll('div')].map((d) => d.shadowRoot).filter(Boolean).find((r) => r.querySelector('.panel'))"


async def run(check, downloads):
    profile = tempfile.mkdtemp(prefix="ml_ext_edge_")
    os.makedirs(os.path.join(profile, "Default"))
    with open(os.path.join(profile, "Default", "Preferences"), "w") as f:
        json.dump({"download": {"default_directory": downloads, "prompt_for_download": False}, "savefile": {"default_directory": downloads}}, f)
    rules = ", ".join(f"MAP {h} 127.0.0.1" for h in HOSTS)
    edge = subprocess.Popen([M.EDGE, "--headless=new", f"--remote-debugging-port={M.CDP_PORT}", f"--user-data-dir={profile}",
                             f"--load-extension={M.EXT}", f"--disable-extensions-except={M.EXT}", "--no-first-run",
                             f"--host-resolver-rules={rules}", "--ignore-certificate-errors", "--window-size=1280,900", "about:blank"])
    folder = os.path.join(downloads, "Model Librarian Gallery")

    async def panel_text(c, want, timeout=20):
        t = time.time()
        while time.time() - t < timeout:
            txt = await c.js(f"(() => {{ const r = {PANEL}; return r ? r.querySelector('.panel').innerText : ''; }})()")
            if want.lower() in (txt or "").lower():  # (the group names are shown in capitals)
                return txt
            await asyncio.sleep(0.25)
        print("   (the panel says:", (txt or "")[:400].replace("\n", " | "), ")")
        return txt or ""

    async def click(c, selector):
        await c.js(f"{PANEL}.querySelector({json.dumps(selector)}).click()")

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
        await pop.js(f"chrome.runtime.sendMessage({{ type: 'settings', base: '{M.ML}' }})")  # (the fake Model Librarian, never yours)

        # ---- Danbooru: the button, the panel, a tag moved, Save -> Model Librarian
        ws, c = await M.tab("https://danbooru.donmai.us/posts/4242", scale=1)
        await c.wait("document.querySelector('.ml-char-add')", 20)
        check(await c.js("document.querySelector('.character-tag-list li .ml-char-add').textContent") == "+ Character",
              "Danbooru: a + Character button beside the character tag")
        await c.js("document.querySelector('.ml-char-add').click()")
        txt = await panel_text(c, "Appearance")
        check("Aurelia" in txt and "long hair" in txt and "80%" in txt and "310 solo posts" in txt,
              "  the panel: the character, its look from Danbooru's related tags with how often each tag is on its posts")
        check(any(h == "danbooru.donmai.us" and p == "/related_tag.json" and "solo rating:g" in q for h, p, q in SEEN),
              "  Danbooru asked for the character's solo, general posts")
        order = await c.js(f"[...{PANEL}.querySelectorAll('.chip')].map((b) => b.className.split(' ')[1] + ':' + b.firstChild.textContent).join('|')")
        check("appearance:long hair" in order and "outfit:straw hat" in order and "outfit:white dress" in order and "skip:freckles" in order and "skip:smile" in order,
              f"  sorted: hair and eyes in appearance, the hat and dress in outfit, the smile skipped ({order[:160]}…)")
        if os.environ.get("ML_E2E_SHOTS"):  # a look at the panel (a folder to save it in)
            await M.shot(c, os.path.join(os.environ["ML_E2E_SHOTS"], "characters-panel.png"))
        await c.js(f"[...{PANEL}.querySelectorAll('.chip')].find((b) => b.firstChild.textContent === 'freckles').click()")
        moved = await c.js(f"[...{PANEL}.querySelectorAll('.chip')].find((b) => b.firstChild.textContent === 'freckles').className")
        check("appearance" in moved, "  a skipped tag clicked moves to appearance")
        await click(c, '[data-act="save"]')
        txt = await panel_text(c, "Model Librarian.")
        check("Added to your characters in Model Librarian" in txt, "  Save: added to your characters in Model Librarian")
        b = POSTED[-1] if POSTED else {}
        ch = b.get("character") or {}
        check(ch.get("tag") == TAG and ch.get("name") == "Aurelia" and ch.get("series") == "Lighthouse Tales" and "freckles" in ch.get("appearance", [])
              and ch.get("outfit") == {"name": "default", "tags": ["straw hat", "white dress"]} and ch.get("mode") == "outfit"
              and ch.get("source", {}).get("url") == "https://danbooru.donmai.us/posts/4242",
              f"  what Model Librarian got: the tag, name, series, appearance, the outfit, the post ({ch.get('appearance')})")
        pic = b.get("picture") or ""
        check(pic.startswith("data:image/webp;base64,") and len(pic) < 60000, f"  with a small WebP picture of the post ({len(pic)} characters)")
        check(await c.js("document.querySelector('.ml-char-add').textContent") == "✓ Character", "  the tag's button says it's done")

        # ---- the same character again: the post as an outfit
        await click(c, '[data-act="close"]')
        await c.js("document.querySelector('.ml-char-add').click()")
        txt = await panel_text(c, "Add as outfit")
        check("Add as outfit to Aurelia" in txt and await c.js(f"{PANEL}.querySelector('[data-field=outfitName]').value") == "post 4242",
              "  a character you have: Add as outfit to it, named after the post")
        await click(c, '[data-act="close"]')
        await ws.close()

        # ---- ComfyUI not running: left for the Gallery
        await pop.js("chrome.runtime.sendMessage({ type: 'settings', base: 'http://127.0.0.1:8219' })")  # (nothing there)
        HAVE.clear()
        ws, c = await M.tab("https://danbooru.donmai.us/posts/4242", scale=1)
        await c.wait("document.querySelector('.ml-char-add')", 20)
        await c.js("document.querySelector('.ml-char-add').click()")
        await panel_text(c, "Appearance", 40)
        n = len(POSTED)
        await click(c, '[data-act="save"]')
        txt = await panel_text(c, "Left for the Gallery", 40)
        check("Left for the Gallery" in txt and len(POSTED) == n, "ComfyUI not running: left for the Gallery, nothing sent")
        left = [x for x in (os.listdir(folder) if os.path.isdir(folder) else []) if x.endswith(".mlchar.json")]
        check(len(left) == 1 and left[0].startswith(TAG + " "), f"  in Downloads\\Model Librarian Gallery as <tag> <time>.mlchar.json ({left})")
        if left:
            with open(os.path.join(folder, left[0]), encoding="utf-8") as f:
                note = json.load(f)
            check(note.get("v") == 1 and note["character"]["tag"] == TAG and str(note.get("picture", "")).startswith("data:image/webp;base64,"),
                  "  the file: the character and its picture")
            gallery = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Model-Librarian-Gallery")
            try:
                sys.path.insert(0, gallery)
                from mlgallery import charfiles  # the Gallery's own code
            except Exception as e:
                print(f"skip: the Gallery's pickup ({e})")
                charfiles = None
            if charfiles:
                mld = tempfile.mkdtemp(prefix="ml_data_")  # a made-up Model Librarian data folder
                with open(os.path.join(mld, "registry.json"), "w") as f:
                    f.write("{}")
                filed = charfiles.pickup(mld, folder)
                with open(os.path.join(mld, "characters.json"), encoding="utf-8") as f:
                    got = json.load(f)["characters"]
                check(filed == 1 and got[0]["name"] == "Aurelia" and got[0]["image"] and not [x for x in os.listdir(folder) if x.endswith(".mlchar.json")],
                      "  the Gallery files it into Model Librarian's characters.json, with its picture, and removes the file")
                shutil.rmtree(mld, ignore_errors=True)
        await ws.close()

        # ---- Gelbooru: the page's tag groups and rating
        await pop.js(f"chrome.runtime.sendMessage({{ type: 'settings', base: '{M.ML}' }})")
        ws, c = await M.tab("about:blank", scale=1)
        await c.call("Page.navigate", url="https://gelbooru.com/index.php?page=post&s=view&id=55")
        await c.wait("document.querySelector('.ml-char-add')", 20)
        await c.js("document.querySelector('.ml-char-add').click()")
        txt = await panel_text(c, "Appearance", 30)
        check("Lumen" in txt and "blue hair" in txt, "Gelbooru: the character from the page's tags")
        await click(c, '[data-act="save"]')
        txt = await panel_text(c, "Model Librarian.", 30)
        ch = (POSTED[-1] if POSTED else {}).get("character") or {}
        check(ch.get("tag") == "lumen_(nightglass)" and ch.get("series") == "Nightglass" and ch.get("source", {}).get("site") == "gelbooru"
              and "blue hair" in ch.get("appearance", []) and "scarf" in ch.get("outfit", {}).get("tags", [])
              and str(POSTED[-1].get("picture", "")).startswith("data:image/webp"),
              f"  filed with the series, the site, its tags, and a picture (Rating: General) ({ch.get('appearance')}, {ch.get('outfit')})")
        await ws.close()

        # ---- CivitAI: a LoRA you have, linked to a character
        HAVE[:] = [{"id": "chr_00000001", "tag": TAG, "name": "Aurelia", "outfits": ["default"], "has_image": True}]
        ws, c = await M.tab("https://civitai.com/models/5001/aurelia", scale=1)
        link = f"[...{M.R}.querySelectorAll('button')].find((b) => b.textContent === 'Link to a character')"
        await M.open_panel(c, f"!!({link})")
        check(await c.js(f"!!({link})"), "CivitAI: a LoRA you have offers Link to a character")
        await c.js(f"{link}.click()")
        await c.wait(f"{M.R}.querySelector('select.pick')", 15)
        await c.js(f"(() => {{ const s = {M.R}.querySelector('select.pick'); s.value = 'chr_00000001'; s.dispatchEvent(new Event('change')); }})()")
        await c.wait(f"{M.R}.querySelector('.link .ok')", 15)
        said = await c.js(f"{M.R}.querySelector('.link').textContent")
        check(LINKED == [("chr_00000001", {"name": "chars/aurelia_v2.safetensors"})] and "Aurelia's LoRA" in said,
              f"  linked in Model Librarian by its file in your library ({LINKED}, {said})")
        await ws.close()

        # ---- the right-click menu is registered
        swws = await M.websockets.connect(sw["webSocketDebuggerUrl"], max_size=None)
        swc = M.CDP(swws)
        menu = await swc.js("new Promise((r) => chrome.contextMenus.update('ml-characters', {}, () => r(!chrome.runtime.lastError)))")
        check(menu, "right-click: Add characters from this post is there")
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
    downloads = tempfile.mkdtemp(prefix="ml_chars_dl_")
    cert, key = os.path.join(certs, "cert.pem"), os.path.join(certs, "key.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
                    "-subj", "/CN=danbooru.donmai.us", "-addext", "subjectAltName=" + ",".join(f"DNS:{h}" for h in HOSTS)], check=True, capture_output=True)
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(cert, key)
    site_app, ml_app = web.Application(), web.Application()
    site_app.router.add_route("GET", "/{tail:.*}", sites)
    ml_app.router.add_route("*", "/{tail:.*}", ml)
    runners = []
    try:
        for app, port, sslctx in ((site_app, 443, ctx), (ml_app, M.ML_PORT, None)):
            r = web.AppRunner(app)
            await r.setup()
            runners.append(r)
            await web.TCPSite(r, "127.0.0.1", port, ssl_context=sslctx).start()
        await run(check, downloads)
    finally:
        for r in runners:
            await r.cleanup()
        shutil.rmtree(certs, ignore_errors=True)
        shutil.rmtree(downloads, ignore_errors=True)
    print("\nFAILED: %d" % fails if fails else "\nALL PASSED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
