# Building a fresh `Homegrown-1.0.0.exe`

Every step needed to turn the current source into a distributable executable, in
the order they must run. Run everything in **Git Bash** from the repo root
(`D:\dev-projects\websites\homegrown`).

Git Bash, not PowerShell — `setup.sh` needs bash, and the final SFX step
concatenates two binaries, which PowerShell's `>` corrupts by rewriting them as
text.

**Budget:** ~45 minutes and ~10 GB free on the repo's drive.

---

## The one command

```bash
bash build.sh
```

Runs every step below in order and ends by printing the `.exe` path, its size
and its SHA-256. Expect ~45 minutes and ~10 GB free.

It also **stashes `frontend/.env.local` and restores it afterwards**. That file
must be absent while Vite builds — `VITE_BACKEND_URL` is baked into the bundle,
so a stale `127.0.0.1` makes every LAN client call its own loopback — but
leaving it deleted silently breaks local development. The restore runs from an
`EXIT` trap, so it happens whether the build succeeds, fails, or you Ctrl-C it.
If no file was there to stash, it writes the default dev value, so the tree is
always left usable. `frontend/.env.local.example` is the committed reference.

Two gates abort the build rather than warn: a `backend/.env` reaching the staged
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

```bash
cd /d/dev-projects/websites/homegrown
bash setup.sh
```

