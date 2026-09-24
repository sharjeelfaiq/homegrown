# Building a fresh `Homegrown-1.0.0.exe`

Every step needed to turn the current source into a distributable executable, in
the order they must run. Run everything in **Git Bash** from the repo root
(`D:\dev-projects\websites\homegrown`).

Git Bash, not PowerShell — the final SFX step concatenates two binaries, which
PowerShell's `>` corrupts by rewriting them as
text.

**Budget:** ~45 minutes and ~10 GB free on the repo's drive.

---

## The one command

```bash
bash build.sh
```

Runs every step below in order and ends by printing the `.exe` path, its size
and its SHA-256. Expect ~45 minutes and ~10 GB free.

It also **stashes `apps/studio/.env.local` and restores it afterwards**. The restore runs from an
`EXIT` trap, so it happens whether the build succeeds, fails, or you Ctrl-C it.
If no file was there to stash, it writes the default dev value, so the tree is
always left usable. `apps/studio/.env.local.example` is the committed reference.

Two gates abort the build rather than warn: a `services/voice-api/.env` reaching the staged
tree (it carries an absolute `MODEL_PATH` that exists on no other machine), and
a non-empty `models/`.

The steps below are the same pipeline by hand — for when a stage fails and you
need to re-run just that part.

---

## 0. Prerequisites (once per machine)

| Need | Check | Install |
|---|---|---|
| Python 3 on PATH | `python --version` | python.org |
| Node + npm | `npm --version` | nodejs.org |
| 7-Zip, incl. `7z.sfx` | `ls "/c/Program Files/7-Zip/7z.sfx"` | `winget install 7zip.7zip` |
| NVIDIA GPU + CUDA driver | `nvidia-smi` | GeForce driver |

---

## 1. Python environment and model

