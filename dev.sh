#!/usr/bin/env bash
# Start the whole app for local development, in one command.
#
#   bash dev.sh
#
# Backend on 127.0.0.1:8000, Vite dev server on :5173, both stopped together
# with Ctrl-C. This is deployment mode 1 of the four in CLAUDE.md.
#
# Reachable from other devices on the network: Vite binds every interface and
# proxies /api, /audio and /refs to the backend, so a phone's API calls arrive
# same-origin and come back here. Nothing to configure on the visiting device.
# That is also why frontend/.env.local must NOT set VITE_BACKEND_URL -- an
# absolute URL bakes one machine's address into the page. The backend itself
# stays on loopback; the proxy reaches it from this host, so a wildcard bind
# there would buy nothing. The address to type is printed below.
#
# No --reload on uvicorn, deliberately. Loading the model takes tens of seconds
# to minutes; a watcher that restarts the process on every backend edit would
# pay that cost each time. Restart this script by hand when you change backend
# code.
#
# Output from both processes goes to .tmp/dev-backend.log and
# .tmp/dev-frontend.log and is tailed here with a prefix, so a crash is still
# readable after the fact.
set -Eeuo pipefail

# Note for anyone testing the Ctrl-C path: run this in the foreground. A shell
# launched as a background job (`bash dev.sh &`) inherits SIGINT as SIG_IGN,
# and bash refuses to install a trap for a signal that was already ignored on
# entry -- so the teardown below silently never runs and both servers survive.
# That is a property of the launch, not of this script. SIGTERM works either
# way, which is what makes the difference easy to misdiagnose.

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$PWD"

BACKEND_LOG=".tmp/dev-backend.log"
FRONTEND_LOG=".tmp/dev-frontend.log"
BACKEND_PID=""
FRONTEND_PID=""
HELPER_PIDS=""    # log-tail pipelines and the readiness poller

