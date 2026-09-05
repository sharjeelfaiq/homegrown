import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

if not getattr(sys, "frozen", False):
    # Dev mode: add the repo root (parent of the vendored `qwen` package) to
    # sys.path. When frozen by PyInstaller, `qwen` is instead bundled at the
    # top level of the onedir bundle, which PyInstaller already puts on
    # sys.path -- no manual insert needed, and __file__ isn't a real repo
    # path to derive one from anyway.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import requests
import torch
import soundfile as sf
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from filelock import FileLock
from pydantic import BaseModel

load_dotenv(Path(__file__).parent / ".env")

from auth import get_current_user, get_last_activity
from qwen import FasterQwen3TTS
from qwen.utils import resolve_device
from audio_convert import wav_to_mp3, write_mp3
from audio_stitcher import stitch_audio
from text_chunker import chunk_text

_whisper_model = None
_whisper_lock = threading.Lock()


def _transcribe_audio(path: str) -> str:
    """Auto-transcribe a reference clip with faster-whisper (CPU, so it doesn't
    contend with the TTS model for this machine's 4GB of VRAM)."""
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel
            _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        # condition_on_previous_text=False and vad_filter=True are the standard
        # cure for whisper's repetition loop, where it re-emits a sentence it
        # already transcribed. Observed here on a 15s clip: one sentence
        # duplicated, giving 361 chars for 15s (~24 chars/sec, about double a
        # real speaking rate). That matters beyond tidiness -- ref_text is spent
        # from the same max_seq_len budget generation needs (see _seq_budget).
        segments, _ = _whisper_model.transcribe(
            path, condition_on_previous_text=False, vad_filter=True,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice_clone_studio")

# Overridable via MODEL_PATH in backend/.env -- the default below only holds
# on the original dev machine's local model cache. Any other host (including
# a RunPod pod) must set MODEL_PATH to wherever it downloaded the snapshot.
MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    r"D:\models_cache\models--Qwen--Qwen3-TTS-12Hz-0.6B-Base\snapshots\5d83992436eae1d760afd27aff78a71d676296fc",
)

if getattr(sys, "frozen", False):
    # Frozen: __file__ points inside the PyInstaller bundle, not a writable
    # location -- use the folder next to the installed exe instead (backend.exe
    # lives in <install>/backend/, so storage/ is its sibling at <install>/storage).
    # Overridable via VOICECLONE_STORAGE_DIR (set in the installer's .env).
    STORAGE_DIR = Path(
        os.environ.get("VOICECLONE_STORAGE_DIR", str(Path(sys.executable).parent.parent / "storage"))
    )
else:
    STORAGE_DIR = Path(__file__).parent / "storage"
REF_DIR = STORAGE_DIR / "references"
GEN_DIR = STORAGE_DIR / "generated"
PRESETS_FILE = STORAGE_DIR / "presets.json"
HISTORY_FILE = STORAGE_DIR / "history.json"
QUEUE_FILE = STORAGE_DIR / "queue.json"
REF_DIR.mkdir(parents=True, exist_ok=True)
GEN_DIR.mkdir(parents=True, exist_ok=True)

# Per-chunk char budget so a single chunk's prefill + decode stay within
# max_seq_len=1024 (tuned for this machine's 4GB GPU -- see
# ../qwen/HOW_TO_RUN.md). Empirically tested: 800 chars / 700 max_new_tokens
# with a short (~3.5s) reference clip takes ~85s and comfortably fits. Longer
# reference clips (10+s) eat into the same max_seq_len budget and will be much
# slower or may exceed it -- the talker's own StaticCache bounds check is the
# final safety net (surfaced as a chunk failure in the job's "error" field).
#
# Long scripts are handled by splitting into multiple CHUNK_MAX_CHARS-sized
# pieces (text_chunker.chunk_text), each generated independently with a fresh
# KV cache -- this is what keeps quality stable past the point where a single
# long generation would drift into noise as cache position approaches
# max_seq_len (rope embeddings extrapolating past the range this model/config
# was validated for). See audio_stitcher.stitch_audio for how the per-chunk
# audio is recombined.
CHUNK_MAX_CHARS = 800
MAX_NEW_TOKENS = 700
MAX_TOTAL_CHARS = 60_000
STITCH_GAP_SECONDS = 0.2

# --- max_seq_len budgeting -------------------------------------------------
# The reference clip and the script share ONE window, and CHUNK_MAX_CHARS=800
# above is calibrated for a ~3.5s reference. Nothing used to reconcile the two,
# so a long clip silently overran the window. Measured failure: a 53.5s
# reference (642 frames) plus an 876-char script asked for
#
#     642 ref frames + ~190 ref_text tokens + ~197 script tokens
#         + 700 generated frames  =  ~1729  vs  1024 available
#
# The talker does not hard-fail on this -- rope positions extrapolate past the
# validated range and output degenerates into murmur and long silence (54.4s of
# audio holding only ~20s of speech). The same preset with a 160-char script
# came to ~1009 and sounded fine, which is why this looked intermittent.
#
# So derive the per-chunk char budget from what the reference actually leaves,
# rather than assuming a short clip. Conversion factors are deliberately rough:
# they only need to be conservative, and SEQ_SAFETY_MARGIN absorbs the slop.
MAX_SEQ_LEN = 1024          # must match from_pretrained(max_seq_len=...) below
CODEC_FRAME_HZ = 12         # Qwen3-TTS-12Hz: 12 codec frames per second of audio
SEQ_SAFETY_MARGIN = 64      # absorbs tokenizer/prompt overhead these estimates miss
MIN_CHUNK_CHARS = 80        # ~one short sentence; below this prosody suffers badly
MIN_GEN_FRAMES = 64         # ~5s of audio; less room than this means reject, not guess
_CHARS_PER_TOKEN = 4.0      # rough English average
_SPEECH_CHARS_PER_SEC = 14.0  # observed: 141 chars -> 8.7s, 160 chars -> 9.6s
_GEN_FRAMES_PER_CHAR = CODEC_FRAME_HZ / _SPEECH_CHARS_PER_SEC

