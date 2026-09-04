# Voice Clone Studio (local dashboard for FasterQwen3TTS)

A local web dashboard around the `qwen` package's `FasterQwen3TTS` — modeled after
[clonevoiceprompt.online/dashboard](https://clonevoiceprompt.online/dashboard)'s core generation flow:
named, reusable voice presets, style/stability controls, script input, generation history, and
play/download — **without** accounts, credits, or billing, which remain intentionally out of scope for
this local MVP.

```
qwen/       Vendored FasterQwen3TTS package (CUDA-graph-accelerated Qwen3-TTS wrapper) --
            see qwen/README.md and qwen/HOW_TO_RUN.md
backend/
  main.py             FastAPI app: loads FasterQwen3TTS once, serves the REST API, runs
                      generation jobs in a background thread
  text_chunker.py     Splits a script into TTS-safe chunks (sentence boundaries first,
                      clause/word-boundary fallback for oversized sentences)
  audio_stitcher.py   Concatenates per-chunk audio with a silence gap between chunks
frontend/   React + Vite + TypeScript dashboard
start_server.bat          One-click launcher for the always-on LAN server mode (see Run below)
start_server_silent.vbs   Same, with no console window -- for auto-start-at-login setups
```

## Installing on another PC (Windows installer)

For a non-developer to run this on their own Windows machine, you only need to give them **one file**:
`dist/VoiceCloneStudio-Setup-1.0.0.exe` (~1.5GB). Nothing else from this repo is needed on the target
machine -- no Python, no Node, no source code, no `.venv`. The installer bundles a frozen `backend.exe`
(Python + torch/CUDA + every dependency), the built frontend, and a launcher exe into one package.

**Target machine requirements:**
- Windows 10/11, 64-bit
- An NVIDIA GPU with up-to-date drivers (CUDA-enabled torch is bundled, but the driver/GPU itself is not --
  the app shows a clear error dialog if no compatible GPU is found instead of a cryptic crash)
- Internet connection the *first* time it runs, to download the ~2.5GB Qwen3-TTS model snapshot (nothing
  further needed after that -- fully offline afterward)
- ~10GB free disk (bundle + model + generated audio storage)

**What the user does:** double-click `VoiceCloneStudio-Setup-1.0.0.exe` → Next/Next/Install (no admin
rights required -- it installs per-user to `%LOCALAPPDATA%\Programs\VoiceCloneStudio`) → double-click the
"Voice Clone Studio" desktop shortcut it creates. That launches the backend hidden in the background and
opens `http://localhost:8000` in their default browser. Closing the browser tab does *not* stop the app --
it keeps running in the background so re-opening the shortcut just reopens the tab; use the Start Menu
uninstaller entry to fully stop and remove it.

**Rebuilding the installer** (after any backend/frontend code change), from the repo root:
```bash
cd frontend && npm install && npm run build && cd ..
cd backend && pip install pyinstaller && pyinstaller backend.spec --clean --noconfirm && cd ..
cd launcher && pyinstaller launcher.spec --clean --noconfirm && cd ..
cd installer && makensis setup.nsi && cd ..
```
Output lands at `dist/VoiceCloneStudio-Setup-1.0.0.exe`. See `backend/run.py` (frozen-mode entrypoint:
model path resolution, first-run model download), `backend/backend.spec` (PyInstaller bundling --
`collect_all` for torch/transformers/etc. plus the vendored `qwen/` package and built `frontend/dist`
as raw data), `launcher/launcher.py` (starts `backend.exe` hidden, waits for `/api/health`, opens the
browser, shows friendly errors for missing GPU/timeout), and `installer/setup.nsi` (NSIS script; per-user
install, no UAC, with an uninstaller that asks before deleting `storage/`).

## Prerequisites

Follow `qwen/HOW_TO_RUN.md` first — CUDA-enabled torch, `qwen-tts`, `soundfile`, and a downloaded
model snapshot. This app reuses those exact same settings (`dtype=bfloat16`, `attn_implementation="sdpa"`,
`max_seq_len=1024`), tuned for a 4GB GPU.

Also needed:
```bash
pip install -r backend/requirements.txt
```
```bash
cd frontend
npm install
```

## Configure

Copy `backend/.env.example` to `backend/.env` and set `MODEL_PATH` to your local model snapshot path
(the same one from `HOW_TO_RUN.md` step 3).

## Run

**Local development** (hot reload, two terminals):

```bash
# Terminal 1 -- backend (loads the model; first startup takes a few seconds)
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2 -- frontend (proxies /api and /audio to the backend, see vite.config.ts)
cd frontend
npm run dev
```

Open **http://localhost:5173**.

**Always-on server** (single process/port, reachable from other devices on the network):

```bash
cd frontend && npm run build   # one-time, and again after any frontend change
```

Then run `start_server.bat` (already at the repo root, no need to create it yourself), which starts
`python -m uvicorn main:app --host 0.0.0.0 --port 8000` from `backend/`. This builds one process that
serves both the API and the built frontend from the same port, so it's reachable at
`http://<this-machine's-LAN-IP>:8000` (find that IP with `ipconfig`) from any device on the network —
no separate frontend server, no CORS to configure.

*Running it:*
- **Manually**: double-click `start_server.bat` in File Explorer, or run it from a terminal
  (`.\start_server.bat`). The console window stays open showing server logs — closing it stops the server.
- **Desktop shortcut**: right-click `start_server.bat` → *Show more options* → *Send to* →
  *Desktop (create shortcut)*. Rename it and, optionally, right-click → *Properties* → *Change Icon*
  to give it its own icon. Double-clicking that shortcut is then equivalent to running the `.bat` directly.
- **Auto-start at login** (no manual click needed): use `start_server_silent.vbs` instead, which runs the
  same `.bat` with no visible console window — point a Windows Task Scheduler task at it with an
  "At log on" trigger, e.g. (run as Administrator, adjust the path to match where you cloned this repo):
  ```powershell
  schtasks /create /tn "VoiceCloneStudio" /tr "wscript.exe \"C:\path\to\repo\start_server_silent.vbs\"" /sc onlogon /rl highest /f
  ```
- **Allowing other devices to connect**: Windows Firewall blocks inbound connections by default, so LAN
  devices can't reach it until you allow the port once (run as Administrator):
  ```powershell
  New-NetFirewallRule -DisplayName "Voice Clone Studio" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
  ```

## Using it

1. **Saved presets** — lists previously saved voice presets; click "Use" to select one for generation, or
   "Delete" to remove it (and its reference audio) permanently.
2. **New preset** — name a preset, upload a short reference `.wav`/`.mp3` and its exact transcript, click
   "Save preset". It's immediately selected and persisted to disk (`backend/storage/presets.json`).
3. **Style & stability** — Natural/Clear/Expressive/Dramatic maps to the model's `instruct` prompt;
   Stable/Balanced/Creative maps to temperature/top-p/top-k.
4. **Script** — pick a language (populated from what the loaded model actually supports) and enter text
   (capped at 60,000 characters total — see the chunked pipeline below for how long scripts are actually
   generated on this hardware).
5. **Generate** — kicks off a generation job and shows live progress (`Generating... chunk N/M`) on the
   button while it runs; once done, produces a playable/downloadable `.wav` and adds an entry to History.
6. **History** — every generation is logged (preset used, text, style/stability, duration, timestamp)
   with inline playback, download, and delete, persisted to disk (`backend/storage/history.json`).

## Long-form generation: chunked pipeline

`max_seq_len=1024` bounds how much a *single* CUDA-graphed generation call can prefill+decode on this
4GB card. Past that, generation either hard-stops or — worse — audio quality degrades as the talker's
rotary position embeddings extrapolate past the range this model/config was validated for (it starts
slowing down, then trails off into non-speech noise). Rather than raising that number (which doesn't
fix the quality problem, and still caps the script length hard), long scripts are split into pieces and
generated independently:

```
Text  -->  Chunker  -->  TTS (per chunk, fresh KV cache)  -->  Stitcher  -->  Final .wav
```

- **Chunker** (`backend/text_chunker.py`) splits the script at sentence boundaries, greedily packing
  multiple sentences into each chunk up to `CHUNK_MAX_CHARS` (800 chars — the empirically-tested-safe
  size for `max_seq_len=1024` with a short reference clip, see `qwen/HOW_TO_RUN.md`). A single sentence
  longer than that falls back to clause boundaries, then word boundaries — text is never split mid-word.
- **Per-chunk generation** (`backend/main.py`, `_run_generate_job`) calls `generate_voice_clone` once per
  chunk. Each call gets its own fresh KV cache and rope state (this is what keeps quality stable no
  matter how many chunks came before — no chunk's cache position ever approaches `max_seq_len`). One
  retry per chunk on failure; a chunk that still fails aborts the job with a clear
  `"Chunk N/M failed: ..."` error rather than silently producing corrupt/partial output.
  - **v1 has no cross-chunk context carryover** — chunks are fully independent, so there's no prosody
    continuity across a chunk boundary (voice/style stay consistent since preset+style+stability are
    reapplied per chunk, but pacing/intonation resets per chunk). A short trailing-context-with-audio-trim
    approach was considered but deferred as unnecessarily fragile for v1; correctness over seamlessness.
- **Stitcher** (`backend/audio_stitcher.py`) concatenates the per-chunk audio with a 200ms silence gap
  between chunks to avoid clicky seams, and writes one final `.wav`.

Because a 60,000-character script can take well over an hour to generate sequentially on this GPU,
`/api/generate` returns immediately with a `job_id` instead of blocking:

- `POST /api/generate` → `{"job_id": "...", "total_chunks": N}` (job runs in a background thread)
- `GET /api/jobs/{job_id}` → `{"status": "running"|"done"|"error", "chunks_done": i, "total_chunks": N, "audio_url": ..., "error": ...}`

The frontend polls the job endpoint once a second and reflects `chunks_done`/`total_chunks` directly on
the Generate button.

## Known limitations (by design, for this local MVP)

- **No accounts/credits/billing.** Presets and history are global to this single local instance — there's
  no concept of separate users.
- **Single GPU, serialized requests.** `PredictorGraph`/`TalkerGraph`'s CUDA graphs and static buffers
  aren't reentrant, so the backend holds a global lock during generation — concurrent requests (and
  concurrent chunks within and across jobs) queue up rather than running in parallel. Fine for one local
  user, not for real multi-user traffic.
- **60,000 character script limit, but real wall-clock time scales with it.** Long scripts are chunked
  (see above) so they no longer degrade into noise or hard-fail, but generation is still sequential —
  60,000 characters is roughly 75 chunks and can take **over an hour** on this GPU. There's no cross-chunk
  prosody carryover in v1 (see above) and no partial-audio delivery — the frontend only gets audio once
  the whole job finishes; `chunks_done`/`total_chunks` progress is the only feedback during that time.
- **In-memory job state.** `_jobs` (job status/progress) lives in the backend process's memory, not on
  disk — restarting the backend mid-job loses that job's progress (though already-completed jobs' History
  entries are unaffected, since those are persisted separately).
- **Streaming used for cancellation, not delivery.** Each chunk now calls `generate_voice_clone_streaming`
  (`qwen/streaming.py`) internally so a canceled job stops within about a second instead of waiting for
  the whole chunk, but the client still only receives audio once a chunk (and the whole job) finishes --
  streaming finished audio to the client as it's generated is a natural next step, just deferred.
- **No pagination/search.** Preset and history lists render in full — fine at local, single-user scale.

## Verified

Backend endpoints (`/api/health`, `/api/languages`, `/api/presets` CRUD, `/api/history` list/delete,
`/api/generate`, `/api/jobs/{id}`), the concurrency lock, **persistence of presets and history across a
backend restart**, and the full browser flow (create preset → select → style/stability → script →
generate → history → delete) have all been exercised end-to-end, producing real, non-silent generated
speech.

The chunked pipeline specifically was verified against the real model (not mocked): a multi-sentence
script correctly split into multiple chunks, each generated independently, stitched into one valid
non-silent `.wav`, with the Generate button showing live `chunk N/M` progress in a real browser session
(Playwright) and reverting to `Generate` on completion, zero console errors.
