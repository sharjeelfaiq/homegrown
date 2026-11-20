# How to Run FasterQwen3TTS

This is a standalone wrapper example, not the Homegrown application installer. For the application,
use the pinned dependencies in `../../services/voice-api/requirements.txt` and the root `README.md`. The example has
been exercised on Windows with a CUDA-capable NVIDIA GPU; available PyTorch wheels depend on the selected
Python version and platform.

## 1. Install a CUDA-enabled PyTorch build

Check your driver's CUDA version first (`nvidia-smi`), then install a matching wheel.
The October 2026 application benchmark used PyTorch 2.11.0+cu126 and driver
560.94. That records one working environment, not a compatibility guarantee
for every GPU. For a standalone environment, the CUDA 12.6 index is:

```bash
pip install --index-url https://download.pytorch.org/whl/cu126 torch --upgrade
```

Verify:
```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```
With that index, expect a CUDA-enabled build and the actual GPU name. CUDA
availability can be false because of a CPU-only wheel, driver issues, or no
supported device. The application additionally checks compiled architecture
support and executes a test operation before selecting CUDA.

## 2. Install the rest of the dependencies

```bash
pip install -U soundfile qwen-tts
```

Note: `qwen-tts` pins its own `transformers` version and may downgrade an existing install — that's expected and fine.

## 3. Download the application model

Use `Qwen3-TTS-12Hz-1.7B-Base` with a GPU budget of at least 8 GB of VRAM.
This is a planning target, not a measured minimum. The local GTX 970 has 4 GB,
and 1.7B generation has not been verified on it.

```bash
python -c "
from huggingface_hub import snapshot_download
path = snapshot_download(
    'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
    local_dir='D:/models_cache/Qwen3-TTS-12Hz-1.7B-Base',
    ignore_patterns=['*.msgpack', '*.h5', 'flax_model*'],
)
print(path)
"
```

This downloads the model into a flat directory and prints that directory for
`from_pretrained` below. The model weights are about 3.86 GB.

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

Save as `run.py` with the repository's `engine/` directory on `sys.path` so
`import qwen` resolves to this package:

```python
import sys
sys.path.insert(0, r"D:\path\to\homegrown\engine")

import torch
import soundfile as sf
from qwen import FasterQwen3TTS

MODEL_PATH = r"D:\models_cache\Qwen3-TTS-12Hz-1.7B-Base"
REF_AUDIO = r"C:\path\to\ref_audio.wav"  # REPLACE with the real path to the file from step 4
REF_TEXT = "The quick brown fox jumps over the lazy dog near the riverbank."

tts = FasterQwen3TTS.from_pretrained(
    MODEL_PATH,
    device="cuda",
    dtype=torch.bfloat16,
    attn_implementation="sdpa",
    max_seq_len=1024,      # match the application's checked-in setting
)

# Non-streaming
audio_arrays, sr = tts.generate_voice_clone(
    text="Hello, this is a test.",
    language="English",
    ref_audio=REF_AUDIO,
    ref_text=REF_TEXT,
    max_new_tokens=128,
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

The first call to `generate_voice_clone`/`generate_voice_clone_streaming` captures
the CUDA graphs when CUDA is selected; later calls reuse them.
Capture time and warm performance depend on the machine and input.

## VRAM notes

Budget at least 8 GB of GPU memory for this checkpoint. The model weights alone
are about 3.86 GB; CUDA graphs and generation buffers need additional space.
If you hit `CUDA out of memory`:
- Lower `max_seq_len` only after measuring generation quality.
- Lower `max_new_tokens`
- Close other GPU-using apps first (check `nvidia-smi` for baseline usage)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ValueError: CUDA graphs require CUDA device` | A graph-only path requires usable CUDA; inspect device probing and PyTorch/driver compatibility |
| `ModuleNotFoundError: No module named 'qwen_tts'` | Redo step 2 |
| `CUDA out of memory` | See VRAM notes above |
| `"SoX could not be found!"` warning on import | Harmless — comes from a transitive audio dependency probing for the optional `sox` CLI; ignore it |
| Model loads but `Warning: flash-attn is not installed` | Harmless — this repo defaults to `attn_implementation="sdpa"`, flash-attn is optional |
