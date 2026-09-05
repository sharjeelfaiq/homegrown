# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Voice Clone Studio: a local/LAN voice-cloning dashboard around a **vendored** `FasterQwen3TTS`
(Qwen3-TTS-12Hz-0.6B) wrapper. Users create named voice presets from a short reference clip, batch-submit
scripts, and get generated `.mp3` back through a queue + history UI. No accounts, no billing — `auth.py`'s
`get_current_user` is a stub that returns the constant `"local-user"` for every request, and every stored
record carries that as `user_id`.

## Commands

There is **no test suite** in this repo — no pytest, no vitest, no test files. Verification is manual
(browser flow) or by running the backend against the real model. Don't claim tests pass; there are none to
run.

```bash
# Backend dev (loads the model on startup; needs CUDA + backend/.env with MODEL_PATH)
cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Frontend dev (needs frontend/.env.local -> VITE_BACKEND_URL=http://127.0.0.1:8000)
cd frontend && npm run dev          # http://localhost:5173

cd frontend && npm run lint         # oxlint (see .oxlintrc.json)
cd frontend && npm run build        # tsc -b && vite build -> frontend/dist  (this is the typecheck too)
```

**LAN / single-port mode** (what the office deployment actually uses): `cd frontend && npm run build`, then
run `start_server.bat` from the repo root — it activates the repo-root `.venv` and serves API + built
frontend from one uvicorn process on `0.0.0.0:8000`. `start_server_silent.vbs` is the same thing with no
console window (for Task Scheduler auto-start).

**Rebuild the Windows installer** (order matters — `backend.spec` hard-fails if `frontend/dist` is missing):

```bash
cd frontend && npm install && npm run build && cd ..
cd backend && pyinstaller backend.spec --clean --noconfirm && cd ..
cd launcher && pyinstaller launcher.spec --clean --noconfirm && cd ..
cd installer && makensis setup.nsi && cd ..
```

## Architecture

### Request path

```
Browser --> FastAPI (backend/main.py, one process, :8000)
              |-- /api/*        REST
              |-- /audio, /refs StaticFiles mounts (generated clips, reference clips)
              |-- catch-all     serves frontend/dist (registered LAST so /api never gets shadowed)
              |-- _worker_loop  single daemon thread -> FasterQwen3TTS -> GPU
              |-- storage/*.json  presets / history / queue (flat files, FileLock'd, gitignored)
```

`backend/main.py` (~1100 lines) is the whole backend — jobs, queue, timing estimates, RunPod idle-stop,
routes. The other backend modules are small and single-purpose (`text_chunker`, `audio_stitcher`,
`audio_convert`, `auth`).

### Generation pipeline — why it's chunked

`max_seq_len=1024` bounds one CUDA-graphed generation call. Past that, audio doesn't just stop — quality
collapses as rope positions extrapolate out of validated range. So long scripts are split, never streamed
as one call:

```
text -> chunk_text(_seq_budget(preset)) -> per-chunk generate (fresh KV cache each) -> stitch_audio(200ms gap) -> write_mp3
```

The chunk size is **not** the static `CHUNK_MAX_CHARS=800` — that value is only the ceiling, and it was
calibrated for a ~3.5s reference clip. The reference and the script share one `max_seq_len` window, so
`_seq_budget()` in `main.py` derives the per-chunk char budget (and `max_new_tokens`) from what the
preset's clip actually leaves: `available = MAX_SEQ_LEN - margin - ref_frames - ref_text_tokens`. A 53.5s
clip costs ~860 of 1024 positions on its own. When the clip leaves less than `MIN_GEN_FRAMES`,
`/api/generate` rejects the job rather than emitting garbage.

Three things that were each learned the hard way, all measured on this machine:

- **Speaking rate is per-preset, not a constant.** `len(ref_text) / clip_duration` — two real presets
  measured 14.4 and 11.2 chars/sec. A hardcoded rate starves the slower voice and truncates its chunks.
- **Chunk size has a sweet spot and fails in BOTH directions.** Same text, produced vs expected:
  380 chars → 89% (clauses silently dropped), 190 → 95%, 110 → 151% (padded, murmuring). Hence
  `ELISION_SAFE_CHUNK_CHARS` as a second ceiling, and a warning below `PADDING_SAFE_MIN_CHARS` where the
  real fix is a shorter reference clip. The original "murmur and long silence" reports were the low end.
- **`max_new_tokens` must be per chunk, not per job** (`_chunk_token_cap()`). Sized from the largest chunk,
  a short final chunk gets the whole allowance and babbles to the cap — observed as 33s of unintelligible
  audio appended to a finished 82s read. Headroom there is additive (`_CHUNK_CAP_HEADROOM_FRAMES`), not a
  percentage: pauses from `...` don't scale with character count, and a proportional cap cut the last line.

