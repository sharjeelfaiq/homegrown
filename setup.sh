#!/usr/bin/env bash
# One-shot setup for Homegrown. Safe to re-run -- every step is skipped
# if it's already done, so a failed/interrupted run just needs re-invoking.
#
#   bash setup.sh
#
# Env overrides:
#   MODEL_DIR   where to download the ~2.5GB model snapshot (default: <repo>/models)
#   PIP_CACHE_DIR  where pip caches wheels (default: <repo>/.pip-cache)
#   TMP_OVERRIDE   where pip unpacks wheels (default: <repo>/.tmp)
#   REQUIRE_GPU=1  fail instead of accepting the CPU fallback (see step 3)
#
# Both default to the repo's own drive on purpose. pip's cache and temp dirs
# normally live under %LOCALAPPDATA% on C:, and this project pulls ~3GB of torch
# + ~2.5GB of model weights -- enough to fill a nearly-full system drive. Keeping
# them next to the repo means the space is on whatever drive you cloned to.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

MODEL_DIR="${MODEL_DIR:-$REPO_ROOT/models}"
export PIP_CACHE_DIR="${PIP_CACHE_DIR:-$REPO_ROOT/.pip-cache}"
# pip unpacks multi-GB wheels here before installing; the default is on C:.
export TMP="${TMP_OVERRIDE:-$REPO_ROOT/.tmp}"
export TEMP="$TMP"
mkdir -p "$PIP_CACHE_DIR" "$TMP"

PY=".venv/Scripts/python.exe"          # Git Bash / Windows
[ -f "$PY" ] || PY=".venv/bin/python"  # POSIX

say() { printf '\n==> %s\n' "$1"; }

# ---- 1. venv -------------------------------------------------------------
if [ ! -f "$PY" ]; then
  say "Creating .venv"
  python -m venv .venv
  PY=".venv/Scripts/python.exe"; [ -f "$PY" ] || PY=".venv/bin/python"
  "$PY" -m pip install --upgrade pip
else
  say ".venv already exists -- skipping"
fi

# ---- 2. Python deps ------------------------------------------------------
# requirements.txt carries the PyTorch index URL in its header, so this single
# command resolves the +cu126 torch pins. --retries/--timeout are deliberate:
# the torch wheel is ~2.8GB and a dropped connection mid-download is common.
if "$PY" -c "import torch" 2>/dev/null; then
  say "Python deps already installed -- skipping"
else
  say "Installing Python deps (~3GB, several minutes)"
  "$PY" -m pip install -r backend/requirements.txt --retries 15 --timeout 120
fi

# ---- 3. Compute device ---------------------------------------------------
# Deliberately NOT a strict `sm_XX in torch.cuda.get_arch_list()` membership
# test. Cubins are forward-compatible within a major version, so an sm_50
# binary runs fine on an sm_52 card (GTX 9xx) that a membership test rejects.
# cuda_is_usable() encodes that rule AND runs a real matmul, which is the only
# way to catch a card torch merely *claims* to support -- it is the same probe
# the backend uses at startup, so installer and runtime can't disagree.
#
# Not fatal, either: with no usable GPU the app falls back to CPU generation --
# correct output, many minutes per chunk. Set REQUIRE_GPU=1 to make it a gate.
say "Checking compute device"
if ! "$PY" - <<'PYEOF'
import sys

import torch

from qwen.utils import cuda_is_usable

usable, reason = cuda_is_usable()
print(f"torch {torch.__version__}")
print(f"torch built for: {' '.join(torch.cuda.get_arch_list())}")
print(("GPU: " if usable else "No usable GPU: ") + reason)
sys.exit(0 if usable else 1)
PYEOF
then
  if [ "${REQUIRE_GPU:-0}" = "1" ]; then
    echo "FAIL: REQUIRE_GPU=1 was set, but no usable GPU was found." >&2
    exit 1
  fi
  say "WARNING: no usable GPU -- continuing with the CPU fallback."
  echo "    Generation still works but takes many minutes per chunk."
  echo "    Set REQUIRE_GPU=1 to make this fatal instead."
fi

# ---- 4. Model ------------------------------------------------------------
if [ -f "$MODEL_DIR/config.json" ]; then
  say "Model already present at $MODEL_DIR -- skipping"
else
  say "Downloading model to $MODEL_DIR (~2.5GB, resumable -- re-run if interrupted)"
  MODEL_DIR="$MODEL_DIR" "$PY" - <<'PYEOF'
import os
from huggingface_hub import snapshot_download
snapshot_download(
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    local_dir=os.environ["MODEL_DIR"],
    ignore_patterns=["*.msgpack", "*.h5", "flax_model*"],
)
PYEOF
fi

# ---- 5. backend/.env -----------------------------------------------------
if [ -f backend/.env ] && grep -qE '^MODEL_PATH=.+' backend/.env && ! grep -q '<snapshot-id>' backend/.env; then
  say "backend/.env already configured -- skipping"
else
  say "Writing backend/.env"
  [ -f backend/.env ] || cp backend/.env.example backend/.env
  # Windows-style path: MODEL_PATH is consumed by Python on Windows.
  WIN_MODEL_DIR="$(cd "$MODEL_DIR" && pwd -W 2>/dev/null || echo "$MODEL_DIR")"
  "$PY" - "$WIN_MODEL_DIR" <<'PYEOF'
import pathlib, re, sys
p = pathlib.Path("backend/.env")
model = sys.argv[1].replace("/", "\\")
text = p.read_text(encoding="utf-8")
text = re.sub(r"(?m)^MODEL_PATH=.*$", f"MODEL_PATH={model}", text)
p.write_text(text, encoding="utf-8")
print(f"MODEL_PATH={model}")
PYEOF
fi

# ---- 6. Frontend ---------------------------------------------------------
# Single-port mode: VITE_BACKEND_URL must stay UNSET so src/api.ts falls back to
# relative paths. A frontend/.env.local pointing at 127.0.0.1 gets baked into
# this build and breaks every client except the one on this machine.
if [ -f frontend/.env.local ]; then
  say "WARNING: frontend/.env.local exists -- it will be baked into this build."
  echo "    Remove/empty VITE_BACKEND_URL before building for single-port or LAN use."
fi
say "Building frontend"
( cd frontend && npm install && npm run build )

say "Setup complete. Start the server with:"
echo "    cd backend && ../.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000"
echo "  (or double-click start_server.bat from the repo root)"
echo
echo "  Then open:  http://localhost:8000        <- on this PC"
echo "              http://<this-PC-LAN-IP>:8000 <- from other devices"
echo
echo "  Do NOT open http://0.0.0.0:8000 -- 0.0.0.0 only means \"listen on every"
echo "  interface\". It is a bind address; no browser can connect to it."