# Idle auto-stop: RUNPOD_API_KEY/RUNPOD_POD_ID let this process stop its own
# RunPod pod once nobody's using it (paired with the Vercel api/wake.ts
# function on the frontend, which resumes it on demand). Left unset for local
# dev, where the loop below just logs once and never runs.
RUNPOD_API_KEY = os.environ.get("RUNPOD_API_KEY")
RUNPOD_POD_ID = os.environ.get("RUNPOD_POD_ID")
IDLE_CHECK_INTERVAL_MIN = float(os.environ.get("IDLE_CHECK_INTERVAL_MIN", "10"))
IDLE_STOP_THRESHOLD_MIN = float(os.environ.get("IDLE_STOP_THRESHOLD_MIN", "10"))

# Reference-audio duration bounds for new presets. ICL voice cloning gets
# unstable outside this range: too short starves the speaker encoder of
# signal; too long eats into the same max_seq_len budget generation uses and
# has been observed (empirically, this session) to cause unstable output --
# degenerate babbling that runs to the full token budget, or near-instant
# stopping -- regardless of chunk size. 23s reference clips reproduced this
# reliably at the old 15s cap. Raised to 60s by product decision (2026-07) --
# this is well past the 23s point where instability was previously observed,
# so watch for garbled/looping output on long reference clips and lower this
# again if it reproduces.
MIN_REF_AUDIO_SECS = 2.0
MAX_REF_AUDIO_SECS = 60.0
# Loose sanity check that ref_text is plausibly a transcript of ref audio,
# not a placeholder (e.g. "ZAZA" for a 23s clip). Real speech is roughly
# 12-15 chars/sec; anything under ~3 chars/sec is almost certainly wrong.
MIN_REF_TEXT_CHARS_PER_SEC = 3.0
# Upper bound on the same check. Fast English narration tops out around 20
# chars/sec; well past that means the transcript is not what was actually said
# -- in practice a whisper repetition loop duplicating a passage. An inflated
# ref_text both mis-conditions the clone and eats sequence budget (_seq_budget).
MAX_REF_TEXT_CHARS_PER_SEC = 22.0

# Time estimation: rolling average of chars/second from the last N completed
# jobs (seeded from history.json's persisted generation_s on startup so
# estimates are sane immediately after a restart, not just after the first
# job). Falls back to the empirically-established CHUNK_MAX_CHARS/85s baseline
# (~9.4 chars/sec) until enough real samples exist.
TIMING_WINDOW = 20
_FALLBACK_CHARS_PER_SEC = CHUNK_MAX_CHARS / 85.0

STYLE_INSTRUCTIONS = {
    "natural": None,
    "clear": "Speak clearly and plainly, enunciating each word.",
    "expressive": "Speak expressively, with varied and lively intonation.",
    "dramatic": "Speak dramatically, with strong emotional emphasis.",
}

STABILITY_PARAMS = {
    "stable": dict(temperature=0.5, top_p=0.85, top_k=30, do_sample=True),
    "balanced": dict(temperature=0.9, top_p=1.0, top_k=50, do_sample=True),
    "creative": dict(temperature=1.2, top_p=1.0, top_k=80, do_sample=True),
}

_tts: Optional[FasterQwen3TTS] = None
_gen_lock = threading.Lock()
_store_lock = threading.Lock()

# Set by lifespan() on successful model load; stays None (and /api/health
# reports model_loaded=false) if CUDA isn't available -- see the CUDA
# preflight check in lifespan(), which lets the process keep serving
# /api/health for the desktop launcher instead of crashing on startup.
_tts: Optional["FasterQwen3TTS"] = None

# Which device the model actually ended up on, and why. Surfaced via
# /api/health so the UI can warn that a CPU run will be extremely slow.
_device: str = "unknown"
_device_reason: str = ""

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

_timing_lock = threading.Lock()
_timing_samples: list[float] = []  # chars/second, most-recent-last, capped at TIMING_WINDOW


def _load_json(path: Path) -> list:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: Path, data: list) -> None:
    # File lock (not just the in-process _store_lock) so concurrent writers
    # across processes -- e.g. a second backend instance started by mistake --
    # can't interleave writes to the same file.
    lock = FileLock(str(path) + ".lock", timeout=10)
    with lock:
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp.replace(path)


_presets: list[dict] = _load_json(PRESETS_FILE)  # newest first
_history: list[dict] = _load_json(HISTORY_FILE)  # newest first


