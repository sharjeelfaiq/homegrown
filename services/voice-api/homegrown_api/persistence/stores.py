"""JSON stores and media reference persistence."""
import homegrown_api.config as config
import json
import shutil
import threading
import time
from pathlib import Path
from typing import Optional
from filelock import FileLock

import homegrown_api.persistence.media_paths as persistence_media_paths

_store_lock = threading.Lock()


def _load_json(path: Path) -> list:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: Path, data: list) -> None:
    # File lock (not just the in-process _store_lock) so concurrent writers
    # across processes -- e.g. a second backend instance started by mistake --
    # can't interleave writes to the same file.
    lock = FileLock(str(path) + ".lock", timeout=10)
    with lock:
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp.replace(path)


_presets: list[dict] = _load_json(config.PRESETS_FILE)  # newest first


_history: list[dict] = _load_json(config.HISTORY_FILE)  # newest first


def _migrate_preset_media_paths() -> None:
    """Canonicalize valid legacy preset paths once, preserving a backup."""
    changed = False
    for preset in _presets:
        raw = preset.get("audio_path")
        try:
            resolved = persistence_media_paths.resolve_stored_media_path(raw, config.STORAGE_DIR)
            canonical = persistence_media_paths.storage_relative_path(resolved, config.STORAGE_DIR)
        except persistence_media_paths.StoredMediaPathError as exc:
            config.logger.warning("Preset %s has unresolved reference media: %s", preset.get("id"), exc)
            continue
        if raw != canonical:
            preset["audio_path"] = canonical
            changed = True
            config.logger.info("Migrated preset %s reference path", preset.get("id"))
    if changed:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = config.PRESETS_FILE.with_name(f"{config.PRESETS_FILE.name}.migration-{stamp}.bak")
        shutil.copy2(config.PRESETS_FILE, backup)
        _save_json(config.PRESETS_FILE, _presets)
        config.logger.info("Backed up presets to %s before path migration", backup)


def _reference_path(preset: dict) -> Path:
    """Resolve a preset clip and persist a valid legacy-path migration."""
    previous = preset.get("audio_path", "")
    resolved = persistence_media_paths.resolve_stored_media_path(previous, config.STORAGE_DIR)
    canonical = persistence_media_paths.storage_relative_path(resolved, config.STORAGE_DIR)
    if previous != canonical:
        with _store_lock:
            stamp = time.strftime("%Y%m%d-%H%M%S")
            backup = config.PRESETS_FILE.with_name(f"{config.PRESETS_FILE.name}.migration-{stamp}.bak")
            if config.PRESETS_FILE.exists() and not backup.exists():
                shutil.copy2(config.PRESETS_FILE, backup)
            preset["audio_path"] = canonical
            _save_json(config.PRESETS_FILE, _presets)
            config.logger.info("Persisted migrated reference path for preset %s", preset.get("id"))
    else:
        preset["audio_path"] = canonical
    return resolved


def _find_preset(preset_id: str) -> Optional[dict]:
    return next((p for p in _presets if p["id"] == preset_id), None)
