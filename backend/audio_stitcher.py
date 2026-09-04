"""Concatenates per-chunk audio arrays into one output, with a silence gap
between chunks to avoid clicky seams at chunk boundaries."""
import numpy as np


def stitch_audio(chunks: list[np.ndarray], sample_rate: int, gap_seconds: float = 0.2) -> np.ndarray:
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    if len(chunks) == 1:
        return chunks[0]

    gap = np.zeros(int(gap_seconds * sample_rate), dtype=np.float32)
    parts = [chunks[0]]
    for chunk in chunks[1:]:
        parts.append(gap)
        parts.append(chunk)
    return np.concatenate(parts)
