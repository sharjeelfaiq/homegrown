"""Environment, paths and generation limits."""
import logging
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parents[1]
from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(REPO_ROOT / "engine"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("homegrown")


# Overridable via MODEL_PATH in services/voice-api/.env -- the default below only holds
# on the original dev machine's local model cache. Any other host (including
# a separate environment) must set MODEL_PATH to wherever it downloaded the snapshot.
MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    r"D:\models_cache\models--Qwen--Qwen3-TTS-12Hz-0.6B-Base\snapshots\5d83992436eae1d760afd27aff78a71d676296fc",
)


if getattr(sys, "frozen", False):
    # Frozen: __file__ points inside the PyInstaller bundle, not a writable
    # location -- use the folder next to the installed exe instead (backend.exe
    # lives in <install>/backend/, so storage/ is its sibling at <install>/storage).
    # Overridable via HOMEGROWN_STORAGE_DIR (set in the installer's .env).
    STORAGE_DIR = Path(
        os.environ.get("HOMEGROWN_STORAGE_DIR")
        # Pre-rebrand installs have the old key in their .env; honour it so an
        # in-place upgrade does not lose its storage directory.
        or os.environ.get("VOICECLONE_STORAGE_DIR")
        or str(Path(sys.executable).parent.parent / "storage")
    )
else:
    STORAGE_DIR = BACKEND_DIR / "storage"


REF_DIR = STORAGE_DIR / "references"


GEN_DIR = STORAGE_DIR / "generated"


PRESETS_FILE = STORAGE_DIR / "presets.json"


HISTORY_FILE = STORAGE_DIR / "history.json"


QUEUE_FILE = STORAGE_DIR / "queue.json"


REF_DIR.mkdir(parents=True, exist_ok=True)


GEN_DIR.mkdir(parents=True, exist_ok=True)


# Per-chunk char budget so a single chunk's prefill + decode stay within
# max_seq_len=1024 (tuned for this machine's 4GB GPU -- see
# ../../engine/qwen/HOW_TO_RUN.md). Empirically tested: 800 chars / 700 max_new_tokens
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


# The model is named "12Hz" but the real rate is 12.5: the codec decoder's
# total_upsample is 1920 samples per frame at a 24000Hz output. Using 12 here
# under-counted every reference clip by 4% and handed that back as generation
# headroom the window did not actually have.
CODEC_FRAME_HZ = 24000 / 1920  # 12.5 frames per second of audio


SEQ_SAFETY_MARGIN = 64      # absorbs tokenizer/prompt overhead these estimates miss


MIN_CHUNK_CHARS = 80        # ~one short sentence; below this prosody suffers badly


# Chunk size has a sweet spot, and the model fails in BOTH directions. Measured
# on this machine with one preset, same 378-char text, produced vs expected:
#
#     380 chars/chunk ->  89%  clauses silently dropped
#     190 chars/chunk ->  95%  complete
#     110 chars/chunk -> 151%  padded and dragging (murmur, trailing silence)
#
# So a chunk budget derived only from max_seq_len is not enough: a long
# reference clip shrinks the budget into the padding regime, which is what the
# original "murmur and long silence" reports actually were. Cap the ceiling for
# elision and warn below the floor, where the fix is a shorter reference clip
# rather than a smaller chunk.
ELISION_SAFE_CHUNK_CHARS = 200


PADDING_SAFE_MIN_CHARS = 150


MIN_GEN_FRAMES = 64         # ~5s of audio; less room than this means reject, not guess


_CHARS_PER_TOKEN = 4.0      # rough English average


# Speaking rate is NOT a constant -- it is a property of the voice being cloned,
# and the clone speaks at roughly the reference speaker's pace. Two real presets
# on this machine: 14.4 chars/sec and 11.2 chars/sec, a 29% spread. A fixed 14.0
# sized chunks to exactly fill their frame allocation, so the slower voice ran
# out of frames mid-chunk and got cut off -- audible as the same clipped/murmured
# endings the budget fix was supposed to remove, just smaller.
#
# Each preset carries what is needed to measure this: ref_text is the transcript
# of a clip of known duration, so chars/sec falls straight out. Clamped, because
# an inaccurate transcript would otherwise skew the whole budget.
_FALLBACK_SPEECH_CHARS_PER_SEC = 13.0


_MIN_SPEECH_CHARS_PER_SEC = 8.0


_MAX_SPEECH_CHARS_PER_SEC = 20.0


# Headroom on the generation side: a chunk can legitimately run slower than the
# reference's average (emphasis, a long number read out, a trailing pause), and
# the cost of over-allocating frames is nothing, while under-allocating truncates.
_GEN_SLACK = 1.15