def _find_preset(preset_id: str) -> Optional[dict]:
    return next((p for p in _presets if p["id"] == preset_id), None)


# ---- Timing estimation ----------------------------------------------------

def _seed_timing_from_history() -> None:
    samples = []
    for entry in _history:  # newest first
        gen_s = entry.get("generation_s")
        text = entry.get("text", "")
        if gen_s and gen_s > 0 and text:
            samples.append(len(text) / gen_s)
        if len(samples) >= TIMING_WINDOW:
            break
    with _timing_lock:
        _timing_samples.extend(reversed(samples))  # oldest-of-the-seed-batch first


def _avg_chars_per_second() -> float:
    with _timing_lock:
        if not _timing_samples:
            return _FALLBACK_CHARS_PER_SEC
        return sum(_timing_samples) / len(_timing_samples)


def _record_timing_sample(char_count: int, generation_s: float) -> None:
    if generation_s <= 0 or char_count <= 0:
        return
    with _timing_lock:
        _timing_samples.append(char_count / generation_s)
        if len(_timing_samples) > TIMING_WINDOW:
            _timing_samples.pop(0)


def _estimate_seconds(char_count: int) -> float:
    rate = _avg_chars_per_second()
    return char_count / rate if rate > 0 else char_count / _FALLBACK_CHARS_PER_SEC


def _ref_seq_cost(preset: dict) -> Optional[int]:
    """Sequence positions the reference clip consumes before generation starts.

    That is its audio codes (duration x 12Hz) plus its transcript's tokens --
    both live in the same window the generated audio has to fit into. Returns
    None when the clip can't be measured, so callers fall back to the static
    budget rather than guessing.
    """
    audio_path = preset.get("audio_path")
    if not audio_path:
        return None
    try:
        duration_s = sf.info(audio_path).duration
    except Exception:
        logger.warning("Could not measure reference clip %s; using static budget", audio_path)
        return None
    ref_frames = int(duration_s * CODEC_FRAME_HZ)
    ref_text_tokens = int(len(preset.get("ref_text") or "") / _CHARS_PER_TOKEN)
    return ref_frames + ref_text_tokens


def _seq_budget(preset: dict) -> tuple[int, int]:
    """(chunk_chars, max_new_tokens) that fit alongside this preset's reference.

    Each script char costs roughly 1/_CHARS_PER_TOKEN positions of prompt AND
    _GEN_FRAMES_PER_CHAR positions of generated audio, so solve

        available = chars * (1/_CHARS_PER_TOKEN + _GEN_FRAMES_PER_CHAR)

    for chars, then give the generation whatever remains. A reference long
    enough to push chunk_chars below MIN_CHUNK_CHARS is clamped -- shorter
    chunks would hurt prosody more than the overrun they prevent.

    max_new_tokens is deliberately NOT floored at a usable minimum: when the
    clip leaves less than MIN_GEN_FRAMES of room the returned value says so and
    /api/generate rejects the job. Flooring it would reinstate the very overrun
    this function exists to prevent, and quietly reproduce the murmur-and-
    silence output all over again.
    """
    ref_cost = _ref_seq_cost(preset)
    if ref_cost is None:
        return CHUNK_MAX_CHARS, MAX_NEW_TOKENS

    available = MAX_SEQ_LEN - SEQ_SAFETY_MARGIN - ref_cost
    chunk_chars = int(available / (1 / _CHARS_PER_TOKEN + _GEN_FRAMES_PER_CHAR))
    chunk_chars = max(MIN_CHUNK_CHARS, min(CHUNK_MAX_CHARS, chunk_chars))

    max_new_tokens = min(MAX_NEW_TOKENS, int(available - chunk_chars / _CHARS_PER_TOKEN))

    if chunk_chars < CHUNK_MAX_CHARS:
        logger.info(
            "Preset %r: reference costs %d of %d sequence positions -- chunking at "
            "%d chars (max %d) and %d new tokens (max %d)",
            preset.get("name"), ref_cost, MAX_SEQ_LEN, chunk_chars, CHUNK_MAX_CHARS,
            max_new_tokens, MAX_NEW_TOKENS,
        )
    # Clamping chunk_chars up to the floor can leave fewer frames than those
    # chars actually need to be spoken, which would truncate every chunk
    # mid-sentence. Treat that as infeasible rather than shipping clipped audio.
    frames_needed = int(chunk_chars * _GEN_FRAMES_PER_CHAR)
    if max_new_tokens < frames_needed:
        max_new_tokens = min(max_new_tokens, 0)

    if max_new_tokens < MIN_GEN_FRAMES:
        logger.warning(
            "Preset %r: reference costs %d of %d sequence positions, leaving room for "
            "only %d frames of audio. Jobs using it will be rejected -- the clip needs "
            "to be shorter.",
            preset.get("name"), ref_cost, MAX_SEQ_LEN, max_new_tokens,
        )
    return chunk_chars, max_new_tokens


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


