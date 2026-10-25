"""Local model onboarding and selection. Identifiers stay on the server."""
import json
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException

import homegrown_api.config as config
import homegrown_api.boot_status as boot_status
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.worker as generation_worker
import homegrown_api.lifespan as startup
import homegrown_api.model_download as model_download
from homegrown_api.model_compatibility import assess, hardware_snapshot

router = APIRouter()
_download_thread: threading.Thread | None = None
_selected = "standard"
_selection_file = config.STORAGE_DIR / "model-selection.json"


def _read_selection() -> str:
    try:
        value = json.loads(_selection_file.read_text(encoding="utf-8")).get("selection")
        return value if value in ("standard", "higher") else "standard"
    except Exception:
        return "standard"


def _installed(choice: str) -> bool:
    return model_download.is_installed(choice)


def _compatibility(choice: str):
    hardware = hardware_snapshot()
    if startup.device_ready():
        hardware.update(gpu_name=generation_model._gpu_name or hardware.get("gpu_name"),
                        compute_capability=generation_model._gpu_compute_capability,
                        vram_mib=generation_model._gpu_memory_mib or hardware.get("vram_mib"),
                        vram_available_mib=generation_model._gpu_available_memory_mib)
    return assess(choice, hardware)


@router.get("/api/models")
def get_models():
    global _selected
    _selected = _read_selection()
    busy = startup.model_busy()
    boot = boot_status.read(config.STORAGE_DIR)
    return {
        "selected": _selected if _installed(_selected) else None,
        "active": _selected if generation_model._tts is not None else None,
        "busy": busy,
        "progress": None,
        "hardware": _hardware(),
        "recommended": _recommend(),
        "choices": {choice: {"installed": _installed(choice), **_compatibility(choice)}
                    for choice in ("standard", "higher")},
        "error": "The voice model could not be loaded. Retry the download or restart Homegrown." if startup.readiness_error() else None,
        "phase": boot.get("phase", "starting"),
        "detail": boot.get("detail"),
        "percent": boot.get("percent"),
    }


def _hardware():
    hardware = hardware_snapshot()
    if startup.device_ready():
        hardware.update(gpu_name=generation_model._gpu_name,
                        compute_capability=generation_model._gpu_compute_capability,
                        vram_mib=generation_model._gpu_memory_mib,
                        vram_available_mib=generation_model._gpu_available_memory_mib)
    return hardware


def _recommend() -> str | None:
    standard = _compatibility("standard")
    higher = _compatibility("higher")
    if higher["gpu"]["available"] and higher["gpu"]["status"] != "Unknown":
        return "higher"
    if standard["gpu"]["available"] and standard["gpu"]["status"] != "Unknown":
        return "standard"
    if standard["available"]:
        return "standard"
    if higher["available"]:
        return "higher"
    return None


@router.post("/api/models/select")
def select_model(payload: dict):
    global _selected, _download_thread
    choice = payload.get("selection")
    if choice not in ("standard", "higher"):
        raise HTTPException(400, "Choose an available model.")
    assessment = _compatibility(choice)
    if not assessment["available"] and assessment.get("status") != "Unknown":
        raise HTTPException(400, assessment["reason"])
    if startup.model_busy():
        raise HTTPException(409, "A model operation is already in progress.")
    _selection_file.parent.mkdir(parents=True, exist_ok=True)
    _selection_file.write_text(json.dumps({"selection": choice}), encoding="utf-8")
    _selected = choice
    if _installed(choice):
        startup._startup_error = None
        startup._model_ready.clear()
        startup._model_busy = True

        def load():
            startup._initialize_model()

        _download_thread = threading.Thread(target=load, name="model-selection", daemon=True)
        _download_thread.start()
        return {"ok": True, "state": "loading"}
    return {"ok": True, "state": "needs_download"}


@router.post("/api/models/download")
def download_model():
    global _download_thread
    if startup.model_busy():
        raise HTTPException(409, "A model operation is already in progress.")
    choice = _read_selection()
    assessment = _compatibility(choice)
    if not assessment["available"] and assessment.get("status") != "Unknown":
        raise HTTPException(400, assessment["reason"])
    if not _installed(choice):
        startup._model_ready.clear()
        startup._startup_error = None
        startup._model_busy = True

        def fetch_and_load():
            try:
                model_download.download_model_if_needed(choice)
                startup._initialize_model()
            except Exception as exc:
                startup._startup_error = "The model could not be downloaded. Check your connection and retry."
                boot_status.write(
                    config.STORAGE_DIR,
                    boot_status.PHASE_ERROR,
                    detail="The model could not be downloaded. Check your connection and retry.",
                )
                config.logger.exception("Model download failed")
            finally:
                startup._model_busy = False

        _download_thread = threading.Thread(target=fetch_and_load, name="model-download", daemon=True)
        _download_thread.start()
    return {"ok": True}


@router.post("/api/models/cancel")
def cancel_download():
    # snapshot_download cannot safely interrupt an active file transfer; partial
    # files remain resumable and the operation will finish before another starts.
    raise HTTPException(409, "The download cannot be canceled safely once it has started.")


@router.post("/api/models/restart")
def restart_model(payload: dict):
    choice = payload.get("selection")
    assessment = _compatibility(choice) if choice in ("standard", "higher") else {"available": False}
    if not assessment["available"] or not _installed(choice):
        raise HTTPException(400, "That model is not installed.")
    with generation_worker._jobs_lock:
        if any(job.get("status") in ("queued", "running", "canceling") for job in generation_worker._jobs.values()):
            raise HTTPException(409, "Finish or cancel queued voiceovers before switching models.")
    _selection_file.parent.mkdir(parents=True, exist_ok=True)
    _selection_file.write_text(json.dumps({"selection": choice}), encoding="utf-8")
    # The local desktop launcher consumes this request and replaces the backend.
    request_file = config.STORAGE_DIR / "restart-request.json"
    request_file.write_text("{}", encoding="utf-8")
    return {"ok": True}
