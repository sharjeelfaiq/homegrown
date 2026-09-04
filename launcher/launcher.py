"""
Voice Clone Studio launcher.

Double-clicked by the desktop/start-menu shortcut. Starts backend.exe hidden
(no console window), waits for it to report healthy, then opens the default
browser at the app's URL. If backend.exe is already running (e.g. the user
double-clicks the shortcut a second time), it just reopens the browser tab
instead of starting a second copy.
"""
import ctypes
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "Voice Clone Studio"
PORT = 8000
BASE_URL = f"http://localhost:{PORT}"
HEALTH_URL = f"{BASE_URL}/api/health"
STARTUP_TIMEOUT_S = 300  # first run downloads a ~2.5GB model -- generous


def show_error(message: str) -> None:
    ctypes.windll.user32.MessageBoxW(0, message, APP_NAME, 0x10)  # MB_ICONERROR


def find_backend_exe() -> Path | None:
    self_dir = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    candidates = [
        self_dir / "backend" / "backend.exe",              # installed layout: <install>/backend/backend.exe
        self_dir.parent.parent / "backend" / "dist" / "backend" / "backend.exe",  # dev: launcher/dist -> repo root
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def is_backend_healthy() -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=2) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def wait_for_backend(timeout_s: int) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if is_backend_healthy():
            return True
        time.sleep(1)
    return False


def main() -> None:
    if is_backend_healthy():
        webbrowser.open(BASE_URL)
        return

    backend_exe = find_backend_exe()
    if backend_exe is None:
        show_error(
            "Could not find backend.exe.\n\nThe installation may be incomplete. "
            "Please reinstall Voice Clone Studio."
        )
        sys.exit(1)

    if port_in_use():
        show_error(
            f"Port {PORT} is already in use by another application.\n\n"
            "Please close whatever is using it and try again."
        )
        sys.exit(1)

    install_dir = backend_exe.parent.parent
    storage_dir = install_dir / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    cuda_flag = storage_dir / "cuda_error.flag"
    cuda_flag.unlink(missing_ok=True)  # clear any stale flag from a previous run

    proc = subprocess.Popen(
        [str(backend_exe)],
        cwd=str(backend_exe.parent),
        creationflags=subprocess.CREATE_NO_WINDOW,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    if not wait_for_backend(STARTUP_TIMEOUT_S):
        proc.terminate()
        show_error(
            "Voice Clone Studio failed to start within 5 minutes.\n\n"
            "Possible causes:\n"
            "- No NVIDIA GPU found (an NVIDIA GPU with CUDA drivers is required)\n"
            "- GPU drivers missing or outdated\n"
            "- Not enough GPU memory (4GB VRAM minimum)\n"
            "- First-run model download still in progress on a slow connection\n\n"
            "Please check your GPU drivers and internet connection, then try again."
        )
        sys.exit(1)

    if cuda_flag.exists():
        error_msg = cuda_flag.read_text(encoding="utf-8")
        cuda_flag.unlink(missing_ok=True)
        proc.terminate()
        show_error(
            f"{error_msg}\n\n"
            "Voice Clone Studio requires an NVIDIA GPU with CUDA drivers.\n"
            "Download drivers at: https://www.nvidia.com/drivers"
        )
        sys.exit(1)

    webbrowser.open(BASE_URL)


if __name__ == "__main__":
    main()