def _job_eta_seconds_locked(job_id: str) -> Optional[float]:
    job = _jobs[job_id]
    status = job["status"]
    if status in ("done", "error", "canceled"):
        return None

    total = job["total_chunks"] or 1
    done = job["chunks_done"]

    if status in ("running", "canceling"):
        # "canceling" still counts as running here -- it's mid-chunk until the
        # worker's next chunk-boundary check honors it (see _process_job), and
        # treating it as queued below would recurse into itself via
        # _current_running_job_id (this same job_id).
        elapsed = _job_elapsed_seconds_locked(job_id) or 0.0
        per_chunk = (elapsed / done) if done > 0 else (job["estimated_s"] / total)
        return max(per_chunk * (total - done), 0.0)

    # queued: wait for the running job to finish + every queued job ahead of this one
    wait = 0.0
    if _current_running_job_id is not None:
        wait += _job_eta_seconds_locked(_current_running_job_id) or 0.0
    for jid in _pending_job_ids:
        if jid == job_id:
            break
        wait += _jobs[jid]["estimated_s"]
    return wait + job["estimated_s"]


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
            "estimated_s": job["estimated_s"],
        })
    _save_json(QUEUE_FILE, records)


def _enqueue_job_locked(job_id: str, job: dict) -> None:
    _jobs[job_id] = job
    _pending_job_ids.append(job_id)
    _persist_queue_locked()
    _queue_event.set()


def _restore_queue_on_startup() -> None:
    records = _load_json(QUEUE_FILE)
    if not records:
        return
    restored = 0
    with _jobs_lock:
        for record in records:
            preset = _find_preset(record["preset_id"])
            if preset is None:
                logger.warning(
                    "Skipping queued job %s on restore -- preset %s no longer exists",
                    record["job_id"], record["preset_id"],
                )
                continue
            text = record["text"]
            # Recomputed from the preset, not read back from queue.json, so a
            # restored job chunks the same way a fresh one would.
            chunks = chunk_text(text, _seq_budget(preset)[0])
            job_id = record["job_id"]
            _jobs[job_id] = {
                # .get(), not [] -- queue.json written before the multiuser
                # migration won't have this key. Such orphaned jobs just won't
                # surface in any user's queue until migrate_to_multiuser.py runs.
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
                "estimated_s": record["estimated_s"],
            }
            _pending_job_ids.append(job_id)
            restored += 1
        if restored:
            _persist_queue_locked()
    if restored:
        logger.info("Restored %d queued job(s) from queue.json", restored)


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
    live_preset = _find_preset(job["preset_id"])
    if live_preset is None:
        with _jobs_lock:
            job.update(status="error", error="Preset was deleted before this job could run.")
            _current_running_job_id = None
            _persist_queue_locked()
        return
    preset = live_preset

    chunks = job["chunks"]
    language = job["language"]
    style = job["style"]
    stability = job["stability"]
    text = job["text"]

    logger.info(
        "Job %s: starting -- preset=%r chunks=%d style=%s stability=%s",
        job_id, preset["name"], len(chunks), style, stability,
    )

    audio_chunks: list[np.ndarray] = []
    sr: Optional[int] = None
    # Once per job, not once per chunk: it re-reads the clip's header and logs.
    max_new_tokens = _seq_budget(preset)[1]

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
        for attempt in range(2):  # one retry per chunk before giving up
            try:
                pieces: list[np.ndarray] = []
                with _gen_lock:
                    # Streaming (not the blocking generate_voice_clone) so a
                    # cancel can take effect after ~1s of audio instead of
                    # waiting for the whole (up to ~85s) chunk to finish.
                    stream = _tts.generate_voice_clone_streaming(
                        text=chunk,
                        language=language,
                        ref_audio=preset["audio_path"],
                        ref_text=preset["ref_text"],
                        instruct=STYLE_INSTRUCTIONS[style],
                        # Bounded by what the reference leaves in max_seq_len,
                        # not the static ceiling -- see _seq_budget().
                        max_new_tokens=max_new_tokens,
                        **STABILITY_PARAMS[stability],
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
                audio_arrays = [np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)]
                last_error = None
                break
            except RuntimeError as e:
                last_error = e
                logger.exception(
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
            with _jobs_lock:
                job.update(status="error", error=error_msg, finished_at=time.time())
                _current_running_job_id = None
                _persist_queue_locked()
            return

        audio_chunks.append(audio_arrays[0])
        with _jobs_lock:
            job["chunks_done"] = i + 1
        logger.info("Job %s: chunk %d/%d done", job_id, i + 1, len(chunks))

    final_audio = stitch_audio(audio_chunks, sr, gap_seconds=STITCH_GAP_SECONDS)
    out_name = f"{uuid.uuid4().hex}.mp3"
    write_mp3(final_audio, sr, str(GEN_DIR / out_name))
    audio_url = f"/audio/{out_name}"
    output_duration_s = len(final_audio) / sr
    finished_at = time.time()
    generation_s = finished_at - job["started_at"]
    logger.info(
        "Job %s: done -- %s (%.1fs audio, %.1fs generation time)",
        job_id, audio_url, output_duration_s, generation_s,
    )

    _record_timing_sample(len(text), generation_s)

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
        "estimated_s": job["estimated_s"],
        "created_at": time.time(),
    }
    with _store_lock:
        _history.insert(0, entry)
        _save_json(HISTORY_FILE, _history)

    with _jobs_lock:
        job.update(status="done", audio_url=audio_url, sample_rate=sr, finished_at=finished_at)
        _current_running_job_id = None
        _persist_queue_locked()


