# Voice generation benchmark

For the retained prefix-skipping decoder and its measured results, see
[waveform-decoding-results.md](../../docs/waveform-decoding-results.md).

Run from the repository root using the existing virtual environment. The entry
point uses only the standard library until it redirects storage and enables
Hugging Face offline mode. It then uses the installed application dependencies.
It requires an existing local `MODEL_PATH`; it never starts the application,
downloads models, restores a queue, or invokes transcription downloads.

Check the **live** `/api/queue` before stopping the backend. Defer if any job is
queued, running, or canceling. Run one benchmark process at a time, with no
other inference, builds, tests, or heavy desktop activity. Restore the original
backend afterward. The optional Windows wrapper checks idle twice, recognizes
the repository's dev launcher, and restores that launcher (or the standalone
backend) in `finally`. It leaves a backend alone if one has already reappeared:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/benchmarks/run_idle_phase.ps1 -Phase baseline
# Make exactly one candidate change, then:
powershell -ExecutionPolicy Bypass -File scripts/benchmarks/run_idle_phase.ps1 -Phase candidate
```

The reproducible underlying commands, after an idle-only shutdown, are:

```powershell
.venv/Scripts/python.exe scripts/benchmarks/voice_generation.py --phase baseline --output .tmp/voice-speed/baseline --budget-seconds 600
.venv/Scripts/python.exe scripts/benchmarks/voice_generation.py --phase candidate --baseline .tmp/voice-speed/baseline --output .tmp/voice-speed/candidate --budget-seconds 600
.venv/Scripts/python.exe scripts/benchmarks/summarize_voice_generation.py .tmp/voice-speed/baseline .tmp/voice-speed/candidate
.venv/Scripts/python.exe scripts/benchmarks/replay_codec_history.py .tmp/voice-speed/baseline .tmp/voice-speed/candidate
# Optional: fails rather than downloading if faster-whisper base is not cached.
.venv/Scripts/python.exe scripts/benchmarks/check_transcripts.py .tmp/voice-speed/candidate
```

The current runner explicitly selects a decoder, independently of the application's
default. `--decoder legacy` uses the frozen old implementation; `--decoder
prefix-skip` uses the retained decoder. `--decoder bounded` is the rejected
25-frame-from-start experiment. For example, use fresh directories:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/benchmarks/run_idle_phase.ps1 -Phase baseline -Output .tmp/voice-speed/my-baseline -BudgetSeconds 500 -Decoder legacy
powershell -ExecutionPolicy Bypass -File scripts/benchmarks/run_idle_phase.ps1 -Phase candidate -Output .tmp/voice-speed/my-candidate -Baseline .tmp/voice-speed/my-baseline -BudgetSeconds 600 -Decoder prefix-skip -WaveformReplay
.venv/Scripts/python.exe scripts/benchmarks/summarize_voice_generation.py .tmp/voice-speed/my-baseline .tmp/voice-speed/my-candidate
.venv/Scripts/python.exe scripts/benchmarks/check_transcripts.py .tmp/voice-speed/my-candidate --replay
```

`-WaveformReplay` runs length probes and paired old/new waveform decoding in the
same process, lock and remaining phase budget. It reuses captured codec and
reference tensors, alternates decoder order, records actual block inputs and
per-call wall/CUDA timings, checks sample boundaries, and writes listening WAVs.
Nested public-decode and internal-forward timings overlap. Replay instrumentation
is heavier than normal phase instrumentation; use complete full-script cases
for end-to-end comparisons. Speaker cosines are computed in FP32, not BF16.

Use fresh output directories. Each phase permits at most 600 seconds of model
loading and GPU work. The total authorization is 20 minutes, including model
loading and GPU replay. Two full 600-second phases exhaust that budget. When
evaluating another sequential candidate, first charge completed work in a ledger
and cap the next phase below the remaining total, including cleanup margin.
The lock prevents overlap, but does not authorize additional GPU time. The budget
is checked between codec yields, so an in-flight launch or initial model/graph
load can finish after its deadline. Incomplete repetitions are labeled and never
counted as successful full-script runs. A background health monitor aborts a
phase if a backend reappears; it does not cancel application jobs. The wrapper
cannot prevent another user/process from starting an app during a benchmark.

The baseline finds the existing 479-character history script whose current
preset has a 40-second reference. It copies the reference bytes and transcript
unchanged to ignored `inputs/`, then freezes input, model/configuration, chunk,
sampling, language and seed identities in `manifest.json`. Candidates copy and
verify those exact inputs and reject changed models or settings. Private text
is confined to ignored input and isolated storage files, never included in
summary output. Reports contain hashes and lengths. Treat the entire artifact
directory as private: isolated history/queue files contain the benchmark text.

Each fresh process loads the model, measures its first full-script generation
(including graph capture and prompt creation), then three warm full-script
repetitions and a first-chunk diagnostic if time permits. Seeds are paired by
case across phases; they differ between repetitions. The real worker supplies
chunk caps, retries, trimming, stitching, MP3 encoding and persistence. The
benchmark calls it directly, so application queue waiting is zero rather than
part of inference time.

`report.json` records hardware, driver/library versions, peak allocated and
reserved CUDA memory, samples, duration, token count, retries, RTF, finiteness
and clipping. CUDA events and method wrappers exist only in the benchmark.
Synchronization occurs at benchmark boundaries; events resolve after each run.
Nested stage durations are **inclusive**: input preparation contains prompt
resolution and graph capture, codec-next contains prefill, and stitching may
contain trimming. Do not add them together. Codec-next wall times cover only
`next()` calls, excluding consumer/vocoder pauses. Existing streaming timing
dictionaries are cumulative and are deliberately not summed.

Legacy candidate diagnostics separately time old/new codec assembly and suppression
masks with alternating execution order. These are microbenchmarks, not an
end-to-end speedup estimate. The preparation changes are small beside reference
vocoder decoding. The retained prefix-skipping path avoids discarded work while
preserving the old internal decode inputs for generated audio.

Each completed case captures reference tensors and produces a listening MP3 (and, in current runner versions,
the pre-encoding float WAV) and captured codec tensors under
the phase directory. Exact fake-decoder parity tests exercise short streams,
calibration boundaries, final partial pieces, reference-free and reference
inputs. Same-seed sampled generations can still differ: compare captured
decoder inputs before attributing waveform changes to assembly. Finite audio,
duration and clipping checks do not establish intelligibility, clean seams or
voice consistency. Listen to paired files and use an already available offline
transcriber before making those quality claims; no transcription model is
downloaded by this runner. The CPU replay script reconstructs each chunk from
captured tokens, verifies the old/new generated decoder windows, and compares
decoded MP3 PCM. Shared reference prefixes remain unchanged. Its adjacent-sample
measure is a general diagnostic, not a seam-specific listening assessment.

The bounded-history candidate lives in `codec_history_candidate.py` solely for
experiments; ordinary generation retains its original assembly. Suppression
vectorization likewise remains a microbenchmark. See the checked-in
[measurement report](../../docs/voice-speed-results.md) for the retention decision.

Run regression coverage with `npm test` (backend, colocated engine and benchmark
safety tests are included). Targeted checks:

```powershell
$env:PYTHONPATH='engine'
.venv/Scripts/python.exe -m unittest discover -s engine -p test_*.py
.venv/Scripts/python.exe -m unittest discover -s scripts/benchmarks -p test_*.py
```
