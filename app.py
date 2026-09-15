"""Prose & Cons: a private, free, local PDF-to-speech app."""

import math
import os
import secrets
import threading
import time
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

from speech import Cancelled, MAX_TEXT, MODEL, ROOT, VOICES, VOICES_FILE, VOICE_MAP, clean_text, encode_mp3, extract_pdf, synthesize

app = Flask(__name__)
app.config.update(MAX_CONTENT_LENGTH=30 * 1024 * 1024, TRUSTED_HOSTS=["localhost", "127.0.0.1", "[::1]"], TEMPLATES_AUTO_RELOAD=True)
TOKEN = secrets.token_urlsafe(32)
OUTPUT = ROOT / "output"
OUTPUT.mkdir(exist_ok=True)
jobs = {}
job_lock = threading.Lock()


@app.before_request
def protect_local_actions():
    if request.method == "POST" and not secrets.compare_digest(request.headers.get("X-Folio-Token", ""), TOKEN):
        abort(403, "Reload Prose & Cons and try again.")


@app.after_request
def headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
    if request.path.startswith("/api") or request.path == "/":
        response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(HTTPException)
def http_error(error):
    message = "PDF must be smaller than 30 MB." if error.code == 413 else error.description
    return jsonify(error=message), error.code


@app.get("/")
def index():
    return render_template("index.html", token=TOKEN, voices=VOICES)


@app.get("/api/status")
def status():
    return jsonify(ready=MODEL.exists() and VOICES_FILE.exists())


@app.post("/api/extract")
def extract():
    upload = request.files.get("file")
    if upload is None or not upload.filename or not upload.filename.lower().endswith(".pdf"):
        abort(400, "Choose a PDF file to import.")
    if b"%PDF-" not in upload.stream.read(1024):
        abort(400, "This file does not appear to be a PDF.")
    upload.stream.seek(0)
    try:
        result = extract_pdf(upload.stream, request.form.get("layout", "single"))
    except ValueError as error:
        abort(400, str(error))
    return jsonify(**result, title=Path(upload.filename).stem)


def update_job(job_id, **values):
    with job_lock:
        jobs[job_id].update(values)


def run_job(job_id, text, voice, speed):
    wav = OUTPUT / f"{job_id}.wav"
    cancel = jobs[job_id]["cancel"]
    try:
        update_job(job_id, status="running", message="Warming up your voice…")

        def progress(done, total):
            update_job(job_id, progress=round(done / total * 95), message=f"Narrating passage {done} of {total}…")

        duration = synthesize(text, voice, speed, wav, progress, cancel)
        update_job(job_id, message="Preparing your audio…", progress=96)
        mp3 = encode_mp3(wav)
        if cancel.is_set():
            raise Cancelled()
        update_job(job_id, status="done", progress=100, message="Your listening time is ready.", duration=duration, formats=["wav", "mp3"] if mp3 else ["wav"])
    except Cancelled:
        wav.unlink(missing_ok=True)
        wav.with_suffix(".mp3").unlink(missing_ok=True)
        update_job(job_id, status="cancelled", message="Narration cancelled.")
    except Exception:
        app.logger.exception("Speech generation failed")
        wav.unlink(missing_ok=True)
        wav.with_suffix(".mp3").unlink(missing_ok=True)
        update_job(job_id, status="error", message="Could not generate audio. Check the Terminal window for details, then try again. If the model is missing, restart with start.command.")


@app.post("/api/jobs")
def create_job():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, "Send text and a voice.")
    text = data.get("text", "")
    if not isinstance(text, str) or not text.strip():
        abort(400, "Add some article text first.")
    if len(text) > MAX_TEXT:
        abort(400, "Use up to 150,000 characters per article.")
    text = clean_text(text)
    if not any(character.isalnum() for character in text):
        abort(400, "Add readable words to narrate.")
    voice = data.get("voice", "af_heart")
    if not isinstance(voice, str) or voice not in VOICE_MAP:
        abort(400, "Choose one of the available voices.")
    try:
        speed = float(data.get("speed", 1.0))
    except (TypeError, ValueError):
        abort(400, "Speed must be between 0.75 and 1.5.")
    if not math.isfinite(speed) or not 0.75 <= speed <= 1.5:
        abort(400, "Speed must be between 0.75 and 1.5.")
    if not MODEL.exists() or not VOICES_FILE.exists():
        abort(503, "Voice model missing. Run ./start.command to download it.")
    title = data.get("title", "My article")
    if not isinstance(title, str):
        abort(400, "The article title must be text.")
    with job_lock:
        if any(job["status"] in {"queued", "running"} for job in jobs.values()):
            abort(409, "A narration is already running. Wait for it or cancel it first.")
        # Bound in-memory history; audio files remain in output/ for the user.
        while len(jobs) >= 100:
            jobs.pop(next(iter(jobs)))
        job_id = secrets.token_hex(16)
        jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0, "message": "Getting ready…", "title": title[:160], "voice": VOICE_MAP[voice]["name"], "created": time.time(), "cancel": threading.Event()}
    threading.Thread(target=run_job, args=(job_id, text, voice, speed), daemon=True).start()
    return jsonify(id=job_id), 202


@app.get("/api/jobs/<job_id>")
def get_job(job_id):
    with job_lock:
        job = jobs.get(job_id)
        if job is None:
            abort(404, "This session has ended. Generate the narration again; saved audio is still in the output folder.")
        return jsonify({key: value for key, value in job.items() if key != "cancel"})


@app.post("/api/jobs/<job_id>/cancel")
def cancel_job(job_id):
    with job_lock:
        job = jobs.get(job_id)
        if job is None:
            abort(404)
        if job["status"] in {"queued", "running"}:
            job["cancel"].set()
    return jsonify(ok=True)


@app.get("/api/jobs/<job_id>/audio.<extension>")
def audio(job_id, extension):
    with job_lock:
        job = jobs.get(job_id)
        if job is None or job["status"] != "done" or extension not in job["formats"]:
            abort(404)
        filename = secure_filename(job["title"]) or "article"
    return send_file(OUTPUT / f"{job_id}.{extension}", mimetype="audio/mpeg" if extension == "mp3" else "audio/wav", as_attachment=request.args.get("download") == "1", download_name=f"{filename}.{extension}", conditional=True)


if __name__ == "__main__":
    port = int(os.environ.get("FOLIO_PORT", "7860"))
    print(f"\n  Prose & Cons is ready at http://localhost:{port}\n  Press Control-C to stop.\n", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
