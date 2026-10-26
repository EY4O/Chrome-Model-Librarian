# Chrome Web Store listing: Model Librarian

**Item ID:** not yet (it's assigned at the first upload).

Paste each section into the matching field of the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), the same account as Linemark. The images are in `store/images/`; rebuild them with `python tools/store_images.py`. Build the upload ZIP with `python tools/package.py`.

---

## Package

Upload `dist/model-librarian-0.6.1.zip` (**New item → Upload**). The ZIP is git-ignored, so build it first.

## Store listing tab

**Name** (from the manifest): `Model Librarian`

**Summary** (the manifest `description`, 130 of 132 characters):
> One-click downloads from CivitAI and HuggingFace into ComfyUI via Model Librarian, and pictures saved for Model Librarian Gallery.

**Category:** Developer Tools (or the closest the dashboard offers)

**Language:** English

**Description** (plain text):

```
The browser side of Model Librarian, a free, open-source model manager for ComfyUI.

It needs Model Librarian (1.15 or newer) installed in the ComfyUI you download into. ComfyUI doesn't have to be open when you click: downloads wait in the extension and start when it is.

One click per file
A download panel on every CivitAI model page, every version and file: full, pruned, fp16, a bundled VAE. Also on HuggingFace file pages and CivArchive pages.
Model Librarian does the download inside ComfyUI: the right folder for the model's type, a subfolder for its base model, a SHA256 check, resume, metadata and a preview.

The best file for your PC
Every file is rated against your GPU, its VRAM and the formats your ComfyUI runs at full speed (FP8, NVFP4, INT8/INT4, GGUF), with the reason the others are slower.
A diffusion model's text encoder and VAE are marked when you have them, and fetched with the model if you like.

Knows what you have
Have and Update badges on CivitAI's model cards, and In your library in the panel. Nothing is downloaded twice.
On a CivitAI image or post, the checkpoint and every LoRA it used, in one click, saved as a recipe.

Saves pictures for Model Librarian Gallery
Right-click any picture, or use the Save button on supported art sites, and it's saved full size to your Downloads folder with a note of its page, artist, title and tags, ready for the Gallery to file.

Your keys stay home
CivitAI and HuggingFace keys live in Model Librarian, never in the extension. No account, no analytics, and nothing is sent to the developer.
```

**Graphic assets** (all in `store/images/`):

| Field | File | Size |
|---|---|---|
| Store icon | `icon-128.png` | 128×128 |
| Screenshot 1: "The best file for your PC." The CivitAI panel recommending a file for an RTX 4070 | `screenshot-1.png` | 1280×800 |
| Screenshot 2: "Every model an image used." The image-page panel | `screenshot-2.png` | 1280×800 |
| Screenshot 3: "Know what you already have." Have and Update badges on model cards | `screenshot-3.png` | 1280×800 |
| Screenshot 4: "Waits until ComfyUI is ready." The popup's queue | `screenshot-4.png` | 1280×800 |
| Screenshot 5: "HuggingFace and CivArchive too." The HuggingFace panel | `screenshot-5.png` | 1280×800 |
| Small promo tile | `promo-small.png` | 440×280 |
| Marquee promo tile | `promo-marquee.png` | 1400×560 |

The screenshots use the README captures in `docs/images/`, taken on staged pages with sample data (not real CivitAI or HuggingFace content).

**Homepage URL:** the Model Librarian suite site, once it's live (until then, `https://github.com/EY4O/Chrome-Model-Librarian`)
**Support URL:** `https://github.com/EY4O/Chrome-Model-Librarian/issues`

---

## Privacy tab

**Single purpose:**
> Send models and pictures from the web to the user's own Model Librarian apps: model files into their ComfyUI, and pictures into their Model Librarian Gallery folder.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the user's settings (their ComfyUI address), the download queue, the saved-for-later list and collection progress on their device. |
| `alarms` | Checks the queue every 30 seconds, so downloads the user clicked while ComfyUI was closed start once it's reachable. |
| `scripting` | Two uses, both at the user's request: when ComfyUI can't be reached directly, the request to Model Librarian runs inside the user's open ComfyUI tab; and "Save from this page" in the popup reads the pictures on the current tab. |
| `declarativeNetRequestWithHostAccess` | Changes headers only on the extension's own requests: removes the Origin header on requests to the user's local ComfyUI (127.0.0.1 / localhost), which otherwise refuses them, and sets Pixiv's referrer on requests to i.pximg.net, which won't serve full-size pictures without it. |
| `notifications` | Says when a download finishes or fails. |
| `contextMenus` | Adds "Download with Model Librarian" on CivitAI model links and "Save to Model Librarian Gallery" on pictures. |
| `downloads` | Saves the pictures the user chooses, with a small note of their page, artist, title and tags, into Downloads\Model Librarian Gallery. |
| `downloads.ui` | Hides the download bubble while several pictures are saved at once, and turns it back on afterwards. |
| `activeTab` | Lets "Save from this page" read the pictures of the tab the user is on when they open the popup. |
| `offscreen` | Holds a picture fetched with its site's referrer (Pixiv) as a blob, so the downloader can save it (reason: BLOBS). |
| Host `http://127.0.0.1/*`, `http://localhost/*` | Talks to Model Librarian in the user's own ComfyUI on their computer. |
| Host `civitai.com`, `civitai.green`, `civitai.red` | Shows the download panel and badges, and reads the public model details for the page the user is on from CivitAI's public API (without cookies). |
| Host and content script on `huggingface.co`, `civarchive.com` | Shows the download panel on file and model pages. |
| Host on Pixiv, X / Twitter, DeviantArt, Danbooru, Gelbooru, Safebooru, yande.re, Konachan, e621, Pawchive, i.pximg.net | Shows the Save button on pictures, and reads the full-size picture and its title, artist and tags when the user saves it. |
| Optional host `http://*/*`, `https://*/*` | Requested only when the user sets a ComfyUI address on another computer (for example over Tailscale), and only for that one address. |

**Remote code:** No, I am not using remote code. All scripts are packaged with the extension.

**Data usage.** Model Librarian handles the following. It goes only to the user's own ComfyUI and their Downloads folder, and is never sent to the developer.
- ☑ **Website content:** model details on CivitAI, HuggingFace and CivArchive pages, and the pictures, titles, artists and tags of pictures the user saves.
- ☑ **Web history:** the address of the page a saved picture or model came from, kept in its note.
- Everything else (personal identity, health, financial, authentication, communications, location, user activity): not handled.

**Certify all three:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `privacy.html` on the Model Librarian suite site, once it's live. It must be up before you submit.

---

## Distribution tab

- **Visibility:** Public (Linemark started as Unlisted; this one launches with the suite on 3 Nov).
- **Regions:** all.

## Edge Add-ons

The same ZIP goes to [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview), with the same description, images and privacy answers. Linemark's `store/EDGE.md` has the field-by-field steps.

## Before you submit

1. `node --test`: all tests pass.
2. Bump `"version"` in `manifest.json` for every upload.
3. `python tools/package.py`, then upload `dist/model-librarian-<version>.zip`.
4. The privacy policy page is live.
