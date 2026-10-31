<div align="center">
  <img src="docs/images/icon.png" width="112" alt="Model Librarian">
  <h1>Model Librarian for Chrome</h1>
  <p><b>One click on CivitAI puts the model in the right ComfyUI folder: sorted, verified and tracked by Model Librarian.</b></p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/EY4O/Chrome-Model-librarian" alt="License"></a>
    <a href="https://github.com/EY4O/Chrome-Model-librarian/commits/main"><img src="https://img.shields.io/github/last-commit/EY4O/Chrome-Model-librarian" alt="Last commit"></a>
    <a href="https://chromewebstore.google.com/detail/model-librarian/dnopofnpaeindcbbgfhfjkbnjmmjjkcc"><img src="https://img.shields.io/badge/Chrome%20Web%20Store-Model%20Librarian-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
    <a href="https://ko-fi.com/looneth"><img src="https://img.shields.io/badge/Ko--fi-Support-FF813F?logo=ko-fi&logoColor=white" alt="Support on Ko-fi"></a>
  </p>
</div>

A Chrome and Edge extension for people who use [Model Librarian](https://github.com/EY4O/ComfyUI-Model-Librarian) in ComfyUI. It puts a **Download with Model Librarian** panel on every CivitAI model page. Model Librarian does the download inside ComfyUI, the same way its Recipes tab does: the right folder for the model's type, a subfolder for its base model, SHA256 check, resume, metadata and preview. ComfyUI doesn't have to be open when you click: downloads wait in the extension and start when it is.

<p align="center"><img src="docs/images/panel-best.png" width="370" alt="The panel on a model page: the best file for an RTX 4070, and the text encoder and VAE it also needs"></p>

> **⚠ Needs Model Librarian 1.11.0 or newer**; 1.15.0 for everything here (image pages, badges, HuggingFace and CivArchive). in the ComfyUI you download into. CivitAI keys stay in Model Librarian (**Settings**); the extension never sees them.

## ✨ Key Features

- ⬇️ **One click per file** — on CivitAI model pages (every version and file: full, pruned, fp16, a bundled VAE), HuggingFace file pages and CivArchive pages (live copies of models removed from CivitAI).
- ★ **Best file for your PC** — rates every file against your GPU, its VRAM (keeping room for the text encoder) and the formats your ComfyUI runs at full speed (FP8, NVFP4, INT8/INT4, GGUF), and says why the others are slower.
- 🧩 **Everything it needs** — a diffusion model's text encoder and VAE, from ComfyUI's own workflow templates (official links): marked when you have them, fetched with the model if you like.
- 🖼️ **Every model an image used** — on a CivitAI image or post, the checkpoint and every LoRA it used, in one click; saved as a recipe in Model Librarian. ComfyUI not running? **Save for the Gallery** leaves it for Model Librarian Gallery to save instead.
- ✅ **Knows what you have** — **✓ Have** and **↑ Get update** badges on CivitAI's model cards (one click gets the newer version), **✓ In your library** in the panel (by version, SHA256 or file name), and nothing downloaded twice. Files land in the right ComfyUI folder, sorted by base model.
- 🖱️ **Right-click any model link** — **Download with Model Librarian** on a CivitAI model link queues its best file for your PC, without opening the page.
- ⏳ **Queue while ComfyUI is closed** — clicks wait in the extension and start when ComfyUI is reachable; the popup shows progress, with **Cancel** and **Retry** that act in Model Librarian itself, and a notification says when each download is done.
- 📚 **Collections and save for later** — get every missing model of a CivitAI collection (the best file of each), or star a model to come back to.
- 🖼️ **Save pictures for Model Librarian Gallery** — right-click any picture (**Save to Model Librarian Gallery**), use the **Save** button on pictures on Pixiv, X, DeviantArt, Danbooru, Gelbooru, Safebooru, yande.re, Konachan, e621 and Pawchive, or pick from a post's pictures in the popup (**Save from this page**). Each is saved full size into `Downloads\Model Librarian Gallery` with a note of its page, artist, title and tags, which the Gallery's **New downloads** files with it. The Gallery needn't be open.
- 👤 **Characters from the boorus** — a **+ Character** button beside each character tag on Danbooru, Gelbooru, Safebooru and e621 opens a panel that sorts the character's usual look into appearance, outfit and skip (from Danbooru's related tags and the post). Click a tag to move it, then **Save**: it goes into Model Librarian's character list (1.24.0+), the one the Gallery shares. ComfyUI not running? It's left for the Gallery to add instead. Saving a picture from a post offers the characters in it you don't have yet, to add or to link to one of yours. On a CivitAI LoRA page, a LoRA you have gets **Link to a character** (Model Librarian 1.26.0+): Character Select loads it for that character, with its trigger words.
- 🖥️ **Works with Comfy Desktop, and several ComfyUIs** — talks to ComfyUI directly (no browser tab needed); pick which ComfyUI gets the downloads, including one on another PC (e.g. over Tailscale).
- 🔒 **Keys stay home** — CivitAI and HuggingFace keys live in Model Librarian; the extension never sees them. A model CivitAI only shows to signed-in users is looked up through Model Librarian, with your key, so it still works.

