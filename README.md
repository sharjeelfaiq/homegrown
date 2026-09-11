# Homegrown

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
git clone git@github.com:sharjeelfaiq/homegrown.git
cd homegrown
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

Or double-click **`start_server.bat`** in the repo root, which runs that second command for you and
prints the exact address to type on other devices. Prefer it: it also refuses to start in three states
that otherwise fail silently or blame the wrong thing —

| It stops when | Because otherwise |
|---|---|
| `frontend/dist/index.html` is missing | `FRONTEND_DIST` is read once at import, so every page load answers `{"detail":"Not Found"}` while `/api` works fine |
| a localhost address is compiled into the bundle | the app works on this PC and fails on every other device, with nothing at runtime able to detect it |
| something already holds :8000 | uvicorn dies with a bind traceback that never mentions the usual culprit, a `dev.sh` backend still running |

- On this PC: **http://localhost:8000**
- From other devices: **http://\<this-PC's-LAN-IP\>:8000** — `start_server.bat` prints it. If you look it
  up yourself with `ipconfig`, pick the real adapter: a machine with Hyper-V or WSL also lists a
  `172.x.x.x` vEthernet address that no other device can reach.

> ⚠️ **There is no sign-in.** `auth.py` is a stub that returns the same user for every request. Anyone who
> can reach the port can create voices, generate voiceovers, and delete other people's. Run it on a network
> you trust.

> **Do not open `http://0.0.0.0:8000`.** `0.0.0.0` means "listen on every interface" — it is a bind address,
> not a destination. Browsers reject it with `ERR_ADDRESS_INVALID`.

