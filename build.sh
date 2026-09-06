#!/usr/bin/env bash
# Source -> VoiceCloneStudio-1.0.0.exe, in one command.
#
#   bash build.sh
#
# Runs everything documented in BUILD.md. Expect ~45 minutes and ~10 GB free on
# this drive. Git Bash, not PowerShell: setup.sh needs bash, and the final SFX
# step concatenates two binaries, which PowerShell's `>` corrupts by rewriting
# them as text.
#
# frontend/.env.local is stashed before the frontend build and restored from an
# EXIT trap, so it survives a failure or a Ctrl-C as well as a clean run. That
# file has to be absent while Vite builds -- VITE_BACKEND_URL is baked into the
# bundle, and a stale 127.0.0.1 makes every LAN client call its own loopback --
# but leaving it deleted silently breaks local development afterwards.
set -Eeuo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$PWD"

VERSION="${VERSION:-1.0.0}"
STAGE_DIR="dist/VoiceCloneStudio"
OUTPUT="dist/VoiceCloneStudio-${VERSION}.exe"
ENV_LOCAL="frontend/.env.local"
ENV_STASH=".tmp/env.local.stash"
SEVENZIP="/c/Program Files/7-Zip/7z.exe"
SFX="/c/Program Files/7-Zip/7z.sfx"

# The one line the app actually needs for local development. Only two Vite
# variables are read anywhere in frontend/src -- VITE_BACKEND_URL and
# VITE_USE_RUNPOD_WAKE -- and the latter is unset outside the Vercel project.
ENV_LOCAL_DEFAULT='VITE_BACKEND_URL=http://127.0.0.1:8000'

