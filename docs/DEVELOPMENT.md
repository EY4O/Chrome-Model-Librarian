# Development

## Layout

| Path | What it is |
|---|---|
| `manifest.json` | Manifest V3. Bump `version` on every change. |
| `background.js` | Service worker: the queue, finding ComfyUI, sending downloads, following progress, the `Origin` header rule. |
| `content/sites.js` | The panel on HuggingFace file pages and CivArchive pages. |
| `content/civitai.js` | The panel on CivitAI model pages (self-contained: content scripts can't import modules; lives in a shadow root). |
| `popup.html/js/css` | Toolbar popup: connection, queue, ComfyUI address. |
| `lib/queue.js` | The queue as pure functions (tested). |
| `lib/civitai.js` | CivitAI model pages and API (tested). |
| `lib/fit.js` | Which file suits this PC: format from the file name, verdict and score per file, the recommendation (tested). |
| `lib/comfy.js` | Talking to Model Librarian: direct, or through an open ComfyUI tab (tested). |
| `lib/gallery.js` | Saving pictures for Model Librarian Gallery: names, full-size addresses, the `.mlg.json` note (tested). |
| `content/gallery.js` | On the sites it knows: the **Save** button on pictures, and each site's reader (the post's full pictures, artist, title, tags) for it, the right-click menu and the popup. |
| `offscreen.html/js` | Holds a Pixiv original (fetched with Pixiv as the referrer) as a `blob:` URL for `chrome.downloads`, which can't send a referrer. |
| `tools/make_icons.py` | Toolbar icons from `docs/images/icon.png`. |
| `tools/media/make_media.py` | README screenshots on staged pages (see below). |

## Model Librarian's side

Besides the Recipes routes (`/recipe/analyze`, `/recipes`) and `/download`, the extension uses these routes Model Librarian (≥ 1.11.0) serves under `/sm-fetcher` (`smf/ext.py`, `smf/routes/ext_routes.py` in that repo):

| Route | Does |
|---|---|
| `GET /ext/hello` | `{app: "model-librarian", version, models_root, free_bytes, civitai_key, active_downloads, system}`; `system` (1.12.0+): `gpu, vram_total, capability, budget, fast {fp8, nvfp4, mxfp8, int8}, formats, loaders {gguf, nunchaku}` |
| `POST /ext/lookup` | `{version_ids, hashes, model_ids}` → which are already in the library (`have` / `downloading` / `missing`; models: `have` / `update`) |
| `POST /ext/download` | `{version_id, file_id?, dry_run?}` → `started` (with the job), `have`, `downloading` or `planned` |
| `POST /ext/companions` | `{base_model, file_name}` → `{family, source, companions: [{folder, name, url, have, alt}]}` from ComfyUI's workflow templates (1.13.0+) |
| `POST /ext/companion-download` | `{base_model, file_name, name}` → one of those, downloaded (only listed files) |
| `GET /ext/model?id=` | A CivitAI model's versions and files (1.14.0+) |
| `POST /ext/civarchive` | `{sha256}` → yours, or CivArchive's live copies planned into a folder (1.15.0+) |
| `POST /ext/download-url` | `{url, folder, dry_run?}` → a HuggingFace file into the folder picked (1.15.0+) |
| `GET /ext/jobs?ids=` | Progress of those downloads |

## Running it

Load the folder unpacked (`chrome://extensions` → Developer mode → Load unpacked). After editing, press reload on the extension's card and refresh CivitAI tabs (an old content script loses its connection to a reloaded extension).

## Tests

```bash
node --test
```

Node 20+. The tests cover the queue, CivitAI parsing and the ComfyUI client with fake responses.

`python tests/e2e_gallery.py` runs saving pictures in headless Edge on staged copies of Pixiv (whose originals refuse a request without its referrer), X, Danbooru, Gelbooru, DeviantArt and Pawchive: the **Save** button, the note beside each picture, **Save from this page**, and the right-click menu. Downloads go to a throwaway folder (the profile's download folder: Edge's DevTools download override would rename the files).

`python tests/e2e_features.py` runs the extension in headless Edge on the staged pages below (sample CivitAI pages and a recording sample Model Librarian; never real sites): the **↑ Get update** badge (and the lookup through Model Librarian when CivitAI's public API won't show a model), a collection's background job, the popup's Cancel and Retry in Model Librarian, and the right-click menu. It needs what `make_media.py` needs.

## README screenshots

```bash
python tools/media/make_media.py
```

Writes `docs/images/*.png` (except the icon) from staged pages: a local HTTPS server answers for civitai.com and huggingface.co in a headless Edge started with `--host-resolver-rules` (and `--ignore-certificate-errors` for its throwaway certificate), serving neutral sample pages and API answers with the art in `tools/media/samples/`; a fake Model Librarian answers on 127.0.0.1:8211. The extension runs unchanged. Needs Edge, Python with aiohttp, websockets and Pillow (ComfyUI's environment), openssl on PATH (Git for Windows), and port 443 free. The popup's ComfyUI list also shows whatever real ComfyUI answers on 8188/8000/8189 at the time.

## Releasing

Bump `version` in `manifest.json`, commit, push. Users reload the unpacked extension. (Not published to the Chrome Web Store.)
