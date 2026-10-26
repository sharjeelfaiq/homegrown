# Building a fresh `Homegrown-1.0.0.exe`

Every step needed to turn the current source into a distributable executable, in
the order they must run. Run everything from the repo root.

The one command below works from any shell. The by-hand steps further down are
written for **Git Bash**, because the final SFX step concatenates two binaries,
which PowerShell's `>` corrupts by rewriting them as text. `npm run build` does
that concatenation with a Node stream instead, so it is shell-agnostic.

**Budget:** ~45 minutes and ~10 GB free on the repo's drive.

## Build progress and diagnostics

The scripted build begins with a numbered overview of its ten top-level stages
and no separate `PLAN` heading:
clean outputs, prerequisites,
Python, PyInstaller, validation, environment stashing, Studio, backend freeze,
launcher freeze, and staging/packaging/reporting. Interactive terminals show a
live 40-character progress bar, stage markers, elapsed time, and current stage.
Each overview row starts with a stage-specific ETA from the latest measured
baseline (for example `(17:42m)` for backend freezing and `(31:42m)` for
packaging). The current run replaces that baseline with its actual duration
after the stage completes. A stage shows `(measuring)` only when no baseline is
available.
CI, pipes, and redirected output receive readable line-oriented updates
without ANSI control sequences. Long-running commands emit no full child log
to the console; their stdout and stderr are captured in
`.tmp/build-logs/build-<timestamp>.log`, which also records stage starts,
pre-stage timing markers, completion durations, cumulative elapsed times, and a
final machine-readable timing summary.

On failure, the console reports the failed stage, command, exit code or signal,
diagnostic log path, and a bounded trailing output tail. The log is useful but
not required for a successful build. The packaging order and output layout are
unchanged, and the process-exit restoration of `apps/studio/.env.local` still
runs after success, failure, Ctrl-C, or SIGTERM.

---

## The one command

```bash
npm run build
```

Runs every step below in order. On success, the final summary prints the build
duration, the absolute installer path, and its size. In an interactive terminal,
the path is clickable and opens the directory containing the installer; redirected
output contains the same absolute path as plain text. The SHA-256 is recorded in
the separate release step below. Expect ~45 minutes and ~10 GB free.

Before checking prerequisites, it removes previous generated outputs, retrying
transient Windows file-lock errors during recursive cleanup:
`dist/`, `services/voice-api/dist/`, `services/voice-api/build/`,
`apps/studio/dist/`, `desktop/launcher/dist/`, and
`desktop/launcher/build/`. Do not keep files in those build-output folders
that you need to retain; the build recreates them.
If a cleanup still fails with a permission error, close Homegrown and any
process using that output folder, then check its permissions before retrying.

It also **stashes `apps/studio/.env.local` and restores it afterwards**. The restore runs from a
process-exit handler, so it happens whether the build succeeds, fails, or you Ctrl-C it.
If no file was there to stash, it writes the default dev value, so the tree is
always left usable. `apps/studio/.env.local.example` is the committed reference.

Two gates abort the build rather than warn: a `services/voice-api/.env` reaching the staged
tree (it carries an absolute `MODEL_PATH` that exists on no other machine), and
a non-empty `models/`.

The steps below are the same pipeline by hand — for when a stage fails and you
need to re-run just that part. When running them manually from the beginning,
first remove the same previous build outputs listed above.

---

## 0. Prerequisites (once per machine)

| Need | Check | Install |
|---|---|---|
| Python 3.13 for the tested Windows dependency set | `python --version` | python.org |
| Node 20.19+ or 22.12+, with npm | `node --version` | nodejs.org |
| 7-Zip, incl. `7z.sfx` | `ls "/c/Program Files/7-Zip/7z.sfx"` | `winget install 7zip.7zip` |
| NVIDIA GPU + working CUDA driver (required for Studio generation; CPU supports voice management) | `nvidia-smi` | GeForce driver |

---

## 1. Python environment and model

