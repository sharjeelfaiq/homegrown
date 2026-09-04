"""
Small local utilities for the /qwen CUDA-graph wrapper.
"""
from __future__ import annotations

import contextlib
import warnings


@contextlib.contextmanager
def suppress_flash_attn_warning():
    """
    Suppress noisy Flash Attention dtype warnings during model loading.

    The wrapper still passes dtype explicitly. This only keeps logs cleaner.
    """
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=".*Flash Attention 2.*",
            category=Warning,
        )
        warnings.filterwarnings(
            "ignore",
            message=".*You are attempting to use Flash Attention.*",
            category=Warning,
        )
        yield
