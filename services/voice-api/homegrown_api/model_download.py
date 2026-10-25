"""Install the selected voice model on demand and report local progress."""
import fnmatch
import threading
from pathlib import Path

import homegrown_api.boot_status as boot_status
import homegrown_api.config as config


REPO_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
HIGHER_REPO_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
IGNORE_PATTERNS = ["*.msgpack", "*.h5", "flax_model*"]
APPROX_MODEL_BYTES = 2_500_000_000


def model_is_installed(model_dir: Path | None = None) -> bool:
    root = Path(model_dir or config.MODEL_PATH)
    # snapshot_download can leave the config and tokenizer in place when an
    # interrupted transfer has not fetched the checkpoint weights yet.
    weights = root / "model.safetensors"
    return (root / "config.json").is_file() and weights.is_file() and weights.stat().st_size > 0


def model_path(choice: str) -> Path:
    return Path(config.HIGHER_MODEL_PATH if choice == "higher" else config.MODEL_PATH)


def model_paths_are_separate() -> bool:
    return model_path("standard").resolve() != model_path("higher").resolve()


def active_model_path() -> Path:
    """Resolve persisted choice without ever aliasing Higher to Standard."""
    choice = active_choice()
    if choice == "higher" and not model_paths_are_separate():
        raise RuntimeError("Higher quality storage must be separate from Standard storage.")
    return model_path(choice)


def active_choice() -> str:
    import json
    try:
        choice = json.loads((config.STORAGE_DIR / "model-selection.json").read_text(encoding="utf-8")).get("selection")
    except Exception:
        choice = "standard"
    return choice if choice in ("standard", "higher") else "standard"


def repo_id(choice: str) -> str:
    return HIGHER_REPO_ID if choice == "higher" else REPO_ID


def is_installed(choice: str) -> bool:
    if choice == "higher" and not model_paths_are_separate():
        return False
    return model_is_installed(model_path(choice))


def _repo_total_bytes(repo: str = REPO_ID) -> int:
    try:
        from huggingface_hub import HfApi

        info = HfApi().model_info(repo, files_metadata=True)
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


def download_model_if_needed(choice: str = "standard") -> None:
    """Fetch the model without delaying the Studio's first render."""
    if choice == "higher" and not model_paths_are_separate():
        raise ValueError("Higher quality storage must be separate from Standard storage.")
    model_dir = model_path(choice)
    if model_is_installed(model_dir):
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

        repo = repo_id(choice)
        total = _repo_total_bytes(repo)
        ticker = threading.Thread(
            target=_write_progress, args=(model_dir, total, stop), daemon=True
        )
        ticker.start()
        snapshot_download(
            repo_id=repo,
            local_dir=str(model_dir),
            ignore_patterns=IGNORE_PATTERNS,
        )
    finally:
        stop.set()
        if ticker is not None:
            ticker.join(timeout=2)