START_TS=$SECONDS
step() { printf '\n\033[1m==> %s\033[0m  (+%dm%02ds)\n' "$1" $(( (SECONDS-START_TS)/60 )) $(( (SECONDS-START_TS)%60 )); }
die()  { printf '\n\033[31mBUILD FAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# ---- env restore -----------------------------------------------------------
# Runs on every exit path: success, failure, or interrupt.
restore_env() {
  local code=$?
  if [ -f "$ENV_STASH" ]; then
    mkdir -p "$(dirname "$ENV_LOCAL")"
    mv -f "$ENV_STASH" "$ENV_LOCAL"
    printf '\n[env] restored %s\n' "$ENV_LOCAL"
  elif [ ! -f "$ENV_LOCAL" ]; then
    # Nothing was stashed and nothing is there -- fresh clone, or a previous
    # build deleted it and never put it back. Leave the tree usable either way.
    mkdir -p "$(dirname "$ENV_LOCAL")"
    printf '%s\n' "$ENV_LOCAL_DEFAULT" > "$ENV_LOCAL"
    printf '\n[env] created %s with the default dev value\n' "$ENV_LOCAL"
  fi
  return $code
}
trap restore_env EXIT

# ---- 0. prerequisites ------------------------------------------------------
step "Checking prerequisites"
command -v python >/dev/null 2>&1 || die "python is not on PATH."
command -v npm    >/dev/null 2>&1 || die "npm is not on PATH."
[ -x "$SEVENZIP" ] || die "7-Zip not found at $SEVENZIP. Install with: winget install 7zip.7zip"
[ -f "$SFX" ]      || die "7z.sfx not found at $SFX. It ships with the full 7-Zip install, not the reduced one."
[ -f backend/backend.spec ]   || die "backend/backend.spec is missing -- are you in the repo root?"
[ -f launcher/launcher.spec ] || die "launcher/launcher.spec is missing."
echo "  python, npm, 7-Zip and both PyInstaller specs present."

# ---- 1. python env + model -------------------------------------------------
step "Python environment and model (setup.sh -- idempotent, skips what is done)"
bash setup.sh

PY=".venv/Scripts/python.exe"
[ -f "$PY" ] || PY=".venv/bin/python"
[ -f "$PY" ] || die "setup.sh did not produce a virtualenv interpreter."

# ---- 2. pyinstaller --------------------------------------------------------
step "PyInstaller"
if "$PY" -c "import PyInstaller" >/dev/null 2>&1; then
  echo "  already installed."
else
  echo "  installing (build tool -- deliberately not in requirements.txt)..."
  "$PY" -m pip install --quiet pyinstaller
fi

# ---- 3. pre-build gates ----------------------------------------------------
# Cheap, and they run before the 20-minute freeze rather than after it.
step "Pre-build checks"
python scripts/check_design_tokens.py
( cd frontend && npm install --no-fund --no-audit --loglevel=error && npm run lint )

# ---- 4. stash the dev env file --------------------------------------------
step "Stashing $ENV_LOCAL"
mkdir -p .tmp
if [ -f "$ENV_LOCAL" ]; then
  mv -f "$ENV_LOCAL" "$ENV_STASH"
  echo "  stashed; will be restored when this script exits."
else
  echo "  not present; the trap will create it with the default dev value at the end."
fi

# ---- 5. frontend -----------------------------------------------------------
# backend.spec hard-fails without frontend/dist, so this precedes the freeze.
step "Building the frontend"
( cd frontend && npm run build )

# ---- 6. freeze -------------------------------------------------------------
# TMP/TEMP land on this drive on purpose: PyInstaller pushes several GB through
# temp and will exhaust a small system drive.
step "Freezing backend.exe (this is the long one, ~15-20 min)"
( cd backend && TMP="$REPO_ROOT/.tmp" TEMP="$REPO_ROOT/.tmp" "../$PY" -m PyInstaller backend.spec --clean --noconfirm )

step "Freezing VoiceCloneStudio.exe (launcher)"
( cd launcher && TMP="$REPO_ROOT/.tmp" TEMP="$REPO_ROOT/.tmp" "../$PY" -m PyInstaller launcher.spec --clean --noconfirm )

# ---- 7. stage --------------------------------------------------------------
step "Staging the install layout"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp launcher/dist/VoiceCloneStudio.exe "$STAGE_DIR/"
cp -r backend/dist/backend "$STAGE_DIR/backend"
mkdir -p "$STAGE_DIR/storage/references" "$STAGE_DIR/storage/generated" "$STAGE_DIR/models"
echo "  staged at $STAGE_DIR"

# ---- 8. portability gate ---------------------------------------------------
# A hard failure, not a reminder: both of these ship a machine-specific build to
# someone else, and neither is obvious once the .exe is packed.
step "Portability gate"
# An `if`, not `[ ... ] && die`: under `set -e` an AND-list whose left side
# fails is only exempt because it is not the final statement, which makes
# that idiom quietly position-dependent.
if [ -f "$STAGE_DIR/backend/.env" ]; then
  die "$STAGE_DIR/backend/.env exists. It carries an absolute MODEL_PATH that exists on no other machine. Delete it and re-run."
fi
if [ -n "$(ls -A "$STAGE_DIR/models" 2>/dev/null)" ]; then
  die "$STAGE_DIR/models is not empty. It must ship empty -- the app downloads the model on first run."
fi
[ -f "$STAGE_DIR/VoiceCloneStudio.exe" ] || die "launcher exe missing from the staged tree."
[ -f "$STAGE_DIR/backend/backend.exe" ]  || die "backend.exe missing from the staged tree."
echo "  no .env shipped, models/ empty, both executables present."

# ---- 9. pack ---------------------------------------------------------------
# -mx5 not -mx9: the payload is mostly incompressible CUDA DLLs, so maximum
# compression costs far more time for a couple of percent.
step "Packing the self-extractor (~10 min)"
( cd dist \
  && rm -f app.7z "VoiceCloneStudio-${VERSION}.exe" \
  && "$SEVENZIP" a -t7z -m0=lzma2 -mx5 -mmt=on app.7z VoiceCloneStudio >/dev/null \
  && cat "$SFX" app.7z > "VoiceCloneStudio-${VERSION}.exe" \
  && rm -f app.7z )
[ -f "$OUTPUT" ] || die "packing produced no $OUTPUT"

# ---- 10. report ------------------------------------------------------------
step "Done"
SIZE=$(du -h "$OUTPUT" | cut -f1)
printf '\n  \033[1m%s/%s\033[0m\n' "$REPO_ROOT" "$OUTPUT"
printf '  size    %s\n' "$SIZE"
printf '  sha256  %s\n' "$(sha256sum "$OUTPUT" | cut -d' ' -f1)"
printf '  built   %dm%02ds\n' $(( (SECONDS-START_TS)/60 )) $(( (SECONDS-START_TS)%60 ))

cat <<'NEXT'

  Not verified by this script -- it needs a human:

    ./dist/VoiceCloneStudio/VoiceCloneStudio.exe

  Expect a browser loader within ~2s, storage/boot_status.json and
  storage/backend.log appearing, NO Windows firewall prompt, and a redirect to
  the app once the model loads. Confirm the listener is loopback-only:

    netstat -ano | findstr :8000     # 127.0.0.1:8000, never 0.0.0.0:8000

  If you publish this build, update the landing page's download link, size text
  and SHA-256 together. A stale checksum is worse than none.
NEXT
