#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export UV_CACHE_DIR="$PWD/.uv-cache"
if [ ! -x .venv/bin/python ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.13 .venv
    uv pip install --python .venv/bin/python -r requirements.txt
  else
    echo 'Install uv (https://docs.astral.sh/uv/), then open this file again.'
    exit 1
  fi
fi
.venv/bin/python download_models.py
PORT="${FOLIO_PORT:-7860}"
if curl --fail --silent "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
  open "http://localhost:$PORT"
  exit 0
fi
.venv/bin/python app.py &
FOLIO_PID=$!
trap 'kill "$FOLIO_PID" 2>/dev/null || true' EXIT INT TERM
for attempt in {1..100}; do
  if curl --fail --silent "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
    open "http://localhost:$PORT"
    wait "$FOLIO_PID"
    exit 0
  fi
  if ! kill -0 "$FOLIO_PID" 2>/dev/null; then
    echo 'Prose & Cons could not start. Check the error above.'
    exit 1
  fi
  sleep 0.2
done
echo 'Prose & Cons did not start in time. Check the error above.'
exit 1
