GPU / CLOUD RECOMMENDATION — Homegrown (Qwen3-TTS-12Hz-0.6B)
======================================================================

CURRENT SETUP (baseline for comparison)
----------------------------------------
- GTX 960, 4GB VRAM, bfloat16, sdpa attention (no flash-attn installed)
  NB: these measurements were taken on a GTX 960. The machine running
  the app now reports a GTX 970 (sm_52) via /api/health. Both are 4GB
  sm_52 Maxwell, so the constants below hold, but the numbers are 960 numbers.
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
- Raise max_seq_len in backend/main.py (currently 1024) --
  8-12GB+ cards can go to 2048-4096 safely, 16GB+ to 4096-8192.
- Raise CHUNK_MAX_CHARS accordingly (currently 800, tuned specifically
  for the 4GB/1024 config) -- fewer, larger chunks means fewer seams
  and faster overall jobs.
- Install flash-attn (not installed currently -- the app is running the
  slower "manual PyTorch version" fallback per its own startup warning).
  This alone is a meaningful speedup on any modern datacenter GPU
  (T4/L4/A10G/A100 all support it; RTX 4090 does too).
- MAX_REF_AUDIO_SECS (currently 60.0, in backend/main.py) is no longer
  the binding limit -- _seq_budget() derives the real per-preset budget
  from what the reference clip leaves of max_seq_len, so raising the
  guard alone just starves generation. Raise max_seq_len first. Note
  also that the practical ceiling is quality, not capacity: clips over
  ~23s have produced garbled output on this card regardless of budget,
  and 10-20s remains the recommended range.
  (This line previously read "currently 15s", which was wrong by 4x.)
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


STABILITY SWEEP (2026-09-09, GTX 970 sm_52)
----------------------------------------
Question: does /api/generate's `stability` setting reduce the chunk
degeneration recorded in CLAUDE.md ("roughly a third of samples babble
or stop short")? The `stable` preset (temperature 0.5, top_p 0.85,
top_k 30) is implemented and validated in the backend but the frontend
has never sent the field, so every voiceover ever made ran `balanced`
(temperature 0.9, top_p 1.0, top_k 50).

Method: one 618-char script, 4 chunks, on a preset with a 16.1s
reference clip (`chunk_chars: 200`, i.e. capped by
ELISION_SAFE_CHUNK_CHARS rather than by the sequence window). 4 runs at
`balanced`, 4 at `stable`. Each result transcribed with faster-whisper
`small` (not the `base` the app uses for reference clips -- the judge
should outrank the thing it judges) and scored word-level against the
source with difflib. Duration ratios deliberately NOT used: they cannot
separate padding from a legitimately slow read.

Result:

  balanced  n=4  similarity mean=0.987 worst=0.983 best=0.991
                 missing=6 invented=6   mean_wall=85s
  stable    n=4  similarity mean=0.987 worst=0.983 best=0.991
                 missing=6 invented=6   mean_wall=85s

Identical. Wall time is equal once `balanced` run 1 (123.5s) is
excluded as the cold CUDA-graph capture; the other seven runs were
81-87s.

The similarity figures UNDERSTATE the output. Every difference across
all 8 runs was a transcription artefact, not a generation error:

  balanced_1  in -> and ;  thirty -> 30
  balanced_2  a  -> the ;  thirty -> 30
  balanced_3  thirty -> 30
  balanced_4  thirty -> 30
  stable_1    in -> and ;  thirty -> 30
  stable_2    thirty -> 30
  stable_3    seven -> 7 ;  thirty -> 30
  stable_4    thirty -> 30

"thirty -> 30" is Whisper writing a numeral; "in -> and", "a -> the"
are mishearings of unstressed function words. Zero dropped clauses,
zero invented sentences.

More significant than the comparison: `grep -c resampl` over the
backend log for the whole sweep returned 0. All 32 chunks passed
_chunk_duration_is_sane() first time. The retry loop was not masking
failures -- there were none.

Conclusions:
- Do not expose a stability control, and do not change the default.
  There is nothing here for temperature to fix.
- The degeneration recorded earlier in CLAUDE.md did not reproduce on
  current code. Most likely already fixed by _seq_budget() sizing
  chunks from the actual reference clip, chunk_text's balanced
  partition removing the runt chunk, and the per-chunk max_new_tokens
  cap.
- Limits, stated plainly: ONE voice, ONE script, one machine. This is
  not proof of absence. Keep the resampling; a longer reference clip
  may still land outside the sweet spot.
- `creative` (temperature 1.2) was not tested.

SOURCES (pricing, verified July 2026)
----------------------------------------
- https://www.runpod.io/pricing
- https://vast.ai/pricing
- https://vast.ai/pricing/gpu/RTX-4090
- https://lambda.ai/pricing
- https://instances.vantage.sh/aws/ec2/g5.xlarge
- https://instances.vantage.sh/aws/ec2/g6.xlarge
- https://instances.vantage.sh/aws/ec2/g4dn.xlarge