bold() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m    warning: %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mdev.sh: %s\033[0m\n' "$1" >&2; exit 1; }

# ---- shutdown --------------------------------------------------------------
# Runs on Ctrl-C, on error, and on normal exit. `kill` alone is not enough on
# Windows: `npm run dev` is a cmd shim that spawns node as a separate process,
# so killing the shim orphans the server and leaves :5173 bound. taskkill //T
# takes the whole tree; the // is Git Bash's escape for a leading slash.
stop() {
  local code=$?
  trap - INT TERM EXIT
  # set +e for the whole teardown: every kill here is best-effort against a
  # process that may already be gone, and a single non-zero would abandon the
  # rest of the cleanup -- which is exactly how :5173 got left bound once.
  set +e
  bold "stopping"
  # $! for `tail ... | sed ... &` is sed's pid, not tail's. Killing sed is
  # enough here only because each tail is run with --pid=$$ and exits on its
  # own once this script does; that is also why nothing below waits on them.
  for pid in $HELPER_PIDS; do kill "$pid" 2>/dev/null; done
  for pid in $FRONTEND_PID $BACKEND_PID; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null
  done
  # Sweep anything still listening -- covers the orphaned-node case above.
  local owner
  if command -v powershell >/dev/null 2>&1; then
    for port in 5173 8000; do
      owner=$(powershell -NoProfile -Command \
        "(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess" \
        2>/dev/null | tr -d '\r' | head -1) || owner=""
      if [ -n "$owner" ]; then
        taskkill //F //T //PID "$owner" >/dev/null 2>&1
      fi
    done
  fi
  # No bare `wait`: the tails outlive this function by design (they watch $$
  # and exit when the script does), so waiting on them would hang the teardown.
  printf '    logs kept at %s and %s\n' "$BACKEND_LOG" "$FRONTEND_LOG"
  # exit, not return: on the Ctrl-C path the shell would otherwise resume the
  # wait loop below and print its "one process exited" line *after* this, which
  # reads as though something crashed. Safe to exit from here -- the traps were
  # cleared above, so this does not re-enter.
  exit $code
}
trap stop INT TERM EXIT

# ---- preflight -------------------------------------------------------------
# Each of these fails later in a way that does not name its own cause, so they
# are checked up front rather than left to surface as a stack trace or a
# silently broken API call.
bold "Preflight"

PY=".venv/Scripts/python.exe"
[ -f "$PY" ] || PY=".venv/bin/python"
[ -f "$PY" ] || die "no virtualenv interpreter. Run: bash setup.sh"

[ -f backend/.env ] || die "backend/.env is missing. Run: bash setup.sh"
grep -qE '^MODEL_PATH=.+' backend/.env || die "backend/.env has no MODEL_PATH. Run: bash setup.sh"

# ALLOWED_ORIGINS only matters for requests a browser sends straight to the
# backend. Through the dev proxy they arrive from Vite instead, server-side,
# and CORS never applies -- but a leftover VITE_BACKEND_URL puts the browser
# back on that path, and then a LAN origin nobody listed is the failure.
if ! grep -qE '^ALLOWED_ORIGINS=.*127\.0\.0\.1:5173' backend/.env; then
  warn "backend/.env ALLOWED_ORIGINS does not list http://127.0.0.1:5173 --"
  warn "harmless while the dev proxy is in use, but not if something bypasses it."
fi

# This check is the reverse of what it used to be. vite.config.ts now proxies
# /api, /audio and /refs, so api.ts's BACKEND_URL falls back to '' and every
# call is same-origin against whatever address the browser typed -- which is
# what lets another device on the network work with no configuration of its
# own. Setting VITE_BACKEND_URL overrides that and hardcodes one address:
# point it at 127.0.0.1 and every visiting device calls its own loopback,
# loading a page that can never reach anything. A warning, not a failure -- it
# is still the right setting for the dormant Vercel+RunPod split (CLAUDE.md,
# deployment mode 4).
if [ -f frontend/.env.local ] && grep -qE '^[[:space:]]*VITE_BACKEND_URL=.+' frontend/.env.local; then
  warn "frontend/.env.local sets VITE_BACKEND_URL. The dev proxy makes it unnecessary,"
  warn "and other devices on your network will call their own machine, not this one."
  warn "Comment it out to serve the LAN."
fi

[ -d frontend/node_modules ] || die "frontend/node_modules is missing. Run: cd frontend && npm install"

echo "    venv, backend/.env and node_modules all present."

# frontend/dist only matters here as a footgun: the backend registers its SPA
# catch-all when dist exists, so :8000 will serve a *built* copy of the app
# that is not the one you are editing. Say so rather than let it confuse.
# An `if`, not `[ ... ] && warn`: under `set -e` that idiom's safety depends on
# its position in the script (see the same note in build.sh).
if [ -d frontend/dist ]; then
  warn "frontend/dist exists -- :8000 serves that stale build. Edit against :5173."
fi

# ---- start -----------------------------------------------------------------
mkdir -p .tmp
: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"

# 127.0.0.1, not 0.0.0.0, even though reaching this from other devices is now
# a goal of the script. Nothing off-host talks to :8000 -- Vite proxies to it
# from here -- so a wildcard bind would buy nothing and cost a second Windows
# Defender Firewall prompt, this one on python.exe. Clicking Cancel on one of
# those writes a permanent Block rule for that exe path, which nothing in the
# app can undo. One prompt (Node, for :5173) is enough.
bold "Backend   http://127.0.0.1:8000   (loading the model, this takes a while)"
( cd backend && exec "$REPO_ROOT/$PY" -m uvicorn main:app --host 127.0.0.1 --port 8000 ) \
  > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

bold "Frontend  http://localhost:5173"
( cd frontend && exec npm run dev ) > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

# The address to type on a phone or another laptop. Filtered, not listed: this
# machine also carries a Hyper-V vEthernet 172.28.x.x that no other device can
# reach, and printing both invites picking the wrong one. Best-effort -- a
# missing address is not worth failing a dev run over.
LAN_IP=""
if command -v powershell >/dev/null 2>&1; then
  LAN_IP=$(powershell -NoProfile -Command \
    "(Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Where-Object { \$_.InterfaceAlias -notmatch 'vEthernet|Loopback' } | Select-Object -First 1).IPAddress" \
    2>/dev/null | tr -d '\r' | head -1) || LAN_IP=""
fi
if [ -n "$LAN_IP" ]; then
  bold "On your network   http://$LAN_IP:5173"
  echo "    Anyone who can reach that address has the whole app -- there is no sign-in."
  echo "    Windows may ask to allow Node.js through the firewall; allow it."
fi

# Colours built with printf rather than written as sed escapes: \o033 in a
# replacement is a GNU-sed extension, and this is the one line that would
# silently emit literal garbage on a sed that lacks it.
C_BACK=$(printf '\033[34m'); C_FRONT=$(printf '\033[32m'); C_OFF=$(printf '\033[0m')
# --pid=$$ is what makes these self-terminating: each tail exits once this
# script does, so no orphaned `tail -f` survives a Ctrl-C or a crash.
tail --pid=$$ -n +1 -f "$BACKEND_LOG"  | sed -u "s/^/${C_BACK}[backend] ${C_OFF}/"  & HELPER_PIDS="$HELPER_PIDS $!"
tail --pid=$$ -n +1 -f "$FRONTEND_LOG" | sed -u "s/^/${C_FRONT}[frontend]${C_OFF} /" & HELPER_PIDS="$HELPER_PIDS $!"

# ---- readiness -------------------------------------------------------------
# The frontend is usable in under a second; the backend is not. Without this,
# the first thing you see is the app's "model not ready" state and no
# indication of whether that is normal or a failed load.
(
  while :; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      printf '\n\033[31m==> backend exited during startup -- see %s\033[0m\n' "$BACKEND_LOG"
      exit 0
    fi
    body=$(curl -sf --max-time 2 http://127.0.0.1:8000/api/health 2>/dev/null || true)
    case "$body" in
      *'"model_loaded":true'*)
        device=$(printf '%s' "$body" | sed -n 's/.*"device":"\([^"]*\)".*/\1/p')
        printf '\n\033[1m==> model ready on %s -- open http://localhost:5173\033[0m\n' "${device:-unknown}"
        [ "$device" = "cpu" ] && printf '\033[33m    CPU fallback: generation will take many minutes per chunk.\033[0m\n'
        exit 0
        ;;
    esac
    sleep 2
  done
) & HELPER_PIDS="$HELPER_PIDS $!"

# ---- wait ------------------------------------------------------------------
# Exit as soon as *either* process dies, rather than leaving half the stack
# running and looking healthy. Polled rather than `wait -n $PID1 $PID2`: taking
# PID arguments needs bash 5.1+, and the tails and the readiness poller are
# jobs too, so a bare `wait -n` would return the moment one of *those* ends.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
bold "one process exited -- shutting the other down"
