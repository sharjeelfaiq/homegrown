"""
PyInstaller entrypoint for the Voice Clone Studio backend.

In dev, nobody runs this -- `python -m uvicorn main:app` (or the Vite dev
flow) is used instead. This file only matters once frozen into backend.exe:
it wires up the installed-machine paths (model dir, storage dir, .env) that
main.py can't derive from a real repo layout anymore, then starts uvicorn.
"""
import os
import sys
from pathlib import Path


def _configure_frozen_env() -> None:
    exe_dir = Path(sys.executable).parent  # <install>/backend/
    install_dir = exe_dir.parent  # <install>/

    # Defaults matching the installer's layout -- overridable by backend/.env
    # (written by the NSIS installer, or hand-edited by an advanced user).
    os.environ.setdefault("MODEL_PATH", str(install_dir / "models"))
    os.environ.setdefault("VOICECLONE_STORAGE_DIR", str(install_dir / "storage"))

    env_path = exe_dir / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path, override=True)


def _download_model_if_needed() -> None:
    model_dir = Path(os.environ["MODEL_PATH"])
    if (model_dir / "config.json").exists():
        return  # already downloaded (or the user pointed MODEL_PATH at one)

    print(f"First run: downloading the Qwen3-TTS model to {model_dir} ...")
    model_dir.mkdir(parents=True, exist_ok=True)
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id="Qwen/Qwen3-TTS-12Hz-0.6B-Base",
            local_dir=str(model_dir),
            ignore_patterns=["*.msgpack", "*.h5", "flax_model*"],
        )
        print("Model download complete.")
    except Exception as e:
        print(f"ERROR: model download failed: {e}")
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            f"Failed to download the AI voice model:\n\n{e}\n\n"
            "Check your internet connection and try again.\n"
            "The model only needs to download once (~2.5GB).",
            "Voice Clone Studio -- Download Failed",
            0x10,  # MB_ICONERROR
        )
        sys.exit(1)


if getattr(sys, "frozen", False):
    _configure_frozen_env()
    _download_model_if_needed()

import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, log_level="info")
