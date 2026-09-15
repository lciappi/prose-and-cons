import io
import threading
from pathlib import Path

import pytest

import app as server
import speech


@pytest.fixture
def client(monkeypatch, tmp_path):
    server.app.config["TESTING"] = True
    monkeypatch.setattr(server, "jobs", {})
    monkeypatch.setattr(server, "OUTPUT", tmp_path)
    # API unit tests mock synthesis and should also run in a fresh clone.
    for name in ("MODEL", "VOICES_FILE"):
        placeholder = tmp_path / name.lower()
        placeholder.touch()
        monkeypatch.setattr(server, name, placeholder)
    return server.app.test_client()


def post(client, route, **kwargs):
    return client.post(route, headers={"X-Folio-Token": server.TOKEN}, **kwargs)


def test_pdf_extracts_actual_fixture(client):
    fixture = Path(__file__).parent / "fixtures/dummy.pdf"
    response = post(client, "/api/extract", data={"file": (io.BytesIO(fixture.read_bytes()), "article.pdf")})
    assert response.status_code == 200
    assert response.json["text"] == "Dummy PDF file"
    assert response.json["pages"] == 1


def test_malformed_and_missing_pdf(client):
    assert post(client, "/api/extract", data={}).status_code == 400
    response = post(client, "/api/extract", data={"file": (io.BytesIO(b"not a pdf"), "bad.pdf")})
    assert response.status_code == 400
    response = post(client, "/api/extract", data={"file": (io.BytesIO(b"%PDF-1.4 broken"), "bad.pdf")})
    assert response.status_code == 400


def test_scanned_pdf_has_actionable_error(monkeypatch):
    class Page:
        def extract_text(self, **kwargs):
            return ""

    class PDF:
        pages = [Page()]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(speech.pdfplumber, "open", lambda stream: PDF())
    with pytest.raises(ValueError, match="OCR"):
        speech.extract_pdf(io.BytesIO())


def test_cleanup_joins_wrapped_lines_and_keeps_paragraphs():
    assert speech.clean_text("A beau-\ntiful story\ncontinues.\n\nNext paragraph.") == "A beautiful story continues.\n\nNext paragraph."


def test_long_article_chunking_keeps_every_word():
    text = " ".join(f"Passage {i} contains some words." for i in range(2000))
    chunks = speech.split_text(text)
    assert len(chunks) > 50
    assert max(map(len, chunks)) <= 450
    assert " ".join(chunks) == text
    assert "".join(speech.split_text("a" * 2000)) == "a" * 2000


@pytest.mark.parametrize("data", [[], {"text": ""}, {"text": "..."}, {"text": 4}, {"text": "x" * 150001}, {"text": "Hi", "voice": []}, {"text": "Hi", "voice": "unknown"}, {"text": "Hi", "speed": "nan"}, {"text": "Hi", "speed": 2}, {"text": "Hi", "speed": None}])
def test_invalid_speech_request(client, data):
    assert post(client, "/api/jobs", json=data).status_code == 400


def test_local_security(client):
    assert client.post("/api/jobs", json={"text": "Hello"}).status_code == 403
    assert client.get("/", headers={"Host": "untrusted.example"}).status_code == 400
    assert "frame-ancestors 'none'" in client.get("/").headers["Content-Security-Policy"]
    assert client.get("/api/jobs/not-a-job/audio.wav").status_code == 404


def test_job_lifecycle_and_download(client, monkeypatch):
    import numpy as np
    import soundfile as sf

    def synthesize(text, voice, speed, path, progress, cancelled):
        sf.write(path, np.zeros(2400), 24000)
        progress(1, 1)
        return 0.1

    # Run synchronously for deterministic API lifecycle assertions.
    class InlineThread:
        def __init__(self, target, args, **kwargs):
            self.target, self.args = target, args

        def start(self):
            self.target(*self.args)

    monkeypatch.setattr(server, "synthesize", synthesize)
    monkeypatch.setattr(server, "encode_mp3", lambda path: None)
    monkeypatch.setattr(server.threading, "Thread", InlineThread)
    response = post(client, "/api/jobs", json={"text": "Hello world", "title": "Example"})
    assert response.status_code == 202
    job_id = response.json["id"]
    status = client.get(f"/api/jobs/{job_id}").json
    assert status["status"] == "done"
    assert status["progress"] == 100
    assert status["formats"] == ["wav"]
    audio = client.get(f"/api/jobs/{job_id}/audio.wav?download=1")
    assert audio.data.startswith(b"RIFF")
    assert "Example.wav" in audio.headers["Content-Disposition"]
    assert client.get(f"/api/jobs/{job_id}/audio.mp3").status_code == 404


def test_cancel_and_busy_state(client):
    event = threading.Event()
    server.jobs["busy"] = {"status": "running", "cancel": event}
    assert post(client, "/api/jobs", json={"text": "Hello world"}).status_code == 409
    assert post(client, "/api/jobs/busy/cancel").status_code == 200
    assert event.is_set()


def test_cancel_removes_partial_audio(client, monkeypatch):
    event = threading.Event()
    event.set()
    server.jobs["cancelled"] = {"status": "queued", "cancel": event}

    def cancelled(text, voice, speed, path, progress, cancel):
        path.write_bytes(b"partial audio")
        raise speech.Cancelled()

    monkeypatch.setattr(server, "synthesize", cancelled)
    server.run_job("cancelled", "Hello world", "af_heart", 1)
    assert server.jobs["cancelled"]["status"] == "cancelled"
    assert not (server.OUTPUT / "cancelled.wav").exists()


def test_missing_ffmpeg_keeps_wav(monkeypatch, tmp_path):
    monkeypatch.setattr(speech.shutil, "which", lambda name: None)
    assert speech.encode_mp3(tmp_path / "audio.wav") is None