- **`chunk_text` balances chunk sizes; it is not greedy.** Greedy packing leaves the last chunk holding the
  remainder (one script gave `[138, 164, 188, 174, 195, 186, 75]`), and that runt is the chunk that sits
  near its frame cap, drops its closing words and murmurs. `_pack()` runs a partition DP over the same
  chunk count greedy would use, so count never rises and `max_chars` is never exceeded — only boundaries
  move. Packing to a smaller limit does NOT achieve this: greedy at any limit below 195 gave nine chunks
  instead of seven. Removing the runt took total silence from 16.2s to 0.0s on the test script.

- **Chunks degenerate stochastically, so bad samples are detected and regenerated.** The same chunk with
  identical settings produced 115%, 105%, 233%, 177%, 96% and 94% of its expected duration across six runs
  — roughly a third of samples babble (including sentences that are nowhere in the script) or stop short.
  Punctuation is not the trigger: stripping markdown and smart quotes changed nothing. No parameter fixes a
  coin flip, so `_process_job` checks each chunk's audio against `_chunk_duration_is_sane()` and resamples
  outside 0.6–1.6× expected, up to `CHUNK_ATTEMPTS`. **This is why a single clean run proves nothing here**
  — every earlier fix reduced the failure *rate*, which makes one-run verification read as a cure.

Verify changes here by transcribing the output and diffing against the script, not by comparing durations —
duration ratios cannot tell padding from a legitimately long read. `faster_whisper` is already a dependency.
Run it more than once: with a per-chunk failure rate this high, n=1 is a coin flip, not evidence.

Each chunk calls `generate_voice_clone_streaming` — **not** for delivery (the client only gets audio when
the whole job finishes) but so a cancel lands within ~1s instead of waiting out an ~85s chunk. One retry
per chunk; a `"CUDA error"` short-circuits the retry because the process's CUDA context is dead anyway.

### Concurrency model

One global `_gen_lock` serializes *all* generation, and one worker thread drains `_pending_job_ids` FIFO.
This is deliberate: `PredictorGraph`/`TalkerGraph`'s CUDA graphs and static buffers are not reentrant.
Multiple users queue behind each other — don't "fix" this with a thread pool.

Lock discipline in `main.py`: `_jobs_lock` (job dict + queue lists), `_store_lock` (presets/history
in-memory lists), `_timing_lock`, `_gen_lock` (GPU). Helpers suffixed `_locked` assume the caller already
holds `_jobs_lock`.

### Persistence

Flat JSON in `backend/storage/` (gitignored), written via temp-file + `.replace()` under a `FileLock`.
`queue.json` holds only queued/in-flight jobs and is replayed on startup (`_restore_queue_on_startup`) —
resumed **from the start of the job**, not mid-chunk. Completed jobs live in `history.json`; the job dicts
themselves (`_jobs`) are in-memory only, so a restart loses status of finished/failed jobs.

Time estimates are a rolling `chars/second` average over the last 20 completed jobs, seeded from
`history.json` on boot so estimates are sane immediately after a restart.

### Frontend

React 19 + Vite + TS. Two routes only (`App.tsx`): `/` LandingPage, `/studio` StudioShell. No state library —
`StudioShell.tsx` holds most state, plus two contexts:
- `GenerationActivityContext` — the **single** queue poller for the whole app (1s while active, 4s idle,
  paused in background tabs). Add queue reads there, not as new polls.
- `AudioActivityContext` — playback amplitude for the decorative waveform/orb visuals.

All API calls go through `src/api.ts`, which prefixes every path with `VITE_BACKEND_URL` when it's set —
an absolute URL, since `vite.config.ts` deliberately has no dev proxy, so dev mode needs it. Unset, the
prefix is `''` and every call is a relative path, which is exactly what single-port/LAN and installer mode
rely on.

### Deployment modes (there are four, sharing one codebase)

1. **Local dev** — Vite :5173 + uvicorn :8000, cross-origin, needs `ALLOWED_ORIGINS`.
2. **LAN single-port** — built `frontend/dist` served by FastAPI on :8000. The current primary target.
3. **Frozen desktop installer** — `backend/run.py` is the PyInstaller entrypoint (path resolution +
   first-run HF model download); `launcher/launcher.py` starts `backend.exe` hidden, polls `/api/health`,
   opens the browser; `installer/setup.nsi` is the per-user NSIS installer.
4. **Vercel + RunPod split (dormant)** — `frontend/api/wake.ts` resumes a stopped pod, backend's
   `_idle_stop_loop` stops it again when idle *and* the queue is empty. Gated client-side by
   `VITE_USE_RUNPOD_WAKE`; unset everywhere except the Vercel project. See `DEPLOYMENT.md`. Whether to keep
   this path is an open decision (`HANDOFF.md` §6) — don't delete it unprompted.

## Gotchas

- **`VITE_BACKEND_URL` is baked in at build time, including `npm run build`.** If `frontend/.env.local`
  sets `http://127.0.0.1:8000` when you build for LAN mode, every LAN client calls *their own* localhost and
  the app is broken for everyone but the GPU machine. Unset it (or set it empty) before a LAN/installer build.
- **`FRONTEND_DIST` is checked once at import time.** If `frontend/dist` doesn't exist when the backend
  process starts, the SPA route never registers for that process's life. Build the frontend *before*
  starting the backend, or restart it.
