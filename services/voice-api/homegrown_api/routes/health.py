"""Routes health"""
import re

import homegrown_api.config as config
from fastapi import APIRouter, HTTPException

import homegrown_api.generation.model as generation_model
import homegrown_api.lifespan as startup
from homegrown_api.model_download import REPO_ID

router = APIRouter()


def _model_display_name(model) -> str:
    """Return a short model identifier without exposing its local path."""
    model_config = getattr(model, "config", None)
    sources = [getattr(model_config, "_name_or_path", None), config.MODEL_PATH]
    for source in sources:
        if not isinstance(source, str) or not source.strip():
            continue
        normalized = source.strip().replace("\\", "/").rstrip("/")
        parts = [part for part in normalized.split("/") if part]
        repo_folder = next((part for part in reversed(parts) if part.startswith("models--")), None)
        if repo_folder:
            return repo_folder.removeprefix("models--").replace("--", "/")
        is_absolute_path = normalized.startswith("/") or bool(re.match(r"^[A-Za-z]:/", normalized))
        if not is_absolute_path and len(parts) == 2:
            return normalized
        name = parts[-1] if parts else ""
        if name and name not in {"models", "snapshots"} and not re.fullmatch(r"[a-f0-9]{32,64}", name, re.I):
            return name
    return REPO_ID


def _loaded_model_details() -> tuple[str | None, str | None]:
    tts = generation_model._tts
    if tts is None:
        return None, None
    model = getattr(getattr(tts, "model", None), "model", None)
    if model is None:
        return None, None
    name = _model_display_name(model)
    custom_voice_model = name if getattr(model, "tts_model_type", None) == "custom_voice" else None
    return name, custom_voice_model


@router.get("/api/health")
def health():
    voice_model, custom_voice_model = _loaded_model_details()
    return {
        "model_loaded": generation_model._tts is not None,
        "voice_model": voice_model,
        "custom_voice_model": custom_voice_model,
        "sample_rate": generation_model._tts.sample_rate if generation_model._tts else None,
        "device": generation_model._device,
        "device_reason": generation_model._device_reason,
        # Truthy once the CUDA context is dead. model_loaded stays True in that
        # state -- the weights are still in memory, it is the context that is
        # gone -- so this is the only way a client can tell that every further
        # job is doomed.
        "gpu_fault": generation_model._gpu_fault,
        "startup_error": startup.readiness_error(),
    }


@router.get("/api/languages")
def languages():
    if generation_model._tts is None:
        raise HTTPException(503, "Model not loaded yet")
    codec_language_id = generation_model._tts.model.model.config.talker_config.codec_language_id
    return {"languages": sorted(lang.capitalize() for lang in codec_language_id.keys())}
