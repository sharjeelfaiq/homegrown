"""JSON stores and media reference persistence."""
import homegrown_api.config as config
import json
import shutil
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional
from filelock import FileLock

import homegrown_api.persistence.media_paths as persistence_media_paths

_store_lock = threading.Lock()
_active_reference_uploads = 0


@contextmanager
def reference_upload():
    """Track uploads through persistence so bulk deletion cannot race transcription."""
    global _active_reference_uploads
    with _store_lock:
        _active_reference_uploads += 1
    try:
        yield
    finally:
        with _store_lock:
            _active_reference_uploads -= 1


def reference_upload_dependency():
    with reference_upload():
        yield


def _owned_media(record: dict, kind: str) -> set[Path]:
    if kind == "presets":
        try:
            path = persistence_media_paths.resolve_stored_media_path(record.get("audio_path"), config.STORAGE_DIR)
        except persistence_media_paths.StoredMediaPathError:
            return set()  # Missing/unsafe legacy paths never authorize filesystem deletion.
        return {path}
    url = record.get("audio_url") or ""
    if not url.startswith("/audio/"):
        return set()
    path = (config.GEN_DIR / url.removeprefix("/audio/")).resolve()
    if config.GEN_DIR.resolve() not in path.parents:
        return set()
    return {path, path.with_suffix(".mp3")}


def delete_collection(kind: str, user_id: str) -> dict:
    """Persist removal first; report cleanup failures without losing other records.

    Caller holds the worker lock. No directory scans: only validated, explicitly
    referenced files are eligible, and references retained by other records win.
    """
    with _store_lock:
        if kind == "presets" and _active_reference_uploads:
            from fastapi import HTTPException
            raise HTTPException(409, "Wait for voice cloning to finish before deleting uploaded voices.")
        records = _presets if kind == "presets" else _history
        targets = [r for r in records if r.get("user_id") == user_id and not (kind == "presets" and r.get("is_builtin"))]
        target_records = {id(r) for r in targets}
        remaining = [r for r in records if id(r) not in target_records]
        paths = set().union(*(_owned_media(r, kind) for r in targets))
        media_root = (config.REF_DIR if kind == "presets" else config.GEN_DIR).resolve()
        paths = {path for path in paths if media_root in path.parents}
        # References may be shared by a protected preset or a historical record.
        retained = set().union(*(_owned_media(r, "presets") for r in _presets if id(r) not in target_records))
        retained.update(set().union(*(_owned_media(r, "history") for r in _history if id(r) not in target_records)))
        _save_json(config.PRESETS_FILE if kind == "presets" else config.HISTORY_FILE, remaining)
        records[:] = remaining
        cleanup_failed = []
        for path in paths - retained:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                config.logger.exception("Bulk deletion could not remove media %s", path)
                cleanup_failed.append(path.name)
        return {"deleted_ids": [r["id"] for r in targets], "cleanup_failed": cleanup_failed}


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
