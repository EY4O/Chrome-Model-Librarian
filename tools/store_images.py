"""Chrome Web Store / Edge Add-ons images in store/images/, composed from the README captures in
docs/images/ (staged pages with sample data, see tools/media/make_media.py).

  python tools/store_images.py

Screenshots are 1280x800, the small promo tile 440x280, the marquee tile 1400x560, the store icon 128x128.
Needs Pillow and Windows' Segoe UI.
"""
import pathlib
import shutil

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "images"
OUT = ROOT / "store" / "images"
FONTS = pathlib.Path("C:/Windows/Fonts")
BG, INK, QUIET = (17, 18, 21), (240, 240, 244), (160, 163, 172)

SLIDES = [
    ("panel-best.png", "The best file for your PC",
     "One click on a CivitAI model page picks the file that fits your GPU and VRAM, and sends it to the right ComfyUI folder."),
    ("image-panel.png", "Every model an image used",
     "On a CivitAI image or post: the checkpoint and every LoRA, in one click, saved as a recipe in Model Librarian."),
    ("badges.png", "Know what you already have",
     "Have and Update badges on CivitAI's model cards. One click gets the newer version."),
    ("popup.png", "Waits until ComfyUI is ready",
     "Clicks queue in the extension and start when ComfyUI is reachable, with progress, Cancel and Retry."),
    ("hf-panel.png", "HuggingFace and CivArchive too",
     "One click on a HuggingFace file page puts it in the folder its path suggests."),
]


def font(size, bold=False):
    return ImageFont.truetype(str(FONTS / ("segoeuib.ttf" if bold else "segoeui.ttf")), size)


def wrap(draw, text, f, width):
    lines, line = [], ""
    for word in text.split():
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=f) > width and line:
            lines.append(line)
            line = word
        else:
            line = test
    return lines + [line]


def fit(img, w, h):
    scale = min(w / img.width, h / img.height, 1.0)
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def slide(src, title, body, n):
    canvas = Image.new("RGB", (1280, 800), BG)
    d = ImageDraw.Draw(canvas)
    shot = Image.open(SRC / src).convert("RGB")
    tf, bf, sf = font(46, True), font(24), font(16)
    if shot.width / shot.height > 1.5:  # wide capture: words on top, picture below
        d.text((64, 56), title, font=tf, fill=INK)
        y = 124
        for line in wrap(d, body, bf, 1150):
            d.text((64, y), line, font=bf, fill=QUIET)
            y += 34
        pic = fit(shot, 1152, 800 - y - 64)
        canvas.paste(pic, ((1280 - pic.width) // 2, y + 24))
    else:  # tall capture: words on the left, picture on the right
        pic = fit(shot, 640, 704)
        canvas.paste(pic, (1216 - pic.width, (800 - pic.height) // 2))
        width = 1216 - pic.width - 64 - 56
        lines = wrap(d, title, tf, width)
        y = 400 - (len(lines) * 58 + 24 + len(wrap(d, body, bf, width)) * 34) // 2
        for line in lines:
            d.text((64, y), line, font=tf, fill=INK)
            y += 58
        y += 24
        for line in wrap(d, body, bf, width):
            d.text((64, y), line, font=bf, fill=QUIET)
            y += 34
    d.text((64, 752), "Sample data", font=sf, fill=QUIET)
    canvas.save(OUT / f"screenshot-{n}.png")


def promo():
    tile = Image.new("RGB", (440, 280), BG)
    d = ImageDraw.Draw(tile)
    icon = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA").resize((112, 112), Image.LANCZOS)
    tile.paste(icon, (36, 84), icon)
    d.text((168, 98), "Model", font=font(34, True), fill=INK)
    d.text((168, 136), "Librarian", font=font(34, True), fill=INK)
    d.text((170, 186), "CivitAI to ComfyUI in one click", font=font(16), fill=QUIET)
    tile.save(OUT / "promo-small.png")


def marquee():
    tile = Image.new("RGB", (1400, 560), BG)
    d = ImageDraw.Draw(tile)
    panel = fit(Image.open(SRC / "panel-best.png").convert("RGB"), 560, 500)
    tile.paste(panel, (1400 - 72 - panel.width, (560 - panel.height) // 2))
    icon = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA")
    tile.paste(icon, (72, 120), icon)
    d.text((72, 272), "Model Librarian", font=font(64, True), fill=INK)
    y = 364
    for line in wrap(d, "One click on CivitAI puts the right file in the right ComfyUI folder.", font(28), 600):
        d.text((74, y), line, font=font(28), fill=QUIET)
        y += 40
    d.text((74, 500), "Sample data", font=font(16), fill=QUIET)
    tile.save(OUT / "promo-marquee.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for n, (src, title, body) in enumerate(SLIDES, 1):
        slide(src, title, body, n)
    promo()
    marquee()
    shutil.copy(ROOT / "icons" / "icon128.png", OUT / "icon-128.png")
    for p in sorted(OUT.glob("*.png")):
        print(p.relative_to(ROOT), Image.open(p).size)
