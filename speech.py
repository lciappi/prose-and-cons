"""Local speech generation and PDF extraction. No cloud services."""

import re
import shutil
import subprocess
import textwrap
import threading
from pathlib import Path

import numpy as np
import pdfplumber
import soundfile as sf

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "models/kokoro-v1.0.onnx"
VOICES_FILE = ROOT / "models/voices-v1.0.bin"
MAX_TEXT = 150_000
VOICES = [
    {"id": "af_heart", "name": "Heart", "description": "Warm & expressive", "accent": "American", "gender": "Female", "lang": "en-us"},
    {"id": "af_bella", "name": "Bella", "description": "Soft & clear", "accent": "American", "gender": "Female", "lang": "en-us"},
    {"id": "af_nicole", "name": "Nicole", "description": "Gentle & intimate", "accent": "American", "gender": "Female", "lang": "en-us"},
    {"id": "am_michael", "name": "Michael", "description": "Steady & relaxed", "accent": "American", "gender": "Male", "lang": "en-us"},
    {"id": "am_fenrir", "name": "Fenrir", "description": "Rich & confident", "accent": "American", "gender": "Male", "lang": "en-us"},
    {"id": "bf_emma", "name": "Emma", "description": "Bright & composed", "accent": "British", "gender": "Female", "lang": "en-gb"},
    {"id": "bf_isabella", "name": "Isabella", "description": "Smooth & measured", "accent": "British", "gender": "Female", "lang": "en-gb"},
    {"id": "bm_george", "name": "George", "description": "Deep & considered", "accent": "British", "gender": "Male", "lang": "en-gb"},
]
VOICE_MAP = {voice["id"]: voice for voice in VOICES}
_engine = None
_engine_lock = threading.Lock()


def clean_text(text):
    text = text.replace("\x00", "").replace("\u00ad", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?<=\w)-[ \t]*\n[ \t]*(?=[a-z])", "", text)
    paragraphs = re.split(r"\n\s*\n", text)
    return "\n\n".join(re.sub(r"\s+", " ", part).strip() for part in paragraphs if part.strip())


def extract_pdf(stream, layout="single"):
    if layout not in {"single", "two"}:
        raise ValueError("Choose single-column or two-column reading order.")
    try:
        with pdfplumber.open(stream) as pdf:
            if len(pdf.pages) > 150:
                raise ValueError("This PDF has more than 150 pages. Export a smaller page range first.")
            pages, empty = [], []
            for number, page in enumerate(pdf.pages, 1):
                if layout == "two":
                    x0, top, x1, bottom = page.bbox
                    middle = (x0 + x1) / 2
                    regions = [page.crop((x0, top, middle, bottom)), page.crop((middle, top, x1, bottom))]
                else:
                    regions = [page]
                text = "\n\n".join(clean_text(region.extract_text(x_tolerance=2) or "") for region in regions).strip()
                if text:
                    pages.append(text)
                else:
                    empty.append(number)
                if sum(map(len, pages)) > MAX_TEXT:
                    raise ValueError("This article is too long. Export a smaller PDF (up to 150,000 characters).")
            if not pages:
                raise ValueError("No readable text found. This may be a scanned PDF. Run OCR first, then import the searchable PDF, or paste its text.")
            warnings = []
            if empty:
                warnings.append("No text on page(s) " + ", ".join(map(str, empty)) + ". They may be scanned images; review the extraction.")
            warnings.append("Review reading order, headings, footnotes, and references before narrating. For two-column papers, try the two-column option; full-width titles may need editing.")
            return {"text": "\n\n".join(pages), "pages": len(pdf.pages), "warnings": warnings}
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Could not read this PDF. It may be damaged or password-protected; try an unlocked copy.") from exc


def split_text(text, limit=450):
    """Keep every word, preferring sentence boundaries and bounded memory."""
    chunks = []
    for paragraph in clean_text(text).split("\n\n"):
        current = ""
        for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
            parts = textwrap.wrap(sentence, width=limit, break_long_words=True, break_on_hyphens=False)
            for part in parts:
                if current and len(current) + len(part) + 1 > limit:
                    chunks.append(current)
                    current = ""
                current = f"{current} {part}".strip()
        if current:
            chunks.append(current)
    return chunks


def get_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            if not MODEL.exists() or not VOICES_FILE.exists():
                raise ValueError("Voice model missing. Run ./start.command to download it and restart.")
            from kokoro_onnx import Kokoro

            _engine = Kokoro(str(MODEL), str(VOICES_FILE))
        return _engine


class Cancelled(Exception):
    pass


def synthesize(text, voice, speed, destination, progress, cancelled):
    engine = get_engine()
    chunks = split_text(text)
    total_samples = 0
    with sf.SoundFile(destination, mode="w", samplerate=24000, channels=1, subtype="PCM_16", format="WAV") as audio_file:
        for index, chunk in enumerate(chunks):
            if cancelled.is_set():
                raise Cancelled()
            samples, rate = engine.create(chunk, voice=voice, speed=speed, lang=VOICE_MAP[voice]["lang"])
            if rate != 24000:
                raise RuntimeError("Unexpected speech model sample rate.")
            audio_file.write(samples)
            total_samples += len(samples)
            if index < len(chunks) - 1:
                pause = np.zeros(6000, dtype=np.float32)
                audio_file.write(pause)
                total_samples += len(pause)
            progress(index + 1, len(chunks))
    if cancelled.is_set():
        raise Cancelled()
    return total_samples / 24000


def encode_mp3(wav_path):
    if not shutil.which("ffmpeg"):
        return None
    mp3_path = wav_path.with_suffix(".mp3")
    try:
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(wav_path), "-codec:a", "libmp3lame", "-q:a", "2", str(mp3_path)], check=True, capture_output=True, timeout=180)
        return mp3_path
    except (subprocess.SubprocessError, OSError):
        mp3_path.unlink(missing_ok=True)
        return None
