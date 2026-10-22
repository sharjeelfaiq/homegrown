"""Lifespan"""
import homegrown_api.config as config
import os
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI

import homegrown_api.boot_status as boot_status
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.worker as generation_worker
import homegrown_api.persistence.stores as persistence_stores


@asynccontextmanager
async def lifespan(app: FastAPI):
    persistence_stores._migrate_preset_media_paths()


    # NOT torch.cuda.is_available(): that returns True for a GPU this torch
    # build has no kernels for (e.g. a Maxwell sm_52 card under a cu128 build),
    # and the failure then surfaces as a mid-generation "no kernel image is
    # available" crash instead of at startup. resolve_device() actually runs a
    # test op, and picks CPU when the GPU can't do the work.
    # Phase reporting throughout: uvicorn binds the port only after this
    # function reaches its `yield`, so until then the launcher's browser loader
    # is reading boot_status.json -- there is no HTTP to ask.
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
    try:
        generation_model.load_model()
    except Exception as e:
        # Fail soft, not hard: an uncaught exception here would crash uvicorn
        # before it ever binds the port, so the desktop launcher's health-poll
        # would just see "connection refused" and report a generic timeout.
        # Instead keep serving (model_loaded stays False) and drop a flag file
        # the launcher checks for a specific, actionable error message.
        config.logger.exception("Model failed to load")
        config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        message = "Homegrown could not load the TTS model." + os.linesep * 2 + str(e)
        (config.STORAGE_DIR / "cuda_error.flag").write_text(message, encoding="utf-8")
        boot_status.write(config.STORAGE_DIR, boot_status.PHASE_ERROR, detail=message)
        yield
        return

    generation_worker._restore_queue_on_startup()
    boot_status.write(config.STORAGE_DIR, boot_status.PHASE_READY)
    generation_worker._stop_event.clear()
    thread = threading.Thread(target=generation_worker._worker_loop, daemon=True)
    thread.start()
    try:
        yield
    finally:
        generation_worker._stop_event.set()
        generation_worker._queue_event.set()
        thread.join(timeout=2)
