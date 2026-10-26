# Waveform decoding evaluation — 26 October 2026

Retained: skip internal vocoder blocks whose audio would be discarded during
initial streaming calibration. The necessary blocks keep the **same codec
inputs, internal alignment, reference context and slicing arithmetic** as the
old implementation. Autoregressive prediction still receives the full reference.

On this machine and frozen input, median warm processing time fell from
**79.53 s to 49.03 s (38.35% less time)**. All five paired cases produced
identical codec tokens and bit-identical pre-encoding PCM. This is a local
measurement on one script/reference, not a universal speedup estimate.

## Installed decoder and candidate selection

The installed qwen-tts 0.1.1 12 Hz decoder has eight sliding-attention layers
with a configured 72-frame window, causal convolutions, and an upsampling
product of 1,920. Its public decoder uses 25-frame overlap between internal
blocks. That overlap is a convention, not a proof of a 25-frame receptive field
for the whole decoder. This repository caps internal blocks at 100 frames;
including overlap, an existing launch can contain up to 125 frames.

The transposed-convolution trimming and stride-one causal convolutions preserve
the upsampling length contract for this implementation. GPU probes verified
exactly `frames × 1920` returned samples at frame counts 1, 2, 3, 12, 13, 24,
25, 26, 36, 37, 100, 101 and 125. The retained helper also checks every decoded
block/window's actual length and refuses to silently pad or drop samples.
Future decoder implementations need renewed length and parity validation.

Two candidates were evaluated sequentially:

1. **25 frames of context from the first piece:** warm median 48.26 s, but the
   first three pieces of each chunk changed. Some onset boundary jumps increased
   (for example, 0.027 to 0.112 in one replay chunk). Offline ASR remained at 0%
   word error, which does not establish absence of audible artifacts. Rejected
   in favor of the more conservative candidate; kept only as benchmark code.
2. **Skip discarded prefix blocks:** warm median 49.03 s, while preserving exact
   decoder inputs and output. Retained in `engine/qwen/waveform_stream.py` and
   used by `generate_voice_clone_streaming()`.

The retained implementation preserves the original proportional reference cut
and calibration rounding rather than replacing them with an assumed exact
ratio. The verified stride locates relevant internal blocks without producing
their discarded predecessors. For the captured 507-frame reference, the first
three old decoder requests included 519/531/543 frames. Their needed final
blocks contain only 44/56/68 frames. These keep the old 100-frame grid and its
25-frame overlap, rather than substituting an arbitrary reference tail.
After calibration, the original 25-frame generated context is unchanged.
Generated codec history is retained only for calibration; later assembly uses
the necessary tail. Multi-block yields collect audio on the device and transfer
it once per yield. No explicit CUDA synchronization was added or removed.

## Comparable full-pipeline measurements

Environment: GTX 970, 4 GiB, Windows/WDDM, driver 560.94, CUDA 12.6,
PyTorch 2.11.0+cu126, Transformers 4.57.3, qwen-tts 0.1.1, Python 3.13.15.
The local Qwen3-TTS 0.6B Base model uses bfloat16, SDPA and existing CUDA graphs.
The unchanged 479-character script and 40-second reference use the existing
three chunks, token caps, sampling defaults and paired seeds. No transcript or
reference media is included in this report.

All phases used fresh processes and matching manifests. No tests/builds ran
concurrently with GPU measurement. No backend interference or incomplete runs
were recorded in these phases. Model loading and first generation were measured
separately. Queue waiting was recorded separately and is effectively zero
because the benchmark calls the isolated worker directly.

| Case | Baseline | Retained candidate | Output duration, both | Tokens, both |
| --- | ---: | ---: | ---: | ---: |
| First, including capture | 84.76 s | 54.42 s | 31.48 s | 393 |
| Warm-1 | 79.88 s | 49.37 s | 31.88 s | 399 |
| Warm-2 | 77.62 s | 47.10 s | 30.64 s | 380 |
| Warm-3 | 79.53 s | 49.03 s | 31.98 s | 397 |
| Single-chunk diagnostic | 23.98 s | 13.81 s | 8.76 s | 110 |

Warm baseline range: 77.62–79.88 s; candidate: 47.10–49.37 s. The 30.50-second
median reduction greatly exceeds the approximately 2.26-second range within
each phase. Median RTF changed from 2.506 to 1.537. Every completed run used
zero retries. Model loading was essentially unchanged: 8.48 versus 8.51 s.