def _worker_loop() -> None:
    while True:
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
            logger.exception("Job %s: worker crashed unexpectedly", job_id)
            with _jobs_lock:
                _jobs[job_id].update(
                    status="error", error="Internal error -- see backend logs.", finished_at=time.time(),
                )
                global _current_running_job_id
                _current_running_job_id = None
                _persist_queue_locked()


def _stop_runpod_pod() -> bool:
    try:
        resp = requests.post(
            f"https://rest.runpod.io/v1/pods/{RUNPOD_POD_ID}/stop",
            headers={"Authorization": f"Bearer {RUNPOD_API_KEY}"},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Idle auto-stop: RunPod pod %s stop requested.", RUNPOD_POD_ID)
        return True
    except Exception:
        logger.exception("Idle auto-stop: failed to stop RunPod pod %s -- will retry next check", RUNPOD_POD_ID)
        return False


def _idle_stop_loop() -> None:
    """Stops this pod once it's been idle (no authenticated request) for
    IDLE_STOP_THRESHOLD_MIN minutes, checked every IDLE_CHECK_INTERVAL_MIN
    minutes. Never fires while a job is running or queued -- an in-flight
    generation must never be interrupted by a self-stop, even if it happens
    to run long past the idle threshold with no new requests coming in."""
    if not RUNPOD_API_KEY or not RUNPOD_POD_ID:
        logger.info(
            "RUNPOD_API_KEY/RUNPOD_POD_ID not set -- idle auto-stop disabled "
            "(expected for local dev)."
        )
        return
    logger.info(
        "Idle auto-stop enabled: checking every %.0fm, stopping after %.0fm with no "
        "authenticated requests and an empty job queue.",
        IDLE_CHECK_INTERVAL_MIN, IDLE_STOP_THRESHOLD_MIN,
    )
    while True:
        time.sleep(IDLE_CHECK_INTERVAL_MIN * 60)
        with _jobs_lock:
            busy = _current_running_job_id is not None or bool(_pending_job_ids)
        if busy:
            logger.info("Idle auto-stop: queue has active/pending jobs -- skipping check.")
            continue
        idle_for = time.time() - get_last_activity()
        if idle_for < IDLE_STOP_THRESHOLD_MIN * 60:
            continue
        logger.info(
            "Idle auto-stop: idle for %.0fm with an empty queue -- stopping pod.",
            idle_for / 60,
        )
        if _stop_runpod_pod():
            return  # pod is stopping -- nothing left to check
        # else: stop call failed (transient RunPod API error) -- loop back
        # and retry at the next check interval instead of giving up forever.


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tts

    global _device, _device_reason

    # NOT torch.cuda.is_available(): that returns True for a GPU this torch
    # build has no kernels for (e.g. a Maxwell sm_52 card under a cu128 build),
    # and the failure then surfaces as a mid-generation "no kernel image is
    # available" crash instead of at startup. resolve_device() actually runs a
    # test op, and picks CPU when the GPU can't do the work.
    _device, _device_reason = resolve_device("auto")
    if _device == "cpu":
        logger.warning(
            "No usable GPU (%s). Falling back to CPU: generation still works "
            "but is dramatically slower -- expect many minutes per chunk.",
            _device_reason,
        )
    else:
        logger.info("Using GPU: %s", _device_reason)

    _seed_timing_from_history()
    try:
        _tts = FasterQwen3TTS.from_pretrained(
            MODEL_PATH,
            device=_device,
            # On CPU the wrapper downgrades this to float32 itself.
            dtype=torch.bfloat16,
            attn_implementation="sdpa",
            max_seq_len=MAX_SEQ_LEN,
        )
    except Exception as e:
        # Fail soft, not hard: an uncaught exception here would crash uvicorn
        # before it ever binds the port, so the desktop launcher's health-poll
        # would just see "connection refused" and report a generic timeout.
        # Instead keep serving (model_loaded stays False) and drop a flag file
        # the launcher checks for a specific, actionable error message.
        logger.exception("Model failed to load")
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        (STORAGE_DIR / "cuda_error.flag").write_text(
            "Voice Clone Studio could not load the TTS model." + os.linesep * 2 + str(e),
            encoding="utf-8",
        )
        yield
        return

    _restore_queue_on_startup()
    threading.Thread(target=_worker_loop, daemon=True).start()
    threading.Thread(target=_idle_stop_loop, daemon=True).start()
    yield


# Overridable via ALLOWED_ORIGINS in backend/.env (comma-separated) -- the
# localhost default only covers the Vite dev server on the same machine.
# A RunPod (or any other) deployment reached through a different origin --
# e.g. a proxied *.proxy.runpod.net domain -- must add that origin here or
# the browser will block the frontend's authenticated API calls.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]

app = FastAPI(title="CloneVoicePrompt-style TTS API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    
)
app.mount("/audio", StaticFiles(directory=str(GEN_DIR)), name="audio")
app.mount("/refs", StaticFiles(directory=str(REF_DIR)), name="refs")


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return cleaned or "voice_clone"


@app.get("/api/download/{filename}")
def download_audio(filename: str, name: str = "voice_clone"):
    """Serve a generated clip as a renamed .mp3 download. New generations are
    written as .mp3 directly (see write_mp3 in _process_job) and are served
    as-is here. History entries from before that change still point at an
    on-disk .wav -- those get converted (via PyAV) and cached on first hit."""
    src_path = (GEN_DIR / filename).resolve()
    if (
        GEN_DIR.resolve() not in src_path.parents
        or src_path.suffix.lower() not in (".mp3", ".wav")
        or not src_path.exists()
    ):
        raise HTTPException(404, "Unknown audio file")

    if src_path.suffix.lower() == ".mp3":
        mp3_path = src_path
    else:
        mp3_path = src_path.with_suffix(".mp3")
        if not mp3_path.exists():
            try:
                wav_to_mp3(str(src_path), str(mp3_path))
            except Exception as e:
                mp3_path.unlink(missing_ok=True)
                logger.exception("Failed to convert %s to mp3", src_path)
                raise HTTPException(500, f"Could not convert audio to mp3: {e}")

    return FileResponse(
        str(mp3_path), media_type="audio/mpeg", filename=f"{_safe_filename(name)}.mp3",
    )


@app.get("/api/health")
def health():
    return {
        "model_loaded": _tts is not None,
        "sample_rate": _tts.sample_rate if _tts else None,
        "device": _device,
        "device_reason": _device_reason,
    }


@app.get("/api/languages")
def languages():
    if _tts is None:
        raise HTTPException(503, "Model not loaded yet")
    codec_language_id = _tts.model.model.config.talker_config.codec_language_id
    return {"languages": sorted(lang.capitalize() for lang in codec_language_id.keys())}


@app.get("/api/estimate")
def estimate(chars: int) -> dict:
    """Lightweight estimate for a given character count, using the same
    rolling average as job submission -- lets the frontend show a live
    estimate while the user is still typing, without spamming /api/generate."""
    return {"estimated_s": _estimate_seconds(max(chars, 0))}


def _preset_response(preset: dict) -> dict:
    """Add fields derivable/servable at read time without persisting them
    redundantly (preview_url is just the reference file exposed over HTTP)."""
    return {**preset, "preview_url": f"/refs/{Path(preset['audio_path']).name}"}


@app.get("/api/presets")
def list_presets(user_id: str = Depends(get_current_user)):
    return {"presets": [_preset_response(p) for p in _presets if p.get("user_id") == user_id]}


@app.post("/api/presets")
async def create_preset(
    audio: UploadFile = File(...),
    name: str = Form(...),
    ref_text: str = Form(""),
    language: str = Form("English"),
    tag: str = Form(""),
    user_id: str = Depends(get_current_user),
):
    name = name.strip()
    ref_text = ref_text.strip()
    tag = tag.strip()
    if not name:
        raise HTTPException(400, "name is required")

    preset_id = uuid.uuid4().hex
    ext = Path(audio.filename or "ref.wav").suffix or ".wav"
    dest = REF_DIR / f"{preset_id}{ext}"
    dest.write_bytes(await audio.read())

    try:
        duration_s = sf.info(str(dest)).duration
    except Exception as e:
        dest.unlink(missing_ok=True)
        logger.exception("Failed to read reference audio for preset %r", name)
        raise HTTPException(400, f"Could not read reference audio file: {e}")

    if duration_s < MIN_REF_AUDIO_SECS:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"Reference audio is {duration_s:.1f}s, too short (minimum {MIN_REF_AUDIO_SECS}s) "
            "for reliable voice cloning.",
        )
    if duration_s > MAX_REF_AUDIO_SECS:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"Reference audio is {duration_s:.1f}s, too long (maximum {MAX_REF_AUDIO_SECS}s) -- "
            "longer reference clips have been observed to produce unstable/garbled generation "
            "on this model. Trim to a shorter, clean clip.",
        )

    if not ref_text:
        try:
            logger.info("Auto-transcribing reference audio for preset %r with faster-whisper", name)
            ref_text = _transcribe_audio(str(dest))
        except Exception as e:
            dest.unlink(missing_ok=True)
            logger.exception("Auto-transcription failed for preset %r", name)
            raise HTTPException(400, f"Auto-transcription failed: {e}. Provide ref_text manually.")
        if not ref_text:
            dest.unlink(missing_ok=True)
            raise HTTPException(
                400,
                "Auto-transcription produced empty text -- the clip may be silent or unclear. "
                "Provide ref_text manually.",
            )

    if len(ref_text) / duration_s < MIN_REF_TEXT_CHARS_PER_SEC:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"ref_text ({len(ref_text)} chars) looks too short to be an accurate transcript of "
            f"{duration_s:.1f}s of audio. ref_text must be the exact transcript of what's spoken "
            "in the reference clip -- a mismatched transcript causes unstable voice cloning.",
        )

    if len(ref_text) / duration_s > MAX_REF_TEXT_CHARS_PER_SEC:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"ref_text ({len(ref_text)} chars for {duration_s:.1f}s = "
            f"{len(ref_text)/duration_s:.0f} chars/sec) is too long to be an accurate "
            "transcript -- nobody speaks that fast. Usually this means a repeated or "
            "duplicated passage. Trim it to exactly what is spoken in the clip.",
        )

    logger.info(
        "Creating preset %r: duration=%.1fs ref_text_len=%d language=%s",
        name, duration_s, len(ref_text), language,
    )

    preset = {
        "id": preset_id,
        "user_id": user_id,
        "name": name,
        "language": language,
        "ref_text": ref_text,
        "audio_path": str(dest),
        "tag": tag,
        "is_builtin": False,
        "created_at": time.time(),
    }
    with _store_lock:
        _presets.insert(0, preset)
        _save_json(PRESETS_FILE, _presets)
    return _preset_response(preset)


