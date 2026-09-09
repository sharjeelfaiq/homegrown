"""
Startup progress, published where the desktop launcher can read it.

The launcher opens a browser loader within a second or two of the double-click,
but the backend has nothing to say over HTTP for a long time after that:
uvicorn runs the ASGI lifespan startup (CUDA probe + model load) *before* it
creates the listening socket, and on a first run `run.py` downloads ~2.5GB
before uvicorn is even imported. For that whole window the desktop build's
port (`PORT` in `run.py`) is connection-refused, so progress is published as a
small JSON file in the storage dir and polled by the launcher's splash server
instead.

Nothing here may raise: a failure to report progress must never be the reason
the app doesn't start.
"""
import json
import os
import tempfile
import time
from pathlib import Path

STATUS_FILENAME = "boot_status.json"

# Phases, in the order they occur. The launcher maps these to loader copy.
PHASE_STARTING = "starting"
PHASE_DOWNLOADING = "downloading"
PHASE_IMPORTING = "importing"
PHASE_PROBING_GPU = "probing_gpu"
PHASE_LOADING_MODEL = "loading_model"
PHASE_READY = "ready"
PHASE_ERROR = "error"

_last_write = 0.0


def status_path(storage_dir) -> Path:
    return Path(storage_dir) / STATUS_FILENAME


def write(storage_dir, phase: str, detail=None, percent=None, throttle: float = 0.0) -> None:
    """Atomically publish the current startup phase.

    `throttle` skips the write if one happened less than that many seconds ago
    -- for the download ticker, which would otherwise write hundreds of times a
    second. Pass 0 (the default) for phase transitions, which must never be
    dropped.
    """
    global _last_write
    now = time.monotonic()
    if throttle and (now - _last_write) < throttle:
        return

    payload = {"phase": phase, "detail": detail, "percent": percent, "ts": time.time()}
    try:
        target = status_path(storage_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        # temp file + os.replace so the launcher polling this can never read a
        # half-written file -- same discipline as _save_json in main.py.
        fd, tmp = tempfile.mkstemp(dir=str(target.parent), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        os.replace(tmp, target)
        _last_write = now
    except Exception:
        pass


def clear(storage_dir) -> None:
    """Drop a status file left behind by a previous run."""
    try:
        status_path(storage_dir).unlink(missing_ok=True)
    except Exception:
        pass


def read(storage_dir) -> dict:
    """Read the current status. Returns {} if absent or mid-write."""
    try:
        with status_path(storage_dir).open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}
