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

cd apps/studio && npm install && cd ../..
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
bash dev.sh
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

## Packaged Windows app

```bash
bash build.sh
```

This creates `dist/Homegrown-<version>.exe`. Run that self-extracting archive,
then run the extracted `Homegrown.exe`; it opens the browser loader and starts
the local Studio and API. The packaged backend listens on port 8731 for trusted
LAN use; deletion uses the default admin password unless `ADMIN_PASSWORD` is
overridden in the extracted `backend/.env`. Other API actions are not
authenticated, so never expose it to an untrusted network. The detailed,
recoverable build procedure is in [docs/BUILD.md](docs/BUILD.md).

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
