"""FIFO queue, job state and generation worker."""
import homegrown_api.config as config
import threading
import time
import uuid
from typing import Optional
import numpy as np

import homegrown_api.audio.convert as audio_convert
import homegrown_api.audio.stitcher as audio_stitcher
import homegrown_api.generation.budget as generation_budget
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.schemas as generation_schemas
import homegrown_api.generation.text_chunker as generation_text_chunker
import homegrown_api.persistence.media_paths as persistence_media_paths
import homegrown_api.persistence.stores as persistence_stores


# Job store + FIFO queue. A single dedicated worker thread processes
# _pending_job_ids in order -- this matches the single-GPU reality (the
# CUDA-graphed talker/predictor can only run one generation at a time
# regardless of how many threads you throw at it) rather than pretending to
# support concurrency the hardware can't back up.
_jobs_lock = threading.Lock()


_jobs: dict[str, dict] = {}


_pending_job_ids: list[str] = []


_current_running_job_id: Optional[str] = None


_queue_event = threading.Event()
_stop_event = threading.Event()


_timing_lock = threading.Lock()


# ---- Queue helpers (all assume caller holds _jobs_lock) --------------------

def _queue_position_locked(job_id: str) -> Optional[int]:
    try:
        return _pending_job_ids.index(job_id)
    except ValueError:
        return None


def _job_elapsed_seconds_locked(job_id: str) -> Optional[float]:
    job = _jobs[job_id]
    started = job.get("started_at")
    if started is None:
        return None
    end = job.get("finished_at") or time.time()
    return end - started


def _persist_queue_locked() -> None:
    """Persist enough to rebuild the queue (queued + in-flight jobs) after a
    restart. Completed/errored/canceled jobs aren't persisted here -- they
    either already landed in history.json or don't need resuming."""
    to_persist = []
    if _current_running_job_id is not None:
        to_persist.append(_current_running_job_id)
    to_persist.extend(_pending_job_ids)

    records = []
    for job_id in to_persist:
        job = _jobs[job_id]
        records.append({
            "job_id": job_id,
            "user_id": job["user_id"],
            "preset_id": job["preset_id"],
            "text": job["text"],
            "language": job["language"],
            "style": job["style"],
            "stability": job["stability"],
            "submitted_at": job["submitted_at"],
        })
    persistence_stores._save_json(config.QUEUE_FILE, records)


def _enqueue_job_locked(job_id: str, job: dict) -> None:
    _jobs[job_id] = job
    _pending_job_ids.append(job_id)
    _persist_queue_locked()
    _queue_event.set()


def _restore_queue_on_startup() -> None:
    records = persistence_stores._load_json(config.QUEUE_FILE)
    if not records:
        return
    restored = 0
    with _jobs_lock:
        for record in records:
            preset = persistence_stores._find_preset(record["preset_id"])
            if preset is None:
                config.logger.warning(
                    "Skipping queued job %s on restore -- preset %s no longer exists",
                    record["job_id"], record["preset_id"],
                )
                continue
            text = record["text"]
            # Recomputed from the preset, not read back from queue.json, so a
            # restored job chunks the same way a fresh one would.
            chunks = generation_text_chunker.chunk_text(text, generation_budget._seq_budget(preset)[0])
            job_id = record["job_id"]
            _jobs[job_id] = {
                # .get(), not [] -- queue.json written before the multiuser
                # migration won't have this key. Such orphaned jobs just won't
                # surface in any user's queue. The legacy migration path is gone.
                "user_id": record.get("user_id"),
                "status": "queued",
                "preset_id": preset["id"],
                "preset_name": preset["name"],
                "text": text,
                "language": record["language"],
                "style": record["style"],
                "stability": record["stability"],
                "chunks": chunks,
                "chunks_done": 0,
                "total_chunks": len(chunks),
                "audio_url": None,
                "sample_rate": None,
                "error": None,
                "submitted_at": record["submitted_at"],
                "started_at": None,
                "finished_at": None,
            }
            _pending_job_ids.append(job_id)
            restored += 1
        if restored:
            _persist_queue_locked()
    if restored:
        config.logger.info("Restored %d queued job(s) from queue.json", restored)


# ---- Worker -----------------------------------------------------------------

