# Voice Clone Studio

A local/LAN web dashboard for voice cloning, built around a vendored copy of `FasterQwen3TTS`
(Qwen3-TTS-12Hz-0.6B with CUDA-graph acceleration). Upload a short reference clip, save it as a named voice,
write a script, get a voiceover back as an `.mp3`.

No accounts, no credits, no billing — every request runs as a single local user.

> **Generation is stochastic.** The model samples (`do_sample=True`, nothing is seeded), so the same script
> generated twice produces different audio: different pacing, different pauses, occasionally different
> pronunciation of hard words. That is inherent to the model, not a bug. If you like a take, keep it — you
> cannot reproduce it.

---

## Quick start

```bash
git clone git@github.com:sharjeelfaiq/voice-clone-agent.git
cd voice-clone-agent
bash setup.sh
```

`setup.sh` is idempotent — every step is skipped if already done, so if it fails or you interrupt it, run it
again. It creates `.venv`, installs Python dependencies (~3GB), downloads the model (~2.5GB), writes
`backend/.env`, and builds the frontend.

It deliberately keeps pip's cache/temp **and** the model on the repo's own drive rather than `C:` — this
project pulls roughly 5GB, and the defaults would put all of it on your system drive.

Then start the server:

```bash
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000**.

---

## Requirements

| | |
|---|---|
| OS | Windows 10/11 (64-bit). The code is cross-platform; the launcher scripts are Windows. |
| GPU | NVIDIA, or none — see below |
| Disk | ~10GB (3GB dependencies + 2.5GB model + generated voiceovers) |
| Python | 3.11+ |
| Node | 18+ (frontend build) |

**GPU support.** Torch is pinned to the **cu126** build, which ships kernels for `sm_50` through `sm_90` — so
Maxwell and Pascal cards (GTX 9xx, GTX 10xx) work, as do Turing, Ampere and Ada. This is deliberate: the
cu128 build only covers `sm_75+`, and on an older card `torch.cuda.is_available()` still returns `True`
before every GPU operation dies with `no kernel image is available for execution on the device`.

Blackwell (RTX 50xx, `sm_100`/`sm_120`) needs cu128 instead — change the `--extra-index-url` and both the
`torch` and `torchaudio` pins in `backend/requirements.txt` together.

**No GPU?** It still runs. The backend detects an unusable GPU (it checks the architecture list *and*
executes a test matmul, because `torch.cuda.is_available()` alone lies), falls back to CPU in float32, and
shows a warning banner in the UI. Correct output, but expect **many minutes per chunk**.

---

## Running it

### LAN server (the main way)

One process serves the API and the built frontend on one port, reachable from any device on your network.

```bash
cd frontend && npm run build      # once, and again after any frontend change
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Or double-click **`start_server.bat`** in the repo root, which runs that second command for you.

- On this PC: **http://localhost:8000**
- From other devices: **http://\<this-PC's-LAN-IP\>:8000** (find it with `ipconfig`)

> **Do not open `http://0.0.0.0:8000`.** `0.0.0.0` means "listen on every interface" — it is a bind address,
> not a destination. Browsers reject it with `ERR_ADDRESS_INVALID`.

