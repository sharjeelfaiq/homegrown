"""Generation budget"""
import homegrown_api.config as config
import threading
from typing import NamedTuple, Optional
import soundfile as sf

import homegrown_api.persistence.media_paths as persistence_media_paths
import homegrown_api.persistence.stores as persistence_stores


# ---- Timing estimation ----------------------------------------------------


def _ref_profile(preset: dict) -> Optional[tuple[int, float]]:
    """(sequence positions the reference consumes, that speaker's chars/sec).

    The cost is its audio codes (duration x 12Hz) plus its transcript's tokens --
    both live in the same window the generated audio has to fit into. The rate
    comes free from the same two numbers: ref_text is a transcript of a clip of
    known length, and the clone speaks at roughly the reference's pace.

    Returns None when the clip can't be measured, so callers fall back to the
    static budget rather than guessing.
    """
    try:
        duration_s = sf.info(persistence_stores._reference_path(preset)).duration
    except Exception:
        config.logger.warning("Could not measure reference clip %s; using static budget", preset.get("audio_path"))
        return None
    if duration_s <= 0:
        return None

    ref_text = preset.get("ref_text") or ""
    ref_frames = int(duration_s * config.CODEC_FRAME_HZ)
    ref_text_tokens = int(len(ref_text) / config._CHARS_PER_TOKEN)

    rate = len(ref_text) / duration_s if ref_text else config._FALLBACK_SPEECH_CHARS_PER_SEC
    rate = min(config._MAX_SPEECH_CHARS_PER_SEC, max(config._MIN_SPEECH_CHARS_PER_SEC, rate))
    return ref_frames + ref_text_tokens, rate


class _Budget(NamedTuple):
    """What fits alongside a preset's reference clip.

    Indexable, so existing budget[0]/budget[1] call sites keep working.
    frames_per_char is carried so per-chunk caps can be derived from it -- see
    _chunk_token_cap(), which is what stops a short chunk from babbling into a
    job-sized allowance.
    """
    chunk_chars: int
    max_new_tokens: int
    frames_per_char: float


# A chunk whose audio lands outside this fraction of its expected duration is
# treated as a bad sample and regenerated. Some chunks are simply unstable on
# this model: the final chunk of the standard test script, generated six times
# with identical settings, produced 115%, 105%, 233%, 177%, 96% and 94% of its
# expected length -- roughly a third of samples degenerate, and the failures
# either babble (a hallucinated sentence that is nowhere in the script) or stop
# short. Punctuation is not the trigger; stripping markdown and smart quotes
# changed nothing. Since the failure is stochastic rather than systematic, no
# parameter fixes it and resampling does. Good and bad samples separate cleanly,
# which is what makes this checkable at all.
#
# Measure the TRIMMED audio. The model pads chunk edges with silence that
# stitch_audio removes anyway, and judging the raw output counts that padding
# as if it were babble: one healthy preset produced 8.8s raw for a 46-char
# chunk that trimmed down to 4.9s. Checking raw output condemned good chunks.
_CHUNK_MIN_DURATION_RATIO = 0.6


_CHUNK_MAX_DURATION_RATIO = 1.6


CHUNK_ATTEMPTS = 3


def _chunk_duration_is_sane(audio_len: int, sample_rate: int, budget: _Budget, chunk: str) -> bool:
    """False when a chunk's audio is too far from what its text should take."""
    if not chunk or sample_rate <= 0 or audio_len <= 0:
        return True  # nothing to judge; let the normal paths handle it
    expected = len(chunk) * budget.frames_per_char / config.CODEC_FRAME_HZ
    if expected <= 0:
        return True
    ratio = (audio_len / sample_rate) / expected
    return _CHUNK_MIN_DURATION_RATIO <= ratio <= _CHUNK_MAX_DURATION_RATIO


def _chunk_token_cap(budget: _Budget, chunk: str) -> int:
    """Frame cap for ONE chunk, sized to that chunk's own text.

    The job-level max_new_tokens is sized for a full chunk_chars chunk. Handing
    that same allowance to a short final chunk lets the model keep generating
    long after it has said its line: observed as 33s of murmur appended to a
    finished 82s read, ending exactly at the job cap (470 frames / 12.5Hz =
    37.6s). Bounding each chunk by its own length caps that overrun at _GEN_SLACK.
    """
    needed = int(len(chunk) * budget.frames_per_char * config._GEN_SLACK) + config._CHUNK_CAP_HEADROOM_FRAMES
    return max(config.MIN_GEN_FRAMES, min(budget.max_new_tokens, needed))


