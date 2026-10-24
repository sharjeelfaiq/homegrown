# Homegrown

Homegrown is a local Windows voice-generation app built around Qwen3-TTS. It
has no accounts or hosted service: audio, presets, history, and the model stay
on the computer that runs it.

## First-time setup

Use Windows 10/11 with Git Bash, Python 3.13 for the tested Windows dependency
set (the API package metadata requires Python 3.11 or newer, but pinned native
dependencies may not publish wheels for the newest Python versions), Node
20.19+ (or 22.12+), and (for a packaged build) 7-Zip. Studio generation
requires the voice model to load on an NVIDIA CUDA device. If no usable GPU is
found, the backend can start on CPU for voice management, but Studio keeps
Generate disabled.

```bash
git clone git@github.com:sharjeelfaiq/homegrown.git
cd homegrown

python -m venv .venv
PY=.venv/Scripts/python.exe; [ -f "$PY" ] || PY=.venv/bin/python
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r services/voice-api/requirements.txt

npm install                       # root orchestration (concurrently)
npm install --prefix apps/studio  # Studio dependencies
cp services/voice-api/.env.example services/voice-api/.env
```

Set `HOMEGROWN_ADMIN_PASSWORD` to a private value in that local `.env` if you
need the permanent bulk-delete actions in Settings. Leave it out of source
control; without it, bulk deletion is disabled.

Download the model once (the default location is the ignored `models/`
directory), then set `MODEL_PATH` in `services/voice-api/.env` to its absolute
Windows path. The app has no sign-in or authentication; use it only on a
trusted network:

```bash
PY=.venv/Scripts/python.exe; [ -f "$PY" ] || PY=.venv/bin/python
MODEL_DIR="${MODEL_DIR:-$PWD/models}" "$PY" - <<'PYEOF'
from huggingface_hub import snapshot_download
import os

snapshot_download(
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    local_dir=os.environ["MODEL_DIR"],
    ignore_patterns=["*.msgpack", "*.h5", "flax_model*"],
)
PYEOF
```

## Repairing a broken Python environment

If `.venv/Scripts/python.exe` reports `did not find executable at ...`, the
base Python installation recorded in `.venv/pyvenv.cfg` is missing. The build
checks this in stage 3 before attempting to install PyInstaller.

Restore the Python version listed in that file, or recreate the environment
with that version installed. For an environment created with Python 3.13,
run these commands in Git Bash (choose an unused backup name):

```bash
py -3.13 --version
mv .venv .venv.backup
py -3.13 -m venv .venv
.venv/Scripts/python.exe -m pip install --upgrade pip
.venv/Scripts/python.exe -m pip install -r services/voice-api/requirements.txt
npm run build
```

If the first command fails, install Python 3.13 before continuing. Keep the
backup until the new environment works. Changing `pyvenv.cfg` to point at a
different Python minor version does not rebuild its installed dependencies.

## Local development

```bash
npm run dev
```

Open `http://localhost:5173`. The script starts Vite first, then FastAPI on
`127.0.0.1:8000`. FastAPI binds and serves the Studio while a background
startup task probes for a usable device, restores the queue, and loads
Qwen3-TTS. `/api/health` remains available during startup; other `/api/*`
requests wait for initialization and return a startup error or timeout if it
does not complete. Vite proxies `/api`, `/audio`, and `/refs`, so Studio always
uses same-origin API paths. It prints a LAN address when available.
There are no accounts or general API authentication. Ordinary actions,
including individual deletes, are unauthenticated. Permanent bulk deletion
from Settings additionally requires the locally configured
`HOMEGROWN_ADMIN_PASSWORD`; keep it private and never commit `.env`.

For manual startup, start Studio first in one terminal, wait until Vite is
serving at `http://localhost:5173`, then start FastAPI in a second terminal.
The Studio shell renders as soon as Vite is ready while FastAPI initializes in
the background. Model-dependent API requests wait for readiness:

```bash
cd apps/studio && npm run dev
```

```bash
cd services/voice-api && ../../.venv/Scripts/python.exe -m uvicorn homegrown_api.app:app --host 127.0.0.1 --port 8000
```

Keep `apps/studio/.env.local` empty for supported local workflows. During
startup, the real header, logo, editor, cards, and controls render immediately.
Skeletons reserve API-backed voice rows, language options, and uncached
history or initial queue rows until their data arrives. Generate and Clone
voice remain visible but disabled until the model is loaded. Generate requires
health to confirm that the model is on CUDA; Clone voice is available after
model initialization, including CPU fallback.

