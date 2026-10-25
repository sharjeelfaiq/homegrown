# Voice model compatibility

`services/voice-api/homegrown_api/model_compatibility.py` assesses Standard and
Higher quality separately for GPU and CPU. The API reports each result as
**Tested**, **Estimated**, **Unknown**, or **Severely insufficient**. A tested
result means an exact documented profile has loaded and generated successfully;
an estimate is a memory-based fit, not a runtime guarantee.

Hardware details include GPU name, compute capability, total and currently
available VRAM, CPU logical thread count, and total and available system RAM.
Unavailable readings are reported as unknown and do not disable model download
or selection. A choice is disabled only when the readings available for both
devices show severe insufficiency. The current memory cutoffs are estimates:
Standard uses 3,584 MiB available VRAM or 6,144 MiB available system RAM;
Higher quality uses 6,144 MiB available VRAM or 10,240 MiB available RAM.
They are not validated minimum requirements. After a successful CPU load,
generation is permitted; GPU generation also checks runtime compatibility.
Startup avoids GPU loading when measured VRAM is
insufficient and CPU fit is measured viable. If an attempted GPU load fails,
the backend also tries CPU. A successful CPU load enables generation and Studio
reports that it will be slow; a CPU load failure is reported as a setup error.

The current tested profile is Standard on an NVIDIA GeForce GTX 970 with
4096 MiB (sm_52). The dated GTX 970 records in [`gpu-notes.md`](gpu-notes.md)
include representative Qwen 0.6B Base generation. Those runs establish basic
load and generation, but cold-start duration and peak load VRAM were not
recorded, and the logs include CUDA watchdog failures. This is not a guarantee
for another card or driver.

Higher quality means Qwen-TTS 1.7B Base. The checkpoint metadata lists 4.54 GB
of files, including a 3.86 GB weights file. This is a lower bound on required
GPU memory, not a runtime measurement. Higher quality requires a generous VRAM
estimate to be offered as a GPU choice; otherwise it remains available for a
plausible CPU memory fit and carries a very slow generation warning. The
recommendation prefers Higher quality when GPU fit is plausible, otherwise
Standard on GPU, then Standard on CPU for a balanced experience.

Higher quality has a separate `HIGHER_MODEL_PATH` (default
`services/voice-api/storage/models/higher` in development and
`<install>/storage/models/higher` in the packaged app). Standard continues to
use `MODEL_PATH`; its development default points to the original workstation's
snapshot, while its packaged default is `<install>/models`. Set `MODEL_PATH` in
`services/voice-api/.env` on a different development machine. Installing either
choice cannot overwrite the other's files.

A download is considered installed only when its `config.json` and non-empty
`model.safetensors` are present in the selected model directory. An interrupted
or partial transfer remains incomplete and can be retried from Studio.

The automated compatibility tests cover fit categories, unknown hardware,
recommendation inputs, CPU warnings, runtime gating, and path separation. They
do not replace cold-load and representative-generation measurements. Untested
estimates remain labeled **Estimated** until successful runtime checks are
recorded for the exact model, device, driver, Python, PyTorch/CUDA, and bundled
engine combination.