def _process_job(job_id: str) -> None:
    global _current_running_job_id
    with _jobs_lock:
        job = _jobs[job_id]
        job["status"] = "running"
        job["started_at"] = time.time()
        _current_running_job_id = job_id
        _persist_queue_locked()

    preset = {"id": job["preset_id"], "name": job["preset_name"]}
    # audio_path/ref_text aren't stored on the job dict (only preset_id/name are,
    # to keep persisted queue records small) -- look the live preset up fresh so
    # edits to ref_text/audio between submission and processing take effect.
    live_preset = persistence_stores._find_preset(job["preset_id"])
    if live_preset is None:
        with _jobs_lock:
            job.update(status="error", error="Preset was deleted before this job could run.")
            _current_running_job_id = None
            _persist_queue_locked()
        return
    preset = live_preset
    try:
        persistence_stores._reference_path(preset)
    except persistence_media_paths.StoredMediaPathError as exc:
        with _jobs_lock:
            job.update(status="error", error=str(exc), finished_at=time.time())
            _current_running_job_id = None
            _persist_queue_locked()
        return

    chunks = job["chunks"]
    language = job["language"]
    style = job["style"]
    stability = job["stability"]
    text = job["text"]

    config.logger.info(
        "Job %s: starting -- preset=%r chunks=%d style=%s stability=%s",
        job_id, preset["name"], len(chunks), style, stability,
    )

    audio_chunks: list[np.ndarray] = []
    sr: Optional[int] = None
    # Once per job, not once per chunk: it re-reads the clip's header and logs.
    # The per-chunk cap is derived from this below, per chunk.
    budget = generation_budget._seq_budget(preset)

    for i, chunk in enumerate(chunks):
        with _jobs_lock:
            canceled = job["status"] == "canceling"
            if canceled:
                job.update(status="canceled", finished_at=time.time())
                _current_running_job_id = None
                _persist_queue_locked()
        if canceled:
            return

        last_error: Optional[Exception] = None
        audio_arrays = None
        canceled_mid_chunk = False
        for attempt in range(generation_budget.CHUNK_ATTEMPTS):  # retries for errors AND bad samples
            try:
                pieces: list[np.ndarray] = []
                with generation_model._gen_lock:
                    # Streaming (not the blocking generate_voice_clone) so a
                    # cancel can take effect after ~1s of audio instead of
                    # waiting for the whole (up to ~85s) chunk to finish.
                    stream = generation_model._tts.generate_voice_clone_streaming(
                        text=chunk,
                        language=language,
                        ref_audio=str(persistence_stores._reference_path(preset)),
                        ref_text=preset["ref_text"],
                        instruct=config.STYLE_INSTRUCTIONS[style],
                        # Bounded by THIS chunk's length, not the job-wide
                        # allowance -- see _chunk_token_cap().
                        max_new_tokens=generation_budget._chunk_token_cap(budget, chunk),
                        **config.STABILITY_PARAMS[stability],
                    )
                    for piece, sr, _timing in stream:
                        pieces.append(piece)
                        with _jobs_lock:
                            canceled_mid_chunk = job["status"] == "canceling"
                        if canceled_mid_chunk:
                            stream.close()
                            break
                if canceled_mid_chunk:
                    break
                produced = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
                if sr and produced.size:
                    # Trim here, not just at stitch time, so the check below
                    # judges speech rather than the model's edge padding.
                    produced = audio_stitcher.trim_edge_silence(produced, sr)
                # Resample a degenerate chunk rather than stitching it in. Only
                # worth doing while attempts remain -- on the last one, shipping
                # imperfect audio beats failing the whole job.
                #
                # Skipped entirely below PADDING_SAFE_MIN_CHARS: there the model
                # drags every sample rather than occasionally, so resampling
                # cannot find a good one. Observed on a 55-char chunk from a
                # 53.5s-reference preset -- 6.2s, then 6.4s on retry, against
                # 3.8s expected. Retrying there tripled a job's generation time
                # (562s for 80s of audio) and changed nothing. The fix for that
                # preset is a shorter reference clip, which _seq_budget warns about.
                if (
                    attempt < generation_budget.CHUNK_ATTEMPTS - 1
                    and sr
                    and budget.chunk_chars >= config.PADDING_SAFE_MIN_CHARS
                    and not generation_budget._chunk_duration_is_sane(produced.size, sr, budget, chunk)
                ):
                    config.logger.warning(
                        "Job %s: chunk %d/%d produced %.1fs for %d chars (expected ~%.1fs) "
                        "-- regenerating (attempt %d of %d)",
                        job_id, i + 1, len(chunks), produced.size / sr, len(chunk),
                        len(chunk) * budget.frames_per_char / config.CODEC_FRAME_HZ,
                        attempt + 1, generation_budget.CHUNK_ATTEMPTS,
                    )
                    continue
                audio_arrays = [produced]
                last_error = None
                break
            except RuntimeError as e:
                last_error = e
                config.logger.exception(
                    "Job %s: chunk %d/%d attempt %d failed", job_id, i + 1, len(chunks), attempt + 1,
                )
                # A CUDA-level error (e.g. Windows TDR killing a kernel) leaves the
                # process's CUDA context unusable -- retrying in the same process
                # would just fail again. Fail fast instead of wasting a retry.
                if "CUDA error" in str(e):
                    break

        if canceled_mid_chunk:
            with _jobs_lock:
                job.update(status="canceled", finished_at=time.time())
                _current_running_job_id = None
                _persist_queue_locked()
            return

        if last_error is not None:
            error_msg = f"Chunk {i + 1}/{len(chunks)} failed: {last_error}"
            if "CUDA error" in str(last_error):
                error_msg += " -- GPU driver reset; restart the backend process before retrying."
                generation_model._gpu_fault = str(last_error)
            with _jobs_lock:
                job.update(status="error", error=error_msg, finished_at=time.time())
                _current_running_job_id = None
                _persist_queue_locked()
            return

        audio_chunks.append(audio_arrays[0])
        with _jobs_lock:
            job["chunks_done"] = i + 1
        config.logger.info("Job %s: chunk %d/%d done", job_id, i + 1, len(chunks))

    final_audio = audio_stitcher.stitch_audio(audio_chunks, sr, gap_seconds=config.STITCH_GAP_SECONDS)
    out_name = f"{uuid.uuid4().hex}.mp3"
    audio_convert.write_mp3(final_audio, sr, str(config.GEN_DIR / out_name))
    audio_url = f"/audio/{out_name}"
    output_duration_s = len(final_audio) / sr
    finished_at = time.time()
    generation_s = finished_at - job["started_at"]
    config.logger.info(
        "Job %s: done -- %s (%.1fs audio, %.1fs generation time)",
        job_id, audio_url, output_duration_s, generation_s,
    )

    entry = {
        "id": uuid.uuid4().hex,
        "user_id": job["user_id"],
        "preset_id": preset["id"],
        "preset_name": preset["name"],
        "text": text,
        "language": language,
        "style": style,
        "stability": stability,
        "audio_url": audio_url,
        "duration_s": output_duration_s,
        "generation_s": generation_s,
        # Kept although nothing predicts any more: generation_s and
        # total_chunks are MEASURED facts and are the raw material if an
        # estimate is ever attempted again. estimated_s is no longer written --
        # there is nothing to write.
        "total_chunks": job["total_chunks"],
        "created_at": time.time(),
    }
    with persistence_stores._store_lock:
        persistence_stores._history.insert(0, entry)
        persistence_stores._save_json(config.HISTORY_FILE, persistence_stores._history)

    with _jobs_lock:
        job.update(status="done", audio_url=audio_url, sample_rate=sr, finished_at=finished_at)
        _current_running_job_id = None
        _persist_queue_locked()