**Let other devices through the firewall** (once, as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Voice Clone Studio" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

**If port 8000 is already taken** on your machine, pick another and tell clients the new port — nothing on
the frontend side is hardcoded to 8000:

```bash
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8010
```

**Auto-start at login** — use `start_server_silent.vbs` (same thing, no console window) with Task Scheduler:

```powershell
schtasks /create /tn "VoiceCloneStudio" /tr "wscript.exe \"C:\path\to\repo\start_server_silent.vbs\"" /sc onlogon /rl highest /f
```

### Local development (hot reload)

Two terminals, two ports. **`vite.config.ts` has no dev proxy, on purpose**, so the frontend must be told
where the backend is:

```bash
# frontend/.env.local
VITE_BACKEND_URL=http://127.0.0.1:8000
```

```bash
# terminal 1
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# terminal 2
cd frontend && npm run dev        # http://localhost:5173
```

That is cross-origin, so `backend/.env` also needs `ALLOWED_ORIGINS=http://localhost:5173`.

> ⚠️ **Delete or empty `frontend/.env.local` before building for LAN or the installer.** `VITE_BACKEND_URL`
> is baked into the bundle at build time. If it says `127.0.0.1` when you run `npm run build`, every LAN
> client calls *their own* localhost and the app is broken for everyone except this machine.

### Standalone Windows build (frozen desktop app)

Produces a single self-extracting `.exe` for a non-developer machine — no Python, no Node, no source. The
last build came out at **1.66 GB**, expanding to **4.48 GB** on disk.

> **`installer/setup.nsi` cannot build this.** NSIS caps its output at 2,147,483,647 bytes and the payload
> is 4.47 GB — `torch` alone is 3.84 GB of it (`torch_cuda.dll` 999 MB, `cublasLt64_12.dll` 507 MB). Running
> `makensis setup.nsi` does not error: it spins for ~25 minutes, parks its temp file at exactly 2 GB, and
> produces nothing. Use the 7-Zip route below. The NSIS script is kept for the day the payload fits.

Requires `pip install pyinstaller` and 7-Zip (`winget install 7zip.7zip`).

```bash
# 1. Frontend first -- backend.spec hard-fails if frontend/dist is missing.
#    Make sure frontend/.env.local does NOT set VITE_BACKEND_URL.
cd frontend && npm install && npm run build && cd ..

# 2. Freeze. Redirect TEMP off the system drive first -- PyInstaller unpacks
#    several GB through it and will exhaust a small C:.
cd backend  && TMP=../.tmp TEMP=../.tmp ../.venv/Scripts/pyinstaller.exe backend.spec  --clean --noconfirm && cd ..
cd launcher && TMP=../.tmp TEMP=../.tmp ../.venv/Scripts/pyinstaller.exe launcher.spec --clean --noconfirm && cd ..

# 3. Stage the app in the layout launcher.py expects (<root>/backend/backend.exe).
mkdir -p dist/VoiceCloneStudio
cp launcher/dist/VoiceCloneStudio.exe dist/VoiceCloneStudio/
cp -r backend/dist/backend dist/VoiceCloneStudio/backend
mkdir -p dist/VoiceCloneStudio/storage/references dist/VoiceCloneStudio/storage/generated dist/VoiceCloneStudio/models

# 4. Compress. -mx5, not -mx9: the payload is mostly incompressible CUDA DLLs,
#    so maximum compression costs far more time for a couple of percent.
cd dist && "/c/Program Files/7-Zip/7z.exe" a -t7z -m0=lzma2 -mx5 -mmt=on app.7z VoiceCloneStudio

# 5. Prepend the SFX module -> one double-clickable .exe.
cat "/c/Program Files/7-Zip/7z.sfx" app.7z > VoiceCloneStudio-1.0.0.exe
```

The result is a **self-extractor, not an installer**: the recipient runs it, picks a folder, then opens that
folder and runs `VoiceCloneStudio.exe`. There is no Start Menu entry and no uninstaller — uninstalling means
deleting the folder. Their machine needs **~8 GB free**: 1.66 GB download + 4.48 GB extracted (~6.1 GB peak
with both present) plus the 2.5 GB model on first launch.

The build artifact is **not** checked in — `dist/` is gitignored.

**What the user sees on launch.** Double-clicking `VoiceCloneStudio.exe` opens a browser loader within a
second or two, which shows the real startup phase — model download percentage on a first run, then library
load, GPU check, model load — and redirects to the app once the backend is healthy. Double-clicking again
while it is already running just reopens the tab; it never restarts a backend that might be mid-generation.
If startup fails, the loader shows the backend's own error and a **Try again** button, and the backend's
output is kept at `<install>/storage/backend.log`.

**The desktop build listens on `127.0.0.1` only** (`backend/run.py`) and is *not* reachable from other
machines. That is deliberate: binding `0.0.0.0` makes Windows Defender Firewall show an "Allow access /
Cancel" alert on first run, and Cancel writes a permanent Block rule that leaves the app broken with no way
to recover from inside the app. For LAN access use the single-port mode above (`start_server.bat`), which
passes `--host 0.0.0.0` itself and is unaffected.

The `.exe` is unsigned, so Windows SmartScreen still shows "Windows protected your PC → More info → Run
anyway" the first time. Only an Authenticode certificate removes that.

Relevant files: `backend/run.py` (frozen entrypoint: path resolution, first-run model download, loopback
bind), `backend/boot_status.py` (startup phases published to `storage/boot_status.json`),
`launcher/launcher.py` (serves the loader, starts the backend hidden, polls `/api/health`, redirects),
`installer/setup.nsi` (unusable at current size, see above).

### Vercel + RunPod (dormant)

A split deployment: static frontend on Vercel, backend on a RunPod pod that sleeps when idle and is woken by
`frontend/api/wake.ts`. Gated behind `VITE_USE_RUNPOD_WAKE`, which is unset everywhere except that project.
See `DEPLOYMENT.md`. Not used by the LAN or installer paths.

---

## Making a voice that actually works

This matters more than any setting in the app. Three rules, all measured on this hardware.

**1. Keep the reference clip to 10–20 seconds.**

The reference clip and your script share a single 1024-position context window. A clip costs roughly
`duration × 12.5` positions before generation even starts:

| clip length | positions used | what's left for your script |
|---|---|---|
| 15s | ~230 of 1024 | plenty — ~200-character chunks |
| 27s | ~400 of 1024 | comfortable |
| **53s** | **~860 of 1024** | **too little — output degrades** |

When too little is left, the app is forced into chunk sizes below the point where this model starts padding
and dragging — which you hear as murmuring, long pauses, and dropped words. The backend logs a warning when
a preset is in that state. The hard limit is 60s, but **longer is not better**: 15 seconds of clean speech
clones better than 60 seconds of anything.

**2. Record dry and close-mic.** Voice cloning copies the *room*, not just the voice. A reverberant clip
produces reverberant output — measurably so: a clip with a 0.618 reverb tail generated audio at 0.474. No
setting removes it. Record close to the microphone, in a soft-furnished room, and never over speakerphone.

**3. The transcript must match the audio exactly.** Leave the transcript field blank to auto-transcribe with
faster-whisper, or type it yourself — but a wrong or placeholder transcript is the single most common cause
of bad output. The app rejects transcripts that are implausibly short or long for the clip's duration (under
3 or over 22 characters per second), which catches most mistakes.

