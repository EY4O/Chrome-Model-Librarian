"""Build the Chrome Web Store / Edge Add-ons upload: dist/model-librarian-<version>.zip.

Only what the extension runs is packed (manifest, scripts, popup, offscreen page, icons);
docs, tests, tools and store assets stay out.

  python tools/package.py
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "offscreen.html", "offscreen.js", "LICENSE"]
DIRS = ["content", "lib", "icons"]

version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "dist" / f"model-librarian-{version}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(ROOT / f, f)
    for d in DIRS:
        for p in sorted((ROOT / d).rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(ROOT).as_posix())
print(f"{out.relative_to(ROOT)}: {out.stat().st_size // 1024} KB")