def _worker_loop() -> None:
    while not _stop_event.is_set():
        with _jobs_lock:
            job_id = _pending_job_ids.pop(0) if _pending_job_ids else None
            if job_id is None:
                _queue_event.clear()
        if job_id is None:
            _queue_event.wait(timeout=1.0)
            continue
        try:
            _process_job(job_id)
        except Exception:
            config.logger.exception("Job %s: worker crashed unexpectedly", job_id)
            with _jobs_lock:
                _jobs[job_id].update(
                    status="error", error="Internal error -- see backend logs.", finished_at=time.time(),
                )
                global _current_running_job_id
                _current_running_job_id = None
                _persist_queue_locked()


def _job_status_response_locked(job_id: str) -> generation_schemas.JobStatusResponse:
    job = _jobs[job_id]
    return generation_schemas.JobStatusResponse(
        status=job["status"],
        chunks_done=job["chunks_done"],
        total_chunks=job["total_chunks"],
        audio_url=job.get("audio_url"),
        sample_rate=job.get("sample_rate"),
        error=job.get("error"),
        elapsed_s=_job_elapsed_seconds_locked(job_id),
        queue_position=_queue_position_locked(job_id),
    )


def _queue_entry_locked(job_id: str) -> generation_schemas.QueueEntry:
    job = _jobs[job_id]
    text = job["text"]
    return generation_schemas.QueueEntry(
        job_id=job_id,
        preset_id=job["preset_id"],
        preset_name=job["preset_name"],
        text_preview=(text[:80] + "...") if len(text) > 80 else text,
        status=job["status"],
        chunks_done=job["chunks_done"],
        total_chunks=job["total_chunks"],
        elapsed_s=_job_elapsed_seconds_locked(job_id),
        queue_position=_queue_position_locked(job_id),
        submitted_at=job["submitted_at"],
        audio_url=job.get("audio_url"),
        error=job.get("error"),
        attempt=job.get("attempt", 1),
    )
