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
- MAX_REF_AUDIO_SECS is not the binding limit and never was a quality
  number. It is 1800.0 (thirty minutes) in backend/main.py today, and
  it guards create_preset buffering the upload in memory. What bounds
  the clip is REF_TRIM_SECS = 40.0: anything longer is trimmed to the
  first 40 seconds of speech rather than rejected, so raising the
  upload guard alone changes nothing about generation.
  _seq_budget() derives the real per-preset budget from what the
  trimmed clip leaves of max_seq_len, so on a bigger card raise
  max_seq_len first, then REF_TRIM_SECS, re-solving the table in the
  REF_TRIM_SECS comment in backend/main.py as you go. Note also that
  the practical ceiling is quality, not capacity: clips over ~23s have
  produced garbled output on this card regardless of budget, and 10-20s
  remains the recommended range. See also the 2026-09-12 sweep below.
  (This line has been wrong twice -- it read "currently 15s", then
  "currently 60.0", while the constant moved to 1800.0.)
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


TIME-ESTIMATE MODEL SELECTION (2026-09-12, GTX 970 sm_52)
----------------------------------------
Question: the estimate beside Generate was wrong by a mean of 50%, and
the ROUNDED STRING the user reads was wrong on 65% of jobs. What model
should replace chars/second?

Method: 24 completed jobs from this machine's history.json, which
stores estimated_s beside generation_s. Chunk counts recomputed with
the real chunk_text()/_seq_budget() for each entry's preset. Scored by
leave-one-out: predict each job from the other 23 only.

    model                                 mean err   worst
    ----------------------------------    --------   -----
    per-character (the old model)              50%     84%
    per-chunk, mean                            47%    109%
    per-frame (chars x frames_per_char)       135%    278%
    per-character keyed by voice               36%    147%
    least squares  a*frames + b*chunks         26%     77%
    overhead + chunks x MEDIAN(sec/chunk)      22%     75%   <- adopted

Adopted model measured through the shipped _estimate_seconds: 20% mean,
75% worst, displayed string wrong 9/23 (39%) against 15/23 (65%).

Three findings that are not obvious and cost real time:

1. MEDIAN vs MEAN is the single biggest lever: 22% vs 40% on identical
   samples. Generation produces outliers by design -- a chunk failing
   _chunk_duration_is_sane() is resampled, and the first job after a
   restart pays CUDA-graph capture. Both drag a mean.

2. THE BEST-SCORING MODEL IS PHYSICALLY WRONG. The least-squares fit
   scores 26%, but its seconds-per-frame coefficient is NEGATIVE at
   every sample count from n=2 to n=23 -- it claims more audio makes
   generation faster. frames and chunks are collinear
   (frames ~= chunks x chunk_chars x frames_per_char), so the fit is
   unstable and would predict nonsense on a voice with different
   geometry. Rejected despite the score. Fit coefficients were printed
   per n specifically to check this; a score alone would have hidden it.

3. THE "VOICE-BLIND" DIAGNOSIS WAS MOSTLY WRONG. Per-voice chars/sec
   spans 3.2x (7.27 on a 16.1s clip, 2.26 on a 40.0s one), which reads
   as a missing per-voice term. Per CHUNK the same voices are:

       English Discussion   16.1s clip   n=13   16.3 s/chunk
       English Clone        26.8s clip   n=1    30.9 s/chunk
       Muslim English Voice 34.4s clip   n=8    15.5 s/chunk
       Juan sample          40.0s clip   n=1    55.3 s/chunk

   -- not ordered by clip length at all. Adding an explicit
   a + b*ref_seconds term made the model WORSE (34% mean, 117% worst).
   The chars/sec spread was mostly job-length mix: a voice used for
   many short scripts looks slow per character because the fixed
   overhead dominates. Do not add a reference-length term on intuition.

Overhead sweep (median model, leave-one-out mean / worst):

     0s -> 28% / 83%     20s -> 22% / 75%     35s -> 29% /  86%
     5s -> 24% / 81%     25s -> 22% / 73%     40s -> 32% / 101%
    10s -> 24% / 78%     30s -> 25% / 71%     50s -> 39% / 130%
    15s -> 22% / 78%

Flat from 15-25s, so _JOB_OVERHEAD_S = 20.0 is a plateau value rather
than a fitted constant.

Limits: 24 jobs, one machine, two voices carrying 21 of them. The two
single-job voices contribute one leave-one-out point each and should
not be read as per-voice measurements. history.json keeps estimated_s
beside generation_s precisely so the next change can be scored the
same way.


REFERENCE-CLIP LENGTH vs CHUNK BUDGET (2026-09-12, GTX 970 sm_52)
----------------------------------------
Question: at what clip length does _seq_budget() force chunks below
PADDING_SAFE_MIN_CHARS, and where does /api/generate start refusing the
job outright? Prompted by a report of "80-character chunks" from a
voice created on another machine, read by the user as a limit of that
machine's hardware. It is not: MAX_SEQ_LEN is a property of the model
and is identical on every GPU.

