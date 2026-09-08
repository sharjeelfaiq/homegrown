"""
Homegrown launcher.

Double-clicked by the desktop/start-menu shortcut. Starts backend.exe hidden
(no console window) and immediately opens the browser on a small loader page
this process serves itself, which polls startup progress and redirects to the
app once the backend is healthy.

The loader exists because there is a long window -- tens of seconds warm, many
minutes on a first run -- where the backend cannot answer for itself. uvicorn
runs the ASGI lifespan startup (CUDA probe, model load) *before* it binds the
socket, and on a first run backend.exe downloads ~2.5GB before uvicorn is even
imported, so port 8000 is connection-refused for all of it. Previously the
launcher just polled in silence and the user saw nothing at all until the whole
chain finished. Progress is instead published by the backend to
storage/boot_status.json and served from here at /status, same-origin with the
loader page so no CORS is involved.

If backend.exe is already running (e.g. the user double-clicks the shortcut a
second time), this just reopens the browser tab instead of starting a second
copy -- a live generation must not be interrupted by a stray double-click.
"""
import ctypes
import json
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_NAME = "Homegrown"
PORT = 8000
BASE_URL = f"http://localhost:{PORT}"
# Probed over 127.0.0.1, never "localhost". That name resolves to ::1 *first*
# and 127.0.0.1 second, and a connect to a dead loopback port on this stack is
# dropped rather than refused -- so urlopen burns its whole timeout once per
# family. Measured here with nothing listening: 4.05s via localhost, 2.01s via
# 127.0.0.1. At 4s a poll the loader's progress would be a slideshow, and the
# old launcher paid it on every one of its 1s-cadence polls.
HEALTH_URL = f"http://127.0.0.1:{PORT}/api/health"

# Session-local named mutex. The old single-instance check was
# is_backend_healthy(), which is blind during the whole pre-bind window: a
# second double-click 20s into a cold start saw no health *and* no listener on
# 8000, and cheerfully spawned a second backend.exe. Both then loaded torch,
# one lost the bind and died silently into DEVNULL.
MUTEX_NAME = "Homegrown.Launcher.SingleInstance"
ERROR_ALREADY_EXISTS = 183

# Where the running launcher advertises its loader URL, so a second launch
# during startup can join the same loader instead of guessing a dead port.
SPLASH_URL_FILE = "launcher_splash.url"

# No fixed overall budget any more. The old flat 300s regularly expired mid
# model-download on a slow line and reported it as "no NVIDIA GPU found",
# which is a badly wrong diagnosis. Instead: give up only if the backend stops
# reporting progress for this long, with a hard ceiling as a backstop.
STALL_TIMEOUT_S = 180
HARD_TIMEOUT_S = 3 * 60 * 60
# How long to keep the loader alive after an error, so the user can hit Retry.
ERROR_LINGER_S = 15 * 60
# Grace period after `ready` for the page to poll once more and redirect.
REDIRECT_GRACE_S = 8

