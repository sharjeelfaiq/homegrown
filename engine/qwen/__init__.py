"""
Local Qwen3-TTS CUDA graph acceleration package.

Expected sibling files supplied by the faster-qwen implementation:
- predictor_graph.py
- talker_graph.py

This package provides:
- FasterQwen3TTS: a generate_voice_clone-compatible wrapper.
"""
from .faster_qwen3_tts import FasterQwen3TTS

__all__ = ["FasterQwen3TTS"]