- **Torch is pinned to the cu126 build, deliberately** (see `backend/requirements.txt` header). cu128 ships
  kernels only for `sm_75+`; on older cards (Maxwell GTX 9xx = `sm_52`) every GPU op dies with
  `no kernel image is available for execution on the device`. cu126 still ships `sm_50` cubins, which run on
  `sm_52`, covering `sm_50`–`sm_90`. Blackwell (`sm_100`/`sm_120`) needs cu128 — switch the index and both
  pins together. The file carries `--extra-index-url` in its header, so a single
  `pip install -r backend/requirements.txt` resolves everything.
- **Never trust `torch.cuda.is_available()` here.** It returns `True` for a GPU this torch build cannot run
  a single kernel on. Use `resolve_device()` / `cuda_is_usable()` in `qwen/utils.py` — they check the arch
  list *and* execute a test matmul. `lifespan()` and `FasterQwen3TTS.from_pretrained` both go through it;
  `from_pretrained` now defaults to `device="auto"`.
- **CPU fallback exists, as a last resort.** With no usable GPU, `from_pretrained` builds no CUDA graphs and
  generation routes through `parity_generate_streaming` (`qwen/streaming.py:182`) in float32. Correct
  output, but many minutes per chunk. `/api/health` reports `device`/`device_reason` and the Studio UI shows
  a warning banner. `generate_custom_voice_streaming` / `generate_voice_design_streaming` have no parity
  path and raise via `_require_graphs` on CPU.
- **Some pins are marked `sys_platform == "linux"` and must stay that way.** `nvidia-*-cu12` (torch's
  Windows wheel already bundles those DLLs in `torch/lib` — see `backend/backend.spec` — so installing them
  duplicates 3-4GB) and `triton`/`uvloop` (no Windows wheels at all; unmarked they abort the entire install
  with "No matching distribution found").
- **`setup.sh` is the one-shot installer.** Idempotent, and it keeps pip's cache/temp plus the model on the
  repo's own drive — the defaults live on `C:` and this project pulls ~5GB.
- **`CHUNK_MAX_CHARS=800` / `max_seq_len=1024` / `MAX_REF_AUDIO_SECS=60` are empirical, GPU-specific
  numbers**, tuned on a 4GB GTX 960 (see `gpu.txt`, `qwen/HOW_TO_RUN.md`). Raising them is plausible on
  bigger cards but untested; reference clips over ~23s previously produced garbled/looping output.
  `CHUNK_MAX_CHARS` is now only a ceiling — `_seq_budget()` lowers it per preset (see above). The failure
  it fixes: a 53.5s clip + an 876-char script asked for ~1729 positions against 1024, and the output came
  back as murmur and long silence (54.4s of audio holding ~20s of speech) rather than as an error.
- **The vocoder decodes in bounded launches (`DECODE_CHUNK_FRAMES=100` in `qwen/faster_qwen3_tts.py`).**
  The vendored `chunked_decode` defaults to 300 frames = 25s of audio per GPU launch, which takes ~4s on a
  GTX 970 — over Windows WDDM's 2s TDR watchdog, which kills the kernel and the CUDA context with
  `cudaErrorLaunchTimeout`. Anything that raises per-launch decode work risks reintroducing this on
  display-attached GPUs.
- **`MAX_SCRIPT_CHARS` in `frontend/src/constants.ts` must stay in sync with `MAX_TOTAL_CHARS` in
  `backend/main.py`** (60,000). Nothing enforces this.
- **`qwen/` is vendored, not a pip package.** In dev, `main.py` inserts the repo root into `sys.path`; when
  frozen, `backend.spec` ships `qwen/` as raw data at the bundle root. Treat it as third-party — edit only
  with a reason.
- **`/api/queue` sorts by real position in `_pending_job_ids`**, not `_jobs` insertion order; reorder only
  splices the requesting user's own jobs so a shared FIFO can't be jumped.
- **Doc hierarchy.** `README.md` (setup, features, troubleshooting) and this file are the maintained docs;
  `workflow.md` covers day-to-day usage and is current. `HANDOFF.md` and `DEPLOY_SPEC.md` carry explicit
  "historical" banners and `DEPLOYMENT.md` documents the dormant Vercel+RunPod path -- treat those three as
  context, not current behaviour, and verify against source.
- **Two things the UI does not do, despite appearances.** `startGenerate()` sends only
  `preset_id`/`text`/`language`, so Style/Stability never leave the browser (the backend defaults to
  `natural`/`balanced`), and no preset is ever `is_builtin`, so the voice gallery's "Studio Voices" section
  never renders.
- **`backend/migrate_to_multiuser.py` is dead** — a one-shot script from the abandoned Clerk multi-tenant
  detour. Don't wire it into anything.

## Other agent configs

Codex (`~/.codex/config.toml`) and Gemini CLI (`~/.gemini/settings.json`) configs exist on this machine.
Reply `/import` to scan and list what's importable (MCP servers, slash commands, subagents, skills,
instructions), then `/import --yes=<digest>` with the digest from the scan output to apply the user-level
items. If `/import` isn't available on this surface, run `claude import` from a terminal instead.
