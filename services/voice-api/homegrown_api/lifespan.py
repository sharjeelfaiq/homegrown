"""Application startup and background model initialization."""
import asyncio
import homegrown_api.config as config
import os
import sys
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI

import homegrown_api.boot_status as boot_status
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.worker as generation_worker
import homegrown_api.model_download as model_download
from homegrown_api.model_compatibility import assess, compatibility, system_snapshot
import homegrown_api.persistence.stores as persistence_stores


_model_ready = threading.Event()
_state_lock = threading.Lock()
_startup_error: str | None = None
_startup_thread: threading.Thread | None = None
_device_thread: threading.Thread | None = None
_worker_thread: threading.Thread | None = None
_startup_active = False
_model_busy = False
_device_ready = threading.Event()
_device_error: str | None = None


def readiness_error() -> str | None:
    with _state_lock:
        return _startup_error


def is_ready() -> bool:
    return _model_ready.is_set() and generation_model._tts is not None


def model_busy() -> bool:
    return _model_busy


def startup_active() -> bool:
    return _startup_active


def device_ready() -> bool:
    return _device_ready.is_set()


def _detect_device() -> None:
    global _device_error
    try:
        generation_model.probe_device()
        if generation_model._device == "unknown":
            raise RuntimeError("No compute device could be selected.")
        if generation_model._device == "cpu":
            config.logger.info("Using CPU: %s", generation_model._device_reason)
        else:
            config.logger.info("Using GPU: %s", generation_model._device_reason)
    except Exception as exc:
        _device_error = str(exc)
        generation_model._device = "unknown"
        generation_model._device_reason = ""
        config.logger.exception("Compute device detection failed")
    finally:
        _device_ready.set()


async def wait_until_ready(timeout: float) -> bool:
    """Wait for initialization without occupying an async request worker."""
    deadline = asyncio.get_running_loop().time() + timeout
    while not _model_ready.is_set():
        if not _model_busy:
            return False
        error = readiness_error()
        if error:
            return False
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(0.1, remaining))
    return is_ready()


def _initialize_model() -> None:
    global _startup_error, _worker_thread, _model_busy
    _model_busy = True
    try:
        # Existing installations continue to start without an onboarding download.
        if not model_download.is_installed(model_download.active_choice()):
            boot_status.write(config.STORAGE_DIR, boot_status.PHASE_READY)
            return
        persistence_stores._migrate_preset_media_paths()

        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_IMPORTING)
        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_PROBING_GPU)
        # Detection starts with the backend, independently of model download
        # and loading. Reuse its result here so the UI can show the compute
        # device while onboarding and the engine uses that same tested device.
        _device_ready.wait()
        if _device_error:
            raise RuntimeError("Compute device detection failed.")
        if generation_model._device == "cpu":
            config.logger.warning(
                "No usable GPU (%s). Falling back to CPU: generation still works "
                "but is dramatically slower -- expect many minutes per chunk.",
                generation_model._device_reason,
            )
        else:
            config.logger.info("Using GPU: %s", generation_model._device_reason)

        fit = assess(model_download.active_choice(), {
            "gpu_name": generation_model._gpu_name,
            "vram_mib": generation_model._gpu_memory_mib,
            **system_snapshot(),
        })
        if generation_model._device.startswith("cuda") and not fit["gpu"]["available"] and fit["cpu"]["available"]:
            generation_model._device = "cpu"
            generation_model._device_reason = "Measured graphics memory is insufficient; using CPU. Generation will be very slow."
            config.logger.warning(generation_model._device_reason)

        boot_status.write(
            config.STORAGE_DIR,
            boot_status.PHASE_LOADING_MODEL,
            detail=f"Loading the voice model onto {generation_model._device.upper()}",
        )
        generation_model.load_model()
        generation_worker._restore_queue_on_startup()
        generation_worker._stop_event.clear()
        compatible, reason = compatibility(
            model_download.active_choice(), generation_model._device,
            generation_model._gpu_name, generation_model._gpu_memory_mib,
        )
        if compatible:
            _worker_thread = threading.Thread(target=generation_worker._worker_loop, daemon=True)
            _worker_thread.start()
        else:
            config.logger.warning("Voice generation is disabled: %s", reason)
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
        boot_status.write(
            config.STORAGE_DIR, boot_status.PHASE_ERROR,
            detail="The voice model could not be loaded. Open Settings to retry.",
        )
        # Wake all API waiters; they will receive a bounded 503 response.
        _model_ready.set()
    finally:
        _model_busy = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_thread, _device_thread, _startup_error, _startup_active, _device_error
    _startup_active = True
    with _state_lock:
        _startup_error = None
    _device_error = None
    _device_ready.clear()
    generation_model._device = "unknown"
    generation_model._device_reason = ""
    generation_model._gpu_memory_mib = None
    generation_model._gpu_available_memory_mib = None
    generation_model._gpu_name = None
    generation_model._gpu_compute_capability = None
    _model_ready.clear()
    _device_thread = threading.Thread(target=_detect_device, name="device-detection", daemon=True)
    _device_thread.start()
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
        if _device_thread is not None:
            _device_thread.join(timeout=2)
        if _worker_thread is not None:
            _worker_thread.join(timeout=2)
