# HANDOFF.md

Generated from actual repo state (`git log`, source files, config) — not from memory. Items I couldn't
verify directly are marked **TODO: verify**.

## 1. Project Summary

**Voice Clone Studio** is a local/LAN voice-cloning dashboard built around a vendored `FasterQwen3TTS`
(Qwen3-TTS-12Hz-0.6B) model: users create named voice presets from a short reference clip, write scripts,
and generate cloned-voice audio with style/stability controls, a processing queue, and generation history.
Modeled after clonevoiceprompt.online's dashboard flow, but intentionally without real multi-user
accounts/billing.

**Current stage**: working MVP, single-machine deployment. It went through an abandoned multi-tenant SaaS
detour (Clerk auth + per-user credits + split Vercel/RunPod cloud deployment) that was mostly unwound in
favor of a single-local-user model, now being set up as an always-on LAN server for ~5 employees on one
office GPU machine. The leftover credits/plans system from that detour has since been fully removed
(see §3, §4).

## 2. Architecture Overview

**Stack**:
- Backend: Python / FastAPI (`uvicorn`), `torch==2.11.0+cu128` + `torchaudio==2.11.0+cu128` (CUDA 12.8
  wheels — **must** match this, not cu13 or a bare `torch` install), `transformers==4.57.3`,
  `qwen-tts==0.1.1`, `faster-whisper==1.2.1` (CPU, for auto-transcribing reference clips), `soundfile`,
  `filelock`, `python-dotenv`. Full list: `backend/requirements.txt` (116 packages).
- Frontend: React 19 + TypeScript + Vite 8, `framer-motion`, `@react-three/fiber`/`drei`/`three` (ambient
  visuals), `react-router-dom`. No state management library — a couple of React Contexts
  (`GenerationActivityContext`, `AudioActivityContext`) plus local component state.
- `qwen/`: vendored `FasterQwen3TTS` wrapper (CUDA-graph-accelerated inference) — not a pip package, lives
  in-repo. See `qwen/README.md` / `qwen/HOW_TO_RUN.md`.

**Component diagram (current primary path — local/LAN)**:
```
Browser (any LAN device) --> FastAPI (backend/main.py, one process, port 8000)
                                 |-- serves built frontend/dist (same origin, no CORS needed)
                                 |-- REST API (/api/*)
                                 |-- background worker thread (_worker_loop) -> FasterQwen3TTS -> GPU
                                 |-- storage/*.json (presets, history, queue) -- flat files, filelocked
```

**Secondary/dormant path (cloud split-deployment, built but not the current focus)**:
```
Vite/React frontend (Vercel) --> frontend/api/wake.ts (Vercel serverless fn, wakes/polls RunPod pod)
                               --> FastAPI backend (RunPod pod, proxy domain, separate origin, CORS live)
```
Env vars for that path: see `DEPLOYMENT.md`. **TODO: verify** whether this path is still wanted or should
be removed — the project has since pivoted to a local GPU + LAN model.

**Ports**: backend 8000 (FastAPI/uvicorn), frontend dev server 5173 (Vite, dev-only — production/LAN mode
serves everything from 8000). No database — flat JSON files in `backend/storage/` (gitignored).

**Deployment specifics**: no RunPod pod ID / Vercel project name found hardcoded in tracked files (only
referenced generically via env vars in `DEPLOYMENT.md`). **TODO: verify** current RunPod pod ID / Vercel
project if that path is still in use — not present in this repo's tracked files.

## 3. Current State

**Working end-to-end** (exercised this session, including live browser testing):
- Voice presets (create/preview/delete), auto-transcription via faster-whisper if transcript left blank
- Multi-script batch submission → job queue → live progress → history, with inline playback/download
- Long-script chunking (`text_chunker.py`) with independent per-chunk KV cache (`audio_stitcher.py` stitches)
- Queue reorder (↑/↓), cancel-while-queued, cancel-while-processing (near-instant, ~1–1.5s, via
  `generate_voice_clone_streaming` instead of the blocking call), delete for canceled/failed queue entries
- Persistence of presets/history/queue across a backend restart
- Single local user, no login friction (Clerk fully removed)

**Partially built / in progress**:
- **RunPod+Vercel split-deployment path** (`DEPLOYMENT.md`, `frontend/api/wake.ts`, idle-auto-stop loop in
  `main.py`) — built and documented, but not the currently-active deployment target.