# Extra frames allowed on top of a chunk's own estimate, as an absolute amount
# rather than a percentage. Pauses do not scale with character count: "pause...
# breathe..." is 17 characters that the model renders as several seconds of
# deliberate silence, and a purely proportional cap cut that chunk's last line
# off entirely. ~6s covers punctuation-driven pauses while still bounding a
# runaway chunk far below the job-wide allowance.
#
# 75 frames (~6s) proved too tight for a chunk that is both short and
# pause-heavy: "Finally, pause... breathe... and say this naturally: <list>" is
# 75 chars whose ellipses the model renders as ~9s of deliberate silence, so it
# ran out of frames mid-list and dropped the tail -- intermittently, since the
# same chunk succeeded on other samples. 125 frames (~10s) covers it while
# still bounding a runaway chunk to well under half the job-wide allowance.
_CHUNK_CAP_HEADROOM_FRAMES = 125


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


# A guard on the UPLOAD, nothing more. Length stopped mattering once clips are
# trimmed -- _trim_reference_clip reads only the opening, so a ten-minute file
# costs the same as a forty-second one. What still scales with the whole file
# is create_preset's `dest.write_bytes(await audio.read())`, which buffers the
# upload in memory, so some ceiling is wanted. Set well clear of any real
# recording: a cap that a genuine clip can hit defeats the trimming it sits in
# front of, which is exactly what a 120s limit did to a 123.5s file.
MAX_REF_AUDIO_SECS = 1800.0


# What actually becomes the reference clip, and the number that matters.
#
# The clip and the script share ONE MAX_SEQ_LEN window: a clip costs
# duration x CODEC_FRAME_HZ frames plus its transcript's tokens, and whatever
# is left is all the room the generated speech has. Solved against the real
# constants (_GEN_SLACK, _FALLBACK_SPEECH_CHARS_PER_SEC, SEQ_SAFETY_MARGIN):
#
#     25s -> refcost 393, avail 567, chunk_chars 200, max_new_tokens 517  OK
#     40s -> refcost 630, avail 330, chunk_chars 200, max_new_tokens 280  OK
#     44s -> refcost 693, avail 267, chunk_chars 196, max_new_tokens 218  OK
#     50s -> refcost 787, avail 173, chunk_chars 127, max_new_tokens 141  BAD
#
# 40 is the LAST comfortable value, not an arbitrary one: it still holds the
# full ELISION_SAFE_CHUNK_CHARS ceiling, 44 starts dropping below it, and 50 is
# into the PADDING_SAFE_MIN_CHARS regime this file documents as murmuring and
# dragging. Do not raise it without re-solving that table.
REF_TRIM_SECS = 40.0


# How much source to read to fill REF_TRIM_SECS of SPEECH. Internal pauses are
# packed out (see pack_speech), so a recording that is half silence needs twice
# the source to yield a full window. 4x covers a clip that is 75% dead air,
# which is about as sparse as a real voice note gets; 160s of stereo float32 at
# 48k is ~61MB, read once at upload.
REF_READ_MULTIPLE = 4.0


# Loose sanity check that ref_text is plausibly a transcript of ref audio,
# not a placeholder (e.g. "ZAZA" for a 23s clip). Real speech is roughly
# 12-15 chars/sec; anything under ~3 chars/sec is almost certainly wrong.
MIN_REF_TEXT_CHARS_PER_SEC = 3.0


# Upper bound on the same check. Fast English narration tops out around 20
# chars/sec; well past that means the transcript is not what was actually said
# -- in practice a whisper repetition loop duplicating a passage. An inflated
# ref_text both mis-conditions the clone and eats sequence budget (_seq_budget).
MAX_REF_TEXT_CHARS_PER_SEC = 22.0


# Generation time is REPORTED, never predicted. There was an estimator here --
# _JOB_OVERHEAD_S + chunks * median(seconds per chunk), scored at 22% mean error
# against history.json -- and it was retired on 2026-09-13 because a median is
# beaten by half of all jobs by construction and the measured overrun was worse
# than that: 12 of 12 jobs on one batch ran over, by 1.2x to 2.5x, none under.
#
# Chunk resampling is why the tail is so fat: _chunk_duration_is_sane resamples
# a degenerate chunk up to CHUNK_ATTEMPTS times, and a median deliberately
# discards exactly those runs (measured p90 32.4s/chunk against p50 19.3s).
#
# generation_s and total_chunks are still recorded on every history entry, so
# the raw material survives if anyone wants to try again. The full
# model-selection table is in docs/gpu-notes.md -- read it before proposing a
# replacement.

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


# Overridable via ALLOWED_ORIGINS in services/voice-api/.env (comma-separated).
# The default covers the Vite dev server on the same machine.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]



# Built Studio location differs between source and the frozen payload.
if getattr(sys, "frozen", False):
    # Frozen: the built frontend is bundled inside the onedir bundle itself
    # (see backend.spec's `datas`), which for a non-onefile build is just the
    # folder containing backend.exe (sys._MEIPASS points there).
    FRONTEND_DIST = Path(sys._MEIPASS) / "frontend_dist"
else:
    FRONTEND_DIST = REPO_ROOT / "apps" / "studio" / "dist"
