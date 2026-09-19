# Prose & Cons

```text
    ____                        ___       ______
   / __ \_________  ________   ( _ )     / ____/___  ____  _____
  / /_/ / ___/ __ \/ ___/ _ \ / __ \/|  / /   / __ \/ __ \/ ___/
 / ____/ /  / /_/ (__  )  __// /_/  <  / /___/ /_/ / / / (__  )
/_/   /_/   \____/____/\___/ \____/\/  \____/\____/_/ /_/____/

          [ PDF / TEXT ] ---> [ VOICE ] ---> [ MP3 / WAV ]
```

A PDF-to-speech app powered by Kokoro. Use the browser version hosted on Vercel, or run the original Mac app locally. Upload a PDF or paste text, choose an English voice, and generate MP3 / WAV audio. Voices are **synthetic**; use the preview button to choose one you like.

## Deploy to Vercel

The hosted version is a static Vite app: PDF extraction and Kokoro speech generation run in the browser. No Python function, speech server, API key, database, or environment variables are needed. Documents and text are not uploaded. Vercel hosting usage is subject to your plan.

For an existing Vercel project connected to this repository, merge this change and deploy the resulting commit. Keep the project **Root Directory** at the repository root. `vercel.json` selects **Vite**, `npm ci`, `npm run build`, and the `dist` output directory, overriding framework/build settings from the earlier Flask deployment. Use Node.js **24.x** (also declared in `package.json`).

The hosted app includes Vercel Web Analytics for page views. Enable **Web Analytics** in the Vercel project's **Analytics** tab, then deploy this version to start collecting visits. No API key or environment variables are required. The integration does not send document contents, pasted text, or generated audio as analytics events.

The previous Flask deployment can build successfully but fail at invocation: `app.py` writes to a local output directory at import, trusts only localhost, and uses process-local tokens, background threads, jobs, and audio files. Vercel functions do not provide the persistent server/filesystem those operations require. Downloading the Python model alone does not solve these issues.

Browser behavior:

- The first preview or narration downloads roughly 90 MB of quantized Kokoro model data from Hugging Face, plus the browser runtime. Browser caching can reuse these files; internet access is needed when they are not cached. No model download happens during the Vercel build.
- Speech runs in a Web Worker using WebAssembly. Use an up-to-date desktop browser; long articles take time and consume device memory. Cancel interrupts generation or model loading immediately; the next attempt reloads the worker.
- PDFs remain limited to 30 MB / 150 pages and narration to 150,000 characters. Review extracted reading order. Scanned PDFs still require OCR first.
- MP3 encoding runs in the browser; WAV remains available if MP3 encoding fails. Keep the tab open while generating, and download audio before refreshing or closing it. Audio and jobs are not persisted across page loads.
- The latest article remains downloadable while previewing voices. A new completed article replaces the previous result.

To develop or preview the hosted app locally (Node.js 24):

```sh
npm ci
npm run dev
# Production build and local preview:
npm run build
npm run preview
```

Validation:

```sh
npm test
npx playwright install chromium
npm run build
npm run test:e2e
# Optional real-model smoke test (downloads the model and generates WAV/MP3):
TEST_REAL_SPEECH=1 npm run test:e2e
```

The default browser tests exercise PDF extraction and cancellation against the production build without requiring a model download. The optional smoke test checks real non-silent, decodable WAV and MP3 output. GitHub Actions runs the build and default tests on PRs.

## Open the Mac app

