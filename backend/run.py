"""
PyInstaller entrypoint for the Homegrown backend.

In dev, nobody runs this -- `python -m uvicorn main:app` (or the Vite dev
flow) is used instead. This file only matters once frozen into backend.exe:
it wires up the installed-machine paths (model dir, storage dir, .env) that
main.py can't derive from a real repo layout anymore, then starts uvicorn.

Everything slow happens here before uvicorn exists, so each step publishes its
progress through `boot_status` -- the launcher's browser loader is the only UI
the user has until port 8000 comes up.
"""
import fnmatch
import os
import sys
import threading
import time
from pathlib import Path

import boot_status

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

    # Defaults matching the installer's layout -- overridable by backend/.env
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
    # Loopback only, deliberately. Binding 0.0.0.0 asks Windows Defender
    # Firewall for a listener on every interface, which pops the "Allow access
    # / Cancel" alert on first run -- and Cancel writes a permanent Block rule
    # that leaves the app broken with no way back from inside the app. The
    # desktop build serves the API and the SPA from this same origin, so it
    # never needed the wildcard. LAN deployments use start_server.bat, which
    # passes --host 0.0.0.0 itself and is unaffected by this.
    uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="info")
