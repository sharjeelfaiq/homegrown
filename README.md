# Homegrown

Homegrown is a local Windows voice-generation app built around Qwen3-TTS. It
has no accounts or hosted service: audio, presets, history, and the model stay
on the computer that runs it.

## First-time setup

Use Windows 10/11 with Git Bash, Python 3.11+, Node 20.19+ (or 22.12+), and (for a packaged
build) 7-Zip. An NVIDIA GPU is recommended; CPU fallback works but generation
may take many minutes.

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

Open `http://localhost:5173`. The script starts Vite first so Studio can show
its startup state, then starts FastAPI on `127.0.0.1:8000`; FastAPI probes for
a usable NVIDIA GPU and loads Qwen3-TTS before reporting ready. Vite proxies
`/api`, `/audio`, and `/refs`, so Studio always uses same-origin API paths. It
prints a LAN address when available.
There is no sign-in or authentication. Use only a trusted network; anyone who
can reach the API can delete voices and completed voiceovers as well as use the
other API actions.

For manual startup, start Studio first in one terminal, wait until Vite is
serving at `http://localhost:5173`, then start FastAPI in a second terminal.
This lets the frontend render while the backend probes the device and loads
the model:

```bash
cd apps/studio && npm run dev
```

```bash
cd services/voice-api && ../../.venv/Scripts/python.exe -m uvicorn homegrown_api.app:app --host 127.0.0.1 --port 8000
```

Keep `apps/studio/.env.local` empty for supported local workflows. While the
model initializes, Studio shows a persistent **Voice model is loading** toast
with an animated spinner; it disappears when startup succeeds or fails. The
full-screen startup overlay also reports the backend phase.

Clone a voice from the persistent Voices card or drop an audio file directly
onto that card. Dropping a file elsewhere does not clone it. During upload, the
Clone voice icon changes to an animated lifecycle mark: amber while work is
running, green on success, and red on failure. The completed result remains
visible for two seconds before the Upload icon returns.

If the backend is unavailable, Studio shows a pulsing warning button at the
lower left. Open it to read the backend message and retry startup. A failed
background refresh keeps cached voiceovers visible without adding an inline
warning above the list.

Use the header **Settings** button to choose a Studio theme or follow the
system theme. The same dialog can hide or show the mascot. Both choices are
stored in this browser; hiding the mascot does not remove its assets or change
voice generation.

Settings also has a **Danger Zone** to permanently delete all generated
voiceovers or all uploaded voices, including their audio, after confirmation.
Built-in voices are preserved. Finish or cancel generation first; uploaded-voice
deletion also requires the cloning queue to finish. Bulk deletion has no Undo.

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
the model is fully ready, and no submission is in progress. While the model is
loading, Generate and **Clone voice** are disabled; their tooltips say the voice
model is loading and can take up to three minutes. The voice, script-language, filter,
and page-size selectors use one shared Base UI menu-backed dropdown style.
Compact Voice, Duration, and Status filters use the shared
dropdown surface and option-window styling; their triggers are slightly shorter
and use smaller text than the script-language selector.
Unselected dropdown inputs use **Select {field label}** as their default
option (for example, **Select language**); fields with an existing setting
continue to show that setting. The language control keeps a fixed 190px width
so voice-name changes do not shift the editor footer.

The persistent Voices card includes a compact, case-insensitive search field.
Clicking a row selects that voice; cloned-voice names are editable with their
pencil control, while preview, reference download, and delete actions remain
on each row. In the Voiceovers section, filters are in the filter popover next
to search and the total count is in the compact footer. Menus share the Base UI
dropdown primitives, tooltips use the shared Base UI tooltip, and interface
icons use `lucide-react`. Animated status and undo countdown rings remain
custom visuals.

On the first model-ready launch, Studio offers a short, read-only tour of the
theme/help controls, reusable voice creation, the Script editor, Generate, and
the Voiceovers search/filter workflow. Press Escape or close it to dismiss it;
use the header help button to replay it. It intentionally excludes the mascot,
queue rows, errors, and other state that may not exist at startup.

## Packaged Windows app

```bash
npm run build
```

This creates `dist/Homegrown-<version>.exe`. Run that self-extracting archive,
then run the extracted `Homegrown.exe`; its browser loader appears before the
local API initializes Qwen3-TTS. The packaged backend listens on port 8731 for
trusted LAN use. No API actions are authenticated, so never expose it to an
untrusted network. The detailed,
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

`apps/marketing/` is a standalone static page. Open `apps/marketing/index.html`
directly in a browser or manually share that directory. It does not require a
build system or hosting-provider configuration.

## Repository layout

```text
apps/
  marketing/       standalone static marketing page
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
- There is no sign-in, authentication, or multi-user isolation. Any client that
  can reach the API can use all actions, including deletion. Never expose the
  development or packaged app to an untrusted network.
- See [docs/gpu-notes.md](docs/gpu-notes.md) for local-GPU measurements and
  [engine/qwen/README.md](engine/qwen/README.md) for the vendored wrapper.
- `docs/archive/` is archival material only; it documents superseded cloud and
  pre-migration workflows and is not executable guidance.