Install [uv](https://docs.astral.sh/uv/) if needed, then clone the repository:

```sh
git clone https://github.com/lciappi/prose-and-cons.git
cd prose-and-cons
./start.command
```

Double-click **start.command** in Finder. Keep its Terminal window open while listening or generating. The app opens at **http://localhost:7860**. Press Control-C in Terminal to stop it.

Or, from this folder:

```sh
./start.command
```

First-time setup needs uv and internet access. The launcher creates a local Python environment, installs the dependencies, downloads about 354 MB of model files, verifies their SHA-256 hashes, and reuses them on later launches. Python packages require additional disk space. After setup, PDF extraction and speech generation work offline. Ordinary computer, storage, and electricity costs still apply.

For a terminal-only launch without opening a browser:

```sh
.venv/bin/python download_models.py
.venv/bin/python app.py
```

## Use the Mac app

1. Choose **Upload PDF** or **Paste text**, then add your article.
2. Review the text and remove anything you do not want read aloud. For journal articles, open **PDF reading order** and try **Two columns**; full-width titles may need correcting.
3. Choose a voice and click **Preview voice** to listen to a sample. Adjust the speed if needed.
4. Click **Generate audio**. Play the result or download MP3 / WAV. You can set a download name under **File name (optional)** before generating.

Eight English voices are included: Heart, Bella, Nicole, Michael, Fenrir, Emma, Isabella, and George. American and British accents; female and male voices. Heart is the default.

Use the preview button to hear any voice. Generated audio and downloaded models are local files and are not included in the repository.

## Mac app practical details

- PDF: selectable text, up to 30 MB / 150 pages; up to 150,000 characters per narration. For image-only/scanned PDFs, run free OCR first (for example, [OCRmyPDF](https://ocrmypdf.readthedocs.io/)), or paste recognized text. Complex layouts, math, citations, and tables may need editing.
- Generation runs one job at a time on the CPU. Long articles can take minutes. Cancel stops after the current speech passage or encoding operation finishes.
- WAV is always available. MP3 uses `ffmpeg` when installed (on macOS with Homebrew: `brew install ffmpeg`); WAV is offered if encoding is unavailable or fails.
- All generated audio, including previews, stays in **output/** until you delete it. Job links last for the running server session (most recent 100 jobs). Saved audio survives restarts. The PDF itself and extracted text are not saved by the app. Refreshing may lose unsent editor changes; an active job can reconnect in the same tab.
- The server binds only to `127.0.0.1`. There are no remote fonts, analytics, cloud speech calls, or document uploads to external servers. The Flask local server is intended for personal use on this computer, not public hosting.

## Mac app development

Python 3.13 is used (`kokoro-onnx` currently requires Python <3.14).

```sh
UV_CACHE_DIR="$PWD/.uv-cache" uv venv --python 3.13 .venv
UV_CACHE_DIR="$PWD/.uv-cache" uv pip install --python .venv/bin/python -r requirements.txt
UV_CACHE_DIR="$PWD/.uv-cache" uv pip install --python .venv/bin/python pytest
.venv/bin/python -m pytest -q tests
```

Unit tests do not need model downloads. They mock speech synthesis; actual listening previews require the model files.

`speech.py` handles extraction, text segmentation, the local model, and MP3 encoding. `app.py` serves a small Flask API and the interface in `templates/` and `static/`. The model is loaded on the first narration. Chunked WAV writing keeps article-length audio from accumulating in memory.

Verified on this Mac: 20 automated checks; a real PDF uploaded through the local HTTP API and converted to WAV and MP3; American female and British male sample generation; audio downloads decoded as non-silent, finite 24 kHz waveforms. A 25-second Heart sample generated and downloaded in about 4 seconds after warmup. Browser interaction, visual layout, and subjective listening quality have not been verified here.

## Credits and licenses

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M): Apache 2.0 model.
- [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx): MIT runtime wrapper. Model files come from its official `model-files-v1.1` release.
- Flask: BSD-3-Clause; pdfplumber: MIT; ONNX Runtime: MIT; SoundFile: BSD-3-Clause.
- Browser version: kokoro-js, Transformers.js, PDF.js, and phonemizer (Apache 2.0), eSpeak NG (GPL-3.0), and @breezystack/lamejs (LGPL-3.0). Quantized model files come from [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX).
- eSpeak NG (included through espeakng-loader) is used for pronunciation: GPL-3.0. FFmpeg is an optional external program with its own build-dependent license.
- Fraunces and DM Sans fonts: SIL Open Font License 1.1. Bundled locally in `static/fonts/` with their license files; no external font requests.

These tools and model weights are available without usage fees. See their upstream licenses before redistributing a bundled app.
