"""Experimental bounded assembly; not enabled in ordinary generation.

The October 2026 measurements did not justify retaining this speed change.
Kept here solely for reproducible microbenchmarks and exact-input replay.
"""
import torch


class CodecHistory:
    def __init__(self, context_frames=25):
        self.context_frames = context_frames
        self.total_frames = 0
        self._pieces = []
        self._tail = None

    def append(self, piece, calibrated):
        self.total_frames += piece.shape[0]
        if calibrated:
            assembled = torch.cat((self._tail, piece), dim=0)
            self._pieces.clear()
        else:
            self._pieces.append(piece)
            assembled = torch.cat(self._pieces, dim=0)
        # Clone so the tail does not retain the entire assembled storage.
        self._tail = assembled[-self.context_frames:].clone()
        return assembled