## 📸 Screenshots

| | |
|:---:|:---:|
| <img src="docs/images/image-panel.png" width="370" alt="Image page panel"><br>**Every model an image used** — in your library, to download, or free on a later day | <img src="docs/images/popup.png" width="340" alt="Popup"><br>**Popup** — progress, finished downloads, and the ones waiting for their day |
| <img src="docs/images/panel-waiting.png" width="370" alt="Paid early access"><br>**Paid for now?** — get it on the day it's free, or try now if you've bought it | <img src="docs/images/hf-panel.png" width="370" alt="HuggingFace panel"><br>**HuggingFace** — into the folder guessed from the file's path |

<p align="center"><img src="docs/images/badges.png" width="760" alt="Badges on model cards"><br><b>Badges</b> — models you have, and ones with a newer version, marked on every listing</p>

<p align="center"><img src="docs/images/popup-settings.png" width="340" alt="Choosing a ComfyUI"><br><b>Several ComfyUIs</b> — pick which one gets the downloads</p>

<sub>Screenshots use staged pages and sample data (`tools/media/make_media.py`), not real CivitAI or HuggingFace content.</sub>

## 📦 Installation

### Option 1: **Chrome Web Store** (Recommended)

1. Open [Model Librarian on the Chrome Web Store](https://chromewebstore.google.com/detail/model-librarian/dnopofnpaeindcbbgfhfjkbnjmmjjkcc) and click **Add to Chrome**.
2. Pin **Model Librarian** to the toolbar.

It updates by itself. In Edge, the same page works once you allow extensions from other stores (Edge offers it on the page, or **edge://extensions → Allow extensions from other stores**).

### Option 2: **Load unpacked**

For the newest version before the store has reviewed it, or to change the code.


1. Download this repository (**Code → Download ZIP**, then unzip) or clone it:
   ```bash
   git clone https://github.com/EY4O/Chrome-Model-librarian.git
   ```
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that has `manifest.json`.
4. Pin **Model Librarian** to the toolbar.

To update: pull or unzip the new version over the old one, then press the reload arrow on the extension's card.

## 🚀 Getting Started

1. Make sure Model Librarian 1.15.0+ is installed in your ComfyUI (ComfyUI-Manager or the Comfy Registry).
2. Start ComfyUI. Click the toolbar icon: it should say **Connected to ComfyUI**. It looks on ports 8188, 8000 (Comfy Desktop) and 8189 by itself; another address goes under **ComfyUI and settings**.
3. Open a model on CivitAI and press **Download with Model Librarian** at the bottom right.
4. Pick the version (★ marks the best one for your PC), then **Download** next to the file you want. On an image page, **Get its models with Model Librarian** fetches everything the image used.
5. Follow it in the popup; when it's done the model is in ComfyUI's lists after a refresh.

## 📖 How It Works

<details>
<summary><b>🔌 Talking to ComfyUI</b></summary>

ComfyUI refuses requests from other origins (like an extension) when it listens on 127.0.0.1 or localhost, unless it was started with `--enable-cors-header`. The extension's own requests to those addresses are sent without an `Origin` header (a `declarativeNetRequest` rule that only applies to requests the extension itself makes), so they get through without changing how ComfyUI starts and without a ComfyUI tab, which matters for Comfy Desktop's own window. If ComfyUI still refuses, the request is run inside an open ComfyUI tab, where it's same-origin.

Websites can't use this: the rule only matches requests from this extension, and everything else still meets ComfyUI's own check.
</details>

<details>
<summary><b>★ Which file suits your PC</b></summary>

Model Librarian reports what decides it: the GPU and its VRAM (minus the headroom set in its **Settings**), which quantized formats this ComfyUI runs at full speed on that GPU (ComfyUI's own checks), and whether the GGUF and Nunchaku loaders are installed. The extension reads each file's format from its name (CivitAI's format tags are often wrong), then rates it:

- **✓** fits in the VRAM budget and runs natively;
- **◐** works, but slower: part of it runs from RAM, or the format isn't native on this GPU (NVFP4 and MXFP8 need an RTX 50-series, FP8 an RTX 40-series);
- **✗** can't load here (e.g. a GGUF file without ComfyUI-GGUF).

A standalone diffusion model (a "Diffusion Model" or GGUF file, not an all-in-one checkpoint) also loads a text encoder. ComfyUI can move the encoder out of VRAM while sampling, so its whole size isn't held back, but about 2 GB (or the encoder's own size, if smaller) is kept free for it, as model makers advise; each file says so and names the encoder (Krea 2's is `qwen3vl_4b_fp8_scaled`, 4.9 GB).

The **★ Best for your GPU** pick is the file with the most precision that still fits and runs fast; among equals, the newest version. Text encoders and VAEs are never picked. In the version list, ★ marks the pick and ✓ / ◐ / ✗ the best file of each version.
</details>

<details>
<summary><b>🧩 Text encoders and VAEs</b></summary>

A "Diffusion Model" file (or a GGUF) is only the core of the model: ComfyUI also loads a text encoder and a VAE for it. Model Librarian reads ComfyUI's own workflow templates, which list the files each official workflow loads with their folder and download link, picks the templates of the model's base family (Krea 2, Flux, Wan, Qwen, Z-Image, ...) and among those the one whose model file is most like yours, and shows its text encoders and VAE under **Also needs**:

- **✓ In your library** when you have the file, in any subfolder;
- **≈ you have …** when you have the same encoder in another precision (e.g. `t5xxl_fp8` instead of `t5xxl_fp16`);
- **Download** otherwise (or **Get N** for all of them): Model Librarian downloads from the template's official link, with the SHA256 from HuggingFace.

Only files on that list can be downloaded this way, and nothing is suggested for families without a template (all-in-one checkpoints like SDXL already include theirs).
</details>

<details>
<summary><b>🖼️ Images, posts and collections</b></summary>

On a CivitAI image page, **Get its models with Model Librarian** sends the page's link to Model Librarian, which reads the image's generation data from CivitAI (the same reader as its Recipes tab) and plans every model it names: the checkpoint or diffusion model, the LoRAs (with their strengths), the VAE. Each shows **✓ In your library**, **Download**, or why it can't be downloaded (removed, early access). **Get all missing** queues the rest; **Save as recipe** keeps it in Model Librarian's Recipes. On a post, pick the image first.

ComfyUI not running? On an image's page, **Save for the Gallery** (0.10.0+) leaves `civitai-<id> <time>.mlrecipe.json` (the image's link) in `Downloads\Model Librarian Gallery`. Model Librarian Gallery (1.21.0+, with **Recipes** on in its Settings) reads the image from CivitAI and saves its recipe into Model Librarian's Recipes, the same ones its Recipes tab shows, while it's open. On a post, open one of its images first.

On a collection page, the panel lists the models whose cards are on the page. **Get all N missing** queues the best file of each for your PC (or the newest version's main file), and **Get all N updates** the newer version of each one you have. It runs in the background, with its progress in the panel, so you can close the panel or leave the page; it carries on if the browser restarts the extension. Only cards that are loaded count, so scroll down first for long collections.
</details>

<details>
<summary><b>✅ Badges</b></summary>

Every model card on CivitAI (home, search, a user's page, a collection) is checked against your library by model id: **✓ Have** when Model Librarian has a file of that model, **↑ Get update** when a newer version of one you have is out (from Model Librarian's update check). Click **↑ Get update** to queue the newer version's best file for your PC without opening the card. On a model page, a version you have with a newer one out shows **You have v1; v2 is newer** with **Get update**. The answers are cached for two minutes.

Right-click a CivitAI model link anywhere for **Download with Model Librarian**: the best file for your PC (or the version the link points at) is queued, and a notification says so.
</details>

<details>
<summary><b>🤗 HuggingFace and CivArchive</b></summary>

- **HuggingFace**: on a model file's page (`.safetensors`, `.gguf`, `.ckpt`, …), pick the ComfyUI folder (it's guessed from the path, e.g. Comfy-Org's `split_files/vae/`, and the name) and download; the SHA256 HuggingFace lists is checked. A file with the same name in that folder counts as yours.
- **CivArchive**: every file the page links by SHA256 is looked up: already yours, or its live copies (CivitAI re-uploads, HuggingFace mirrors) planned into the right folder by Model Librarian, and copies on other hosts as links. On a model page, CivitAI's own download is offered first (CivArchive uses CivitAI's ids).
</details>

<details>
<summary><b>🖥️ Several ComfyUIs and notifications</b></summary>

**ComfyUI and settings** in the popup lists every ComfyUI answering on ports 8188, 8000 and 8189 (with its Model Librarian version) and the addresses you added; choose which one gets the downloads, or **Find it** to use the first one answering. A notification appears when a download finishes or fails (switch it off there too), and **Get a model's missing text encoder and VAE with it** decides whether those come along automatically.
</details>

<details>
<summary><b>⏳ The queue</b></summary>

Each click is stored in the extension first (`chrome.storage`), so nothing is lost if ComfyUI is closed, restarts or the browser restarts. The queue is sent when a Model Librarian answers: every 30 seconds, when a ComfyUI tab finishes loading, and right after a click. Once Model Librarian has a download, the extension follows its progress every 2 seconds. If CivitAI fails for a moment, the item is tried again a few times before it's marked as failed. **Cancel** stops a download in Model Librarian too; **Retry** carries on in Model Librarian from where the file stopped when it still has the download (an interrupted or cancelled one), and sends it again otherwise. A ComfyUI that stops answering for 10 minutes has its downloads marked as failed, with Retry, instead of spinning for ever, and finished items are cleared from the list after two weeks.

A version that's paid or early access for now (CivitAI says until when) offers **Get it on <date>**: it waits in the downloads list (**⏰ Waiting until …** in the popup) and starts by itself once that day has passed, with **Try now** if you've bought it. A download CivitAI refuses for that reason turns into such a wait by itself, and a failed one can be set to **Wait for <date>**.
</details>

<details>
<summary><b>🗂️ Where files go</b></summary>

Model Librarian decides, from CivitAI's details of that version: the folder for the model type (`checkpoints`, `loras`, `embeddings`, `vae`, `controlnet`, `upscale_models`, `animatediff_models`, `hypernetworks`), and for checkpoints, LoRAs and diffusion models a subfolder named for the base model (the names Organize uses). A GGUF "checkpoint" goes to `diffusion_models`, a version's bundled VAE file to `vae`. Workflows, wildcards and training data aren't model files and aren't downloaded. A file that's already there, or already downloading, isn't started again.
</details>

<details>
<summary><b>🖼️ Saving pictures for Model Librarian Gallery</b></summary>

- **Right-click** any picture, on any site: **Save to Model Librarian Gallery**. On the sites below it's saved as the post has it; elsewhere, as the page shows it, with the page's address and title.
- On **Pixiv, X, DeviantArt, Danbooru, Gelbooru, Safebooru, yande.re, Konachan, e621 and Pawchive**, a **Save** button appears on the pictures you rest the mouse on. The extension reads the post: the full-size original (Pixiv's original file, X's original size, DeviantArt's full view, a booru's original, Pawchive's file rather than its thumbnail), the artist and their page, the title and text, and the tags. Pixiv only gives its originals with Pixiv as the referrer, so those are fetched by the extension first and then saved.
- **Save from this page** (in the toolbar popup) shows the post's pictures (every page of a Pixiv set), all ticked: untick any, then **Save**. On other sites it lists the page's big pictures.
- Each picture lands in `Downloads\Model Librarian Gallery`, under a name the Gallery reads the artist from where the site has one (`12345678_p0.png`, `…_by_artist_d1a2b3c.png`, `__…_drawn_by_artist__md5.png`, `handle-id-date-img1.jpg`), and beside it `<name>.mlg.json`: the page, the artist and their page, the title, the text and the tags. Model Librarian Gallery (1.7.0 or newer) offers that folder in **New downloads**; filing a picture gives it its artist and source, the tags (marked as from the site) and the title as its note, and the note file goes. If Chrome saves somewhere other than your Downloads folder, add that folder's `Model Librarian Gallery` to the Gallery's **Settings → New downloads**.
</details>

<details>
<summary><b>👤 Characters from Danbooru, Gelbooru, Safebooru and e621</b></summary>

- On a post, **+ Character** sits beside each character tag (or right-click the page: **Add characters from this post**). A panel opens on the page with every character in the post, the one you clicked ticked.
- Each character's usual look comes from Danbooru: the general tags on most of its solo, general-rated posts (all its general-rated posts when it has few solo ones), with how often each appears. The post's own tags join in; with several characters, a tag goes to the one it belongs to most. Hair, eyes and the like go under **Appearance**, clothes and accessories under **Outfit**, the rest (the scene, expressions) under **Skip**. Click a tag to move it: appearance → outfit → skip. e621's characters are sorted from the post alone, its species counted as appearance. A character's look is asked of Danbooru once a week at most.
- Name the character, its series and the outfit, then **Save**. A character you have already (by its tag) gets the post as another outfit, named after the post, and any appearance tags it didn't have; **New character** makes a separate one instead.
- **Link to one of yours** (0.9.0+, Model Librarian 1.27.0): for a character you don't have by its tag, pick one of yours instead (search by name or alias; one with the same name in either order and no tag yet is picked to start with). It gets the booru tag (when it has none), the series (when it has none), the post's look and an outfit; its name stays yours. Listing yours needs ComfyUI running.
- **After a save:** saving a picture from a Danbooru post shows a small bar on the page when the post has characters you don't have yet (**Add or link…** opens the panel with just those). The saved note lists the post's characters too, so the Gallery's **New downloads** offers them as well.
- It's filed into Model Librarian's character list (`characters.json` in its shared data folder), with a small picture of the post when the post is rated general. When ComfyUI isn't running (or its Model Librarian is older than 1.24.0), it's saved as `<tag> <time>.mlchar.json` in `Downloads\Model Librarian Gallery` instead, and Model Librarian Gallery (1.15.0+) adds it to the same list while it's open.
- Danbooru and e621 are asked without your cookies, so your accounts there aren't involved.
</details>

<details>
<summary><b>🔒 Privacy and permissions</b></summary>

- **civitai.com / .green / .red, huggingface.co, civarchive.com** — to show the panel; CivitAI's public API is read for model versions and files.
- **127.0.0.1 / localhost** — to reach Model Librarian in ComfyUI. Another address is asked for when you save it.
- **storage, alarms, notifications** — the queue, the 30-second check and the "downloaded" notices. **contextMenus** — **Download with Model Librarian** on CivitAI model links, **Save to Model Librarian Gallery** on pictures, **Add characters from this post** on booru posts. **scripting** — the fallback through an open ComfyUI tab, and **Save from this page** on sites it doesn't know. **declarativeNetRequestWithHostAccess** — the header rule above, and Pixiv's referrer for its originals.
- **Pixiv, X, DeviantArt, Danbooru, Gelbooru, Safebooru, yande.re, Konachan, e621, Pawchive (and i.pximg.net)** — to read a post's pictures, artist and tags for saving, and to show the **Save** button. **Danbooru (and its pictures' server), e926, e621's and Gelbooru's picture servers** — to read a post and a character's related tags for **+ Character**, and the post's small picture. **downloads, downloads.ui** — to save pictures into `Downloads\Model Librarian Gallery` (Chrome's download bubble is kept quiet while it does). **activeTab** — **Save from this page** on the tab you're looking at. **offscreen** — a page with no window that holds a Pixiv original for the downloader.

Nothing is sent anywhere else, and the extension stores no keys.
</details>

---

## 🧪 Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## 🤝 Contributing

Issues and pull requests are welcome. Please run `node --test` before sending changes.

## 🙏 Credits

- [Model Librarian](https://github.com/EY4O/ComfyUI-Model-Librarian), which does the downloading.
- [Prompto](https://github.com/EY4O/prompto), whose CivitAI and ComfyUI code this started from.
- [CivitAI](https://civitai.com)'s public API.
- Stability Matrix's extension, for the idea.

## ☕ Support

If this saves you a few clicks per model, you can support its development:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/looneth)

## 📄 License

[MIT](LICENSE)