LOADER_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Homegrown</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html { background: #0d0e13; }
  body {
    margin: 0; min-height: 100svh; display: grid; place-items: center;
    font-family: Inter, system-ui, "Segoe UI", Roboto, sans-serif;
    color: #f5f6f8;
    background: var(--bg, #14151a);
  }
  .card {
    width: min(440px, calc(100vw - 48px));
    padding: 40px 36px;
    border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 12px;
    background: #1d1f28;
    text-align: center;
  }
  .mark {
    width: 56px; height: 56px; margin: 0 auto 22px;
    border-radius: 50%;
    border: 3px solid rgba(255, 180, 58, 0.25);
    border-top-color: #ffb43a;
    animation: spin 900ms linear infinite;
  }
  .card.is-error .mark {
    animation: none; border-color: rgba(255, 97, 105, 0.5); border-top-color: #ff6169;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 {
    margin: 0 0 10px; font-size: 0.72rem; font-weight: 600;
    letter-spacing: 0.18em; text-transform: uppercase; color: #a9adba;
  }
  .detail { margin: 0; font-size: 0.875rem; color: #a9adba; line-height: 1.5; min-height: 1.3em; }
  .track {
    margin: 24px 0 10px; height: 6px; border-radius: 3px;
    background: rgba(255, 255, 255, 0.09); overflow: hidden;
  }
  .fill {
    height: 100%; border-radius: 3px;
    background: #ffb43a;
    width: 30%; transition: width 400ms ease;
  }
  .track.indeterminate .fill { width: 35%; animation: slide 1.4s ease-in-out infinite; }
  @keyframes slide {
    0% { transform: translateX(-110%); } 100% { transform: translateX(320%); }
  }
  .elapsed {
    font-size: 0.7rem; color: #8b90a4; margin: 0;
    font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', monospace;
    font-variant-numeric: tabular-nums;
  }
  .error-text {
    display: none; margin: 18px 0 0; padding: 14px; text-align: left;
    font-size: 0.8125rem; line-height: 1.5; color: #ffc9cc; white-space: pre-wrap;
    background: rgba(255, 97, 105, 0.14); border: 1px solid rgba(255, 97, 105, 0.4);
    border-radius: 8px; max-height: 220px; overflow: auto;
    font-family: inherit;
  }
  .card.is-error .error-text { display: block; }
  .card.is-error .track, .card.is-error .elapsed { display: none; }
  button {
    display: none; margin: 18px auto 0; padding: 10px 22px;
    font: inherit; font-size: 0.875rem; font-weight: 500; color: #fff;
    background: #f5f6f8; color: #0d0e13; border: none; border-radius: 5px; cursor: pointer;
  }
  button:hover { background: #ffffff; }
  .card.is-error button { display: block; }
</style>
</head>
<body>
  <main class="card" id="card">
    <div class="mark"></div>
    <h1 id="title">Starting Homegrown</h1>
    <p class="detail" id="detail">This can take a minute the first time.</p>
    <div class="track indeterminate" id="track"><div class="fill" id="fill"></div></div>
    <p class="elapsed" id="elapsed"></p>
    <pre class="error-text" id="errorText"></pre>
    <button id="retry" type="button">Try again</button>
  </main>
<script>
  var APP_URL = "__BASE_URL__";
  var TITLES = {
    starting: "Starting Homegrown",
    downloading: "Downloading the voice model",
    importing: "Loading libraries",
    probing_gpu: "Checking your graphics card",
    loading_model: "Loading the voice model",
    ready: "Ready"
  };
  var DEFAULT_DETAIL = {
    starting: "This can take a minute the first time.",
    downloading: "About 2.5 GB, once only. Later launches skip this.",
    importing: "Reading a few gigabytes of libraries from disk.",
    probing_gpu: "Making sure this machine can run the model.",
    loading_model: "Almost there.",
    ready: "Opening the app."
  };
  var started = Date.now();
  var card = document.getElementById("card");
  var title = document.getElementById("title");
  var detail = document.getElementById("detail");
  var track = document.getElementById("track");
  var fill = document.getElementById("fill");
  var elapsed = document.getElementById("elapsed");
  var errorText = document.getElementById("errorText");
  var retry = document.getElementById("retry");
  var redirected = false;

  retry.addEventListener("click", function () {
    retry.disabled = true;
    fetch("/restart", { method: "POST" }).then(function () {
      card.classList.remove("is-error");
      retry.disabled = false;
      started = Date.now();
    });
  });

  setInterval(function () {
    if (redirected || card.classList.contains("is-error")) return;
    var s = Math.round((Date.now() - started) / 1000);
    elapsed.textContent = s < 1 ? "" : s + "s elapsed";
  }, 500);

  function render(s) {
    if (s.phase === "ready") {
      redirected = true;
      location.replace(APP_URL);
      return;
    }
    if (s.phase === "error") {
      card.classList.add("is-error");
      title.textContent = "Homegrown could not start";
      detail.textContent = "";
      errorText.textContent = s.detail || "The backend stopped unexpectedly.";
      return;
    }
    card.classList.remove("is-error");
    title.textContent = TITLES[s.phase] || "Starting Homegrown";
    detail.textContent = s.detail || DEFAULT_DETAIL[s.phase] || "";
    if (typeof s.percent === "number") {
      track.classList.remove("indeterminate");
      fill.style.width = Math.max(2, Math.min(100, s.percent)) + "%";
    } else {
      track.classList.add("indeterminate");
      fill.style.width = "35%";
    }
  }

  function poll() {
    fetch("/status", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { /* launcher gone; keep the last frame on screen */ })
      .then(function () { if (!redirected) setTimeout(poll, 500); });
  }
  poll();
</script>
</body>
</html>
"""


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
        self_dir.parent.parent / "backend" / "dist" / "backend" / "backend.exe",  # dev: launcher/dist -> repo root
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def resolve_storage_dir(backend_exe: Path) -> Path:
    """Mirror how backend/run.py resolves the storage dir, .env override included.

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


def is_backend_healthy(quick: bool = False) -> bool:
    """True once the backend is serving. `quick` trades timeout for cadence.

    The TCP pre-check matters more than it looks: for the entire pre-bind
    window nothing is listening on 8000, and an HTTP attempt against that costs
    seconds (see HEALTH_URL) where a connect attempt costs milliseconds. The
    poll loop passes quick=True so it can actually run at its 0.5s cadence;
    the one-shot checks in main() stay generous, because a false negative
    there would spawn a second backend.
    """
    if not port_in_use(0.25 if quick else 1.0):
        return False
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=2) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


class BootState:
    """What /status serves. Written by the main thread, read by request threads."""

    def __init__(self):
        self._lock = threading.Lock()
        self._payload = {"phase": "starting", "detail": None, "percent": None}
        self.restart_requested = threading.Event()

    def set(self, phase: str, detail=None, percent=None) -> None:
        with self._lock:
            self._payload = {"phase": phase, "detail": detail, "percent": percent}

    def get(self) -> dict:
        with self._lock:
            return dict(self._payload)


def make_handler(state: BootState, page: bytes):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: bytes, content_type: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/status"):
                self._send(200, json.dumps(state.get()).encode("utf-8"), "application/json")
            elif self.path in ("/", "/index.html"):
                self._send(200, page, "text/html; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path.startswith("/restart"):
                state.restart_requested.set()
                self._send(200, b"{}", "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def log_message(self, *args):
            pass  # this process is windowed; there is nowhere for these to go

    return Handler


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
    splash_file = storage_dir / SPLASH_URL_FILE

    if mutex is None:
        # Another launcher is mid-startup. Join its loader rather than starting
        # a second backend or opening a URL that isn't listening yet.
        if is_backend_healthy():
            webbrowser.open(BASE_URL)
            return
        try:
            webbrowser.open(splash_file.read_text(encoding="utf-8").strip())
        except OSError:
            webbrowser.open(BASE_URL)
        return

    if is_backend_healthy():
        webbrowser.open(BASE_URL)
        return

    if port_in_use():
        show_error(
            f"Port {PORT} is already in use by another application.\n\n"
            "Please close whatever is using it and try again."
        )
        sys.exit(1)

    storage_dir.mkdir(parents=True, exist_ok=True)  # stale flag/status cleared per attempt below

    state = BootState()
    page = LOADER_HTML.replace("__BASE_URL__", BASE_URL).encode("utf-8")

    # Port 0: let the OS pick a free one, so there is no second port to collide
    # over. Loopback only, so this never trips the firewall either.
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state, page))
    except OSError:
        server = None

    splash_url = None
    if server is not None:
        server.daemon_threads = True
        splash_url = f"http://127.0.0.1:{server.server_address[1]}/"
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            splash_file.write_text(splash_url, encoding="utf-8")
        except OSError:
            pass

    opened_browser = False
    try:
        while True:
            (storage_dir / "cuda_error.flag").unlink(missing_ok=True)
            (storage_dir / "boot_status.json").unlink(missing_ok=True)
            state.set("starting")
            proc, log_path = start_backend(backend_exe, storage_dir)

            if not opened_browser:
                # Before any waiting: this is the whole point -- the user sees a
                # loader about a second after the double-click, not a blank
                # desktop. On a retry the tab is already open, so don't reopen.
                webbrowser.open(splash_url or BASE_URL)
                opened_browser = True

            ok, failure = wait_for_backend(state, storage_dir, log_path, proc)

            if ok:
                state.set("ready")
                if server is not None:
                    # Let the page poll once more and redirect itself before
                    # the port disappears out from under it.
                    time.sleep(REDIRECT_GRACE_S)
                    server.shutdown()
                else:
                    webbrowser.open(BASE_URL)
                return

            if server is None:
                show_error(failure)
                sys.exit(1)

            # Show the failure in the loader and offer Retry. The button only
            # renders in the error state, so a restart request can only arrive
            # here -- which is why the retry loop lives in main() and not in
            # wait_for_backend, where an earlier version put it and where it
            # could never actually fire.
            state.set("error", detail=failure)
            if not _wait_for_retry(state):
                server.shutdown()
                sys.exit(1)
    finally:
        splash_file.unlink(missing_ok=True)


def _wait_for_retry(state: BootState) -> bool:
    """Block until the loader asks for a retry. False if nobody ever does.

    The user closing that browser tab isn't observable from here, hence the
    ceiling -- otherwise a dismissed error would leave this process resident
    forever, still holding the single-instance mutex.
    """
    deadline = time.time() + ERROR_LINGER_S
    while time.time() < deadline:
        if state.restart_requested.is_set():
            state.restart_requested.clear()
            return True
        time.sleep(0.25)
    return False


def wait_for_backend(state: BootState, storage_dir: Path, log_path: Path, proc):
    """Mirror the backend's published progress into /status until it is healthy.

    Returns (True, None) on success, or (False, message) on failure. Retrying
    after a failure is main()'s job, not this function's.
    """
    hard_deadline = time.time() + HARD_TIMEOUT_S
    last_change = time.time()
    last_seen = None
    cuda_flag = storage_dir / "cuda_error.flag"

    while True:
        if is_backend_healthy(quick=True):
            # The backend keeps serving with model_loaded=False when the model
            # fails to load (main.py's deliberate fail-soft path), so a 200
            # alone isn't success -- the flag file distinguishes the two.
            if cuda_flag.exists():
                message = cuda_flag.read_text(encoding="utf-8")
                cuda_flag.unlink(missing_ok=True)
                _terminate(proc)
                return False, (
                    f"{message}\n\n"
                    "Homegrown requires an NVIDIA GPU with CUDA drivers.\n"
                    "Download drivers at: https://www.nvidia.com/drivers"
                )
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
                state.set(status.get("phase") or "starting",
                          detail=status.get("detail"), percent=status.get("percent"))

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