- **Streaming to the client** — chunk generation now uses the streaming API internally (added this session,
  for fast cancellation), but the frontend still only receives audio once a whole chunk finishes, not
  progressively.
- **LAN server launcher** (`start_server.bat`, `start_server_silent.vbs`, README "Always-on server"
  section) — written and documented this session, but **not yet verified from an actual second device on
  the network**. TODO: verify end-to-end.

**Known bugs** (specific):
1. **`frontend/.env.local` sets `VITE_BACKEND_URL=http://127.0.0.1:8000`.** Vite bakes this into
   `npm run build` output too, not just dev. If the LAN-server build (`frontend/dist`, served by the
   backend on the GPU machine) is built while this file is present, every LAN client's browser will try to
   call *their own* `127.0.0.1:8000` instead of the GPU server — breaking the app for everyone except
   someone browsing from the GPU machine itself. **Not yet fixed.** Fix: unset/rename `.env.local` (or set
   `VITE_BACKEND_URL=` empty) before running `npm run build` for LAN mode.
2. `planm.md` (repo root, **untracked**, never committed) is a stale planning note referencing Clerk env
   vars (`CLERK_SECRET_KEY`, `CLERK_JWKS_URL`) that no longer apply. Harmless, safe to delete.
3. Two git remotes exist with very different histories: `origin` (this repo, actively maintained) and
   `localhost-tool` (`voice_over_tool_localhost`), which was force-overwritten in a prior session to match
   `origin`, discarding an unrelated Electron-desktop-app scaffold (`desktop/`, `electron-builder.yml`)
   that lived there. That old state is recoverable only briefly via GitHub's orphaned-commit URL
   (`b041d46...`), not indefinitely.

## 4. Recent Changes

From `git log --oneline -13` (most recent first):
```
45bfdd4 Add LAN server launcher scripts for always-on office deployment
973d884 Make cancel-while-processing near-instant via streaming generation
81c0715 Fix queue reorder display order; add cancel-while-processing and delete for dead jobs
247deda Remove Clerk auth in favor of single local user
dfdef5b fix: add crossOrigin anonymous to audio elements for Web Audio API CORS
a5c62b9 fix: add @types/node and api to tsconfig.app.json
f129895 Split deployment: Vercel frontend + on-demand RunPod backend
b9046b7 Add Clerk auth, per-user credits/plans system, and RunPod deployment support
80f1161 / c04c404 Add delete confirmation modal, animated new-voice toggle, and glass styling
8f7dda8 Add job queue, time estimates, multi-script batch UI, dark redesign, and direct MP4 generation
044f028 Vendor qwen (FasterQwen3TTS) package into the repo, make import path portable
2571c74 Initial commit
```

**This session's work** (not yet reflected further back than `247deda`):
1. Fixed the queue reorder buttons — `/api/queue` returned entries in submission order instead of sorted
   by actual position, so reordering worked internally but the UI never visibly moved rows.
2. Added delete for canceled/failed queue entries (previously stuck in the list forever with no way to
   clear them).
3. Added cancel-while-processing with a confirmation modal, then made it near-instant (~1–1.5s instead of
   waiting up to the full chunk duration, sometimes 85s+) by switching chunk generation to
   `generate_voice_clone_streaming` and checking the cancel flag after each ~1s audio piece instead of only
   at chunk boundaries.
4. Explored turning the app into a desktop app (discussion only, no code committed in this repo).
5. Built the LAN-server rollout: `start_server.bat`/`start_server_silent.vbs`, `backend/.env.example`,
   README updates (fixed stale `webapp/` paths and a copy-paste bug in the frontend dev command, documented
   the LAN run mode, shortcut creation, Task Scheduler auto-start, firewall rule).
6. Force-pushed this repo's full content over `voice_over_tool_localhost` (user's explicit choice — see §3
   item 3).

**Uncommitted right now**: `README.md` has staged-but-unpushed edits (the LAN-run-mode documentation) —
confirm `git status` before assuming README matches what's on GitHub.

## 5. Environment & Credentials

**Backend** (`backend/.env`, copy from `backend/.env.example` — gitignored, never commit it):
- `MODEL_PATH` — required, path to the local Qwen3-TTS model snapshot
- `ALLOWED_ORIGINS` — only needed for cross-origin deployments (Vercel+RunPod split); irrelevant for LAN
  single-port mode
- `RUNPOD_API_KEY`, `RUNPOD_POD_ID` — optional, only for the RunPod idle-auto-stop path
- `IDLE_CHECK_INTERVAL_MIN`, `IDLE_STOP_THRESHOLD_MIN` — optional, same path

