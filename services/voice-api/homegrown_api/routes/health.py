"""Routes health"""
from fastapi import APIRouter, HTTPException

import homegrown_api.generation.model as generation_model
import homegrown_api.lifespan as startup

router = APIRouter()


@router.get("/api/health")
def health():
    return {
        "model_loaded": generation_model._tts is not None,
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