@app.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str, user_id: str = Depends(get_current_user)):
    preset = _find_preset(preset_id)
    if preset is None or preset.get("user_id") != user_id:
        raise HTTPException(404, "Unknown preset_id")
    with _store_lock:
        _presets.remove(preset)
        _save_json(PRESETS_FILE, _presets)
    Path(preset["audio_path"]).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/history")
def list_history(user_id: str = Depends(get_current_user)):
    return {"history": [h for h in _history if h.get("user_id") == user_id]}


@app.delete("/api/history/{entry_id}")
def delete_history_entry(entry_id: str, user_id: str = Depends(get_current_user)):
    entry = next((h for h in _history if h["id"] == entry_id), None)
    if entry is None or entry.get("user_id") != user_id:
        raise HTTPException(404, "Unknown history entry_id")
    with _store_lock:
        _history.remove(entry)
        _save_json(HISTORY_FILE, _history)
    audio_url = entry.get("audio_url", "")
    if audio_url.startswith("/audio/"):
        wav_path = GEN_DIR / audio_url.removeprefix("/audio/")
        wav_path.unlink(missing_ok=True)
        wav_path.with_suffix(".mp3").unlink(missing_ok=True)
    return {"ok": True}


class GenerateRequest(BaseModel):
    preset_id: str
    text: str
    language: str = "English"
    style: str = "natural"
    stability: str = "balanced"


