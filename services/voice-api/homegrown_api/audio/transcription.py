"""Audio transcription"""
import homegrown_api.config as config
import logging
import threading
from pathlib import Path
from typing import Optional
import soundfile as sf

import homegrown_api.audio.convert as audio_convert
import homegrown_api.audio.stitcher as audio_stitcher


_whisper_model = None


_whisper_lock = threading.Lock()


def _transcribe_audio(path: str) -> tuple[str, str]:
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
        segments, info = _whisper_model.transcribe(
            path, condition_on_previous_text=False, vad_filter=True,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        # Whisper detects the language as a side effect of transcribing, so the
        # voice can carry the language of its own recording instead of asking
        # the user to declare it.
        return text, (info.language or "")


def _trim_reference_clip(path: str, keep_secs: float) -> Optional[tuple[Path, float]]:
    """Cut a long upload down to the first `keep_secs` of speech, in place.

    Returns (new_path, new_duration). The path changes because write_mp3 goes
    through PyAV, which picks its container from the FILE EXTENSION -- handed a
    .wav path it happily writes a RIFF/WAVE container wrapping an MP3 stream,
    which soundfile then reports as `format=WAV subtype=MPEG_LAYER_III`. Odd
    rather than broken, but the file would be lying about itself, so the
    trimmed clip is always written as .mp3 and the caller re-points at it.

    Leading silence goes first (via trim_edge_silence, the same helper the
    generated chunks use), so a recording that opens with two seconds of room
    tone does not spend them here.

    Deliberately the FIRST N seconds rather than the loudest window: the user
    can predict what was used and re-cut the file by hand if they disagree,
    which a similarity-scored scan would not allow.

    Must run BEFORE transcription. ref_text has to describe the audio the model
    will actually be conditioned on -- _ref_profile derives the speaker's
    chars/sec from len(ref_text)/duration, and that rate sizes every chunk. A
    transcript of the original two minutes against a 25s clip would report a
    speaking rate roughly 5x too high.
    """
    # Bounded: read the opening, never the whole file. Verified that
    # soundfile's `frames=` works on MP3 and returns the exact prefix, so an
    # upload of any length costs the same here as a short one. This is what
    # lets MAX_REF_AUDIO_SECS be a formality rather than a gate.
    sample_rate = sf.info(path).samplerate
    want = int(keep_secs * config.REF_READ_MULTIPLE * sample_rate)
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=False, frames=want)
    if audio.ndim > 1:
        # write_mp3 wants mono; a stereo upload arrives as (n, channels).
        audio = audio.mean(axis=1)

    audio = audio_stitcher.trim_edge_silence(audio, sample_rate)
    # Then the pauses INSIDE it. The window is charged by duration, so silence
    # in the middle costs exactly as much sequence budget as speech and teaches
    # the clone nothing.
    audio = audio_stitcher.pack_speech(audio, sample_rate)
    if audio.size == 0:
        return None
    keep = int(keep_secs * sample_rate)
    # Trimming the silence alone may already have brought it under the cap.
    audio = audio[:keep] if audio.size > keep else audio

    source = Path(path)
    dest = source.with_suffix(".mp3")
    audio_convert.write_mp3(audio, sample_rate, str(dest))
    if dest != source:
        source.unlink(missing_ok=True)
    return dest, audio.size / sample_rate


logging.basicConfig(level=logging.INFO)