Clone voices from the persistent Voices card by selecting one or more files, or
drop multiple audio files directly onto that card. Dropping files elsewhere
does not clone them. The **Clone voice** button keeps its label and Upload icon
while files are processed. Toasts show waiting uploads, the current clone, and
file-specific errors; success changes the spinner to an animated green tick and
dismisses after one second. Uploads are processed one at a time in selection
order.

If the backend is unavailable, Studio shows a pulsing warning button at the
lower left. Open it to read the backend message and retry startup. A failed
background refresh keeps cached voiceovers visible without adding an inline
warning above the list.

Use the header **Settings** button to choose **System** or a named Studio
theme. The theme options remain visible in a stable order after selection;
choosing a theme does not remove it from the list. The same dialog can hide or
show the mascot. Both choices are stored in this browser; hiding the mascot
does not remove its assets or change voice generation.

Settings also has a **Danger Zone** to permanently delete all generated
voiceovers or all uploaded voices, including their audio, after confirmation.
Finish or cancel generation first; cloned-voice
deletion also requires the cloning queue to finish. The second confirmation
requires the `HOMEGROWN_ADMIN_PASSWORD` configured in
`services/voice-api/.env`; if it is unset, bulk deletion is unavailable. Bulk
deletion has no Undo.

The Studio mascot is a session-local viewport companion. On wide screens it
rests at the Voiceovers section's lower-left corner, and on narrow screens at
the viewport's lower-left, until you drag the mascot artwork itself; after a
completed drag, its clamped position remains for the open tab. Clicking the
artwork without moving it plays the mascot's reaction instead. The small
previous/next arrows cycle the numbered mascot catalog, and the corner grip
resizes the mascot between 56 and 176px by drag or arrow keys. Like the
position, that size lasts only for the open tab and is never persisted.
Mascot 2 (the Cat sheets) is the default.

To add a mascot, place a numbered pair in `apps/studio/public/mascots/`:
`<id>a.webp` for directions and `<id>b.webp` for reactions. Run Studio normally
(`npm run dev`, `npm run test`, `npm run lint`, or `npm run build`); each command
regenerates `apps/studio/src/features/mascots/generated/mascotCatalog.ts`. Commit the two assets
and that generated catalog together.

Run `npm run test` for the Studio and backend unit suites. Backend tests use
Python's `unittest` runner and never build or freeze the backend. The separate
`npm run build` command packages the Windows application.

The Script editor is 300–400px high, with its height adapting to viewport size.
Its footer places the language selector on the left and the compact **Generate**
action on the right. Generate stays disabled until the script contains
non-whitespace text, an available voice and a script language are selected,
health confirms the model is loaded on a CUDA device, and no submission is in
progress. During model startup, Generate and **Clone voice** are disabled; the
loading tooltip says the voice model can take up to three minutes. If the
backend falls back to CPU, Clone voice becomes available after model loading,
but Generate stays disabled and Studio explains that CUDA is required. The
voice, script-language, filter, and page-size selectors use one shared Base UI
menu-backed dropdown style.
Compact Voice, Duration, and Status filters use the shared
dropdown surface and option-window styling; their triggers are slightly shorter
and use smaller text than the script-language selector.
Unselected dropdown inputs use **Select {field label}** as their default
option (for example, **Select language**); fields with an existing setting
continue to show that setting. The language control keeps a fixed 190px width
so voice-name changes do not shift the editor footer.

The textarea has a **Paste from clipboard** button in its top-right corner.
Clicking it calls the browser clipboard API, which can show the browser's own
permission prompt. Pasting inserts at the current selection, or appends when
the textarea is not focused, and clips the inserted text to the 60,000-character
limit. If clipboard access is unavailable or denied, Studio shows a toast with
guidance to use Ctrl+V or check this site's browser permission. The clear
button below Paste is disabled for an empty textarea and clears all script text
when enabled.

Studio initially focuses the Script textarea. Typing a printable character
elsewhere returns focus there, while search fields and other editable controls
keep their normal typing behavior. Modifiers, composition input, menus, and
dialogs are not intercepted.