class GenerateJobStart(BaseModel):
    job_id: str
    total_chunks: int
    estimated_s: float
    queue_position: int


class JobStatusResponse(BaseModel):
    status: str  # "queued" | "running" | "done" | "error" | "canceled"
    chunks_done: int
    total_chunks: int
    audio_url: Optional[str] = None
    sample_rate: Optional[int] = None
    error: Optional[str] = None
    estimated_s: Optional[float] = None
    elapsed_s: Optional[float] = None
    eta_s: Optional[float] = None
    queue_position: Optional[int] = None


class QueueEntry(BaseModel):
    job_id: str
    preset_name: str
    text_preview: str
    status: str
    chunks_done: int
    total_chunks: int
    estimated_s: Optional[float] = None
    elapsed_s: Optional[float] = None
    eta_s: Optional[float] = None
    queue_position: Optional[int] = None
    submitted_at: float
    audio_url: Optional[str] = None
    error: Optional[str] = None


class ReorderRequest(BaseModel):
    job_ids: list[str]


def _job_status_response_locked(job_id: str) -> JobStatusResponse:
    job = _jobs[job_id]
    return JobStatusResponse(
        status=job["status"],
        chunks_done=job["chunks_done"],
        total_chunks=job["total_chunks"],
        audio_url=job.get("audio_url"),
        sample_rate=job.get("sample_rate"),
        error=job.get("error"),
        estimated_s=job.get("estimated_s"),
        elapsed_s=_job_elapsed_seconds_locked(job_id),
        eta_s=_job_eta_seconds_locked(job_id),
        queue_position=_queue_position_locked(job_id),
    )


def _queue_entry_locked(job_id: str) -> QueueEntry:
    job = _jobs[job_id]
    text = job["text"]
    return QueueEntry(
        job_id=job_id,
        preset_name=job["preset_name"],
        text_preview=(text[:80] + "...") if len(text) > 80 else text,
        status=job["status"],
        chunks_done=job["chunks_done"],
        total_chunks=job["total_chunks"],
        estimated_s=job.get("estimated_s"),
        elapsed_s=_job_elapsed_seconds_locked(job_id),
        eta_s=_job_eta_seconds_locked(job_id),
        queue_position=_queue_position_locked(job_id),
        submitted_at=job["submitted_at"],
        audio_url=job.get("audio_url"),
        error=job.get("error"),
    )


