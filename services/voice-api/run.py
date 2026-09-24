"""
PyInstaller entrypoint for the Homegrown backend.

In dev, nobody runs this -- `python -m uvicorn main:app` (or the Vite dev
flow) is used instead. This file only matters once frozen into backend.exe:
it wires up the installed-machine paths (model dir, storage dir, .env) that
main.py can't derive from a real repo layout anymore, then starts uvicorn.

Everything slow happens here before uvicorn exists, so each step publishes its
progress through `boot_status` -- the launcher's browser loader is the only UI
the user has until PORT comes up.
"""
import fnmatch
import os
import sys
import threading
import time
from pathlib import Path

import boot_status

# Not 8000, deliberately. 8000 belongs to dev (`dev.sh`); this build is the only one whose port nobody types,
# because it serves the API and the SPA from the same loopback origin and the
# frontend calls it with relative paths. Sharing 8000 meant the launcher's
# health probe could find a dev uvicorn already listening, conclude Homegrown
# was up, open the browser and never start backend.exe at all -- and a healthy
# dev backend serving a built apps/studio/dist is indistinguishable from this one
# over HTTP, so no probe can tell them apart. Separate ports can.
#
# MUST match PORT in desktop/launcher/launcher.py, which is what polls this process
# into readiness. They are separately frozen exes with no import path between
# them, so nothing but `build.sh`'s pre-build check stops them drifting; if
# they disagree the launcher polls a dead port and reports the backend as
# having timed out during startup, which is a badly wrong diagnosis.
PORT = 8731

REPO_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
IGNORE_PATTERNS = ["*.msgpack", "*.h5", "flax_model*"]

# Fallback when the size of the repo can't be looked up (offline-ish HF API,
# rate limit). Only used to render a progress bar, never to decide anything.
APPROX_MODEL_BYTES = 2_500_000_000


def _storage_dir() -> Path:
    # VOICECLONE_STORAGE_DIR is the pre-rebrand key, still read so an
    # existing install keeps its storage after an in-place upgrade.
    return Path(os.environ.get("HOMEGROWN_STORAGE_DIR")
                or os.environ["VOICECLONE_STORAGE_DIR"])


def _configure_frozen_env() -> None:
    exe_dir = Path(sys.executable).parent  # <install>/backend/
    install_dir = exe_dir.parent  # <install>/

    # Defaults matching the packaged layout -- overridable by backend/.env
    # (written by the NSIS installer, or hand-edited by an advanced user).
    os.environ.setdefault("MODEL_PATH", str(install_dir / "models"))
    os.environ.setdefault("HOMEGROWN_STORAGE_DIR", str(install_dir / "storage"))

    env_path = exe_dir / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path, override=True)

    # A status file from a previous run would make the launcher's loader show
    # a stale phase (or a stale error) before this run has published anything.
    boot_status.clear(_storage_dir())
    boot_status.write(_storage_dir(), boot_status.PHASE_STARTING)


def _repo_total_bytes() -> int:
    """Sum of the files snapshot_download will actually fetch, for the bar."""
    try:
        from huggingface_hub import HfApi
        info = HfApi().model_info(REPO_ID, files_metadata=True)
        total = 0
        for sibling in info.siblings or []:
            name = sibling.rfilename
            if any(fnmatch.fnmatch(name, pat) for pat in IGNORE_PATTERNS):
                continue
            total += sibling.size or 0
        if total > 0:
            return total
    except Exception:
        pass
    return APPROX_MODEL_BYTES


def _bytes_on_disk(root: Path) -> int:
    try:
        return sum(f.stat().st_size for f in root.rglob("*") if f.is_file())
    except OSError:
        return 0


