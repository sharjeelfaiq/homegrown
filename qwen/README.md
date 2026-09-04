# FasterQwen3TTS

CUDA-graph-accelerated wrapper around [`qwen-tts`](https://github.com/QwenLM/Qwen3-TTS)'s `Qwen3TTSModel`. Captures the talker's decode step and the code predictor's 15-codebook loop as CUDA graphs for ~6-10x faster autoregressive TTS generation, while keeping the same generation API (voice cloning, custom voice, voice design).

## Requirements

- NVIDIA GPU + CUDA-enabled PyTorch build (CPU is not supported — `from_pretrained` raises if CUDA isn't available)
- `torch`
- `transformers` (a recent version providing `transformers.masking_utils.create_causal_mask` / `create_sliding_window_causal_mask`)
- `qwen-tts` (`pip install -U qwen-tts`) — provides `Qwen3TTSModel` and the underlying model/tokenizer implementation
- `numpy`
- `soundfile` (requires system `libsndfile`)

```bash
pip install -U qwen-tts torch transformers numpy soundfile
```

## External services / API requirements

**None required for normal use.** This code makes no direct calls to any LLM, TTS, or cloud API, and reads no API keys or env vars.

The only implicit external dependency: `FasterQwen3TTS.from_pretrained(model_name, ...)` passes `model_name` straight to `qwen_tts.Qwen3TTSModel.from_pretrained`. If `model_name` is a Hugging Face Hub id (e.g. `"Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"`) rather than a local directory, `qwen-tts` will download weights from the Hub the first time it runs:

- Public models: no auth needed, just network access.
- Gated/private models: requires a Hugging Face token, either via `huggingface-cli login` or the `HF_TOKEN` env var, before calling `from_pretrained`.

To avoid any network/API dependency at runtime, pre-download the model and pass a local directory path as `model_name` instead.

## Files

| File | Purpose |
|---|---|
| `faster_qwen3_tts.py` | `FasterQwen3TTS` wrapper class — public API |
| `predictor_graph.py` | CUDA graph capture for the code predictor's 15-step codebook decode |
| `talker_graph.py` | CUDA graph capture for the talker's single-token decode step |
| `generate.py` | Non-streaming generation loop (`fast_generate`) |
| `sampling.py` | Shared logits sampling / repetition penalty helpers |
| `utils.py` | Misc helpers (Flash Attention warning suppression) |
| `streaming.py` | Chunked/streaming generation loop (`fast_generate_streaming`, `parity_generate_streaming`) |

## Quick start

```python
from qwen import FasterQwen3TTS

tts = FasterQwen3TTS.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",  # HF Hub id or local model dir
    device="cuda",
    dtype="bfloat16",
)

# Voice cloning from a reference audio file
audio_arrays, sample_rate = tts.generate_voice_clone(
    text="Hello, this is a cloned voice speaking.",
    language="English",
    ref_audio="reference.wav",
    ref_text="Transcription of the reference audio.",
)
```

CUDA graphs are captured lazily on the first generation call (warmup happens automatically inside `_prepare_generation`).

## Public API

### `FasterQwen3TTS.from_pretrained(model_name, device="cuda", dtype=torch.bfloat16, attn_implementation="sdpa", max_seq_len=2048)`
Loads the base `qwen-tts` model and builds (but does not yet capture) the predictor/talker CUDA graphs.

### `generate_voice_clone(text, language, ref_audio=None, ref_text="", ..., xvec_only=False, voice_clone_prompt=None, instruct=None)`
Generate speech that clones a reference voice. Either pass `ref_audio`/`ref_text`, or a precomputed `voice_clone_prompt`. Set `xvec_only=True` to condition only on the speaker embedding (avoids phoneme bleed-through from the reference, allows language switching) instead of full in-context-learning (ICL) mode.

### `generate_custom_voice(text, speaker, language, instruct=None)`
Generate speech using one of the model's built-in named speakers. Requires a `custom_voice` model.

### `generate_voice_design(text, instruct, language)`
Generate a new, free-form designed voice from an instruction string. Requires a `voice_design` model.

### Streaming variants
`generate_voice_clone_streaming`, `generate_custom_voice_streaming`, `generate_voice_design_streaming` — same parameters as their non-streaming counterparts plus `chunk_size` (codec steps per yielded chunk, default 12 ≈ 1 second) and `parity_mode` (voice-clone streaming only; disables CUDA graphs and decodes via the talker's own HF `generate()` for debugging/parity checks, at the cost of first-chunk latency). Yield `(audio_chunk, sample_rate, timing_dict)` tuples.

## Notes

- Output sample rate is inferred from the underlying codec's `speech_tokenizer`, defaulting to 24000 Hz if it can't be determined.
- `max_seq_len` bounds the talker's static KV cache; inputs producing a longer prefill than `max_seq_len` will raise `RuntimeError` — use shorter text or reference audio.
- `parity_mode` (on streaming/generation paths that support it) disables CUDA graphs and falls back to standard HF `generate()` for debugging/parity checks against upstream `qwen-tts`.
