# Prose & Cons

A free, local PDF-to-speech app for your Mac, powered by Kokoro. Upload a PDF or paste text, choose an English voice, and generate an audio file. No account, API key, subscription, or per-character fees. Voices are **synthetic**; use the preview button to choose one you like.

## Open it

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

## Use it

1. Choose **Upload PDF** or **Paste text**, then add your article.
2. Review the text and remove anything you do not want read aloud. For journal articles, open **PDF reading order** and try **Two columns**; full-width titles may need correcting.
3. Choose a voice and click **Preview voice** to listen to a sample. Adjust the speed if needed.
4. Click **Generate audio**. Play the result or download MP3 / WAV. You can set a download name under **File name (optional)** before generating.

Eight English voices are included: Heart, Bella, Nicole, Michael, Fenrir, Emma, Isabella, and George. American and British accents; female and male voices. Heart is the default.

Use the preview button to hear any voice. Generated audio and downloaded models are local files and are not included in the repository.

## Practical details

- PDF: selectable text, up to 30 MB / 150 pages; up to 150,000 characters per narration. For image-only/scanned PDFs, run free OCR first (for example, [OCRmyPDF](https://ocrmypdf.readthedocs.io/)), or paste recognized text. Complex layouts, math, citations, and tables may need editing.
- Generation runs one job at a time on the CPU. Long articles can take minutes. Cancel stops after the current speech passage or encoding operation finishes.
- WAV is always available. MP3 uses `ffmpeg` when installed (on macOS with Homebrew: `brew install ffmpeg`); WAV is offered if encoding is unavailable or fails.
- All generated audio, including previews, stays in **output/** until you delete it. Job links last for the running server session (most recent 100 jobs). Saved audio survives restarts. The PDF itself and extracted text are not saved by the app. Refreshing may lose unsent editor changes; an active job can reconnect in the same tab.
- The server binds only to `127.0.0.1`. There are no remote fonts, analytics, cloud speech calls, or document uploads to external servers. The Flask local server is intended for personal use on this computer, not public hosting.

## Development

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
- eSpeak NG (included through espeakng-loader) is used for pronunciation: GPL-3.0. FFmpeg is an optional external program with its own build-dependent license.
- Fraunces and DM Sans fonts: SIL Open Font License 1.1. Bundled locally in `static/fonts/` with their license files; no external font requests.

These tools and model weights are available without usage fees. See their upstream licenses before redistributing a bundled app.