def _download_progress_loop(model_dir: Path, total: int, stop: threading.Event) -> None:
    """Report download progress by watching the model dir grow.

    Deliberately not huggingface_hub's `tqdm_class`: that hands out one bar per
    file plus an overall bar, created lazily as parallel workers start, so the
    aggregate total jumps around mid-download. Bytes on disk (including the
    partial files under .cache/) only ever move one way.
    """
    while not stop.wait(1.0):
        done = _bytes_on_disk(model_dir)
        percent = min(99, int(done * 100 / total)) if total else None
        boot_status.write(
            _storage_dir(),
            boot_status.PHASE_DOWNLOADING,
            detail=f"{done / 1e9:.1f} GB of {total / 1e9:.1f} GB",
            percent=percent,
        )


def _download_model_if_needed() -> None:
    model_dir = Path(os.environ["MODEL_PATH"])
    if (model_dir / "config.json").exists():
        return  # already downloaded (or the user pointed MODEL_PATH at one)

    print(f"First run: downloading the Qwen3-TTS model to {model_dir} ...")
    model_dir.mkdir(parents=True, exist_ok=True)
    boot_status.write(
        _storage_dir(), boot_status.PHASE_DOWNLOADING, detail="Contacting Hugging Face", percent=0
    )

    stop = threading.Event()
    ticker = None
    try:
        from huggingface_hub import snapshot_download

        total = _repo_total_bytes()
        ticker = threading.Thread(
            target=_download_progress_loop, args=(model_dir, total, stop), daemon=True
        )
        ticker.start()

        snapshot_download(
            repo_id=REPO_ID,
            local_dir=str(model_dir),
            ignore_patterns=IGNORE_PATTERNS,
        )
        print("Model download complete.")
    except Exception as e:
        print(f"ERROR: model download failed: {e}")
        message = (
            f"Failed to download the AI voice model:\n\n{e}\n\n"
            "Check your internet connection and try again.\n"
            "The model only needs to download once (~2.5GB)."
        )
        # Both channels: the flag file feeds the launcher's browser loader, the
        # message box covers someone running backend.exe on its own.
        boot_status.write(_storage_dir(), boot_status.PHASE_ERROR, detail=message)
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0, message, "Homegrown -- Download Failed", 0x10,  # MB_ICONERROR
        )
        sys.exit(1)
    finally:
        stop.set()
        if ticker is not None:
            ticker.join(timeout=2)


if getattr(sys, "frozen", False):
    _configure_frozen_env()
    _download_model_if_needed()
    # `import main` (via uvicorn, below) faults in ~3.8GB of torch DLLs off
    # disk -- tens of seconds cold, and silent. Say so before it happens.
    boot_status.write(_storage_dir(), boot_status.PHASE_IMPORTING)

import uvicorn

if __name__ == "__main__":
    # Wildcard bind, so the desktop build is reachable from other machines on
    # the LAN. This reverses an earlier deliberate loopback-only bind; both
    # costs of the reversal are real and neither is hypothetical.
    #
    # 1. FIRST RUN HITS WINDOWS DEFENDER FIREWALL. A listener on every
    #    interface pops the "Allow access / Cancel" alert, and **Cancel writes
    #    a permanent Block rule for this exe path** that nothing in the app can
    #    undo -- after which it never starts again. Pre-authorise the exe
    #    before first launch, from an elevated prompt:
    #
    #      netsh advfirewall firewall add rule name="Homegrown" dir=in ^
    #        action=allow program="C:\Homegrown\backend\backend.exe" ^
    #        protocol=TCP localport=8731 enable=yes profile=private
    #
    #    A pre-existing allow rule means the prompt never appears, so the
    #    unrecoverable Cancel is never offered.
    #
    # 2. THERE IS NO AUTHENTICATION ANYWHERE IN THIS APP. auth.py's
    #    get_current_user returns the constant "local-user" for every request,
    #    so anyone who can reach this port has the same rights the owner does:
    #    create voices, submit jobs, and permanently delete voices and
    #    voiceovers (DELETE /api/presets/{id} unlinks the reference clip;
    #    DELETE /api/history/{id} unlinks both the .wav and the .mp3). Neither
    #    is recoverable. Bind this only on networks you trust.
    #
    # PORT stays 8731: desktop/launcher/launcher.py polls the same number and
    # scripts/check_desktop_port.py is what stops the two drifting.
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info")
