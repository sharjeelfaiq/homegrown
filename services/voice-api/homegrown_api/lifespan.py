"""Application startup and background model initialization."""
import asyncio
import homegrown_api.config as config
import os
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI

import homegrown_api.boot_status as boot_status
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.worker as generation_worker
import homegrown_api.model_download as model_download
import homegrown_api.persistence.stores as persistence_stores


_model_ready = threading.Event()
_state_lock = threading.Lock()
_startup_error: str | None = None
_startup_thread: threading.Thread | None = None
_worker_thread: threading.Thread | None = None
_startup_active = False


def readiness_error() -> str | None:
    with _state_lock:
        return _startup_error


def is_ready() -> bool:
    return _model_ready.is_set() and generation_model._tts is not None


def startup_active() -> bool:
    return _startup_active


async def wait_until_ready(timeout: float) -> bool:
    """Wait for initialization without occupying an async request worker."""
    deadline = asyncio.get_running_loop().time() + timeout
    while not _model_ready.is_set():
        error = readiness_error()
        if error:
            return False
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(0.1, remaining))
    return is_ready()


def _initialize_model() -> None:
    global _startup_error, _worker_thread
    try:
        # Both development and packaged launches may start with an empty model
        # directory. Ensure the snapshot exists before attempting to load it.
        model_download.download_model_if_needed()
        persistence_stores._migrate_preset_media_paths()

        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_IMPORTING)
        # Run a test op rather than trusting torch.cuda.is_available(): a GPU
        # may be visible but lack kernels for this torch build.
        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_PROBING_GPU)
        generation_model.probe_device()
        if generation_model._device == "cpu":
            config.logger.warning(
                "No usable GPU (%s). Falling back to CPU: generation still works "
                "but is dramatically slower -- expect many minutes per chunk.",
                generation_model._device_reason,
            )
        else:
            config.logger.info("Using GPU: %s", generation_model._device_reason)

        boot_status.write(
            config.STORAGE_DIR,
            boot_status.PHASE_LOADING_MODEL,
            detail=f"Loading the voice model onto {generation_model._device.upper()}",
        )
        generation_model.load_model()
        generation_worker._restore_queue_on_startup()
        generation_worker._stop_event.clear()
        _worker_thread = threading.Thread(target=generation_worker._worker_loop, daemon=True)
        _worker_thread.start()
        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_READY)
        _model_ready.set()
    except Exception as exc:
        config.logger.exception("Backend startup failed")
        message = "Homegrown could not load the TTS model." + os.linesep * 2 + str(exc)
        try:
            config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            (config.STORAGE_DIR / "cuda_error.flag").write_text(message, encoding="utf-8")
        except Exception:
            config.logger.exception("Could not write model startup error flag")
        with _state_lock:
            _startup_error = message
        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_ERROR, detail=message)
        # Wake all API waiters; they will receive a bounded 503 response.
        _model_ready.set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_thread, _startup_error, _startup_active
    _startup_active = True
    with _state_lock:
        _startup_error = None
    _model_ready.clear()
    _startup_thread = threading.Thread(target=_initialize_model, name="model-startup", daemon=True)
    _startup_thread.start()
    try:
        # Uvicorn can bind and serve the SPA immediately. API middleware holds
        # application requests until initialization completes.
        yield
    finally:
        _startup_active = False
        generation_worker._stop_event.set()
        generation_worker._queue_event.set()
        if _startup_thread is not None:
            _startup_thread.join(timeout=2)
        if _worker_thread is not None:
            _worker_thread.join(timeout=2)