Method: synthesised silent wavs of known duration, paired with a
ref_text sized to a nominal 13 chars/sec, and called _ref_facts() and
main.estimate() directly. No generation -- only the budget arithmetic,
which is deterministic.

    clip   chunk_chars   max_new_tokens   notice?   /api/generate
    ----   -----------   --------------   -------   -------------
     40s       200            280            -         allowed
     42s       200            249            -         allowed
     44s       196            218            -         allowed
     46s       174            192            -         allowed
     48s       150            166            -         allowed
     50s       127            141          shown       allowed
     52s       104            115          shown       allowed
     54s        81             89          shown       allowed
     56s        80              0          shown       REJECTED
     60s        80             -5          shown       REJECTED

Three things fall out:
- The notice threshold (chunk_chars < PADDING_SAFE_MIN_CHARS = 150) is
  crossed between 48s and 50s.
- 80 is MIN_CHUNK_CHARS, a floor. A voice reporting 80 is therefore not
  "80 and could be worse" -- it is clamped, and somewhere past ~54s.
- The hard gate (max_new_tokens < MIN_GEN_FRAMES = 64) arrives only two
  seconds after the floor is reached, so the band where a voice warns
  but still renders is narrow: roughly 50-54s.

Reverse-solving the floor across the whole clamped rate range
(_MIN/_MAX_SPEECH_CHARS_PER_SEC, 8-20 chars/sec) puts it at 50.4s at
20 chars/sec, 54.1s at 13, and 54.9s at 8 -- so "80-char chunks" means
a ~50-55s clip whatever the speaker's pace.

None of this is reachable through the current upload path:
REF_TRIM_SECS=40 trims every clip on create, and 40s yields 200-char
chunks. Clips in this range only exist on presets created before
trimming shipped (2026-09-10, commit 352bcde), and upgrading does not
re-trim a stored clip. All five presets on this machine measured 16.1s
to 40.0s and 200-char chunks.

Limits: the budget is arithmetic, so these rows are exact for the given
rate -- but the AUDIBLE quality claim behind PADDING_SAFE_MIN_CHARS is
the older 380/190/110-char measurement recorded in CLAUDE.md, not
re-measured here. No audio was generated for this sweep.


TDR STRIKES (2026-09-10, GTX 970 sm_52, display-attached)
----------------------------------------
Observation only -- the cause is not diagnosed.

Across one working session, eight jobs failed with

    CUDA error: the launch timed out and was terminated
    (cudaErrorLaunchTimeout)

DECODE_CHUNK_FRAMES=100 was in effect throughout. That constant exists
specifically to keep each vocoder launch under Windows' ~2s WDDM
watchdog on a display-attached card, so it is either not sufficient on
this machine, or something other than the vocoder decode is running long
enough to trip the watchdog.

What was seen:
- The strikes did NOT correlate with unusually long scripts. Several
  were single-chunk jobs of ~20-200 characters.
- Once struck, the process's CUDA context is dead: every subsequent job
  fails identically until the backend is restarted. _process_job
  already short-circuits its chunk retries on "CUDA error" for this
  reason.
- One strike took out a running job and two queued behind it in a single
  event.
- A backend restart recovered fully each time; no driver-level reset or
  reboot was needed.

Not established: whether another process was contending for the GPU
during the session (a browser compositing, the frozen desktop build on
:8731 also holding a model, or a second dev backend). CLAUDE.md's
troubleshooting note already warns against running two model processes
at once, and at least one point in this session had both a dev backend
on :8000 and backend.exe on :8731 loaded.

Next step if this recurs: check whether the strikes stop with only one
model process running, before touching DECODE_CHUNK_FRAMES. Raising
Windows' TdrDelay is the other lever, but it is a machine-wide registry
change and should be a last resort.

RECURRED 2026-09-12, and the profile matches exactly: a single-chunk,
18-character job ("Persistence probe.") on the 16.1s-clip preset struck
cudaErrorLaunchTimeout on its first and only chunk. That is the third
independent confirmation that script length is not the variable. The
backend set _gpu_fault and every subsequent job failed until the process
was restarted, which is the designed behaviour -- see the gpu_fault note
in CLAUDE.md. DECODE_CHUNK_FRAMES was still 100.

SOURCES (pricing, verified July 2026)
----------------------------------------
- https://www.runpod.io/pricing
- https://vast.ai/pricing
- https://vast.ai/pricing/gpu/RTX-4090
- https://lambda.ai/pricing
- https://instances.vantage.sh/aws/ec2/g5.xlarge
- https://instances.vantage.sh/aws/ec2/g6.xlarge
- https://instances.vantage.sh/aws/ec2/g4dn.xlarge
