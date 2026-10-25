"""End-to-end check of saving pictures for Model Librarian Gallery, in headless Edge with the extension, on staged
copies of the sites it knows (never the real sites): Pixiv, X, Danbooru and Pawchive pages served from 127.0.0.1.

  - the save button on a picture saves the full-size original into Downloads\\Model Librarian Gallery, with its note
    (the page, the artist and their page, the title, the tags) beside it, under a name the Gallery reads
  - Pixiv's original only comes with Pixiv as the referrer: the extension's rule gives it
  - X's picture at its original size, the account as the artist, the hashtags as tags
  - "Save from this page" lists the post's pictures (every page of a Pixiv set); saving them saves each with its note
  - the right-click "Save to Model Librarian Gallery" menu is there

  python tests/e2e_gallery.py

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

HOSTS = ["www.pixiv.net", "i.pximg.net", "x.com", "pbs.twimg.com", "danbooru.donmai.us", "pawchive.pw", "n2.pawchive.pw", "img.pawchive.pw",
         "www.deviantart.com", "images-wixmp-abc.wixmp.com", "gelbooru.com", "img3.gelbooru.com"]
SEEN = []  # (host, path, referer) of every request


def base36(n: int) -> str:
    out = ""
    while n:
        n, d = divmod(n, 36)
        out = "0123456789abcdefghijklmnopqrstuvwxyz"[d] + out
    return out or "0"


def png(color, size=(640, 900)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "PNG")
    return out.getvalue()


def html(title, body):
    return web.Response(text=f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title></head><body style='margin:0;background:#111'>{body}</body></html>",
                        content_type="text/html")


async def sites(request: web.Request):
    host, path = request.host.split(":")[0], request.path
    SEEN.append((host, path, request.headers.get("Referer", "")))
    img = lambda c: web.Response(body=png(c), content_type="image/png")  # noqa: E731
    if host == "www.pixiv.net":
        if path == "/en/artworks/555":
            return html("Harbour", "<img src='https://i.pximg.net/c/600x1200_90/img-master/img/2024/01/01/00/00/00/555_p0_master1200.jpg' width=600 height=800>"
                        "<a href='/en/artworks/556'><img src='https://i.pximg.net/c/250x250_80_a2/img-master/img/2024/01/02/00/00/00/556_p0_square1200.jpg' width=250 height=250></a>")
        if path == "/ajax/illust/556":
            return web.json_response({"error": False, "body": {"illustTitle": "Related", "userName": "Ren", "userId": "7", "tags": {"tags": []}}})
        if path == "/ajax/illust/556/pages":
            return web.json_response({"error": False, "body": [{"urls": {"original": "https://i.pximg.net/img-original/img/2024/01/02/00/00/00/556_p0.jpg"}}]})
        if path == "/ajax/illust/555":
            return web.json_response({"error": False, "body": {"illustTitle": "Harbour at dusk", "illustComment": "A <b>study</b><br>in blue",
                                                                "userName": "Mika", "userId": "42", "tags": {"tags": [{"tag": "landscape"}, {"tag": "harbour"}]}}})
        if path == "/ajax/illust/555/pages":
            base = "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/555_p{}.png"
            return web.json_response({"error": False, "body": [{"urls": {"original": base.format(n), "small": base.format(n)}} for n in (0, 1)]})
    if host == "i.pximg.net":  # Pixiv's originals: only with Pixiv as the referrer
        if not request.headers.get("Referer", "").startswith("https://www.pixiv.net/"):
            return web.Response(status=403, text="no referrer")
        return img((40, 90, 160))
    if host == "x.com" and path == "/inkling_jp/status/1712345678901234567":
        return html("Post", """<article><a href='/inkling_jp/status/1712345678901234567'><time datetime='2024-04-05T10:11:12.000Z'>Apr 5</time></a>
            <div data-testid='tweetText'>Evening sketch #ink #harbour</div>
            <img src='https://pbs.twimg.com/media/GAbc123?format=jpg&name=small' width=600 height=800>
            <div role='link'><a href='/someone_else/status/99'><time datetime='2024-01-01T00:00:00.000Z'>Jan 1</time></a>
              <img src='https://pbs.twimg.com/media/GQuoted?format=jpg&name=small' width=300 height=300></div></article>""")
    if host == "pbs.twimg.com":  # (a JPEG, as format=jpg says)
        size = (1200, 1600) if request.query.get("name") == "orig" else (600, 800)
        out = io.BytesIO()
        Image.new("RGB", size, (200, 60, 60)).save(out, "JPEG")
        return web.Response(body=out.getvalue(), content_type="image/jpeg")
    if host == "danbooru.donmai.us":
        if path == "/posts/777":
            return html("Post", "<img id='image' src='https://danbooru.donmai.us/data/sample-0123456789abcdef0123456789abcdef.jpg' width=600 height=800>")
        if path == "/posts/777.json":
            return web.json_response({"file_url": "https://danbooru.donmai.us/data/0123456789abcdef0123456789abcdef.png", "md5": "0123456789abcdef0123456789abcdef",
                                      "file_ext": "png", "tag_string_artist": "mika_art", "tag_string_character": "hatsune_miku", "tag_string_copyright": "vocaloid",
                                      "tag_string_general": "1girl solo", "preview_file_url": "https://danbooru.donmai.us/data/sample-0123456789abcdef0123456789abcdef.jpg"})
        if path.startswith("/data/"):
            return img((60, 160, 90))
    if host == "pawchive.pw":
        if path == "/patreon/user/9/post/33":
            return html("Post", """<a class='post__user-name' href='/patreon/user/9'> Sic </a><h1 class='post__title'><span>Lanterns</span></h1>
              <a class='fileThumb' href='https://n2.pawchive.pw/data/aa/bb/aabb.png?f=lanterns.png'><img src='https://img.pawchive.pw/thumbnail/data/aa/bb/aabb.png' width=600 height=800></a>""")
        if path == "/api/v1/patreon/user/9/post/33":
            return web.json_response({"title": "Lanterns", "content": "<p>For the festival</p>", "file": {"name": "lanterns.png", "path": "/aa/bb/aabb.png", "node": 2},
                                      "attachments": [], "tags": ["festival"]})
    if host in ("n2.pawchive.pw", "img.pawchive.pw"):
        return img((180, 140, 40))
    if host == "www.deviantart.com" and path == "/someartist/art/Sunset-Study-987654321":
        return web.Response(text="""<!doctype html><html><head><meta property='og:title' content='Sunset Study by someartist on DeviantArt'>
            <meta property='og:description' content='Oil on board'></head><body><h1>Sunset Study</h1>
            <img property='contentUrl' src='https://images-wixmp-abc.wixmp.com/f/1/sunset.png?token=t' width=600 height=800>
            <a href='/tag/landscape'>landscape</a><a href='/tag/sunset'>sunset</a></body></html>""", content_type="text/html")
    if host == "images-wixmp-abc.wixmp.com":
        return img((220, 120, 40))
    if host == "gelbooru.com" and request.query.get("id") == "55":
        return html("Post", """<ul><li class='tag-type-artist'><a href='index.php?page=wiki&s=list&search=ren'>?</a> <a href='index.php?page=post&s=list&tags=ren_ito'>ren ito</a></li>
            <li class='tag-type-character'><a href='index.php?page=post&s=list&tags=lumen'>lumen</a></li>
            <li class='tag-type-general'><a href='index.php?page=post&s=list&tags=night'>night</a></li></ul>
            <img id='image' src='https://img3.gelbooru.com/samples/ab/cd/sample_0123456789abcdef0123456789abcd12.jpg' width=600 height=800>
            <a href='https://img3.gelbooru.com/images/ab/cd/0123456789abcdef0123456789abcd12.png'>Original image</a>""")
    if host == "img3.gelbooru.com":
        return img((90, 90, 200))
    return web.Response(status=404, text="not staged")


async def run(check, downloads):
    profile = tempfile.mkdtemp(prefix="ml_ext_edge_")
    os.makedirs(os.path.join(profile, "Default"))
    with open(os.path.join(profile, "Default", "Preferences"), "w") as f:  # (downloads into the throwaway folder, without asking)
        json.dump({"download": {"default_directory": downloads, "prompt_for_download": False}, "savefile": {"default_directory": downloads}}, f)
    rules = ", ".join(f"MAP {h} 127.0.0.1" for h in HOSTS)
    edge = subprocess.Popen([M.EDGE, "--headless=new", f"--remote-debugging-port={M.CDP_PORT}", f"--user-data-dir={profile}",
                             f"--load-extension={M.EXT}", f"--disable-extensions-except={M.EXT}", "--no-first-run",
                             f"--host-resolver-rules={rules}", "--ignore-certificate-errors", "--window-size=1280,900", "about:blank"])
    folder = os.path.join(downloads, "Model Librarian Gallery")

    async def saved(name, timeout=20):
        t = time.time()
        while time.time() - t < timeout:
            p = os.path.join(folder, name)
            if os.path.isfile(p) and os.path.isfile(p + ".mlg.json"):
                await asyncio.sleep(0.2)
                with open(p + ".mlg.json", encoding="utf-8") as f:
                    return json.load(f)
            await asyncio.sleep(0.25)
        print("   (not there; what is:", [os.path.relpath(os.path.join(d, x), downloads) for d, _, fs in os.walk(downloads) for x in fs],
              [os.path.relpath(os.path.join(d, x), profile) for d, _, fs in os.walk(profile) for x in fs if x.lower().endswith((".png", ".jpg", ".json")) and "Extension" not in d][:8], ")")
        return None
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

        # ---- Pixiv: the save button on the picture -> the original, with its note
        ws, c = await M.tab("https://www.pixiv.net/en/artworks/555", scale=1)
        await c.wait("document.images[0] && document.images[0].complete && document.documentElement.lastElementChild.shadowRoot", 20)
        await c.js("document.images[0].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        btn = "[...document.querySelectorAll('div')].map((d) => d.shadowRoot).filter(Boolean).map((r) => r.querySelector('button')).find(Boolean)"
        await c.wait(f"{btn} && !{btn}.hidden", 10)
        await c.js(f"{btn}.click()")
        note = await saved("555_p0.png")
        check(note is not None, "Pixiv: the save button saves the original (555_p0.png) into Downloads\\Model Librarian Gallery, with its note")
        if note:
            check(note.get("artist") == "Mika" and note.get("artist_url") == "https://www.pixiv.net/users/42" and note.get("title") == "Harbour at dusk"
                  and note.get("tags") == ["landscape", "harbour"] and note.get("page") == "https://www.pixiv.net/artworks/555"
                  and note.get("description") == "A study\nin blue",
                  f"  the note: the artist and their page, the title, the description, the tags, the page ({note.get('artist')}, {note.get('tags')})")
        check(any(h == "i.pximg.net" and "img-original" in p and r.startswith("https://www.pixiv.net/") for h, p, r in SEEN),
              "  Pixiv's original asked for with Pixiv as the referrer (the extension's header rule)")
        for _ in range(40):
            label = await c.js(f"{btn}.textContent.trim() + ' | ' + {btn}.title")
            if "Saved" in label or "Didn't" in label:
                break
            await asyncio.sleep(0.25)
        check("Saved" in label, f"  the button says it's saved ({label})")

        # ---- a related work's thumbnail on the page is that work, not the page's
        await c.js("document.images[1].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        await asyncio.sleep(0.3)
        await c.js(f"{btn}.click()")
        note = await saved("556_p0.png") or await saved("556_p0.jpg", timeout=2)
        check(note is not None and note.get("artist") == "Ren", f"  a related work's thumbnail saves that work, by its artist ({note and note.get('artist')})")

        # ---- the popup's "Save from this page": every page of the set
        pws, pop = await M.tab(f"chrome-extension://{ext_id}/popup.html", 380, 1000)
        await pop.wait("document.readyState === 'complete'", 10)
        # (the popup may not read other tabs' addresses: no "tabs" permission. The one whose reader answers is the Pixiv page)
        r = await pop.js("""chrome.tabs.query({}).then(async (ts) => { for (const t of ts) { const r = await chrome.runtime.sendMessage({ type: 'galleryPage', tabId: t.id });
            if (r && r.known && r.items && r.items.length) return r; } return null; })""")
        check(r and r.get("known") and len(r.get("items", [])) == 2 and r["items"][1]["src"].endswith("555_p1.png"),
              f"Save from this page: the post's pictures, full size ({len((r or {}).get('items', []))} of a 2-page set)")
        if r and r.get("items"):
            s = await pop.js(f"chrome.runtime.sendMessage({{ type: 'gallerySave', items: {json.dumps(r['items'][1:])} }})")
            note = await saved("555_p1.png")
            check(s.get("saved") == 1 and note and note.get("artist") == "Mika", "  saving the ones ticked saves each with its note")
        await ws.close()

        # ---- X: the original size, the account, the hashtags
        ws, c = await M.tab("https://x.com/inkling_jp/status/1712345678901234567", scale=1)
        await c.wait("document.images[0] && document.images[0].complete", 20)
        await c.js("document.images[0].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        await c.wait(f"{btn} && !{btn}.hidden", 10)
        await c.js(f"{btn}.click()")
        note = await saved("inkling_jp-1712345678901234567-20240405_101112-img1.jpg")
        quoted = [x for x in os.listdir(folder) if "GQuoted" in x or "img2" in x]
        check(note is not None and "name=orig" in note.get("src", "") and note.get("artist") == "inkling_jp" and note.get("tags") == ["ink", "harbour"],
              f"X: the original size, the account as the artist, the hashtags as tags ({note and note.get('src')})")
        check(not quoted, "  a quoted post's picture isn't counted as this post's")
        await ws.close()

        # ---- Danbooru: the original from its JSON, a name with the artist in it
        ws, c = await M.tab("https://danbooru.donmai.us/posts/777", scale=1)
        await c.wait("document.images[0] && document.images[0].complete", 20)
        await c.js("document.images[0].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        await c.wait(f"{btn} && !{btn}.hidden", 10)
        await c.js(f"{btn}.click()")
        note = await saved("__hatsune_miku_drawn_by_mika_art__0123456789abcdef0123456789abcdef.png")
        check(note is not None and note.get("artist") == "mika art" and "1girl" in (note.get("tags") or []),
              "Danbooru: the original, under a name with its artist, the tags")
        await ws.close()

        # ---- Pawchive: the file (not the thumbnail), the artist from the page, the title and the post's text
        ws, c = await M.tab("https://pawchive.pw/patreon/user/9/post/33", scale=1)
        await c.wait("document.images[0] && document.images[0].complete", 20)
        await c.js("document.images[0].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        await c.wait(f"{btn} && !{btn}.hidden", 10)
        await c.js(f"{btn}.click()")
        note = await saved("lanterns.png")
        check(note is not None and note.get("artist") == "Sic" and note.get("title") == "Lanterns" and note.get("description") == "For the festival"
              and note.get("src", "").startswith("https://n2.pawchive.pw/data/") and note.get("tags") == ["festival"],
              f"Pawchive: the file itself, the artist from the page, the title, the text, the tags ({note and note.get('artist')})")
        await ws.close()

        # ---- DeviantArt: the full view, the artist from the address, its tags; a name the Gallery reads the artist from
        ws, c = await M.tab("https://www.deviantart.com/someartist/art/Sunset-Study-987654321", scale=1)
        await c.wait("document.images[0] && document.images[0].complete", 20)
        await c.js("document.images[0].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        await c.wait(f"{btn} && !{btn}.hidden", 10)
        await c.js(f"{btn}.click()")
        note = await saved(f"sunset_study_by_someartist_d{base36(987654321)}.png")
        check(note is not None and note.get("artist") == "someartist" and note.get("title") == "Sunset Study" and note.get("tags") == ["landscape", "sunset"]
              and note.get("src", "").startswith("https://images-wixmp-abc.wixmp.com/"),
              f"DeviantArt: the full view, the artist, the title, the tags, under DeviantArt's own kind of name ({note and note.get('title')})")
        await ws.close()

        # ---- Gelbooru (read from its page): the original, the artist tag, the tags
        ws, c = await M.tab("about:blank", scale=1)  # (an address with & in it: navigated to, /json/new would cut it short)
        await c.call("Page.navigate", url="https://gelbooru.com/index.php?page=post&s=view&id=55")
        await c.wait("document.images[0] && document.images[0].complete", 20)
        await c.js("document.images[0].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))")
        await c.wait(f"{btn} && !{btn}.hidden", 10)
        await c.js(f"{btn}.click()")
        note = await saved("__lumen_drawn_by_ren_ito__0123456789abcdef0123456789abcd12.png")
        check(note is not None and note.get("artist") == "ren ito" and note.get("tags") == ["lumen", "night"] and note.get("post") == "55",
              "Gelbooru: the original from its page, the artist tag, the tags")
        await ws.close()

        # ---- the right-click menu is registered
        swws = await M.websockets.connect(sw["webSocketDebuggerUrl"], max_size=None)
        swc = M.CDP(swws)
        menu = await swc.js("new Promise((r) => chrome.contextMenus.update('ml-gallery', {}, () => r(!chrome.runtime.lastError)))")
        check(menu, "right-click: the Save to Model Librarian Gallery menu is there")
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
    downloads = tempfile.mkdtemp(prefix="ml_gallery_dl_")
    cert, key = os.path.join(certs, "cert.pem"), os.path.join(certs, "key.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
                    "-subj", "/CN=www.pixiv.net", "-addext", "subjectAltName=" + ",".join(f"DNS:{h}" for h in HOSTS)], check=True, capture_output=True)
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(cert, key)
    app = web.Application()
    app.router.add_route("GET", "/{tail:.*}", sites)
    r = web.AppRunner(app)
    await r.setup()
    try:
        await web.TCPSite(r, "127.0.0.1", 443, ssl_context=ctx).start()
        await run(check, downloads)
    finally:
        await r.cleanup()
        shutil.rmtree(certs, ignore_errors=True)
        shutil.rmtree(downloads, ignore_errors=True)
    print("\nFAILED: %d" % fails if fails else "\nALL PASSED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