def _compute_seq_budget(preset: dict) -> _Budget:
    """(chunk_chars, max_new_tokens, frames_per_char) for this preset's reference.

    Each script char costs roughly 1/_CHARS_PER_TOKEN positions of prompt AND
    frames_per_char positions of generated audio, so solve

        available = chars * (1/_CHARS_PER_TOKEN + frames_per_char * _GEN_SLACK)

    for chars, then give the generation whatever remains. frames_per_char comes
    from THIS preset's measured speaking rate, not a constant -- see
    _ref_profile(). A reference long
    enough to push chunk_chars below MIN_CHUNK_CHARS is clamped -- shorter
    chunks would hurt prosody more than the overrun they prevent.

    max_new_tokens is deliberately NOT floored at a usable minimum: when the
    clip leaves less than MIN_GEN_FRAMES of room the returned value says so and
    /api/generate rejects the job. Flooring it would reinstate the very overrun
    this function exists to prevent, and quietly reproduce the murmur-and-
    silence output all over again.
    """
    profile = _ref_profile(preset)
    if profile is None:
        return _Budget(
            config.CHUNK_MAX_CHARS, config.MAX_NEW_TOKENS,
            config.CODEC_FRAME_HZ / config._FALLBACK_SPEECH_CHARS_PER_SEC,
        )
    ref_cost, rate = profile
    frames_per_char = config.CODEC_FRAME_HZ / rate

    available = config.MAX_SEQ_LEN - config.SEQ_SAFETY_MARGIN - ref_cost
    chunk_chars = int(available / (1 / config._CHARS_PER_TOKEN + frames_per_char * config._GEN_SLACK))
    # Two independent ceilings: what the window can hold, and what the model
    # reads without skipping. The lower one wins.
    chunk_chars = min(chunk_chars, config.ELISION_SAFE_CHUNK_CHARS)
    chunk_chars = max(config.MIN_CHUNK_CHARS, min(config.CHUNK_MAX_CHARS, chunk_chars))

    max_new_tokens = min(config.MAX_NEW_TOKENS, int(available - chunk_chars / config._CHARS_PER_TOKEN))

    if chunk_chars < config.CHUNK_MAX_CHARS:
        config.logger.info(
            "Preset %r: reference costs %d of %d sequence positions at %.1f chars/sec "
            "-- chunking at %d chars (max %d) and %d new tokens (max %d)",
            preset.get("name"), ref_cost, config.MAX_SEQ_LEN, rate, chunk_chars, config.CHUNK_MAX_CHARS,
            max_new_tokens, config.MAX_NEW_TOKENS,
        )
    # Clamping chunk_chars up to the floor can leave fewer frames than those
    # chars actually need to be spoken, which would truncate every chunk
    # mid-sentence. Treat that as infeasible rather than shipping clipped audio.
    frames_needed = int(chunk_chars * frames_per_char)
    if max_new_tokens < frames_needed:
        max_new_tokens = min(max_new_tokens, 0)

    if chunk_chars < config.PADDING_SAFE_MIN_CHARS:
        config.logger.warning(
            "Preset %r: reference costs %d of %d positions, forcing %d-char chunks -- "
            "below the ~%d-char point where this model starts padding output with "
            "murmur and trailing silence. Re-create the preset from a shorter "
            "reference clip (10-20s) to get usable chunk sizes.",
            preset.get("name"), ref_cost, config.MAX_SEQ_LEN, chunk_chars, config.PADDING_SAFE_MIN_CHARS,
        )

    if max_new_tokens < config.MIN_GEN_FRAMES:
        config.logger.warning(
            "Preset %r: reference costs %d of %d sequence positions, leaving room for "
            "only %d frames of audio. Jobs using it will be rejected -- the clip needs "
            "to be shorter.",
            preset.get("name"), ref_cost, config.MAX_SEQ_LEN, max_new_tokens,
        )
    return _Budget(chunk_chars, max_new_tokens, frames_per_char)


class _RefFacts(NamedTuple):
    """Everything a preset's reference clip decides, computed once together.

    ref_seconds is carried alongside the budget rather than read separately
    because both come from the same sf.info() call, and both are now wanted on
    the same request: /api/presets reports the clip length AND the chunk size it
    forces, so a voice cloned from an over-long clip is visible before it costs
    anyone a render.
    """
    ref_seconds: Optional[float]
    budget: _Budget


# Memoised because _compute_seq_budget is not cheap and is called a lot:
# /api/estimate runs it per keystroke (400ms debounce) and /api/presets now runs
# it once per voice per list. Each call is an sf.info() header read plus an INFO
# and possibly a WARNING log line, so without this the log fills with the same
# sentence about the same preset hundreds of times and says nothing new.
_ref_facts_cache: dict[tuple, _RefFacts] = {}


_ref_facts_lock = threading.Lock()


# Keyed by path+mtime, so a deleted or re-created preset leaves its old entry
# behind. Presets number in the tens, so this only matters over a very long
# uptime; drop the whole cache rather than track ages.
_REF_FACTS_CACHE_MAX = 256


def _ref_cache_key(preset: dict) -> Optional[tuple]:
    """Cache identity for a preset's reference clip, or None if unreadable.

    mtime is enough to invalidate: a reference clip is immutable once the preset
    is saved -- trimming happens during create, before the write -- and
    PATCH /api/presets/{id} only ever touches `name`. ref_text length is in the
    key anyway because the speaking rate derives from it, and a rate change
    resizes every chunk.
    """
    try:
        path = persistence_stores._reference_path(preset)
        mtime = path.stat().st_mtime_ns
    except (persistence_media_paths.StoredMediaPathError, OSError):
        return None
    return (path, mtime, len(preset.get("ref_text") or ""))


def _ref_facts(preset: dict) -> _RefFacts:
    key = _ref_cache_key(preset)
    if key is not None:
        with _ref_facts_lock:
            hit = _ref_facts_cache.get(key)
        if hit is not None:
            return hit

    try:
        ref_seconds = round(sf.info(persistence_stores._reference_path(preset)).duration, 1)
    except Exception:
        # Not fatal, and deliberately not logged here: _compute_seq_budget hits
        # the same file next and logs its own warning before falling back to the
        # static budget.
        ref_seconds = None
    facts = _RefFacts(ref_seconds, _compute_seq_budget(preset))

    if key is not None:
        with _ref_facts_lock:
            if len(_ref_facts_cache) >= _REF_FACTS_CACHE_MAX:
                _ref_facts_cache.clear()
            _ref_facts_cache[key] = facts
    return facts


def _seq_budget(preset: dict) -> _Budget:
    """Memoised _compute_seq_budget. Call this, not the uncached one."""
    return _ref_facts(preset).budget
