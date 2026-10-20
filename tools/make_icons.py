"""Toolbar and store icons from Model Librarian's icon (docs/images/icon.png in that repo)."""
import os
import sys

from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "docs", "images", "icon.png")
out = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(out, exist_ok=True)
with Image.open(src) as im:
    im = im.convert("RGBA")
    for n in (16, 32, 48, 128):
        im.resize((n, n), Image.LANCZOS).save(os.path.join(out, f"icon{n}.png"))
print("icons written")
