"""Concatenates per-chunk audio arrays into one output, with a silence gap
between chunks to avoid clicky seams at chunk boundaries."""
import numpy as np

# Chunk edges are trimmed before the gap is inserted. The model pads the end of
# a chunk with silence before it stops, and sometimes leads with silence too.
# Left alone those stack with the deliberate gap and with the next chunk's own
# lead-in, turning every chunk boundary into several seconds of dead air --
# reported from listening as "a 3-4 second pause after 'occasional showers'",
# which is exactly where one chunk ended and the next began. Trimming the edges
# leaves gap_seconds as the only pause, which is the point of it.
_TRIM_WINDOW_SECONDS = 0.02
# Below this RMS is silence worth removing. Deliberately well under speech level
# (0.02-0.06 in practice) so a soft consonant onset is never mistaken for it.
_TRIM_THRESHOLD = 0.008
# Kept either side of the speech so onsets/decays are not clipped.
_TRIM_PAD_SECONDS = 0.06


def trim_edge_silence(chunk: np.ndarray, sample_rate: int) -> np.ndarray:
    """Strip leading/trailing near-silence from one chunk's audio.

    Returns the chunk unchanged when it is entirely quiet -- a chunk that is all
    silence is a generation failure, and silently dropping it to zero length
    would hide that rather than surface it.
    """
    if chunk.size == 0:
        return chunk

    window = max(1, int(_TRIM_WINDOW_SECONDS * sample_rate))
    count = chunk.size // window
    if count == 0:
        return chunk

    rms = np.sqrt((chunk[: count * window].reshape(count, window) ** 2).mean(axis=1))
    loud = np.flatnonzero(rms > _TRIM_THRESHOLD)
    if loud.size == 0:
        return chunk

    pad = int(_TRIM_PAD_SECONDS * sample_rate)
    start = max(0, loud[0] * window - pad)
    end = min(chunk.size, (loud[-1] + 1) * window + pad)
    return chunk[start:end]


def stitch_audio(chunks: list[np.ndarray], sample_rate: int, gap_seconds: float = 0.2) -> np.ndarray:
    if not chunks:
        return np.zeros(0, dtype=np.float32)

    trimmed = [trim_edge_silence(c, sample_rate) for c in chunks]
    if len(trimmed) == 1:
        return trimmed[0]

    gap = np.zeros(int(gap_seconds * sample_rate), dtype=np.float32)
    parts = [trimmed[0]]
    for chunk in trimmed[1:]:
        parts.append(gap)
        parts.append(chunk)
    return np.concatenate(parts)