Accent is **not** a factor. A non-native English clip at the right length performs as well as a native one —
in a direct comparison it produced *less* silence and finished faster.

---

## Using the app

### Voices

- **New preset** — name it, upload a `.wav`/`.mp3` reference clip (2–60s), optionally add a mood tag. Leave
  the transcript blank to auto-transcribe. Saved to `backend/storage/presets.json`, clip to
  `backend/storage/references/`.
- **Preview** — the play button on a card plays the *reference clip itself*, not a live generation.
- **Delete** — removes the preset and its reference audio permanently.

### Scripts

Each script block has its own voice dropdown, its own text (up to 60,000 characters), a live estimated-time
readout, and reorder/remove buttons. "+ Add another script" adds more blocks; **Generate** submits every
valid block to the queue at once.

Language is populated from what the loaded model actually reports supporting.

### Currently Generating

Only one job runs at a time — one worker thread, one GPU lock — so this section shows exactly one row for
the job on the GPU, with a progress bar that advances smoothly between chunk completions rather than jumping.

Anything waiting sits underneath as a compact line you can reorder (^/v) or cancel. A running job can be
canceled too; it stops after the current chunk, within about a second. Failed and canceled jobs stay here
with their error message until you dismiss them.

### Generations

Every finished job: inline playback, download (with a rename field so the file lands with a sensible name),
delete, and **re-queue** (wand icon), which pulls that job's script and voice back into a fresh script block.

Persisted to `backend/storage/history.json`, so it survives a restart.

---

## How generation works

```
script -> chunk_text() -> per-chunk generate -> resample if degenerate -> trim edges -> stitch (200ms gaps) -> .mp3
```

- **Chunk size is per-preset, not fixed.** `_seq_budget()` works out how many characters fit alongside *this*
  preset's reference clip, using the clip's own measured speaking rate. `CHUNK_MAX_CHARS=800` is only a
  ceiling; a second ceiling caps chunks at 200 characters, above which the model starts skipping clauses.
- **Chunks are balanced, not greedily packed**, so there is no undersized final chunk — those are the ones
  that misbehave.
- **Each chunk gets a fresh KV cache**, which is what keeps quality stable however long the script is.
- **Degenerate output is resampled.** Roughly one chunk in three comes out wrong on this model — babbling, or
  stopping short. Each chunk's audio is checked against how long its text should take and regenerated (up to
  3 attempts) if it is wildly off.
- **No partial delivery.** You get audio when the whole job finishes; progress is chunk-level.

Time estimates come from a rolling average of characters/second over the last 20 completed jobs, seeded from
`history.json` at startup. The queue survives a restart (`queue.json`), resuming from the *start* of an
interrupted job.

---

## API

All routes are under `/api`, and every request is the same single local user.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | `model_loaded`, `sample_rate`, `device`, `device_reason` |
| GET | `/api/languages` | Languages the loaded model supports |
| GET | `/api/estimate?chars=N` | Estimated seconds for a script of N characters |
| GET | `/api/presets` | List voice presets |
| POST | `/api/presets` | Create one (multipart: `audio`, `name`, `ref_text`, `language`, `tag`) |
| DELETE | `/api/presets/{id}` | Delete a preset and its reference clip |
| POST | `/api/generate` | Queue a job → `{job_id, total_chunks, estimated_s, queue_position}` |
| GET | `/api/jobs/{id}` | One job's status |
| GET | `/api/queue` | The queue, in real processing order |
| POST | `/api/queue/{id}/cancel` | Cancel a queued or running job |
| DELETE | `/api/queue/{id}` | Dismiss a finished or failed job |
| POST | `/api/queue/reorder` | Reorder queued jobs |
| GET | `/api/history` | Completed generations |
| DELETE | `/api/history/{id}` | Delete an entry and its audio |
| GET | `/api/download/{filename}?name=` | Download with a chosen filename |