Creates `.venv`, installs `backend/requirements.txt` (~3 GB, pulls the
`+cu126` torch build via the index URL in that file's header), verifies CUDA,
and downloads the ~2.5 GB model into `models/` if absent.

Safe to re-run — every step is skipped when already done. Re-run it after
deleting `.venv`.

```bash
./.venv/Scripts/python.exe -m pip install pyinstaller
```

PyInstaller is deliberately **not** in `requirements.txt` — it is a build tool,
not a runtime dependency.

---

## 2. Pre-build checks

Do these before spending 30 minutes freezing a broken build.

These are the same five gates `build.sh` runs, in the same order. All five
must pass; each exists because something once shipped broken past it.

```bash
# 1. No colour outside frontend/src/styles/tokens.css (reads 6-digit hex,
#    3-digit hex and rgb()/rgba(); two palettes -- all nine themes for the
#    SPA, Studio only for launcher.py and the landing page).
python scripts/check_design_tokens.py

# 2. WCAG AA for every theme, computed rather than eyeballed.
python scripts/check_contrast.py

# 3. CSS classes no component uses -- written after a ported component left
#    .compose-bar .generate matching nothing and un-anchored Generate.
python scripts/check_orphan_css.py

# 4. backend/run.py's PORT and launcher/launcher.py's PORT must agree. They
#    are separately frozen exes with no import path between them.
python scripts/check_desktop_port.py

# 5. launcher/_splash.py must be current with splash.html/splash.css.
python scripts/build_splash.py --check

# Frontend types + lint
cd frontend && npm install && npm run lint && cd ..
```

`npm run lint` reports **four** pre-existing `react(only-export-components)`
warnings — one each in `AudioActivityContext.tsx` and
`GenerationActivityContext.tsx`, and two in `ThemeContext.tsx`. Those are
expected. Anything else is new.

`npm run build` is the typecheck (`tsc -b && vite build`); step 4 runs it.

---

## 3. Remove the dev-only backend override

```bash
rm -f frontend/.env.local
```

**Do not skip this.** `VITE_BACKEND_URL` is baked into the bundle at build time.
If it is set to `http://127.0.0.1:8000`, every LAN user's browser will call
*their own* loopback instead of the server, and the app will appear dead.

---

## 4. Build the frontend

```bash
cd frontend && npm run build && cd ..
```

`backend.spec` hard-fails if `frontend/dist/index.html` is missing, so this must
precede the freeze.

---

## 5. Freeze both executables (~15–20 min)

```bash
mkdir -p .tmp
python scripts/build_splash.py
cd backend  && TMP=../.tmp TEMP=../.tmp ../.venv/Scripts/pyinstaller.exe backend.spec  --clean --noconfirm && cd ..
cd launcher && TMP=../.tmp TEMP=../.tmp ../.venv/Scripts/pyinstaller.exe launcher.spec --clean --noconfirm && cd ..
```

`build_splash.py` compiles the launcher's loading screen — `launcher/splash.html`
and `splash.css` — with the Tailwind CLI and writes `launcher/_splash.py`, which
`launcher.py` imports. It must run **before** the launcher freeze, or the exe
ships whatever `_splash.py` last held.

That splash is the one surface that cannot use the Tailwind Play CDN the landing
page uses: it has to paint with no backend and frequently no network, which is
exactly when a CDN is unavailable. `_splash.py` is committed, so a build on a
machine without npm still produces a working exe; `python scripts/build_splash.py
--check` fails if it is stale relative to its sources.

It is a generated **module**, not a data file. `launcher.spec` declares
`datas=[]` and PyInstaller follows imports, so the spec needs no change.

`TMP`/`TEMP` are redirected off `C:` on purpose — PyInstaller unpacks several GB
through the temp directory and will exhaust a small system drive.

Both must be rebuilt whenever `backend/` **or** `launcher/` changes. Rebuilding
only the launcher leaves a stale `backend.exe` with the old API and bind address.

---

## 6. Stage the install layout

```bash
rm -rf dist/Homegrown
mkdir -p dist/Homegrown
cp launcher/dist/Homegrown.exe dist/Homegrown/
cp -r backend/dist/backend dist/Homegrown/backend
mkdir -p dist/Homegrown/storage/references \
         dist/Homegrown/storage/generated \
         dist/Homegrown/models
```

`launcher.py` looks for `backend/backend.exe` beside itself; this is that layout.

`models/` ships **empty** — the app downloads the model on first run into
`<install>/models`.

---

## 7. Portability gate

```bash
ls dist/Homegrown/backend/.env 2>/dev/null && echo "^^ DELETE THIS" || echo "OK: no .env shipped"
ls -A dist/Homegrown/models    # must print nothing
```

If `.env` is present, delete it. It carries an absolute
`MODEL_PATH=D:\dev-projects\...` that exists on no other machine.

---

## 8. Smoke-test before packing

Cheaper to catch a bad build here than after compressing 1.8 GB.

```bash
./dist/Homegrown/Homegrown.exe
```

Expect, in order:

1. A browser **loader within ~2 seconds** — not a blank desktop.
2. `dist/Homegrown/storage/boot_status.json` appears during startup.
3. `dist/Homegrown/storage/backend.log` gets written.
4. **No Windows firewall prompt** — the backend binds `127.0.0.1` only.
5. The loader redirects to the app once the model has loaded.

Then confirm the listener really is loopback-only:

```bash
netstat -ano | findstr :8731    # expect 127.0.0.1:8731, never 0.0.0.0:8731
```

If the loader never appears, the launcher exe is stale — step 5 did not rebuild.

Stop the app before continuing.

---

## 9. Pack the self-extractor (~10 min)

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

## 10. Verify the artifact

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
| `frontend/dist is missing` during step 5 | Step 4 was skipped |
| Loader never appears | Stale launcher exe — re-run step 5 |
| Firewall prompt on first run | Stale `backend.exe`; `run.py` must bind `127.0.0.1` |
| App works locally, dead on LAN | `frontend/.env.local` survived step 3 and set `VITE_BACKEND_URL`. `start_server.bat` catches this before serving; the frozen build does not, so check the bundle |
| Chunk count missing under the script box | Backend predates the `POST /api/estimate` change — rebuild |
| PyInstaller runs out of disk | `TMP`/`TEMP` not redirected in step 5 |
| `No matching distribution` for torch | `--extra-index-url` header in `requirements.txt` was bypassed |
