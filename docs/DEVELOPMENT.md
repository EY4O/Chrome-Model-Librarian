# Development

## Layout

| Path | What it is |
|---|---|
| `manifest.json` | Manifest V3. Bump `version` on every change. |
| `background.js` | Service worker: the queue, finding ComfyUI, sending downloads, following progress, the `Origin` header rule. |
| `content/civitai.js` | The panel on CivitAI model pages (self-contained: content scripts can't import modules; lives in a shadow root). |
| `popup.html/js/css` | Toolbar popup: connection, queue, ComfyUI address. |
| `lib/queue.js` | The queue as pure functions (tested). |
| `lib/civitai.js` | CivitAI model pages and API (tested). |
| `lib/fit.js` | Which file suits this PC: format from the file name, verdict and score per file, the recommendation (tested). |
| `lib/comfy.js` | Talking to Model Librarian: direct, or through an open ComfyUI tab (tested). |
| `tools/make_icons.py` | Toolbar icons from `docs/images/icon.png`. |

## Model Librarian's side

The extension uses four routes Model Librarian (≥ 1.11.0) serves under `/sm-fetcher` (`smf/ext.py`, `smf/routes/ext_routes.py` in that repo):

| Route | Does |
|---|---|
| `GET /ext/hello` | `{app: "model-librarian", version, models_root, free_bytes, civitai_key, active_downloads, system}`; `system` (1.12.0+): `gpu, vram_total, capability, budget, fast {fp8, nvfp4, mxfp8, int8}, formats, loaders {gguf, nunchaku}` |
| `POST /ext/lookup` | `{version_ids, hashes}` → which are already in the library (`have` / `downloading` / `missing`) |
| `POST /ext/download` | `{version_id, file_id?, dry_run?}` → `started` (with the job), `have`, `downloading` or `planned` |
| `GET /ext/jobs?ids=` | Progress of those downloads |

## Running it

Load the folder unpacked (`chrome://extensions` → Developer mode → Load unpacked). After editing, press reload on the extension's card and refresh CivitAI tabs (an old content script loses its connection to a reloaded extension).

## Tests

```bash
node --test
```

Node 20+. The tests cover the queue, CivitAI parsing and the ComfyUI client with fake responses; the end-to-end check (headless Edge with the extension loaded, against a test ComfyUI) is run by hand.

## Releasing

Bump `version` in `manifest.json`, commit, push. Users reload the unpacked extension. A Chrome Web Store package (zip of the folder without `tests/`, `tools/`, `docs/`, `package.json`) can come later.