**Frontend** (`frontend/.env.local`, gitignored):
- `VITE_BACKEND_URL` — must be an absolute URL for the split cloud deployment; **must be unset** for LAN
  single-port mode (see bug #1 in §3)

**Vercel project env** (only relevant if the cloud path is used — see `DEPLOYMENT.md` for the full table):
`VITE_CLERK_PUBLISHABLE_KEY` is listed there but **stale** — Clerk was fully removed this session
(`247deda`), so that var no longer does anything; `DEPLOYMENT.md` itself wasn't updated to reflect that.

**Secrets check**: searched git history for committed `.env` files and Clerk-looking secret strings
(`sk_`/`pk_`/`secret`) in `backend/auth.py`'s history — found none. No evidence of leaked keys, but this
was a targeted search, not exhaustive. **TODO: verify** independently if this matters for compliance.

**Local setup**:
```bash
pip install -r backend/requirements.txt
cd frontend && npm install
cp backend/.env.example backend/.env   # then edit MODEL_PATH
```
Run: see `README.md` "Run" section (dev mode: two terminals, `uvicorn` + `npm run dev`; LAN mode:
`npm run build` then `start_server.bat`).

## 6. Next Steps

Prioritized:
1. **Fix or work around the `VITE_BACKEND_URL` build bug (§3 #1)** before building `frontend/dist` for the
   LAN server — otherwise the LAN rollout silently doesn't work for anyone but the GPU machine itself.
2. Finish and verify the LAN rollout's system-level steps (router DHCP reservation, Windows Firewall rule,
   auto-login, Task Scheduler task) — instructions were given, execution/verification status from a real
   second device is unconfirmed. **TODO: verify.**
3. Decide the open architecture question below (RunPod/Vercel path) so dead code either gets removed or
   properly maintained.
4. Clean up `planm.md` (stale, untracked) and `DEPLOYMENT.md`'s stale Clerk reference.

**Open decisions**:
- Is the RunPod+Vercel cloud deployment still wanted, or has the project fully pivoted to local/LAN-only?
  Affects whether `DEPLOYMENT.md`, `frontend/api/wake.ts`, and the idle-auto-stop loop in `main.py` should
  be kept, simplified, or deleted.
- Whether to pursue the Electron desktop-app direction (discussed this session, no code exists for it in
  this repo — an earlier attempt existed only in `voice_over_tool_localhost` and was discarded).

## 7. Gotchas & Non-Obvious Context

- **cu128, not cu13 or plain `torch`.** `torch==2.11.0+cu128` / `torchaudio==2.11.0+cu128` are CUDA 12.8
  wheels — installing a mismatched CUDA build will fail or silently fall back to CPU. See
  `qwen/HOW_TO_RUN.md`.
- **4GB-VRAM tuning baked into constants.** `CHUNK_MAX_CHARS=800` and `max_seq_len=1024`
  (`backend/main.py`) were tuned for a razor-thin-margin GTX 960 4GB card (`gpu.txt`) to avoid Windows TDR
  kernel kills and rope-position quality collapse on long generations. The office GPU machine has 12GB —
  these caps are conservative for that hardware and could likely be raised for better throughput/quality,
  but nobody has done that yet. **TODO: verify/consider.**
- **Single global generation lock.** `_gen_lock` in `main.py` serializes *all* generation, regardless of
  GPU headroom — the 5-employee LAN rollout will queue people behind each other, not run them in parallel.
  This is by design (CUDA graphs/static buffers aren't reentrant), not a bug, but easy to be surprised by.
- **`FRONTEND_DIST` is checked once at import time, not per-request** (`backend/main.py`, the
  `serve_frontend` route). If `frontend/dist` doesn't exist when the backend process starts, the
  SPA-serving route never registers for that process's lifetime — building the frontend *after* starting
  the backend does nothing until restart.
- **`auth.py`'s `get_current_user` is a stub, not real auth** — every request is silently treated as the
  same `"local-user"`, with no per-user gating of any kind (the credits/plans system that used to sit
  behind it was removed).
- **`vite.config.ts` has no dev-server API proxy anymore** — removed when the app moved to
  absolute-URL-only API calls for the split cloud deployment. Local dev now depends entirely on
  `frontend/.env.local`'s `VITE_BACKEND_URL` pointing at wherever the backend actually runs.