The persistent Voices card includes a compact, case-insensitive server search
and paginates cloned voices. Page sizes are 10, 25, 50,
and 100 (default 10); the preference is stored independently from Voiceovers.
The footer shows page navigation and the count of matching cloned voices. Clicking a
row selects that voice; cloned-voice names are editable with their pencil
control, while preview, reference download, and delete actions remain on each
row. In completed Voiceovers rows, the fixed-width editable name is
followed by a truncated script preview and timestamp; playback has a seekable
progress bar. Download is beside the three-dot menu, which contains Reuse
transcript and Delete. Live rows keep the compact name/script layout and show
queue or generation controls. Filters are in the popover beside search, and
the total count is in the compact footer. Menus share the Base UI
dropdown primitives, tooltips use the shared Base UI tooltip, and interface
icons use `lucide-react`. Animated status and undo countdown rings remain
custom visuals.

On the first model-ready launch, Studio offers a short, read-only tour of
Settings (theme, mascot visibility, and Danger Zone), voice selection and batch
cloning, script and language entry, generation and its queue, and Voiceovers
playback, reuse, search, and filters. The tour explains queue behavior without
depending on queue rows being present. Press Escape or close it to dismiss it;
use the header help button to replay it. It does not target transient queue
rows or error states.

## Packaged Windows app

```bash
npm run build
```

This creates `dist/Homegrown-<version>.exe`. Run that self-extracting archive,
then run the extracted `Homegrown.exe`; its browser loader appears before the
local API initializes Qwen3-TTS. The packaged backend listens on port 8731 for
trusted LAN use. Ordinary API actions are unauthenticated; permanent bulk
deletion also requires the local `HOMEGROWN_ADMIN_PASSWORD`. Never expose it to
an untrusted network. The detailed,
recoverable build procedure is in [docs/build.md](docs/build.md).

The build prints a numbered ten-stage overview without a separate `PLAN`
heading. Each row begins with its stage-specific timing, such as
`(00:00s) 01. Removing old build files` using the measured baseline, then the
current-run duration replaces it after completion. If no baseline is available,
the row shows `(measuring)`. In an interactive
terminal it updates a live progress bar with elapsed time and current stage; CI
and redirected output use ordinary one-line updates with no ANSI escape
sequences. Child command output and machine-readable stage timing records are
retained in the timestamped `.tmp/build-logs/build-<timestamp>.log` file. Successful output remains
concise; a failure reports its stage, command, exit status, log path, and a
bounded trailing diagnostic. The packaging order, artifacts, `.env.local`
restoration, and final executable path are unchanged.

## Marketing page

`apps/marketing/` is a standalone static page with no build step. Open
`apps/marketing/index.html` directly in a browser or share that directory,
including its `assets/` folder (the hero's launch video and poster, plus Studio
screenshots). The page offers Homegrown as a $69 one-time lifetime purchase;
there is no checkout or download link. Buyers use the on-page **Contact** section
(`#contact`), whose pricing, hero and mobile-bar buttons all link to it. It lists
WhatsApp (+92 333 5082452, via `wa.me`) and email (admin@runtimeguru.com) and says
the team responds within a day or less. The page has no form, backend or
environment variables. Check the page layout with `scripts/marketing/measure_landing.sh`.

The page's favicon, touch icon and logo (`favicon.svg`, `favicon.ico`,
`apple-touch-icon.png`, `logo.svg`) share one source with the Studio favicon and the
Windows app icon: `python scripts/build/build_brand.py` regenerates them and
`--check` verifies them (see `docs/build.md`).

## Repository layout

```text
apps/
  marketing/       static marketing page plus the contact-form function (api/, lib/)
  studio/          React + Vite Studio
services/
  voice-api/
    homegrown_api/ FastAPI package: routes, generation, audio, persistence
    tests/         backend tests
    backend.spec   frozen backend build
engine/
  qwen/            vendored FasterQwen3TTS wrapper
desktop/
  launcher/        browser loader and launcher executable
  installer/       legacy NSIS source (not the supported packaging path)
  assets/          desktop icon assets
scripts/           development, build, checks, marketing, migrations
docs/architecture.md  module ownership and runtime paths
docs/build.md      detailed frozen-build procedure
docs/workflow.md   day-to-day Studio workflow
```

## Safety and support

- Do not commit `.env` files, model snapshots, generated audio, or local
  storage.
- There are no accounts or general API authentication. Individual deletion and
  other ordinary API actions are unauthenticated; permanent bulk deletion
  additionally requires `HOMEGROWN_ADMIN_PASSWORD`. Never expose the
  development or packaged app to an untrusted network.
- See [docs/gpu-notes.md](docs/gpu-notes.md) for local-GPU measurements and
  [engine/qwen/README.md](engine/qwen/README.md) for the vendored wrapper.
- `docs/archive/` is archival material only; it documents superseded cloud and
  pre-migration workflows and is not executable guidance.