Warm median peak allocated GPU memory fell from 2,859.44 MiB to 2,623.89 MiB
(235.55 MiB less, approximately 8.2%). Warm reserved memory was 3,370 versus
3,058 MiB. First-generation allocated peaks remained close: 2,859.44 versus
2,856.78 MiB, because cold prompt/model work still contributes to the peak.

Codec-next wall time remained about 41 seconds (41.03 versus 40.87 median);
autoregressive prediction was not accelerated. Baseline public vocoder decoding
took 37.88 s wall time. Candidate internal decoder CUDA spans total about 7.50 s
per warm job. The candidate's remaining public-decode wall time is 4.93 s, which
overlaps those spans and excludes direct calibration decoding: **do not add
these nested measurements or treat the two instrument scopes as identical**.
Encoding remained about 0.57 s. Autoregressive work now accounts for roughly
83% of processing and is the dominant remaining cost.

## Quality and regression evidence

Identical-token GPU replay covered two complete scripts, six chunk pairs and
70 streamed pieces. Candidate decoder-block inputs were an ordered subsequence
of the old inputs; 90 of 160 block executions were omitted. Every yielded piece
was bit-identical, with matching sample counts and boundary positions/jumps.
The more heavily instrumented replay took 115.02 s in the old path versus
15.82 s in the candidate across those six chunks. Use full-pipeline timings
above for the speedup claim, not this profiling-heavy diagnostic.

Independent full-pipeline comparisons also found identical codec tensors and
float WAV PCM for **all five cases**, not just the replayed cases. Audio is
finite, without clipped samples, and has identical durations, trimming,
stitching and chunk boundaries. The existing cached faster-whisper Base model
ran offline on CPU/int8: both replayed scripts had 0% normalized word error in
both paths. FP32-computed onset speaker-embedding cosine was approximately 1
for the retained candidate; exact PCM equality is the stronger evidence.
The earlier prototype's BF16 cosine calculation could exceed 1 due to rounding
and was not used as acceptance evidence; future replay computes it in FP32.

Paired files are under ignored `.tmp/voice-speed/waveform-prefix-skip/`, including
`replay-warm-1-legacy.wav` and `replay-warm-1-bounded.wav`. Here the filename
`bounded` labels the selected candidate; `waveform-replay.json` identifies it
as `prefix-skip`. Human listening was **not** performed. Naturalness, audible
artifacts, seams and voice consistency were not assessed by listening; exact
parity establishes unchanged samples for the cases tested.

Colocated tests cover short/reference-free streams, references around internal
block boundaries, calibration transitions, large and partial final pieces,
exact legacy PCM and decoder inputs, stride/length failures, source closure,
and no CUDA timing or added synchronization in ordinary decoding. Backend
integration exercises cancellation through the actual prefix-skipping helper,
no canceled publication, the next queued job, retries and persisted history.
The public clone entry point preserves full prompt and sampling arguments.

## Budget, artifacts and validation

GPU work ran one process at a time, with idle checks and automatic original
backend/dev-stack restoration. A conservative ledger charges each phase from
first report creation to final report save, adds measured loading and 15 seconds
of cleanup margin. Charges were 369.75 s baseline, 330.66 s rejected candidate,
and 373.32 s retained candidate: **1,073.73 s (17.90 minutes)** total, within
the 20-minute authorization. No more GPU benchmarking was performed.

Artifacts, frozen inputs, codec/reference captures and raw reports are under
ignored `.tmp/voice-speed/waveform-{baseline,candidate,prefix-skip}/`.
The budget, comparison and analysis files are in their parent directory.
The benchmark-only adapter was used during measurement; the public entry point
now delegates to the same retained helper. Final bookkeeping keeps a single
CPU transfer when a yield crosses internal blocks; tests cover that case.

`npm test`, frontend lint, Studio build, 14 build progress/summary tests and
splash consistency passed. Lint retains eight pre-existing frontend warnings.
The final targeted engine/benchmark run passed 17 tests, including the public
entry point and disabled-instrumentation checks. Backend CUDA readiness was
verified after restoration at the conclusion of this evaluation.

See [the benchmark procedure](../scripts/benchmarks/voice_generation.md) for
fresh-directory commands. Results apply to this hardware, model, input and
reference; they do not predict another GPU's performance or all voice workloads.
