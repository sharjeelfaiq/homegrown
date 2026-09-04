GPU / CLOUD RECOMMENDATION — Voice Clone Studio (Qwen3-TTS-12Hz-0.6B)
======================================================================

CURRENT SETUP (baseline for comparison)
----------------------------------------
- GTX 960, 4GB VRAM, bfloat16, sdpa attention (no flash-attn installed)
- Model itself is small: 0.6B params, ~1.2GB weights in bf16
- But VRAM sits at ~3989-3991MB used out of 4096MB during generation --
  basically maxed out just from CUDA-graph static buffers + KV cache
- That razor-thin margin is the direct cause of two real bugs hit this
  session: Windows TDR killing kernels mid-generation (driver watchdog
  assumes a hung GPU when a kernel runs too long under memory pressure),
  and CHUNK_MAX_CHARS having to be capped at 800 chars / max_seq_len=1024
  to avoid rope-position quality collapse on long generations.
- Generation is single-stream, autoregressive, one codec token at a time
  (via CUDA graph replay) -- this is a LATENCY-bound workload, not a
  throughput/FLOPs-bound one. A bigger GPU mainly buys headroom and
  speed, not "more model capacity."

TL;DR RECOMMENDATION
----------------------------------------
Don't over-buy. This is a 0.6B model, not a 70B LLM -- it does not need
A100/H100-class hardware. The single biggest win is just getting off a
4GB card onto something with real headroom.

  Best value pick:      NVIDIA L4 (24GB)   or   RTX 4090 (24GB)
  Budget-acceptable:     NVIDIA T4 (16GB)
  If serving many users: NVIDIA L40S (48GB) or A100 (40GB)

24GB VRAM removes the memory-pressure problem entirely: model weights
(~1.2GB) + a much larger CUDA-graph KV cache (max_seq_len could go to
4096-8192 instead of 1024) + comfortable slack, with zero risk of
hitting the TDR-style instability seen on the 4GB card.

VRAM TIER BREAKDOWN
----------------------------------------
8-12GB  (RTX 3060 12GB, RTX 4070, T4 16GB-ish tier)
  - Fixes the crash/instability problem outright.
  - Can safely raise max_seq_len to ~2048-3072 without the current
    "shrink chunk size per preset's reference-clip length" workaround
    being nearly as critical.
  - Good minimum bar if cost is the main constraint.

16-24GB (T4 16GB, A10G 24GB, L4 24GB, RTX 4090 24GB)
  - Comfortable headroom: max_seq_len 4096+, longer reference clips
    tolerated safely, room to eventually add batching (multiple
    concurrent generations) without re-architecting immediately.
  - RTX 4090 specifically has excellent memory bandwidth and the best
    raw price/performance of this group for single-stream latency --
    but it's a consumer card (no official cloud SLA/ECC), fine for
    this project's scale.
  - L4 / A10G are the datacenter equivalents if you want a "real" cloud
    instance type (AWS/GCP) rather than a GPU-rental marketplace.

40GB+ (A100 40GB/80GB, L40S 48GB)
  - Only worth it if you actually plan to serve many concurrent users
    with real request batching. The current code holds a global lock
    serializing all generation (CUDA graphs aren't reentrant), so
    right now a bigger GPU alone does NOT give you parallel throughput
    -- that requires code changes (multiple model instances / a queue
    + worker pool) before this tier pays for itself.

INSTANCE TYPES BY PROVIDER — HOURLY PRICING TABLE
(prices verified via web search, July 2026 -- marketplace prices like
Vast.ai are dynamic/live-market and will drift; check current rate
before committing)
----------------------------------------------------------------------------------------
GPU              VRAM   Provider        Instance/Tier            $/hr        Notes
----------------------------------------------------------------------------------------
RTX 4090         24GB   RunPod          Community Cloud          $0.34       cheapest tier
RTX 4090         24GB   RunPod          Secure Cloud             $0.69       vetted DCs
RTX 4090         24GB   Vast.ai         marketplace (low end)    $0.31       varies live
NVIDIA L4        24GB   RunPod          --                       $0.39+      "from" price
NVIDIA L4        24GB   AWS             g6.xlarge                $0.805      on-demand
NVIDIA T4        16GB   AWS             g4dn.xlarge              $0.526      on-demand
NVIDIA A10G      24GB   AWS             g5.xlarge                $1.006      on-demand
NVIDIA A100      80GB   RunPod          Community Cloud          $1.39       --
NVIDIA A100      80GB   Vast.ai         marketplace (low end)    $0.67       high-reliability
                                                                              hosts, varies
NVIDIA A100      40GB   Lambda Labs     fixed on-demand          $1.99       fixed, predictable
----------------------------------------------------------------------------------------
GCP (g2-standard-4/L4, N1+T4) and Azure (NC-series T4/A10) sit in a
similar band to their AWS equivalents above -- check each provider'sa
calculator for current region-specific rates, not included in the
table since exact figures weren't confirmed.

RunPod also has free egress (hyperscalers charge $0.09-0.12/GB out) and
a serverless "pay only while generating" option -- a good fit since
this app isn't a 24/7 always-on service.

WHAT TO CHANGE IN THE CODE WHEN MOVING TO A BIGGER GPU
----------------------------------------
- Raise max_seq_len in webapp/backend/main.py (currently 1024) --
  8-12GB+ cards can go to 2048-4096 safely, 16GB+ to 4096-8192.
- Raise CHUNK_MAX_CHARS accordingly (currently 800, tuned specifically
  for the 4GB/1024 config) -- fewer, larger chunks means fewer seams
  and faster overall jobs.
- Install flash-attn (not installed currently -- the app is running the
  slower "manual PyTorch version" fallback per its own startup warning).
  This alone is a meaningful speedup on any modern datacenter GPU
  (T4/L4/A10G/A100 all support it; RTX 4090 does too).
- MAX_REF_AUDIO_SECS (currently 15s, in webapp/backend/main.py) can
  likely be raised somewhat too, since the instability observed this
  session was tied to the tight max_seq_len budget on the 4GB card --
  worth re-validating empirically on the new GPU rather than assuming.
- If you want real concurrent multi-user throughput (not just bigger/
  faster single requests), the global _gen_lock serialization needs to
  become a small worker pool (one model instance per GPU, or multiple
  GPUs) -- that's a real architecture change, not just a bigger GPU.

BOTTOM LINE
----------------------------------------
Rent an RTX 4090 24GB or L4 24GB on a per-second marketplace (RunPod is
the easiest starting point) rather than committing to a reserved
instance or jumping straight to A100/H100. Re-run the same empirical
calibration approach used this session (test real chunk sizes/durations
against the new max_seq_len before trusting a bigger number) once
you're on the new hardware.

SOURCES (pricing, verified July 2026)
----------------------------------------
- https://www.runpod.io/pricing
- https://vast.ai/pricing
- https://vast.ai/pricing/gpu/RTX-4090
- https://lambda.ai/pricing
- https://instances.vantage.sh/aws/ec2/g5.xlarge
- https://instances.vantage.sh/aws/ec2/g6.xlarge
- https://instances.vantage.sh/aws/ec2/g4dn.xlarge
