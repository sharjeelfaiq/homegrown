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
Windows path. The default admin password is `Homegrown-Admin-8731!`; override
`ADMIN_PASSWORD` with a long, unique password in `services/voice-api/.env`
before anyone else can reach the app. Only delete operations use this password;
other API actions are not authenticated:

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

## Local development

```bash
npm run dev
```

Open `http://localhost:5173`. The script starts FastAPI on `127.0.0.1:8000`
and Vite on port 5173. Vite proxies `/api`, `/audio`, and `/refs`, so Studio
always uses same-origin API paths. It prints a LAN address when available.
There is no sign-in; the admin password only gates deletion of voices and
completed voiceovers. Use only a trusted network.

For manual startup, use separate terminals:

```bash
cd services/voice-api && ../../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

```bash
cd apps/studio && npm run dev
```

Keep `apps/studio/.env.local` empty for supported local workflows.

When a voice clip is uploaded from the Script editor, the Upload icon changes
to an animated lifecycle mark: amber while work is running, green on success,
and red on failure. The completed result remains visible for two seconds before
the Upload icon returns.

If the backend is unavailable, Studio shows a pulsing warning button at the
lower left. Open it to read the backend message and retry startup. A failed
background refresh keeps cached voiceovers visible without adding an inline
warning above the list.

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
regenerates `apps/studio/src/generated/mascotCatalog.ts`. Commit the two assets
and that generated catalog together.

Run `npm run test` for the Studio and backend unit suites. Backend tests use
Python's `unittest` runner and never build or freeze the backend. The separate
`npm run build` command packages the Windows application.

The Script editor is 300–400px high, with its height adapting to viewport size.
The **Generate** button is centered below the editor and is 44px high. It stays
disabled until the script contains non-whitespace text, an available voice and
a script language are selected, the model is ready, and no submission or
startup is in progress. Its disabled reason and keyboard-shortcut reminder are
auxiliary text, so they do not shift the action off the editor's centerline.
The voice, script-language, filter, and page-size selectors use one shared
Base UI menu-backed dropdown style; the Clone Voice action sits beside the
voice selector. Compact Voice, Duration, and Status filters use the shared
dropdown surface and option-window styling; their triggers are slightly shorter
and use smaller text than the script-language selector.
Unselected dropdown inputs use **Select {field label}** as their default
option (for example, **Select language**); fields with an existing setting
continue to show that setting. The language control keeps a fixed 190px width
so voice-name changes do not shift the editor footer.

The cloned-voice picker includes a compact search field at the top of its
dropdown. Search filters the available voice names locally, case-insensitively.
Clicking a voice name selects it without closing the picker; names are read-only
until the pencil button is clicked. The pencil hides while a name is being
edited and returns when editing ends. Preview, download, and delete actions
remain available on each row. The query is cleared when the dropdown closes.

With no voice selected, the voice picker reads **Select voice**. In the
Voiceovers section, the left heading shows the total voiceover count
until rows are selected, then shows the selected count (with singular grammar
for one voiceover). When no rows are selected, **Select voice**, **Select
duration**, **Select status**, and the **Select date range** calendar filter
sit on the right. The row wraps on narrow screens instead of scrolling
horizontally. Menus share the Base UI dropdown primitives, tooltips use the
shared Base UI tooltip, and interface icons use `lucide-react`. Animated
status and undo countdown rings remain custom visuals.

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
then run the extracted `Homegrown.exe`; it opens the browser loader and starts
the local Studio and API. The packaged backend listens on port 8731 for trusted
LAN use; deletion uses the default admin password unless `ADMIN_PASSWORD` is
overridden in the extracted `backend/.env`. Other API actions are not
authenticated, so never expose it to an untrusted network. The detailed,
recoverable build procedure is in [docs/BUILD.md](docs/BUILD.md).

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
  voice-api/       FastAPI service and PyInstaller spec
engine/
  qwen/            vendored FasterQwen3TTS wrapper
desktop/
  launcher/        browser loader and launcher executable
  installer/       legacy NSIS source (not the supported packaging path)
  assets/          desktop icon assets
docs/BUILD.md      detailed frozen-build procedure
docs/workflow.md   day-to-day Studio workflow
```

## Safety and support

- Do not commit `.env` files, model snapshots, generated audio, or local
  storage.
- There is no sign-in or multi-user isolation. The default admin password is
  shared and only protects deletions; other API actions are unauthenticated.
  Change it before allowing other trusted-LAN users to delete, and never expose
  the development or packaged app to an untrusted network.
- See [docs/gpu-notes.md](docs/gpu-notes.md) for local-GPU measurements and
  [engine/qwen/README.md](engine/qwen/README.md) for the vendored wrapper.
- `docs/history/` is archival material only; it documents superseded cloud and
  pre-migration workflows and is not executable guidance.