**Let other devices through the firewall** (once, as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Homegrown" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

**If port 8000 is already taken** on your machine, pick another and tell clients the new port — nothing on
the frontend side is hardcoded to 8000:

```bash
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8010
```

**Auto-start at login** — use `start_server_silent.vbs` (same thing, no console window) with Task Scheduler:

```powershell
schtasks /create /tn "Homegrown" /tr "wscript.exe \"C:\path\to\repo\start_server_silent.vbs\"" /sc onlogon /rl highest /f
```

### Local development (hot reload)

One command from the repo root:

```bash
bash dev.sh
```

It preflights the venv and both env files, starts uvicorn on `127.0.0.1:8000` and Vite on `:5173`, tails
both logs side by side with `[backend]` / `[frontend]` prefixes, polls `/api/health` and prints when the
model is actually ready (which the frontend does not wait for), and stops both processes on Ctrl-C —
including the orphaned node child that `kill` alone leaves holding `:5173` on Windows. Logs stay at
`.tmp/dev-backend.log` and `.tmp/dev-frontend.log`.

No `--reload` on the backend, deliberately: the model takes tens of seconds to minutes to load, and a
watcher would pay that on every edit. Restart `dev.sh` by hand after backend changes.

**Dev is reachable from other devices too**, at `http://<this-PC's-IP>:5173`. `dev.sh` prints the address.
Nothing to configure on the visiting phone or laptop — `vite.config.ts` proxies `/api`, `/audio` and
`/refs` to the backend, so each device's API calls are same-origin against whatever address it typed. The
same "no sign-in" warning above applies.

The same thing by hand is two terminals:

```bash
# terminal 1
cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# terminal 2
cd frontend && npm run dev        # http://localhost:5173
```

`frontend/.env.local` should set **nothing**. `VITE_BACKEND_URL` hardcodes one backend address into the
page, which is right for the dormant Vercel + RunPod split and wrong everywhere else: point it at
`127.0.0.1` and every device except this one loads the app, calls its own loopback, and finds nothing.
`dev.sh` warns if it is set.

The backend stays on `127.0.0.1` even in this mode. Vite reaches it from this machine, so binding it wide
would add nothing but a second Windows Firewall prompt.

`ALLOWED_ORIGINS` in `backend/.env` only matters for requests that skip the proxy — through it they arrive
server-side from Vite and CORS never applies. Keep
`ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173` anyway; both spellings, since they are the
same socket but different origins to CORS.

> ⚠️ **`VITE_BACKEND_URL` must be unset before building for LAN or the installer.** It is baked into the
> bundle at build time. If it says `127.0.0.1` when you run `npm run build`, every LAN client calls *their
> own* localhost and the app is broken for everyone except this machine. `build.sh` stashes
> `frontend/.env.local` for you; a hand-run `npm run build` does not, which is why `start_server.bat`
> greps the emitted bundle and refuses to serve one that has it.

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
mkdir -p dist/Homegrown
cp launcher/dist/Homegrown.exe dist/Homegrown/
cp -r backend/dist/backend dist/Homegrown/backend
mkdir -p dist/Homegrown/storage/references dist/Homegrown/storage/generated dist/Homegrown/models

# 4. Compress. -mx5, not -mx9: the payload is mostly incompressible CUDA DLLs,
#    so maximum compression costs far more time for a couple of percent.
cd dist && "/c/Program Files/7-Zip/7z.exe" a -t7z -m0=lzma2 -mx5 -mmt=on app.7z Homegrown

# 5. Prepend the SFX module -> one double-clickable .exe.
cat "/c/Program Files/7-Zip/7z.sfx" app.7z > Homegrown-1.0.0.exe
```

The result is a **self-extractor, not an installer**: the recipient runs it, picks a folder, then opens that
folder and runs `Homegrown.exe`. There is no Start Menu entry and no uninstaller — uninstalling means
deleting the folder. Their machine needs **~8 GB free**: 1.66 GB download + 4.48 GB extracted (~6.1 GB peak
with both present) plus the 2.5 GB model on first launch.

The build artifact is **not** checked in — `dist/` is gitignored.

**What the user sees on launch.** Double-clicking `Homegrown.exe` opens a browser loader within a
second or two, which shows the real startup phase — model download percentage on a first run, then library
load, GPU check, model load — and redirects to the app once the backend is healthy. Double-clicking again
while it is already running just reopens the tab; it never restarts a backend that might be mid-generation.
If startup fails, the loader shows the backend's own error and a **Try again** button, and the backend's
output is kept at `<install>/storage/backend.log`.

**The desktop build listens on `127.0.0.1:8731` only** (`backend/run.py`) and is *not* reachable from other
machines. Two deliberate choices there:

- **Loopback, not `0.0.0.0`.** A wildcard bind makes Windows Defender Firewall show an "Allow access /
  Cancel" alert on first run, and Cancel writes a permanent Block rule that leaves the app broken with no
  way to recover from inside the app. For LAN access use the single-port mode above (`start_server.bat`),
  which passes `--host 0.0.0.0` itself and is unaffected.
- **8731, not 8000.** 8000 belongs to dev (`dev.sh`) and to LAN mode. Sharing it meant the launcher's
  health probe could find a dev uvicorn already listening, conclude Homegrown was running, open the browser
  and never start `backend.exe` — leaving the user on a bare `{"detail": "Not Found"}`. The desktop build
  is the one mode whose port nobody types (single origin, relative API paths), so it is the one that moved.
  The number is written twice — `PORT` in `backend/run.py` binds it, `PORT` in `launcher/launcher.py` polls
  it — because they are separately frozen exes with no import path between them.
  `scripts/check_desktop_port.py`, run from `build.sh`'s pre-build checks, is what stops them drifting.

The `.exe` is unsigned, so Windows SmartScreen still shows "Windows protected your PC → More info → Run
anyway" the first time. Only an Authenticode certificate removes that.

Relevant files: `backend/run.py` (frozen entrypoint: path resolution, first-run model download, loopback
bind), `backend/boot_status.py` (startup phases published to `storage/boot_status.json`),
`launcher/launcher.py` (serves the loader, starts the backend hidden, polls `/api/health`, redirects),
`installer/setup.nsi` (unusable at current size, see above).

### Vercel + RunPod (dormant)

A split deployment: static frontend on Vercel, backend on a RunPod pod that sleeps when idle and is woken by
`frontend/api/wake.ts`. Gated behind `VITE_USE_RUNPOD_WAKE`, which is unset everywhere except that project.
See `docs/DEPLOYMENT.md`. Not used by the LAN or installer paths.

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
a voice is in that state. Anything longer than 40 seconds is **trimmed to the first 40 seconds of speech**
rather than rejected (`REF_TRIM_SECS`), and the upload itself is only capped at 30 minutes
(`MAX_REF_AUDIO_SECS`) — a guard on buffering the file in memory, not a quality limit. But **longer is not
better**: 10–20 seconds of clean speech clones better than 40 seconds of anything, and past ~23s output has
been observed to garble regardless of the budget arithmetic.

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

The **✚** button beside the voice dropdown opens the Voices dialog.

- **Add a voice** — drop or pick a `.wav`/`.mp3` reference clip (2s–30min accepted and trimmed to the
  first 40 seconds of speech, **10–20s recommended**). A spinner runs on the dropzone while it clones.
  That is the whole step: the voice is cloned and saved on drop, with no name field and no Save button.
  The name comes from the filename and is edited in place on the row afterwards. The language is detected
  from the recording by faster-whisper and stamped onto the voice, which is what generation uses — so
  there is no language control anywhere. The transcript is auto-transcribed too. Saved to
  `backend/storage/presets.json`, clip to `backend/storage/references/`.
- **Rename a voice** — click its name in the dialog, type, press Enter or click away. Escape cancels.
  Unlike a voiceover's name, this is stored on the server (`PATCH /api/presets/{id}`), because the backend
  reads it on every generate. Renaming does **not** change the voice name recorded on voiceovers you have
  already made — that is a snapshot of what the voice was called at the time.
- **Clips over 40s** are shortened to the first 40 seconds *of speech* — long internal pauses are packed
  out first, so a mostly-silent voice note still yields a full window. The limit is stated up front under
  the dropzone rather than reported per clip afterwards. Shorter is better anyway — see "Making a voice
  that actually works".
- **The dialog does not change height** as voices are added or removed: the list is a fixed six-row window
  that scrolls past six.
- **Play** — the ▶ on a row plays that voice's *reference clip*, not a live generation. Available both in
  the dialog and on each row of the voice dropdown.
- **Download** — the ⭳ on a dialog row saves the reference clip, named after the voice and in whatever
  format it was uploaded in (no re-encoding). Renaming the voice changes the downloaded filename.
- **A voice that is mid-generation is marked `busy`**, and its delete confirmation warns that queued
  voiceovers will fail. The delete is still allowed — wanting a voice gone is a good enough reason.
- **Delete** — in the dialog only, and two-step (the row flips to Delete/Keep). Removes the voice and its
  reference audio permanently. Deleting the selected voice clears the selection. The dropdown deliberately
  has no delete: it is a menu you open to pick a voice, not to destroy one.

### Script

One script box, up to 60,000 characters, fixed height — drag the corner grip to resize it. A word count sits
in the bottom-right corner *inside* the box rather than in a row of its own. The **voice dropdown**
and **✚** sit *above* the box, at the right; **Generate** sits alone below it.

**Your script survives a reload.** It is kept in `localStorage` as you type, so closing the tab or
refreshing does not lose it — which is also why there is no "are you sure you want to leave" prompt.
The re-queue wand, which replaces the box with an old script, offers an **Undo** when it overwrites
something you had written.

Keyboard shortcuts: **Ctrl/Cmd+Enter** generates, **/** focuses the script, **Ctrl/Cmd+F** focuses the
voiceovers search, **Escape** dismisses an error. `/` and `Ctrl+F` are shown as key caps on the controls
they drive; Generate shows its shortcut on hover. There is no Space shortcut — it was removed, because
binding a bare Space globally means taking over page scrolling everywhere outside a text field.

### While it generates

Only one job runs at a time — one worker thread, one GPU lock.

The voiceover being generated appears at once as the **first row of the Voiceovers column**, in the slot
its finished self will occupy and laid out identically, with three swaps: the waveform becomes a progress
bar (hairline ticks at the chunk boundaries, advancing smoothly between completions rather than jumping),
the transport becomes a labelled **Cancel**, and the clock counts **elapsed** time.

The Generate button stays live throughout, so a second script submitted mid-run is queued rather than
refused. Queued voiceovers are further rows above the finished ones, in processing order, and are
**purple** rather than amber — an empty bar and the word `Queued` in place of a filling bar and a
ticking clock, so the difference survives greyscale as well as colour. Each promotes in place when its
turn comes.

Elapsed rather than remaining, deliberately: `eta_s` is a rolling chars/second average that moves in both
directions as chunks land. The **Generate** button stays a button and keeps its label throughout: progress
belongs in the Voiceovers column, not on the control you press.

**A toast reports each job as it ends** — "Voiceover ready" with the voice name, or a failure toast that
does not auto-dismiss. Transient errors elsewhere in the app are toasts too. Three notices stay inline
instead, because they describe a *condition* rather than an event and would be wrong to fade out while
still true: the model-down banner (which carries **Retry**), the CPU-fallback notice, and the
long-reference-clip warning.

**Cancel** stops a running job after the current chunk, within about a second. On a **running** job it
asks first (`Stop it?` → Stop / Keep going), because a cancel throws away however much of the render
is already done; a **queued** job cancels in one click, since no GPU time has been spent on it. There
is no pause — a paused job would hold the GPU lock and stall the whole queue.

A voiceover that **fails** stays visible rather than disappearing: the row turns red, reads `Failed`, and
carries the backend's own error in place of the script preview, with the full text on hover. It sorts below
the running and queued rows and consumes no voiceover number. **Retry** resubmits it and **Dismiss** clears
it. From the second attempt on, the row reads `Failed · try 2` and counts up — a retry mints a new job and
replaces the row, so without the count a voiceover that fails instantly every time is indistinguishable
from a button that does nothing. Retry is server-side (`POST /api/queue/{job_id}/retry`): the queue entry only carries a truncated
preview, but the backend still holds the full script, so nothing is retyped and nothing large is reposted
on every poll. It runs the same validation as `/api/generate`, so a voice deleted since the failure returns
a clear 404 instead of failing again. Failed jobs live in the backend's in-memory job table, so restarting
the backend clears them.

The voice dropdown stays usable throughout, so you can line up the next voice while one job runs.

There is no queue list and no reorder control in the UI, though `POST /api/queue/reorder` exists and works
— see the API table below.

### Themes

Nine, in the picker at the top right: six dark — **Studio** (charcoal and cyan), **Greenroom** (deep
green and jade), **Booth** (near-black, on air), **Marquee** (violet, magenta and cyan), **Vinyl**
(warm black and gold), **Tide** (midnight navy and teal) — and three light — **Daylight** (neutral),
**Tape** (warm paper and rust), **Score** (paper white, high contrast). **System** follows your OS.

The choice is stored in `localStorage` and applied before the first paint, so there is no flash of
the wrong theme on load. Every palette is checked against WCAG AA by `scripts/check_contrast.py` at
build time rather than by eye.

### Voiceovers

A **search box** sits under the heading, focused by `Ctrl/Cmd+F` (the shortcut is printed inside the
field). It filters as you type, with no delay, and matches a voiceover's **name** and the **voice** that
spoke it — not the script, since a 60,000-character script makes any common word match nearly everything.
It runs entirely in the browser, because two of the things it searches are not on the server at all: a
custom name is a `localStorage` override, and the default `Voiceover 27` is derived from the row's
position. While a search is running, the whole history is loaded and the queue rows are hidden.

Every finished job, newest first, in a **fixed window about eight rows tall**. The newest 20 arrive on
first paint and scrolling to the bottom of that window fetches ten more — there is no paginator, and on a
desktop-width viewport the page itself does not scroll at all; the list is the only scrolling region. On a
short screen the window renders fewer rows than the cap allows, since it can only use the height the column
actually has. Below 1025px the layout is one column — composer first, Voiceovers under it — the page
scrolls normally, and the list grows to fit instead of scrolling inside itself. The script box shrinks with
the viewport there (`clamp(140px, 30svh, 260px)`) so it does not sit between you and your history.

Each row is three lines:

1. Its name — **`Voiceover 1`** is the oldest, numbered by position — and, on the right, the voice that
   spoke it. The name is click-to-edit: type, click away to save, Escape to revert, clear it to fall back
   to `Voiceover N`. Whatever you call it is also the download filename. The field is sized to its text. A
   name typed while the voiceover is still generating carries over when it lands.
2. Play, the waveform (which doubles as the seek bar), a `0:12 / 1:06` clock — click its left half to count
   down the time remaining instead — and the actions at the right, dimmed until you hover the row:
   download, re-queue (wand — pulls that script and voice back into the script box), and delete. The clock
   occupies a fixed 14ch so nothing beside it shifts as it ticks.
3. The first words of the script.

**Click the script preview** to unfold the whole script inside the row — selectable, scrollable, with
a **Copy script** button. One row opens at a time. This is the only way to read a script in full: the
row shows 96 characters and re-queue would replace whatever is in the compose box.

**Deleting a voiceover is undoable.** The row disappears at once and a toast offers **Undo** for
seven seconds; the request is only sent when that expires. One consequence worth knowing: if you
close the tab inside that window the delete never happens and the row comes back on reload.

**Select rows** with the checkbox that appears on hover, **shift-click** for a range, or use the
checkbox in the `VOICEOVERS` heading to take everything on screen — with a search running that means
the matches, and rows you selected before searching stay selected. A floating bar then offers
**Download** (all of them as one `.zip`) and **Delete** (one toast, one Undo, for the whole batch).

A voiceover finishing while you are scrolled down does not move you; it is counted, and an **N new
voiceovers — show** button appears above the list.

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
- **Degenerate output is resampled.** Each chunk's audio is checked against how long its text should take
  and regenerated (up to 3 attempts) if it is wildly off. This was written when roughly one chunk in three
  came out wrong — babbling, or stopping short. **It has since stopped reproducing**: a re-measurement on
  2026-09-09 produced 32/32 clean chunks over 8 runs and the retry loop never fired, most likely because
  `_seq_budget()`, balanced chunking and the per-chunk token cap each removed a cause. The check stays —
  one voice on one machine is not a proof of absence. Numbers in `docs/gpu-notes.md`.
- **No partial delivery.** You get audio when the whole job finishes; progress is chunk-level.

Time estimates come from a rolling average of characters/second over the last 20 completed jobs, seeded from
`history.json` at startup. The queue survives a restart (`queue.json`), resuming from the *start* of an
interrupted job.

---

## API

All routes are under `/api`, and every request is the same single local user.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | `model_loaded`, `sample_rate`, `device`, `device_reason`, `gpu_fault` |
| GET | `/api/languages` | Languages the loaded model supports |
| POST | `/api/estimate` | `{text, preset_id}` → `estimated_s`, `chunks`, `chunk_chars`, `ref_seconds`, `warning`. POST, and the whole script, because chunk count depends on sentence boundaries *and* on the voice |
| GET | `/api/presets` | List voice presets |
| POST | `/api/presets` | Create one (multipart: `audio`, `name`, `ref_text`, `language`, `tag`) → also returns `ref_seconds` and `trimmed_from_seconds` |
| PATCH | `/api/presets/{id}` | Rename one (`{name}`). Does not touch `preset_name` on existing history entries |
| GET | `/api/presets/{id}/download` | The voice's reference clip, named after the voice |
| DELETE | `/api/presets/{id}` | Delete a preset and its reference clip |
| POST | `/api/generate` | Queue a job → `{job_id, total_chunks, estimated_s, queue_position}` |
| GET | `/api/jobs/{id}` | One job's status |
| GET | `/api/queue` | The queue, in real processing order |
| POST | `/api/queue/{id}/cancel` | Cancel a queued or running job |
| POST | `/api/queue/{id}/retry` | Resubmit a failed job's own script → same shape as `/api/generate` |
| DELETE | `/api/queue/{id}` | Dismiss a **canceled or failed** job. Finished ones are deleted through `/api/history` |
| POST | `/api/queue/reorder` | Reorder queued jobs |
| GET | `/api/history` | Completed voiceovers. No `q` — search is client-side, see below |
| POST | `/api/history/zip` | Several voiceovers as one `.zip` (`{ids, names}`). `names` carries the display names, which the server has never seen |
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
| `VITE_BACKEND_URL` | Frontend only, **baked in at build time**. Leave it unset: relative paths are what LAN mode, the installer *and* dev all need (dev proxies instead). Set it only for the Vercel + RunPod split. |
| `DECODE_CHUNK_FRAMES` | Vocoder frames per GPU launch (default 100). Lower it if a slower display GPU trips its watchdog. |
| `REQUIRE_GPU=1` | Makes `setup.sh` fail instead of accepting the CPU fallback. |
| `MODEL_DIR` / `PIP_CACHE_DIR` / `TMP_OVERRIDE` | `setup.sh` paths. |

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ERR_ADDRESS_INVALID` on `0.0.0.0:8000` | That is a bind address. Use `localhost` or the LAN IP. |
| LAN devices cannot connect | `ERR_CONNECTION_REFUSED` means a loopback bind — use `start_server.bat` (`0.0.0.0`) or `dev.sh` (:5173), not a hand-run `--host 127.0.0.1`. A *timeout* instead means the firewall rule above is missing. |
| LAN clients load the UI but every action fails | `VITE_BACKEND_URL` was set when you built (or, in dev, is set at all). Comment it out in `frontend/.env.local` and rebuild. `start_server.bat` now catches this before it starts. |
| `no kernel image is available for execution on the device` | The torch build has no kernels for your GPU. cu126 covers `sm_50`–`sm_90`; Blackwell needs cu128. |
| `CUDA error: the launch timed out and was terminated` | Windows TDR killed a GPU batch running over ~2s on a display-attached card. It kills the whole process's CUDA context, so the running voiceover **and everything queued behind it** fail together — the app detects this (`gpu_fault`), hides Retry and asks you to restart, because nothing in-app can recover it. Lower `DECODE_CHUNK_FRAMES`, and do not run two model processes at once. |
| Yellow "Running on CPU" banner | No usable GPU was found; the reason is in the banner and in `/api/health`. |
| Output murmurs, drags, or drops words | Almost always the reference clip — see "Making a voice that actually works". |
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
- **Search covers names and voices, not scripts.** The voiceovers column has a search box
  (`Ctrl/Cmd+F`) matching a voiceover's name and the voice that spoke it. Script text is deliberately
  excluded: a script runs to 60,000 characters, so a common word matches nearly everything. The voice list
  in the dialog has no search.
- **Voiceover names are per-browser.** A voiceover's display name is a `localStorage` override, so a
  rename — and therefore searching for that name — only exists in the browser that made it. A *voice's*
  name is server-side and shared.

---

## Repo layout

```
README.md      This file
CLAUDE.md      Architecture and the hard-won gotchas (agent instructions)
dev.sh         Local development: uvicorn :8000 + Vite :5173 together, one command
build.sh       Source -> Homegrown-<ver>.exe, one command
setup.sh       One-shot idempotent installer (venv, deps, model, backend/.env)
start_server.bat / start_server_silent.vbs   LAN server launchers (host 0.0.0.0)
vercel.json    Deploys landing-page/ only; main-branch deploys disabled

docs/
  BUILD.md       Build procedure, step by step
  DEPLOYMENT.md  Vercel + RunPod split (dormant)
  workflow.md    Day-to-day usage, end to end
  gpu-notes.md   GPU measurements behind the empirical constants
  history/       Superseded, kept for rationale -- HANDOFF.md, DEPLOY_SPEC.md

qwen/          Vendored FasterQwen3TTS (CUDA-graph Qwen3-TTS wrapper). Treat as third-party.
backend/
  main.py            FastAPI app: model load, REST API, job queue, worker thread
  run.py             Frozen-desktop entrypoint: path resolution, first-run model download, :8731
  boot_status.py     Startup phases, published to storage/boot_status.json
  text_chunker.py    Splits scripts into chunks (sentence -> clause -> word fallback), balanced
  audio_stitcher.py  Trims chunk edge silence, concatenates with a gap
  audio_convert.py   wav/mp3 conversion
  auth.py            Single-user stub
  backend.spec       PyInstaller spec (hard-fails without frontend/dist)
  storage/           presets.json, history.json, queue.json, generated/, references/  (gitignored)
frontend/      React 19 + Vite + TypeScript dashboard (the app)
landing-page/  Marketing page -- the only thing Vercel deploys; separate release cadence
launcher/      Frozen-app launcher (PyInstaller)
installer/     NSIS installer script (unusable at current payload size, see above)
scripts/       Build gates and dev utilities. build.sh runs five: check_design_tokens.py,
               check_contrast.py, check_orphan_css.py, check_desktop_port.py and
               build_splash.py --check. Also build_og_image.sh and measure_landing.sh
assets/        Build-time binaries: icon.ico, consumed by launcher.spec and setup.nsi
```

Directory depth here is load-bearing: `backend/main.py`, both `.spec` files, `launcher/launcher.py`,
`scripts/check_design_tokens.py`, `scripts/check_desktop_port.py`, `build.sh`, `setup.sh` and
`installer/setup.nsi` each resolve paths by
counting parents from their own location. Moving a top-level directory means editing all of them.

Further reading: `CLAUDE.md` (architecture and the hard-won gotchas), `docs/workflow.md` (day-to-day
usage), `docs/BUILD.md` (building the .exe), `docs/DEPLOYMENT.md` (Vercel + RunPod),
`qwen/HOW_TO_RUN.md` (the model wrapper itself).
