"""Routes generation"""
import homegrown_api.config as config
import time
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import homegrown_api.dependencies as dependencies
import homegrown_api.generation.budget as generation_budget
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.schemas as generation_schemas
import homegrown_api.generation.text_chunker as generation_text_chunker
import homegrown_api.generation.worker as generation_worker
import homegrown_api.persistence.media_paths as persistence_media_paths
import homegrown_api.persistence.stores as persistence_stores

router = APIRouter()


class EstimateRequest(BaseModel):
    text: str = ""
    preset_id: Optional[str] = None


@router.post("/api/estimate")
def estimate(req: EstimateRequest, user_id: str = Depends(dependencies.get_current_user)) -> dict:
    """Pre-flight cost of rendering `text` with `preset_id`.

    Chunk count has to be computed here and cannot be approximated on the
    client. Chunk size is a property of the *preset*, not a constant: the
    reference clip's audio codes and transcript consume part of the single
    MAX_SEQ_LEN window, and the script only gets what is left (_seq_budget).
    A longer reference means smaller chunks, more of them, and a longer render
    -- and since ELISION_SAFE_CHUNK_CHARS caps the result at 200, real chunks
    land between MIN_CHUNK_CHARS (80) and 200, nowhere near CHUNK_MAX_CHARS.
    A client mirroring 800 reported "1 chunk" for a script the backend then
    split into 3.

    This runs the same chunk_text() call the job will, so the number shown
    before Generate is the number the progress display counts up to.

    POST rather than GET because the text is needed to split on sentence
    boundaries, and it can run to MAX_TOTAL_CHARS.
    """
    text = req.text or ""
    chars = len(text.strip())
    result: dict = {
        # Provisional: with no preset there is no chunk count, so this is the
        # fallback model. Recomputed below once the preset gives a real one.
        "chunks": None,
        "chunk_chars": None,
        "ref_seconds": None,
        "warning": None,
    }
    if chars == 0:
        result["chunks"] = 0
        return result

    preset = persistence_stores._find_preset(req.preset_id) if req.preset_id else None
    if preset is None or preset.get("user_id") != user_id:
        return result  # no preset: chunking is unknowable

    facts = generation_budget._ref_facts(preset)
    budget = facts.budget
    result["chunk_chars"] = budget.chunk_chars
    result["chunks"] = len(generation_text_chunker.chunk_text(text, budget.chunk_chars))
    result["ref_seconds"] = facts.ref_seconds

    # Surface the same condition _compute_seq_budget only writes to the log: a
    # reference long enough to force chunks below the point where this model
    # starts padding output with murmur and trailing silence.
    #
    # Lead with the clip length, because that is the cause and the only number
    # the reader can act on. Without it this message named a chunk size nothing
    # in the UI controls, and was read as a limit of the machine doing the
    # rendering -- it is not; MAX_SEQ_LEN is a property of the model and is the
    # same on every GPU.
    if budget.chunk_chars < config.PADDING_SAFE_MIN_CHARS:
        cause = (
            f"This voice was cloned from a {facts.ref_seconds:.0f}s reference clip, which "
            f"leaves room for only {budget.chunk_chars}-character chunks"
            if facts.ref_seconds is not None
            else f"This voice renders in {budget.chunk_chars}-character chunks"
        )
        result["warning"] = (
            f"{cause} -- below the {config.PADDING_SAFE_MIN_CHARS}-character point where quality "
            "starts to suffer. Re-create it from a shorter reference clip (10-20s)."
        )
    return result


@router.post("/api/generate", status_code=202)
def generate(req: generation_schemas.GenerateRequest, user_id: str = Depends(dependencies.get_current_user)) -> generation_schemas.GenerateJobStart:
    if generation_model._tts is None:
        raise HTTPException(503, "Model not loaded yet")
    preset = persistence_stores._find_preset(req.preset_id)
    if preset is None or preset.get("user_id") != user_id:
        raise HTTPException(404, "Selected voice is unavailable. Choose a voice before generating.")
    try:
        persistence_stores._reference_path(preset)
    except persistence_media_paths.StoredMediaPathError as exc:
        raise HTTPException(409, str(exc))
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text is required")
    if len(text) > config.MAX_TOTAL_CHARS:
        raise HTTPException(
            400,
            f"Script too long ({len(text)} > {config.MAX_TOTAL_CHARS} chars).",
        )
    style = req.style.lower()
    stability = req.stability.lower()
    if style not in config.STYLE_INSTRUCTIONS:
        raise HTTPException(400, f"Unknown style '{req.style}'")
    if stability not in config.STABILITY_PARAMS:
        raise HTTPException(400, f"Unknown stability '{req.stability}'")
    language = generation_model._canonical_language(req.language)
    if language is None:
        raise HTTPException(
            400,
            f"This model does not speak '{req.language}'. "
            "GET /api/languages lists the ones it does.",
        )

    budget = generation_budget._seq_budget(preset)
    if budget.max_new_tokens < config.MIN_GEN_FRAMES:
        raise HTTPException(
            400,
            f"Preset '{preset['name']}' has a reference clip long enough to fill the "
            f"model's {config.MAX_SEQ_LEN}-position window on its own, leaving no room to "
            "generate speech. Create a preset from a shorter clip (10-20s works well).",
        )

    chunks = generation_text_chunker.chunk_text(text, budget.chunk_chars)
    job_id = uuid.uuid4().hex
    job = {
        "user_id": user_id,
        "status": "queued",
        "preset_id": preset["id"],
        "preset_name": preset["name"],
        "text": text,
        "language": language,
        "style": style,
        "stability": stability,
        "chunks": chunks,
        "chunks_done": 0,
        "total_chunks": len(chunks),
        "audio_url": None,
        "sample_rate": None,
        "error": None,
        "attempt": req.attempt,
        "submitted_at": time.time(),
        "started_at": None,
        "finished_at": None,
    }
    with generation_worker._jobs_lock:
        generation_worker._enqueue_job_locked(job_id, job)
        position = generation_worker._queue_position_locked(job_id)

    return generation_schemas.GenerateJobStart(
        job_id=job_id, total_chunks=len(chunks), queue_position=position,
    )