Static mounts: `/audio` (generated clips) and `/refs` (reference clips). The SPA catch-all is registered
last, so it can never shadow `/api`.

---

## Configuration

`backend/.env` (copy from `backend/.env.example`):

| Variable | Purpose |
|---|---|
| `MODEL_PATH` | Path to the model snapshot. Written by `setup.sh`. |
| `ALLOWED_ORIGINS` | CORS origins — only needed when the frontend is on a different origin (dev mode). |
| `RUNPOD_API_KEY` / `RUNPOD_POD_ID` | Optional; RunPod idle auto-stop only. |
| `IDLE_CHECK_INTERVAL_MIN` / `IDLE_STOP_THRESHOLD_MIN` | Idle-stop tuning. |

Environment overrides:

| Variable | Purpose |
|---|---|
| `VITE_BACKEND_URL` | Frontend only, **baked in at build time**. Unset means relative paths, which is what LAN mode needs. |
| `DECODE_CHUNK_FRAMES` | Vocoder frames per GPU launch (default 100). Lower it if a slower display GPU trips its watchdog. |
| `REQUIRE_GPU=1` | Makes `setup.sh` fail instead of accepting the CPU fallback. |
| `MODEL_DIR` / `PIP_CACHE_DIR` / `TMP_OVERRIDE` | `setup.sh` paths. |

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ERR_ADDRESS_INVALID` on `0.0.0.0:8000` | That is a bind address. Use `localhost` or the LAN IP. |
| LAN devices cannot connect | Add the firewall rule above, and bind `0.0.0.0`, not `127.0.0.1`. |
| LAN clients load the UI but every action fails | `VITE_BACKEND_URL` was set when you built. Empty `frontend/.env.local` and rebuild. |
| `no kernel image is available for execution on the device` | The torch build has no kernels for your GPU. cu126 covers `sm_50`–`sm_90`; Blackwell needs cu128. |
| `CUDA error: the launch timed out and was terminated` | Windows TDR killed a GPU batch running over ~2s on a display-attached card. Lower `DECODE_CHUNK_FRAMES`, and do not run two model processes at once. |
| Yellow "Running on CPU" banner | No usable GPU was found; the reason is in the banner and in `/api/health`. |
| Output murmurs, drags, or drops words | Almost always the reference clip — see "Making a voice preset that actually works". |
| Output has echo | Reverb in your reference clip. Re-record dry and close-mic. |
| Port already in use | Another app owns it. Start with `--port 8010`. |
| Jobs are slow | Normal on a small GPU. A shorter reference clip gives bigger chunks, fewer of them, and a much faster job. |

---

## Known limitations

- **No accounts.** `auth.py`'s `get_current_user` returns the constant `"local-user"`; presets and history
  are global to the instance.
- **Single GPU, serialized.** CUDA graphs are not reentrant, so all generation sits behind one lock.
  Multiple users share one FIFO queue.
- **In-memory job state.** Finished and failed job status lives in process memory, so a restart loses it.
  Queued work and completed history are on disk.
- **No cross-chunk prosody.** Chunks are independent, so pacing resets at each boundary.
- **No partial audio delivery.** Streaming is used internally so cancel lands quickly, not to stream to the
  client.
- **Not reproducible.** Sampling is unseeded — see the note at the top.
- **No test suite.** There is no pytest, no vitest, no test files. Verification is `npm run lint`,
  `npm run build` (which is also the typecheck), and running the app. Do not trust any claim that tests pass.
- **No pagination or search** in the preset and history lists.

---

## Repo layout

```
qwen/          Vendored FasterQwen3TTS (CUDA-graph Qwen3-TTS wrapper). Treat as third-party.
backend/
  main.py            FastAPI app: model load, REST API, job queue, worker thread
  text_chunker.py    Splits scripts into chunks (sentence -> clause -> word fallback), balanced
  audio_stitcher.py  Trims chunk edge silence, concatenates with a gap
  audio_convert.py   wav/mp3 conversion
  auth.py            Single-user stub
  storage/           presets.json, history.json, queue.json, generated/, references/  (gitignored)
frontend/      React 19 + Vite + TypeScript dashboard
launcher/      Frozen-app launcher (PyInstaller)
installer/     NSIS installer script
setup.sh       One-shot idempotent installer
start_server.bat / start_server_silent.vbs   LAN server launchers
```

Further reading: `CLAUDE.md` (architecture and the hard-won gotchas), `workflow.md` (day-to-day usage),
`DEPLOYMENT.md` (Vercel + RunPod), `qwen/HOW_TO_RUN.md` (the model wrapper itself).
