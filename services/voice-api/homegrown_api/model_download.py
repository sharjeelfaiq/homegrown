"""Download the voice model when missing during background ASGI startup."""
import fnmatch
import threading
from pathlib import Path

import homegrown_api.boot_status as boot_status
import homegrown_api.config as config


REPO_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
IGNORE_PATTERNS = ["*.msgpack", "*.h5", "flax_model*"]
APPROX_MODEL_BYTES = 2_500_000_000


def _repo_total_bytes() -> int:
    try:
        from huggingface_hub import HfApi

        info = HfApi().model_info(REPO_ID, files_metadata=True)
        total = sum(
            sibling.size or 0
            for sibling in info.siblings or []
            if not any(fnmatch.fnmatch(sibling.rfilename, pattern) for pattern in IGNORE_PATTERNS)
        )
        if total > 0:
            return total
    except Exception:
        pass
    return APPROX_MODEL_BYTES


def _bytes_on_disk(root: Path) -> int:
    try:
        return sum(item.stat().st_size for item in root.rglob("*") if item.is_file())
    except OSError:
        return 0


def _write_progress(model_dir: Path, total: int, stop: threading.Event) -> None:
    while not stop.wait(1.0):
        done = _bytes_on_disk(model_dir)
        percent = min(99, int(done * 100 / total)) if total else None
        boot_status.write(
            config.STORAGE_DIR,
            boot_status.PHASE_DOWNLOADING,
            detail=f"{done / 1e9:.1f} GB of {total / 1e9:.1f} GB",
            percent=percent,
        )


def download_model_if_needed() -> None:
    """Fetch the model without delaying the Studio's first render."""
    model_dir = Path(config.MODEL_PATH)
    if (model_dir / "config.json").exists():
        return

    model_dir.mkdir(parents=True, exist_ok=True)
    boot_status.write(
        config.STORAGE_DIR,
        boot_status.PHASE_DOWNLOADING,
        detail="Contacting Hugging Face",
        percent=0,
    )

    stop = threading.Event()
    ticker = None
    try:
        from huggingface_hub import snapshot_download

        total = _repo_total_bytes()
        ticker = threading.Thread(
            target=_write_progress, args=(model_dir, total, stop), daemon=True
        )
        ticker.start()
        snapshot_download(
            repo_id=REPO_ID,
            local_dir=str(model_dir),
            ignore_patterns=IGNORE_PATTERNS,
        )
    finally:
        stop.set()
        if ticker is not None:
            ticker.join(timeout=2)
