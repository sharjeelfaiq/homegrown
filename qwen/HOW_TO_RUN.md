# How to Run FasterQwen3TTS

Verified working end-to-end on: Windows, Python 3.14, NVIDIA GTX 960 (4GB VRAM). These are the exact steps used in that verified run.

## 1. Install a CUDA-enabled PyTorch build

Check your driver's CUDA version first (`nvidia-smi`), then install a matching wheel. This repo was verified with CUDA 12.6 wheels on a driver supporting CUDA 13.0 (drivers are backward compatible):

```bash
pip install --index-url https://download.pytorch.org/whl/cu126 torch --upgrade
```

Verify:
```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```
Expect something like `2.12.1+cu126 True <your GPU name>`. If `cuda.is_available()` is `False`, you got a CPU-only wheel — check `pip index versions torch` and the `--index-url` matches your CUDA version and Python version.

## 2. Install the rest of the dependencies

```bash
pip install -U soundfile qwen-tts
```

Note: `qwen-tts` pins its own `transformers` version and may downgrade an existing install — that's expected and fine.

## 3. Download a model

Pick the smallest model that fits your VRAM. On a 4GB card, use the 0.6B model:

```bash
python -c "
from huggingface_hub import snapshot_download
path = snapshot_download('Qwen/Qwen3-TTS-12Hz-0.6B-Base', cache_dir='D:/models_cache')
print(path)
"
```

This downloads ~2.5GB and prints the local snapshot path — save that path, you'll pass it to `from_pretrained` below. Other available models: `Qwen3-TTS-12Hz-1.7B-Base`, `-CustomVoice`, `-VoiceDesign` variants (bigger, need more VRAM).

## 4. Get a reference audio clip + transcript (for voice cloning)

`generate_voice_clone` needs a short reference `.wav` and its exact transcript. If you don't have one handy, synthesize one (Windows, via built-in SAPI):

```powershell
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile("ref_audio.wav")
$synth.Speak("The quick brown fox jumps over the lazy dog near the riverbank.")
$synth.Dispose()
```
Use the exact text you spoke as `ref_text`.

## 5. Run it

Save as `run.py`, next to (or with `D:\projects` on `sys.path` so `import qwen` resolves to this package):

```python
import sys
sys.path.insert(0, r"D:\projects")   # parent of this repo folder, so `import qwen` works

import torch
import soundfile as sf
from qwen import FasterQwen3TTS

MODEL_PATH = r"D:\models_cache\models--Qwen--Qwen3-TTS-12Hz-0.6B-Base\snapshots\<snapshot-hash>"  # REPLACE with the real path printed by step 3 -- this placeholder will not work as-is
REF_AUDIO = r"C:\path\to\ref_audio.wav"  # REPLACE with the real path to the file from step 4
REF_TEXT = "The quick brown fox jumps over the lazy dog near the riverbank."

tts = FasterQwen3TTS.from_pretrained(
    MODEL_PATH,
    device="cuda",
    dtype=torch.bfloat16,
    attn_implementation="sdpa",
    max_seq_len=256,       # keep small on <=4GB cards; see VRAM note below
)

# Non-streaming
audio_arrays, sr = tts.generate_voice_clone(
    text="Hello, this is a test.",
    language="English",
    ref_audio=REF_AUDIO,
    ref_text=REF_TEXT,
    max_new_tokens=128,    # keep small on <=4GB cards
)
sf.write("out.wav", audio_arrays[0], sr)

# Streaming
chunks = []
for audio_chunk, sr, timing in tts.generate_voice_clone_streaming(
    text="Hello, this is a streaming test.",
    language="English",
    ref_audio=REF_AUDIO,
    ref_text=REF_TEXT,
    max_new_tokens=128,
    chunk_size=12,
):
    print(timing)
    chunks.append(audio_chunk)

import numpy as np
sf.write("out_stream.wav", np.concatenate(chunks), sr)
```

```bash
python run.py
```

The first call to `generate_voice_clone`/`generate_voice_clone_streaming` captures the CUDA graphs (takes several seconds); subsequent calls reuse them and are fast.

## VRAM notes (4GB cards)

This was verified to peak at ~4.2GB/4.3GB VRAM used with `max_seq_len=256` and `max_new_tokens=128` on the 0.6B model — right at the edge. If you hit `CUDA out of memory`:
- Lower `max_seq_len` further (e.g. 128–192)
- Lower `max_new_tokens`
- Close other GPU-using apps first (check `nvidia-smi` for baseline usage)
- Use the 0.6B model, not 1.7B, on anything ≤6GB VRAM

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ValueError: CUDA graphs require CUDA device` | Your torch build is CPU-only — redo step 1 with the right `--index-url` |
| `ModuleNotFoundError: No module named 'qwen_tts'` | Redo step 2 |
| `CUDA out of memory` | See VRAM notes above |
| `"SoX could not be found!"` warning on import | Harmless — comes from a transitive audio dependency probing for the optional `sox` CLI; ignore it |
| Model loads but `Warning: flash-attn is not installed` | Harmless — this repo defaults to `attn_implementation="sdpa"`, flash-attn is optional |
