"""
Homegrown launcher.

Double-clicked by the desktop/start-menu shortcut. Starts backend.exe hidden
(no console window) and opens the built Studio as soon as the backend serves
the app. Model download and initialization continue in the backend's background
startup worker, so the packaged app shows the same shell and API loading states
as the development app.

If backend.exe is already running (e.g. the user double-clicks the shortcut a
second time), this just reopens the browser tab instead of starting a second
copy -- a live generation must not be interrupted by a stray double-click.
"""
import ctypes
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "Homegrown"
# The desktop build's own port, not 8000. 8000 is used by dev (`npm run dev`); this build never shares it, because a dev
# uvicorn answering on the same port made the health probe below conclude
# Homegrown was already running -- so this process opened the browser and
# returned without ever starting backend.exe.
#
# MUST match PORT in services/voice-api/run.py, which is what actually binds it. The two
# are separately frozen exes with no import path between them, so nothing but
# `npm run build`'s pre-build check stops them drifting; if they disagree this
# process polls a dead port for STALL_TIMEOUT_S and then blames the backend for
# a startup timeout it never had.
PORT = 8731
BASE_URL = f"http://localhost:{PORT}"
# Probed over 127.0.0.1, never "localhost". That name resolves to ::1 *first*
# and 127.0.0.1 second, and a connect to a dead loopback port on this stack is
# dropped rather than refused -- so urlopen burns its whole timeout once per
# family. Measured here with nothing listening: 4.05s via localhost, 2.01s via
# 127.0.0.1. At 4s a poll the Studio's loading state would update too slowly.
HEALTH_URL = f"http://127.0.0.1:{PORT}/api/health"
# The app root, same host rule as HEALTH_URL. /api/health alone cannot tell
# this backend from any other FastAPI app on the port -- including a dev uvicorn
# of this same project that imported the API while apps/studio/dist was missing,
# which answers health 200 but has no SPA route at all. Adopting one of those
# sent the browser to a bare {"detail": "Not Found"} and skipped starting
# backend.exe.
#
# Second line of defence now, not the first: PORT moved off 8000 precisely so
# that encounter cannot happen. This still earns its keep against anything else
# that happens to bind the port, and the failure it prevents is the expensive
# kind -- silently not starting the app.
ROOT_URL = f"http://127.0.0.1:{PORT}/"

# Session-local named mutex. The old single-instance check was
# is_backend_healthy(), which is blind during the whole pre-bind window: a
# second double-click 20s into a cold start saw no health *and* no listener on
# PORT, and cheerfully spawned a second backend.exe. Both then loaded torch,
# one lost the bind and died silently into DEVNULL.
MUTEX_NAME = "Homegrown.Launcher.SingleInstance"
ERROR_ALREADY_EXISTS = 183

# No fixed overall budget any more. The old flat 300s regularly expired mid
# model-download on a slow line and reported it as "no NVIDIA GPU found",
# which is a badly wrong diagnosis. Instead: give up only if the backend stops
# reporting progress for this long, with a hard ceiling as a backstop.
STALL_TIMEOUT_S = 180
HARD_TIMEOUT_S = 3 * 60 * 60
EXISTING_START_TIMEOUT_S = 3 * 60 * 60


def show_error(message: str) -> None:
    ctypes.windll.user32.MessageBoxW(0, message, APP_NAME, 0x10)  # MB_ICONERROR


def acquire_single_instance_mutex():
    """Return the mutex handle, or None if another launcher already holds it."""
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        return None
    if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        return None
    return handle


def find_backend_exe():
    self_dir = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    candidates = [
        self_dir / "backend" / "backend.exe",              # installed layout: <install>/backend/backend.exe
        self_dir.parent.parent.parent / "services" / "voice-api" / "dist" / "backend" / "backend.exe",  # dev: desktop/launcher/dist -> repo root
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def resolve_storage_dir(backend_exe: Path) -> Path:
    """Mirror how services/voice-api/run.py resolves the storage dir, .env override included.

    run.py defaults to <install>/storage but lets backend/.env override it via
    HOMEGROWN_STORAGE_DIR. Assuming the default here would leave the launcher
    polling a boot_status.json nobody writes, on any install that sets one.
    """
    default = backend_exe.parent.parent / "storage"
    env_path = backend_exe.parent / ".env"
    if not env_path.exists():
        return default
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() in ("HOMEGROWN_STORAGE_DIR", "VOICECLONE_STORAGE_DIR"):
                value = value.strip().strip('"').strip("'")
                if value:
                    return Path(value)
    except OSError:
        pass
    return default


def port_in_use(timeout: float = 1.0) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def is_backend_healthy(quick: bool = False, serving_app: bool = False) -> bool:
    """True once the backend is serving. `quick` trades timeout for cadence.

    The TCP pre-check matters more than it looks: for the entire pre-bind
    window nothing is listening on PORT, and an HTTP attempt against that costs
    seconds (see HEALTH_URL) where a connect attempt costs milliseconds. The
    poll loop passes quick=True so it can actually run at its 0.5s cadence;
    the one-shot checks in main() stay generous, because a false negative
    there would spawn a second backend.

    `serving_app` adds a second request checking that / returns HTML, i.e. that
    whatever is on PORT is serving the app and not just the API (see ROOT_URL).
    Startup checks require this so the launcher opens the app only after the
    built frontend route is available.
    """
    if not port_in_use(0.25 if quick else 1.0):
        return False
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=2) as r:
            if r.status != 200:
                return False
        if not serving_app:
            return True
        with urllib.request.urlopen(ROOT_URL, timeout=2) as r:
            return r.status == 200 and "text/html" in r.headers.get("Content-Type", "")
    except (urllib.error.URLError, OSError):
        return False


