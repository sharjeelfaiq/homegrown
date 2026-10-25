"""Routes health"""
from fastapi import APIRouter, HTTPException

import homegrown_api.generation.model as generation_model
import homegrown_api.model_download as model_download
from homegrown_api.model_compatibility import compatibility
import homegrown_api.lifespan as startup

router = APIRouter()


@router.get("/api/health")
def health():
    compatible, _ = compatibility(
        model_download.active_choice(),
        generation_model._device if startup.device_ready() else None,
        generation_model._gpu_name,
        generation_model._gpu_memory_mib,
    )
    return {
        "model_loaded": generation_model._tts is not None,
        "generation_ready": generation_model._tts is not None and compatible,
        "sample_rate": generation_model._tts.sample_rate if generation_model._tts else None,
        "device": generation_model._device,
        "device_reason": generation_model._gpu_name if generation_model._device.startswith("cuda") else (
            generation_model._device_reason or "No validated graphics device is available."
            if generation_model._device == "cpu" else None
        ),
        "device_ready": startup.device_ready(),
        # Truthy once the CUDA context is dead. model_loaded stays True in that
        # state -- the weights are still in memory, it is the context that is
        # gone -- so this is the only way a client can tell that every further
        # job is doomed.
        "gpu_fault": "GPU compute stopped. Restart Homegrown to continue." if generation_model._gpu_fault else None,
        "startup_error": "The voice model could not be loaded. Open Settings to retry." if startup.readiness_error() else None,
    }


@router.get("/api/languages")
def languages():
    if generation_model._tts is None:
        raise HTTPException(503, "Model not loaded yet")
    codec_language_id = generation_model._tts.model.model.config.talker_config.codec_language_id
    return {"languages": sorted(lang.capitalize() for lang in codec_language_id.keys())}
