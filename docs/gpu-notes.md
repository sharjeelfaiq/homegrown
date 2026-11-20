# GPU notes for the 1.7B voice model

Homegrown downloads `Qwen/Qwen3-TTS-12Hz-1.7B-Base`. The model weights are about
3.86 GB. Budget at least 8 GB of GPU memory for the model, CUDA graphs, and
generation buffers. This is a planning target, not a measured minimum. The
local GTX 970 has 4 GB, below that budget; 1.7B generation has not been
verified on it.

The current application uses bfloat16 and PyTorch SDPA. Its checked-in sequence
and chunk limits live in `services/voice-api/homegrown_api/config.py`. These
limits have not been measured for quality or peak memory with the 1.7B model.
Measure them on the target GPU before changing them or making speed claims.

For a meaningful integration check, load the model, clone a short reference,
generate a voiceover, and confirm playback and the resulting audio file. Use
`scripts/benchmarks/voice_generation.md` for isolated measurements that do not
alter saved user data.