@app.post("/api/generate", status_code=202)
def generate(req: GenerateRequest, user_id: str = Depends(get_current_user)) -> GenerateJobStart:
    if _tts is None:
        raise HTTPException(503, "Model not loaded yet")
    preset = _find_preset(req.preset_id)
    if preset is None or preset.get("user_id") != user_id:
        raise HTTPException(404, "Unknown preset_id -- create a preset first")
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text is required")
    if len(text) > MAX_TOTAL_CHARS:
        raise HTTPException(
            400,
            f"Script too long ({len(text)} > {MAX_TOTAL_CHARS} chars).",
        )
    style = req.style.lower()
    stability = req.stability.lower()
    if style not in STYLE_INSTRUCTIONS:
        raise HTTPException(400, f"Unknown style '{req.style}'")
    if stability not in STABILITY_PARAMS:
        raise HTTPException(400, f"Unknown stability '{req.stability}'")

    chunk_chars, max_new_tokens = _seq_budget(preset)
    if max_new_tokens < MIN_GEN_FRAMES:
        raise HTTPException(
            400,
            f"Preset '{preset['name']}' has a reference clip long enough to fill the "
            f"model's {MAX_SEQ_LEN}-position window on its own, leaving no room to "
            "generate speech. Create a preset from a shorter clip (10-20s works well).",
        )

    chunks = chunk_text(text, chunk_chars)
    estimated_s = _estimate_seconds(len(text))
    job_id = uuid.uuid4().hex
    job = {
        "user_id": user_id,
        "status": "queued",
        "preset_id": preset["id"],
        "preset_name": preset["name"],
        "text": text,
        "language": req.language,
        "style": style,
        "stability": stability,
        "chunks": chunks,
        "chunks_done": 0,
        "total_chunks": len(chunks),
        "audio_url": None,
        "sample_rate": None,
        "error": None,
        "submitted_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "estimated_s": estimated_s,
    }
    with _jobs_lock:
        _enqueue_job_locked(job_id, job)
        position = _queue_position_locked(job_id)

    return GenerateJobStart(
        job_id=job_id, total_chunks=len(chunks), estimated_s=estimated_s, queue_position=position,
    )


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, user_id: str = Depends(get_current_user)) -> JobStatusResponse:
    with _jobs_lock:
        if job_id not in _jobs or _jobs[job_id].get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        return _job_status_response_locked(job_id)


@app.get("/api/queue")
def list_queue(user_id: str = Depends(get_current_user)) -> dict:
    with _jobs_lock:
        entries = [
            _queue_entry_locked(job_id)
            for job_id, job in _jobs.items()
            if job.get("user_id") == user_id
        ]
        # _jobs dict order is submission order, not processing order -- sort
        # queued entries by their real position in _pending_job_ids so the
        # list actually reflects /api/queue/reorder (non-queued entries keep
        # their relative order via the stable sort's shared key).
        entries.sort(key=lambda e: e.queue_position if e.queue_position is not None else -1)
    return {"queue": entries}


@app.post("/api/queue/{job_id}/cancel")
def cancel_queued_job(job_id: str, user_id: str = Depends(get_current_user)):
    with _jobs_lock:
        if job_id not in _jobs or _jobs[job_id].get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        job = _jobs[job_id]
        if job_id in _pending_job_ids:
            _pending_job_ids.remove(job_id)
            job.update(status="canceled", finished_at=time.time())
            _persist_queue_locked()
        elif job_id == _current_running_job_id and job["status"] == "running":
            # Not canceled yet -- _process_job's chunk loop notices this and
            # finishes the cancellation (see the "canceling" check there).
            job["status"] = "canceling"
        else:
            raise HTTPException(
                400, "Only a queued or currently-processing job can be canceled.",
            )
    return {"ok": True}


@app.delete("/api/queue/{job_id}")
def delete_job(job_id: str, user_id: str = Depends(get_current_user)):
    """Removes a dead job (canceled/error) from the in-memory queue list --
    "done" jobs already have their own delete via /api/history, so aren't
    handled here to avoid double-managing the same audio file."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        if job["status"] not in ("canceled", "error"):
            raise HTTPException(400, "Only a canceled or failed job can be deleted.")
        del _jobs[job_id]
    return {"ok": True}


@app.post("/api/queue/reorder")
def reorder_queue(req: ReorderRequest, user_id: str = Depends(get_current_user)):
    with _jobs_lock:
        owned_pending = [jid for jid in _pending_job_ids if _jobs[jid].get("user_id") == user_id]
        if set(req.job_ids) != set(owned_pending):
            raise HTTPException(
                400,
                "job_ids must be exactly the set of currently queued (not yet started) job ids.",
            )
        # Splice this user's jobs back into their own slots in the new order,
        # preserving the relative position of every other user's queued jobs
        # (the FIFO queue is shared, so reordering must not let one user's
        # request move another user's job earlier or later).
        new_order = iter(req.job_ids)
        _pending_job_ids[:] = [
            next(new_order) if _jobs[jid].get("user_id") == user_id else jid
            for jid in _pending_job_ids
        ]
        _persist_queue_locked()
    return {"ok": True}


# ---- Frontend (production) --------------------------------------------------
# Serves the built React app so a deployed pod's single exposed port is the
# only origin the browser ever talks to. Registered last -- Starlette checks
# routes in registration order and stops at the first match, so every
# /api/*, /audio/*, and /refs/* route above always wins first; this can never
# shadow them. Only activates when frontend/dist exists (i.e. `npm run build`
# has run) -- in local dev, where Vite's own dev server handles the frontend
# on :5173, frontend/dist doesn't exist and this block never registers.
if getattr(sys, "frozen", False):
    # Frozen: the built frontend is bundled inside the onedir bundle itself
    # (see backend.spec's `datas`), which for a non-onefile build is just the
    # folder containing backend.exe (sys._MEIPASS points there).
    FRONTEND_DIST = Path(sys._MEIPASS) / "frontend_dist"
else:
    FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIST.is_dir():

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            # A genuinely unmatched /api/* path -- report a real 404 instead
            # of silently handing back index.html and masking the bug.
            raise HTTPException(404, "Not Found")

        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and FRONTEND_DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)

        # Everything else -- including client-side routes like /studio,
        # /sign-in, /sign-up -- falls through to index.html; React Router
        # takes over from there.
        return FileResponse(FRONTEND_DIST / "index.html")
