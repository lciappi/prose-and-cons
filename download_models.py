"""Download official model files once and verify their published SHA-256 hashes."""

import hashlib
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
FILES = {
    "kokoro-v1.0.onnx": "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def checksum(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    folder = Path(__file__).resolve().parent / "models"
    folder.mkdir(exist_ok=True)
    for name, expected in FILES.items():
        destination = folder / name
        if destination.exists() and checksum(destination) == expected:
            print(f"Verified {name}")
            continue
        print(f"Downloading {name}. One-time setup, about 354 MB total…", flush=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            with urllib.request.urlopen(BASE + name, timeout=60) as response, temporary.open("wb") as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            if checksum(temporary) != expected:
                raise RuntimeError(f"Checksum mismatch for {name}. The download is incomplete or upstream has changed. Try again or check the official release.")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    print("Voice model ready. Future launches work offline.", flush=True)


if __name__ == "__main__":
    main()