Complete [First-time setup](../README.md#first-time-setup) before building. It
creates `.venv`, installs `services/voice-api/requirements.txt`, downloads the
model, configures `services/voice-api/.env`, and installs Studio dependencies.
The API has no accounts or general authentication. Ordinary actions, including
individual deletes, are unauthenticated; permanent bulk deletion additionally
requires `HOMEGROWN_ADMIN_PASSWORD`. Use the packaged app only on a trusted
network and never package the local `.env` or password.

```bash
./.venv/Scripts/python.exe -m pip install pyinstaller
```

PyInstaller is deliberately **not** in `requirements.txt` — it is a build tool,
not a runtime dependency.

---

## 2. Pre-build checks

Do these before spending 30 minutes freezing a broken build.

`npm run build` runs eight validations: the five Python checks below, Studio
tests, Studio lint, and the splash freshness check. All eight must pass; each
exists because something once shipped broken past it. The build installs Studio
dependencies before these validations, then runs `build_splash.py --check`
last because it needs the Tailwind CLI from `apps/studio/node_modules`.

```bash
# 1. No colour outside apps/studio/src/styles/tokens.css (reads 6-digit hex,
#    3-digit hex and rgb()/rgba(); two palettes -- all nine themes for the
#    SPA, Studio only for launcher.py and the landing page).
python scripts/checks/check_design_tokens.py

# 2. WCAG AA for every theme, computed rather than eyeballed.
python scripts/checks/check_contrast.py

# 3. Hue collisions and surface separation -- the axis a contrast ratio
#    cannot express. A waveform that looks like an error passes check 2.
python scripts/checks/check_palette.py

# 4. CSS classes no component uses -- written after a ported component left
#    .compose-bar .generate matching nothing and un-anchored Generate.
python scripts/checks/check_orphan_css.py

# 5. services/voice-api/run.py's PORT and desktop/launcher/launcher.py's PORT must agree. They
#    are separately frozen exes with no import path between them.
python scripts/checks/check_desktop_port.py

# 6–7. Studio catalog generation, unit tests, and lint
cd apps/studio && npm run test && npm run lint && cd ../..

# 8. desktop/launcher/_splash.py must be current with its splash sources.
python scripts/build/build_splash.py --check

# 9. Brand assets (favicon, app icon, logo) must match their generator.
python scripts/build/build_brand.py --check
```

`npm run lint` currently reports `react(only-export-components)` Fast Refresh
warnings in context/provider modules, `Dropdown.tsx`, `VoiceoverFilters.tsx`,
and `HistoryList.tsx`, plus a `react-hooks(exhaustive-deps)` warning in
`HistoryList.tsx`. Treat new lint errors or warnings beyond those findings as a
build issue.

The Studio `test` script first regenerates the mascot catalog, runs its Node test
for catalog generation, then runs the Vitest suite. `lint` regenerates the
catalog and runs Oxlint. The Studio production build also runs TypeScript project
checks before Vite (`tsc -b && vite build`); section 3 runs it.

When a loading fixture or its surrounding responsive layout changes, also
regenerate the checked-in Boneyard assets before committing. In one terminal
run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`; in another:

```bash
cd apps/studio && npm run bones:build
```

The capture is local, root-route-only, and needs Playwright Chromium once
(`npx playwright install chromium`). Commit `src/skeletons/generated/*.bones.json` and
`src/skeletons/generated/registry.ts`; they are production build inputs, not disposable cache.
The fixtures intentionally model stable shell geometry only: do not add the
mascot, canvas effects, live status/errors, or conditional queue controls.

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
python scripts/build/build_splash.py
cd services/voice-api && TMP=../../.tmp TEMP=../../.tmp ../../.venv/Scripts/pyinstaller.exe backend.spec --clean --noconfirm && cd ../..
cd desktop/launcher && TMP=../../.tmp TEMP=../../.tmp ../../.venv/Scripts/pyinstaller.exe launcher.spec --clean --noconfirm && cd ../..
```

`build_splash.py` compiles the launcher's loading screen —
`desktop/launcher/splash/index.html` and `desktop/launcher/splash/styles.css` — with the
Tailwind CLI and writes `desktop/launcher/_splash.py`, which `launcher.py`
imports. It must run **before** the launcher freeze, or the exe
ships whatever `_splash.py` last held.

That splash is the one surface that cannot use the Tailwind Play CDN the landing
page uses: it has to paint with no backend and frequently no network, which is
exactly when a CDN is unavailable. `_splash.py` is committed, so a build on a
machine without npm still produces a working exe; `python scripts/build/build_splash.py
--check` fails if it is stale relative to its sources.

## Brand assets

`scripts/build/build_brand.py` is the single source for the Homegrown mark (four
waveform bars on a rounded tile, in `--bg-base` and `--accent-2`). It writes the
Studio and landing-page `favicon.svg`, both `apple-touch-icon.png`, the landing
page's `favicon.ico` and `logo.svg`, and `desktop/assets/icon.ico` (the Windows
executable icon used by `launcher.spec`). `--check` fails on a stale SVG or a
missing or wrongly sized PNG/ICO. Pillow rasterises the PNG/ICO files, so their
bytes are not compared. The mark is also inlined in `BrandMark.tsx`, the landing
page's header and footer, and the launcher splash; change the bars in the
generator and those copies together, then rebuild `_splash.py`.

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
4. The backend listens on `0.0.0.0:8731` for trusted LAN access, so Windows may show a firewall
   prompt on first run. Allow access only on the Private profile when LAN access is needed; declining
   the prompt leaves inbound access blocked. To add a Private-profile rule before first run, use an
   elevated prompt:

   ```
   netsh advfirewall firewall add rule name="Homegrown" dir=in ^
     action=allow program="C:\Homegrown\backend\backend.exe" ^
     protocol=TCP localport=8731 enable=yes profile=private
   ```
5. The loader redirects to the app once the model has loaded.
6. In Studio, open the header **Settings** dialog. Confirm it offers a System
   choice and every named theme in a stable order. Select each named theme and
   confirm the options remain visible and in the same order, then select System
   and verify it follows the OS appearance. The **Pet animal** switch should
   hide and restore the mascot without affecting voices or voiceovers. Reload
   the page and confirm both preferences persist.
7. Confirm the Script editor footer shows the language selector on
   the left and the compact Generate action on the right. Check that Generate
   stays disabled until script text, voice, language, and model readiness
   prerequisites are met; use Ctrl/Cmd+Enter after it enables. Confirm that
   the textarea is focused at startup and that printable typing from a
   non-editable surface inserts there, while searches retain their own input.
   Use the clipboard button at the textarea's top-right. When permission has not
   been denied, confirm the browser handles any permission prompt; then confirm
   text inserts at the caret or replaces a selection, appends when the textarea
   is unfocused, and stops at the script limit. Deny or block clipboard access
   and confirm Studio shows a toast with browser-permission and Ctrl+V guidance.
   Confirm the clear icon button below Paste is disabled for an empty textarea
   and clears all text when enabled. Type several short edits, then use Undo and
   Redo above the word/character count: Undo should step back through typing
   groups and Redo should restore them. Confirm both buttons disable when their
   respective history is empty, and a new edit after Undo clears Redo. Repeat
   with paste, Clear, and a script reused from a voiceover preview. With the
   textarea focused, Ctrl/Cmd+Z should undo and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
   should redo. Restored text should retain a sensible caret or selection.
   To check startup rendering and readiness behavior, run `npm run dev`
   separately. Start Vite, open Studio before starting FastAPI, and confirm the
   header, logo, editor, cards, layout controls, and static buttons render
   immediately. Start FastAPI while the model is still loading: API-backed voice
   rows, language options, and uncached history or initial queue rows should
   show skeletons while the rest of Studio remains visible. Confirm
   `/api/health` responds with startup progress and other API requests wait for
   initialization; pending requests should finish after readiness or receive
   HTTP 503 if startup fails. Generate and Clone voice should remain visible but disabled
   during startup. After loading, Clone voice should enable; Generate should
   enable only when the model is reported on CUDA and the form prerequisites
   are met. On CPU fallback, confirm Clone voice enables and Generate remains
   disabled with a CUDA-required explanation. The packaged launcher displays
   its browser splash while the backend initializes, then opens Studio after
   readiness.
8. In the Voices card, confirm the search covers cloned voices only.
   Search with a mixed-case substring and confirm only matching rows remain;
   check the 50/80/100 page-size choices (default 50), the matching total, and previous,
   next, and numbered-page controls when the fixture has enough voices. Change
   pages and page size, then change the query and confirm it returns to page one.
   Clear the query and confirm all rows return. Select or drop multiple audio
   files onto the card. The Clone
   voice button must keep its label and Upload icon; each file should have a
   waiting toast, then a cloning toast with a spinner, then a green success
   tick for one second (or a file-specific error). Later files must wait their
   turn. Drop a file elsewhere in Studio: it must not clone, and the browser
   must not navigate to the file.
   Check preview, reference download, rename, and delete actions on cloned rows.
   Generate one short voiceover with a selected voice and wait for completion;
   that voice's completed count should increase by one, while counts for other
   voices stay unchanged. Delete that history entry and confirm its count
   decreases by one. The count is independent of the current Voiceovers filters
   and page.
9. In Voiceovers, use the filter button beside search and verify the four
   equal-width filter controls appear in two columns: Voice and Date range in
   the first row, Duration and Generation status in the second. Choose a simple filter and
   confirm the choice is applied while the filter popover stays open; **Clear**
   should become enabled and its trigger should show an active count. Confirm
   only clicking outside or pressing Escape closes the popover. Reopen it and
   clear the filters. Confirm the total count appears in the
   compact, vertically centered footer alongside pagination.
   At a narrow viewport, verify the header wraps without horizontal scrolling.
   Confirm a completed row shows its fixed-width editable name, truncated
   script preview, timestamp, and seekable playback. The download action and
   three-dot menu should be visible and contain Delete. Clicking the script
   preview should restore the script, voice, and language. Generating and queued
   rows should also reuse from their script previews and should not show a
   three-dot menu. Live rows should use the same compact name/script layout with
   queue/progress controls, without completed-row download actions. Hover and
   keyboard-focus controls to check tooltips and theme-aware styling.
10. Drag the mascot by its artwork, then use its side arrows to cycle numbered
   mascots without moving it; Mascot 2 (the Cat sheets) should be the default.
   Click the artwork without moving it and confirm reaction sprites play, then
   resize the mascot with its corner grip (drag and arrow keys) and confirm it
   stays inside the viewport at both bounds. Confirm every committed mascot has
   a matching `<id>a.webp` directions sheet and `<id>b.webp` reactions sheet,
   and that `apps/studio/src/features/mascots/generated/mascotCatalog.ts` is current.
11. Verify voice and completed-voiceover deletes: selecting **Delete** should
   open a confirmation with **Cancel** and **Delete**. Cancel preserves the
   item; confirming shows a seven-second Undo toast. The voice row is hidden
   immediately, while a voiceover row remains until the timer expires and its
   history refresh completes. Selecting Undo preserves the item; allowing the
   timer to expire deletes it. Queue cancellation has no Undo toast.
   To verify the Settings **Danger Zone**, use disposable test data and a
   non-production storage directory. Configure `HOMEGROWN_ADMIN_PASSWORD` in
   the backend `.env`, restart the backend, and open Settings. Each bulk action
   should first show a scope confirmation, then a separate password prompt.
   Canceling either step must leave all records and audio untouched. Entering
   the configured password should delete the chosen collection across all
   pages; deleting cloned voices must preserve generated voiceovers and legacy
   built-in records. Never run this check against storage containing user data.
12. If the backend is unavailable or startup fails, confirm the pulsing warning
   button appears at the lower left. Open it and verify the reported message
   and Retry action. With cached history present, make a background history
   refresh fail and verify the rows remain visible without an inline warning
   above the voiceovers list.
13. Run `npm run build` in an interactive terminal and wait for success. Confirm
   the summary shows `BUILD SUCCEEDED`, duration, an absolute installer path,
   and size. Click the installer path and confirm File Explorer opens the
   directory containing the `.exe`. For redirected output, confirm the path is
   plain absolute text with no terminal escape sequences.

This is manual UI QA: the build gates validate source and generated assets, not GPU generation or browser
WebGL/compositing paths. Before release, generate a voiceover on the target GPU and confirm queueing,
progress, completion, audio playback, and a clean browser console.

Then confirm the listener is on every interface:

```bash
netstat -ano | findstr :8731    # expect 0.0.0.0:8731
```

The app has no accounts or general API authentication, and no multi-user
isolation. Anyone who reaches this port can use ordinary actions, including
individual deletion, uploading voices, and generating audio. Permanent
collection-wide deletion also requires the local `HOMEGROWN_ADMIN_PASSWORD`.
Trusted networks only.

If the loader never appears, the launcher exe is stale — step 4 did not rebuild.

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

**Output:** `dist/Homegrown-1.0.0.exe` by default. Set `VERSION` to change the
version suffix. The compressed size varies with dependency and driver-runtime
versions; use the build's reported size for the current artifact.

---

## 9. Verify the artifact

```bash
ls -lh dist/Homegrown-1.0.0.exe
sha256sum dist/Homegrown-1.0.0.exe
```

Record that checksum. The landing page has no checkout or download link; buyers
contact the team through WhatsApp or email and receive the executable
separately. Keep the SHA-256 in the release record rather than publishing a
checksum that could become stale on `apps/marketing/index.html`.

Final check: run the `.exe` on a machine that has never had this app, extract to
a folder outside the repo, and run `Homegrown.exe` from there.

---

## What the recipient experiences

1. Runs the `.exe`; 7-Zip asks where to extract.
2. `<chosen folder>/Homegrown/` appears. Its size depends on the current frozen
   backend and launcher dependencies.
3. Runs `Homegrown.exe` inside it.
4. **SmartScreen warns once** — "Windows protected your PC" → More info → Run
   anyway. The exe is unsigned; only an Authenticode certificate removes this.
5. First launch downloads the ~2.5 GB model, with progress shown in the loader.

**Requirements to state to them:** Windows and about 8 GB free disk, plus
about 2.5 GB for the model download. Studio generation requires an NVIDIA GPU
with working CUDA drivers; on CPU fallback, voice management remains available
but Generate stays disabled. The
4 GB VRAM figure is a historical tested profile, not a guaranteed minimum.
No Python, no Node.

There is no installer, no Start Menu entry and no uninstaller — uninstalling
means deleting the folder.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `apps/studio/dist is missing` during step 4 | Step 3 was skipped |
| Loader never appears | Stale launcher exe — re-run step 4 |
| Firewall prompt on first run | Expected when `backend.exe` binds `0.0.0.0:8731`; allow it only on a trusted private network |
| Long-reference warning is missing | Backend predates the `POST /api/estimate` chunking check — rebuild |
| PyInstaller runs out of disk | `TMP`/`TEMP` not redirected in step 4 |
| `No matching distribution` for torch | `--extra-index-url` header in `requirements.txt` was bypassed |
