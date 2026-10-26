# Voice generation measurements — 26 October 2026

This is the earlier exploratory benchmark. A subsequent controlled evaluation
retained a decoder optimization with a measured speedup; see
[waveform-decoding-results.md](waveform-decoding-results.md).

Retained: an instance-owned prompt LRU with 16 entries and a 16 MiB tensor-storage
limit, full transcript/mode/batch/device/dtype identity, resolved file path,
size and nanosecond modification time. Failed file inspection and oversized
prompts bypass caching; files changed during prompt creation are not cached.
This is a correctness and bounded-memory change. **No generation speedup is
claimed.** Precision, sampling, reference context, stream/chunk sizes, retries,
cancellation, queue ordering and persistence formats remain unchanged.

Bounded codec-history assembly was implemented, tested, measured, then removed
from ordinary generation. Its experimental implementation and replay tests
remain under `scripts/benchmarks/`. Suppression-mask vectorization was tested
and measured separately, but was not enabled in production.

The procedure is in [voice_generation.md](../scripts/benchmarks/voice_generation.md).
Private inputs, manifests, detailed per-call wall/CUDA timings, captured codec
tokens, listening files and ASR results remain in ignored `.tmp/voice-speed/`.
No private transcript appears in this report.

## Environment and comparability

GTX 970, 4 GiB VRAM, Windows WDDM; driver 560.94, CUDA runtime 12.6,
PyTorch 2.11.0+cu126, Transformers 4.57.3, qwen-tts 0.1.1, Python 3.13.15.
The configured local checkpoint is Qwen3-TTS 0.6B Base, bfloat16, SDPA,
CUDA graphs, maximum sequence length 1024. The unchanged 479-character script
and 40-second reference split into three chunks under the existing 200-character
ceiling and 258-token budget. Model/configuration and input hashes match across
phases; paired seeds are 1729 for first generation and 1730 for warm-1.

These runs are **not a controlled speed comparison**. CPU validation overlapped
some baseline work. A replacement application backend was found after baseline,
and a live application job was left to finish before candidate started.
A new continuous health guard then detected another backend during candidate
warm-2 and stopped the benchmark between stream pieces. It did not cancel any
application job. Baseline's late outlier and incomplete candidate repetitions
are retained in artifacts, not silently discarded.

Baseline completed first generation, three warm repetitions and the single-chunk
diagnostic. Candidate completed first generation and warm-1; warm-2 is incomplete,
and warm-3/single-chunk were deferred. Recorded model-load plus processing time
was approximately 746 seconds (12.4 minutes), plus subsecond independent GPU
microbenchmarks, within the approved 20-minute GPU budget. No further GPU phase
was attempted. Backend health subsequently confirmed CUDA readiness without a
GPU fault or startup error.

## Observations, not a speedup claim

| Case | Baseline processing | Candidate processing | Audio duration (both completed pairs) |
| --- | ---: | ---: | ---: |
| First, including capture | 82.67 s | 92.29 s | 31.48 s |
| Warm-1 | 76.34 s | 87.20 s | 31.88 s |
| Warm-2 | 74.43 s | 58.67 s, incomplete | 30.64 s baseline |
| Warm-3 | 147.27 s | deferred | 31.98 s baseline |
| First chunk only | 38.76 s | deferred | 8.76 s baseline |

Baseline warm median: 76.34 s, range 74.43–147.27 s; median RTF 2.429,
range 2.394–4.605. Candidate has only one complete warm run: 87.20 s,
RTF 2.735. The descriptive warm-median difference is **+14.23%**, and the paired
warm-1 difference is also +14.23%. Neither establishes a causal performance
change. All completed runs used zero retries. First-generation token count is
393 in both phases; warm-1 is 399 in both. Baseline warm-2/3 counts are 380/397.
Model load took 51.91 s baseline versus 36.24 s candidate. Within first
generation, graph capture took 1.298/1.452 s and cold prompt resolution took
3.579/2.345 s wall time (0.733/0.987 s CUDA-event time). These are separate
startup/cold-state measurements, not steady-state speed improvements.

Peak CUDA allocated memory was approximately 2,859.26 MiB baseline versus
2,859.27 MiB candidate, with a 3,370 MiB reserved peak in both. The comparable
warm-1 allocated delta was only 3,584 bytes, not a material memory improvement.
The cache bounds cap future retained storage; these runs use one reference,
so they do not demonstrate a multi-reference VRAM saving.

Baseline warm median stage wall times below are inclusive and must not be
added as independent measurements:

| Stage | Median wall time | Interpretation |
| --- | ---: | --- |
| Codec-next calls | 38.64 s | About 51% of processing; includes 1.05 s prefill |
| Vocoder decoding | 37.03 s | About 49%; reference context is still decoded during calibration |
| Input preparation | 0.0179 s | Includes prompt resolution; warm graph capture is absent |
| Prompt resolution | 0.000045 s | Three existing-cache hits, effectively negligible |
| CPU transfers | 0.0192 s | Nested in other stages where applicable |
| Encoding | 0.618 s | Less than 1% |
| Trimming/stitching/persistence | Each under 0.004 s | Small; stitching includes trimming |

In baseline warm-1, the first three reference-inclusive calibration decodes of
each chunk consumed 32.12 s of the 37.03 s vocoder total (86.8%, or about 42%
of total processing). This measures calibration calls, not an isolated estimate
of removable reference cost: their generated-audio work and acoustic context
must still be preserved or evaluated separately.

CUDA-event records are resolved after completion, and ordinary generation has
no added CUDA events or synchronization. Codec-next wrappers exclude consumer
pauses. Existing cumulative streaming timing dictionaries were not summed.
The initial runner inferred misses/hits from first versus warm state; the
current runner additionally records explicit prompt-creation calls, group
boundaries and queue-wait measurements. This benchmark invokes the worker
directly, so queue waiting is zero by design. The initial source/config hashes
were added to the runner after baseline; its provenance limitation is recorded
in `baseline/validity.json`.

## Independent candidates and retention

Nine alternating-order paired microbenchmarks ran on the candidate GPU process.
They are preparation diagnostics, not end-to-end measurements:

| Candidate | Old median | New median | Decision |
| --- | ---: | ---: | --- |
| History assembly, 696 frames in 12-frame pieces | 1.758 ms | 1.961 ms | About 11.5% slower in this microbenchmark; revert |
| Tail suppression mask, 1,024 suppressed positions | 39.794 ms | 0.143 ms | About 99.64% less preparation time; do not retain this iteration |
| Prompt-cache hardening | Cache-hit work remains below 1 ms per job | Correctness/memory bounds | Retain without a speed claim |

The mask saves about 0.119 s over three chunks, roughly 0.16% of the baseline
warm median. Even the two fastest baseline warm runs differ by 1.90 s, so this
does not meet the required end-to-end benefit-over-variability threshold.
Bounded history introduces tail cloning and did not produce useful savings
here. The actual experimental full-pipeline candidate combined history with
cache hardening; the interrupted end-to-end comparison cannot independently
attribute their effects. The independent microbenchmarks and conservative
retention decisions avoid such attribution.

## Quality evidence and limits

Captured tokens from the two completed pairs replay through the old and bounded
assembly with exact generated decoder-window equality across 70 pieces per
phase. Shared reference prefixes are unchanged. Deterministic fake-decoder
tests additionally verify exact yielded PCM, rounding and slicing with short
streams, calibration boundaries, partial final pieces, no reference and
references up to 500 frames. Chunk identities/caps match the frozen manifest.

The two completed pairs have identical sampled codec tokens, identical decoded
MP3 PCM, identical durations and zero clipped/nonfinite samples. First/warm-1
peaks are 0.468/0.382 and RMS levels 0.0441/0.0471. The largest adjacent-sample
steps are identical between phases (0.269/0.164); this is not a seam-specific
artifact detector. Paired listening files are available in both phase folders.

The already cached faster-whisper Base model ran offline on CPU/int8. After
case/punctuation normalization, both completed candidate transcripts have 0%
word error against the input. Because paired audio is identical, that evidence
also applies to those baseline files. This checks word coverage, not perceived
naturalness. **Human listening was not performed:** audible artifacts, seams
and voice consistency have not been assessed by listening.

## Remaining opportunities

1. Profile redundant initial reference-context vocoder work first: it is a
   substantial measured stage. Reducing that context requires separate acoustic
   quality evaluation and is deliberately outside this change.
2. Profile autoregressive graph execution and repetition-history work with clean,
   uninterrupted repetitions. Preserve sampling order and cancellation cadence.
3. Revisit small preparation savings only if a cleaner benchmark can resolve
   their end-to-end effect; reducing queue wait, encoding or persistence is not
   supported as a priority by these measurements.

A newer GPU or more VRAM may enable different kernels/configurations, but that
requires measurements on the proposed hardware. No hardware-upgrade speedup is
inferred from this GTX 970.

## Validation

`npm test` passed: 145 Studio tests plus five generator tests, 30 backend tests,
six colocated cache tests and benchmark/replay safety tests. The final targeted
benchmark run passed all eight tests after adding interference/budget checks.
Coverage includes exact masks for small vocabularies and EOS positions, storage
view accounting, eviction, invalidation, independent instances, canceled-stream
closure, subsequent-job execution, retries and persisted history.

`npm run lint` passed with eight existing frontend warnings; the Studio
production build passed. Build progress/summary tests passed (14), splash
consistency matched, and `git diff --check` passed. No frontend or public API
schema changes were made. All changes remain unstaged and uncommitted.