Complete [First-time setup](../README.md#first-time-setup) before building. It
creates `.venv`, installs `services/voice-api/requirements.txt`, downloads the
model, configures `services/voice-api/.env`, and installs Studio dependencies.
The compiled default admin password is `Homegrown-Admin-8731!`. Override it
with `ADMIN_PASSWORD` in `services/voice-api/.env` for local use. That `.env`
is not bundled; an optional `<install>/backend/.env` can override the default
for an extracted package.

```bash
./.venv/Scripts/python.exe -m pip install pyinstaller
```

PyInstaller is deliberately **not** in `requirements.txt` — it is a build tool,
not a runtime dependency.

---

## 2. Pre-build checks

Do these before spending 30 minutes freezing a broken build.

These are the same six gates `build.sh` runs, in the same order. All six
must pass; each exists because something once shipped broken past it.

```bash
# 1. No colour outside apps/studio/src/styles/tokens.css (reads 6-digit hex,
#    3-digit hex and rgb()/rgba(); two palettes -- all nine themes for the
#    SPA, Studio only for launcher.py and the landing page).
python scripts/check_design_tokens.py

# 2. WCAG AA for every theme, computed rather than eyeballed.
python scripts/check_contrast.py

# 3. Hue collisions and surface separation -- the axis a contrast ratio
#    cannot express. A waveform that looks like an error passes check 2.
python scripts/check_palette.py

# 4. CSS classes no component uses -- written after a ported component left
#    .compose-bar .generate matching nothing and un-anchored Generate.
python scripts/check_orphan_css.py

# 5. services/voice-api/run.py's PORT and desktop/launcher/launcher.py's PORT must agree. They
#    are separately frozen exes with no import path between them.
python scripts/check_desktop_port.py

# 6. desktop/launcher/_splash.py must be current with its splash sources.
python scripts/build_splash.py --check

# Studio types, unit tests, and lint
cd apps/studio && npm install && npm run test && npm run lint && cd ../..
```

`npm run lint` may report `react(only-export-components)` Fast Refresh warnings
for context/provider modules and `VoiceoverFilters.tsx`. They are existing
warnings from exporting hooks or helpers alongside components; treat any new
lint error or warning outside that known class as a build issue.

`npm run build` runs the TypeScript project build and Vite production build
(`tsc -b && vite build`); section 3 runs it.
`npm run test` runs the Vitest suite, including history-query normalization,
cache-key isolation, and sliding history-pager-window checks.

When a loading fixture or its surrounding responsive layout changes, also
regenerate the checked-in Boneyard assets before committing. In one terminal
run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`; in another:

```bash
cd apps/studio && npm run bones:build
```

The capture is local, root-route-only, and needs Playwright Chromium once
(`npx playwright install chromium`). Commit `src/bones/*.bones.json` and
`src/bones/registry.ts`; they are production build inputs, not disposable cache.

---

## 3. Build the Studio

```bash
cd apps/studio && npm run build && cd ../..
```

`services/voice-api/backend.spec` hard-fails if `apps/studio/dist/index.html` is missing, so this must
precede the freeze.

---

## 4. Freeze both executables (~15–20 min)

```bash
mkdir -p .tmp
python scripts/build_splash.py
cd services/voice-api && TMP=../../.tmp TEMP=../../.tmp ../../.venv/Scripts/pyinstaller.exe backend.spec --clean --noconfirm && cd ../..
cd desktop/launcher && TMP=../../.tmp TEMP=../../.tmp ../../.venv/Scripts/pyinstaller.exe launcher.spec --clean --noconfirm && cd ../..
```

`build_splash.py` compiles the launcher's loading screen —
`desktop/launcher/splash.html` and `desktop/launcher/splash.css` — with the
Tailwind CLI and writes `desktop/launcher/_splash.py`, which `launcher.py`
imports. It must run **before** the launcher freeze, or the exe
ships whatever `_splash.py` last held.

That splash is the one surface that cannot use the Tailwind Play CDN the landing
page uses: it has to paint with no backend and frequently no network, which is
exactly when a CDN is unavailable. `_splash.py` is committed, so a build on a
machine without npm still produces a working exe; `python scripts/build_splash.py
--check` fails if it is stale relative to its sources.

It is a generated **module**, not a data file. `desktop/launcher/launcher.spec` declares
`datas=[]` and PyInstaller follows imports, so the spec needs no change.

`TMP`/`TEMP` are redirected off `C:` on purpose — PyInstaller unpacks several GB
through the temp directory and will exhaust a small system drive.

Both must be rebuilt whenever `services/voice-api/` **or** `desktop/launcher/` changes. Rebuilding
only the launcher leaves a stale `backend.exe` with the old API and bind address.

---

## 5. Stage the install layout

```bash
rm -rf dist/Homegrown
mkdir -p dist/Homegrown
cp desktop/launcher/dist/Homegrown.exe dist/Homegrown/
cp -r services/voice-api/dist/backend dist/Homegrown/backend
mkdir -p dist/Homegrown/storage/references \
         dist/Homegrown/storage/generated \
         dist/Homegrown/models
```

`desktop/launcher/launcher.py` looks for `backend/backend.exe` beside itself; this is that layout.

`models/` ships **empty** — the app downloads the model on first run into
`<install>/models`.

---

## 6. Portability gate

```bash
ls dist/Homegrown/backend/.env 2>/dev/null && echo "^^ DELETE THIS" || echo "OK: no .env shipped"
ls -A dist/Homegrown/models    # must print nothing
```

If `.env` is present, delete it. It carries an absolute
`MODEL_PATH=D:\dev-projects\...` that exists on no other machine.

---

## 7. Smoke-test before packing

Cheaper to catch a bad build here than after compressing 1.8 GB.

```bash
./dist/Homegrown/Homegrown.exe
```

Expect, in order:

1. A browser **loader within ~2 seconds** — not a blank desktop.
2. `dist/Homegrown/storage/boot_status.json` appears during startup.
3. `dist/Homegrown/storage/backend.log` gets written.
4. **A Windows firewall prompt on first run** — the backend binds `0.0.0.0`. Do not click Cancel: it
   writes a permanent Block rule for that exe path which nothing in the app can undo. Pre-authorise the
   exe beforehand from an elevated prompt and the prompt never appears:

   ```
   netsh advfirewall firewall add rule name="Homegrown" dir=in ^
     action=allow program="C:\Homegrown\backend\backend.exe" ^
     protocol=TCP localport=8731 enable=yes profile=private
   ```
5. The loader redirects to the app once the model has loaded.
6. In the Studio, verify Generate is 40px high; check its normal, starting, and submitting labels plus
   the adjacent blocked-state reason, and use Ctrl/Cmd+Enter when it is ready. In each theme, move the pointer over the enabled
   button and confirm the specular highlight stays within the button without moving layout. It must be
   absent while disabled or when reduced motion is enabled.
7. Verify voice and completed-voiceover deletes: a wrong admin password closes
   the modal without deleting; the default password opens a seven-second Undo
   toast; selecting Undo preserves the item, while allowing the timer to expire
   deletes it. Queue cancellation is separate and has no Undo timer toast.

This is manual UI QA: the build gates validate source and generated assets, not GPU generation or browser
WebGL/compositing paths. Before release, generate a voiceover on the target GPU and confirm queueing,
progress, completion, audio playback, and a clean browser console.

Then confirm the listener is on every interface:

```bash
netstat -ano | findstr :8731    # expect 0.0.0.0:8731
```

The app has **no general authentication or multi-user isolation**. The admin
password gates only voice and completed-voiceover deletion; anyone who reaches
this port can still use other API actions, including uploading voices and
generating audio. The shared default is `Homegrown-Admin-8731!`; override it in
`<install>/backend/.env` before allowing other trusted-LAN users to delete.
Trusted networks only.

If the loader never appears, the launcher exe is stale — step 5 did not rebuild.

Stop the app before continuing.

---

## 8. Pack the self-extractor (~10 min)

```bash
cd dist
rm -f app.7z Homegrown-1.0.0.exe
"/c/Program Files/7-Zip/7z.exe" a -t7z -m0=lzma2 -mx5 -mmt=on app.7z Homegrown
cat "/c/Program Files/7-Zip/7z.sfx" app.7z > Homegrown-1.0.0.exe
rm -f app.7z
cd ..
```

`-mx5`, not `-mx9`: the payload is mostly incompressible CUDA DLLs, so maximum
compression costs far more time for a couple of percent.

**Output:** `dist/Homegrown-1.0.0.exe` (~1.7 GB).

---

## 9. Verify the artifact

```bash
ls -lh dist/Homegrown-1.0.0.exe
sha256sum dist/Homegrown-1.0.0.exe
```

Record that checksum. If you publish this build on the landing page, update the
download link, the size text **and** the SHA-256 together — a stale checksum is
worse than none.

Final check: run the `.exe` on a machine that has never had this app, extract to
a folder outside the repo, and run `Homegrown.exe` from there.

---

## What the recipient experiences

1. Runs the `.exe`; 7-Zip asks where to extract.
2. `<chosen folder>/Homegrown/` appears (~4.5 GB).
3. Runs `Homegrown.exe` inside it.
4. **SmartScreen warns once** — "Windows protected your PC" → More info → Run
   anyway. The exe is unsigned; only an Authenticode certificate removes this.
5. First launch downloads the ~2.5 GB model, with progress shown in the loader.

**Requirements to state to them:** NVIDIA GPU with CUDA drivers (4 GB VRAM
minimum), ~8 GB free disk, plus 2.5 GB for the model. No Python, no Node.

There is no installer, no Start Menu entry and no uninstaller — uninstalling
means deleting the folder.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `apps/studio/dist is missing` during step 5 | Step 4 was skipped |
| Loader never appears | Stale launcher exe — re-run step 5 |
| Firewall prompt on first run | Expected when `backend.exe` binds `0.0.0.0:8731`; allow it only on a trusted private network |
| Delete password | `Homegrown-Admin-8731!` unless `ADMIN_PASSWORD` is set in `backend/.env` |
| Long-reference warning is missing | Backend predates the `POST /api/estimate` chunking check — rebuild |
| PyInstaller runs out of disk | `TMP`/`TEMP` not redirected in step 5 |
| `No matching distribution` for torch | `--extra-index-url` header in `requirements.txt` was bypassed |