def read_boot_status(storage_dir: Path) -> dict:
    """Read what the backend published. {} if absent (or caught mid-replace)."""
    try:
        with (storage_dir / "boot_status.json").open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def start_backend(backend_exe: Path, storage_dir: Path):
    """Spawn backend.exe hidden, with its output captured to a log file.

    Its stdout used to go to DEVNULL, which threw away every traceback the
    backend printed on the way down -- the single biggest obstacle to
    diagnosing a failed start on someone else's machine.
    """
    log_path = storage_dir / "backend.log"
    try:
        log = open(log_path, "w", encoding="utf-8", errors="replace")
    except OSError:
        log = subprocess.DEVNULL
    proc = subprocess.Popen(
        [str(backend_exe)],
        cwd=str(backend_exe.parent),
        creationflags=subprocess.CREATE_NO_WINDOW,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    return proc, log_path


def main() -> None:
    mutex = acquire_single_instance_mutex()

    backend_exe = find_backend_exe()
    if backend_exe is None:
        show_error(
            "Could not find backend.exe.\n\nThe installation may be incomplete. "
            "Please reinstall Homegrown."
        )
        sys.exit(1)

    storage_dir = resolve_storage_dir(backend_exe)
    if mutex is None:
        # Another launcher owns startup. Wait for its app to become available
        # rather than opening a URL that is not listening yet.
        deadline = time.time() + EXISTING_START_TIMEOUT_S
        while time.time() < deadline:
            if is_backend_healthy(quick=True, serving_app=True):
                webbrowser.open(BASE_URL)
                return
            time.sleep(0.5)
        show_error("Homegrown is still starting. Please try opening it again shortly.")
        return

    if is_backend_healthy(serving_app=True):
        webbrowser.open(BASE_URL)
        return

    if port_in_use():
        show_error(
            f"Port {PORT} is already in use by another application.\n\n"
            "Please close whatever is using it and try again."
        )
        sys.exit(1)

    storage_dir.mkdir(parents=True, exist_ok=True)  # stale flag/status cleared per attempt below

    (storage_dir / "cuda_error.flag").unlink(missing_ok=True)
    (storage_dir / "boot_status.json").unlink(missing_ok=True)
    proc, log_path = start_backend(backend_exe, storage_dir)
    ok, failure = wait_for_backend(storage_dir, log_path, proc)
    if ok:
        webbrowser.open(BASE_URL)
        return
    show_error(failure)
    sys.exit(1)


def wait_for_backend(storage_dir: Path, log_path: Path, proc):
    """Mirror the backend's published progress into /status until it is healthy.

    Returns once the app is serving, while model initialization may still be
    running in the background. Fatal pre-bind failures return a message.
    """
    hard_deadline = time.time() + HARD_TIMEOUT_S
    last_change = time.time()
    last_seen = None
    while True:
        if is_backend_healthy(quick=True, serving_app=True):
            # The Studio owns startup feedback and keeps its real UI reachable
            # even if model initialization later reports an error.
            return True, None

        status = read_boot_status(storage_dir)
        if status:
            if status.get("phase") == "error":
                _terminate(proc)
                return False, status.get("detail") or "The backend reported an error during startup."
            fingerprint = (status.get("phase"), status.get("percent"), status.get("detail"))
            if fingerprint != last_seen:
                last_seen = fingerprint
                last_change = time.time()

        if proc.poll() is not None:
            return False, (
                f"The backend stopped unexpectedly (exit code {proc.returncode}).\n\n"
                f"Details were written to:\n{log_path}"
            )

        now = time.time()
        if now - last_change > STALL_TIMEOUT_S:
            _terminate(proc)
            return False, (
                "The backend stopped responding during startup and made no progress for "
                f"{STALL_TIMEOUT_S // 60} minutes.\n\n"
                f"Details were written to:\n{log_path}"
            )
        if now > hard_deadline:
            _terminate(proc)
            return False, (
                "Homegrown took too long to start.\n\n"
                f"Details were written to:\n{log_path}"
            )

        time.sleep(0.5)


def _terminate(proc) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


if __name__ == "__main__":
    main()
