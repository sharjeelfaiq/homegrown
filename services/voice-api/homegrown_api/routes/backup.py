"""Password-protected snapshots of the local Homegrown data."""

import copy
import io
import json
import os
import shutil
import stat
import tempfile
import zipfile
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

import homegrown_api.config as config
import homegrown_api.dependencies as dependencies
import homegrown_api.generation.worker as generation_worker
import homegrown_api.persistence.media_paths as persistence_media_paths
import homegrown_api.persistence.stores as persistence_stores


router = APIRouter()
SUPPORTED_FORMAT_VERSION = 1
_STORE_NAMES = ("presets", "history", "queue")
_MEDIA_ROOTS = ("references", "generated")
_SECRET_NAMES = {".env", ".env.local", ".env.production"}
_EXECUTABLE_SUFFIXES = {".exe", ".dll", ".bat", ".cmd", ".com", ".ps1", ".sh"}


def _app_version() -> str | None:
    try:
        return version("homegrown-api")
    except PackageNotFoundError:
        return None


def _generated_path(audio_url: object) -> Path:
    if not isinstance(audio_url, str) or not audio_url.startswith("/audio/"):
        raise persistence_media_paths.StoredMediaPathError("Generated audio has no valid stored path.")
    root = config.STORAGE_DIR.resolve()
    candidate = (config.GEN_DIR / audio_url.removeprefix("/audio/")).resolve()
    try:
        candidate.relative_to(config.GEN_DIR.resolve())
    except ValueError as exc:
        raise persistence_media_paths.StoredMediaPathError("Generated audio path escapes local storage.") from exc
    if not candidate.is_file():
        raise persistence_media_paths.StoredMediaPathError(
            f"Generated audio is missing from local storage: {candidate.relative_to(root).as_posix()}"
        )
    return candidate


def _warning(kind: str, record: dict, error: Exception) -> str:
    record_id = record.get("id") or record.get("preset_id") or "unknown"
    return f"Could not include {kind} media for record {record_id}: {error}"


def _build_backup() -> tuple[io.BytesIO, str]:
    # The caller owns both locks. Deep copies make the archive's JSON and media
    # references a coherent immutable view even after the locks are released.
    presets = copy.deepcopy(persistence_stores._presets)
    history = copy.deepcopy(persistence_stores._history)
    queue = copy.deepcopy(persistence_stores._load_json(config.QUEUE_FILE))
    snapshots = {"presets": presets, "history": history, "queue": queue}
    warnings: list[str] = []
    media: dict[str, Path] = {}

    for preset in presets:
        try:
            path = persistence_media_paths.resolve_stored_media_path(preset.get("audio_path"), config.STORAGE_DIR)
            try:
                path.relative_to(config.REF_DIR.resolve())
            except ValueError as exc:
                raise persistence_media_paths.StoredMediaPathError("Reference media is outside storage/references.") from exc
            media[f"storage/{path.relative_to(config.STORAGE_DIR.resolve()).as_posix()}"] = path
        except persistence_media_paths.StoredMediaPathError as exc:
            warnings.append(_warning("reference", preset, exc))

    for entry in history:
        try:
            path = _generated_path(entry.get("audio_url"))
            media[f"storage/{path.relative_to(config.STORAGE_DIR.resolve()).as_posix()}"] = path
        except persistence_media_paths.StoredMediaPathError as exc:
            warnings.append(_warning("generated", entry, exc))

    created_at = datetime.now().astimezone().isoformat()
    manifest = {
        "format_version": 1,
        "created_at": created_at,
        "app_version": _app_version(),
        "stores": ["presets", "history", "queue"],
        "counts": {name: len(records) for name, records in snapshots.items()},
        "warnings": warnings,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2).encode("utf-8"))
        for name, records in snapshots.items():
            archive.writestr(f"{name}.json", json.dumps(records, indent=2).encode("utf-8"))
        for relative, path in media.items():
            archive.write(path, relative.removeprefix("storage/"))
    buf.seek(0)
    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    return buf, f"homegrown-backup-{stamp}.zip"


@router.post("/api/backup")
def create_backup(_admin: None = Depends(dependencies.require_admin_password)):
    with generation_worker._jobs_lock:
        if any(job.get("status") in {"queued", "running", "canceling"} for job in generation_worker._jobs.values()):
            raise HTTPException(409, "Wait for generation to finish or cancel queued jobs before creating a backup.")
        with persistence_stores._store_lock:
            if persistence_stores._active_reference_uploads:
                raise HTTPException(409, "Wait for voice cloning to finish before creating a backup.")
            payload, filename = _build_backup()
    return StreamingResponse(
        payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _json_store(archive: zipfile.ZipFile, name: str) -> list:
    candidates = (f"{name}.json", f"storage/{name}.json")
    present = [candidate for candidate in candidates if candidate in archive.namelist()]
    if len(present) != 1:
        raise HTTPException(400, f"Backup must contain exactly one {name}.json store.")
    try:
        value = json.loads(archive.read(present[0]))
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError) as exc:
        raise HTTPException(400, f"Backup contains malformed {name}.json.") from exc
    if not isinstance(value, list) or any(not isinstance(record, dict) for record in value):
        raise HTTPException(400, f"Backup {name}.json must contain an array of objects.")
    return value


def _safe_archive_name(name: str) -> str:
    if not name or "\\" in name or name.startswith("/"):
        raise HTTPException(400, "Backup contains an unsafe path.")
    parts = name.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(400, "Backup contains a path traversal entry.")
    return "/".join(parts)


def _media_name_from_preset(record: dict) -> str:
    value = record.get("audio_path")
    if not isinstance(value, str) or not value.startswith("references/"):
        raise HTTPException(400, f"Preset {record.get('id', 'unknown')} has an unsafe reference path.")
    return value


def _media_name_from_history(record: dict) -> str:
    value = record.get("audio_url")
    if not isinstance(value, str) or not value.startswith("/audio/"):
        raise HTTPException(400, f"History record {record.get('id', 'unknown')} has an unsafe audio path.")
    return f"generated/{value.removeprefix('/audio/')}"


def _validate_ids(records: list, key: str, store: str) -> set[str]:
    ids: set[str] = set()
    for record in records:
        record_id = record.get(key)
        if not isinstance(record_id, str) or not record_id or record_id in ids:
            raise HTTPException(400, f"Backup contains duplicate or invalid {store} IDs.")
        ids.add(record_id)
    return ids


def _validate_archive(payload: bytes) -> tuple[Path, dict[str, list]]:
    stage = Path(tempfile.mkdtemp(prefix="homegrown-restore-", dir=config.STORAGE_DIR.parent))
    try:
        try:
            archive = zipfile.ZipFile(io.BytesIO(payload))
            bad = archive.testzip()
        except (zipfile.BadZipFile, OSError) as exc:
            raise HTTPException(400, "The backup is not a valid ZIP archive.") from exc
        if bad is not None:
            raise HTTPException(400, "The backup contains a corrupt archive entry.")

        names = [_safe_archive_name(info.filename) for info in archive.infolist()]
        if len(names) != len(set(names)):
            raise HTTPException(400, "Backup contains duplicate archive entries.")
        for info, name in zip(archive.infolist(), names):
            if stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK:
                raise HTTPException(400, "Backup contains a symbolic link entry.")
            if name.rsplit("/", 1)[-1].lower() in _SECRET_NAMES or Path(name).suffix.lower() in _EXECUTABLE_SUFFIXES:
                raise HTTPException(400, "Backup contains a forbidden secret or executable file.")

        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(400, "Backup manifest.json is missing or malformed.") from exc
        if not isinstance(manifest, dict) or manifest.get("format_version") != SUPPORTED_FORMAT_VERSION:
            raise HTTPException(400, "Unsupported backup format version.")
        if manifest.get("stores") != list(_STORE_NAMES):
            raise HTTPException(400, "Backup manifest does not describe the expected stores.")
        if not isinstance(manifest.get("created_at"), str) or not isinstance(manifest.get("warnings"), list):
            raise HTTPException(400, "Backup manifest is missing required metadata.")

        snapshots = {name: _json_store(archive, name) for name in _STORE_NAMES}
        counts = manifest.get("counts")
        if not isinstance(counts, dict) or any(counts.get(name) != len(snapshots[name]) for name in _STORE_NAMES):
            raise HTTPException(400, "Backup manifest counts do not match the JSON stores.")
        preset_ids = _validate_ids(snapshots["presets"], "id", "preset")
        history_ids = _validate_ids(snapshots["history"], "id", "history")
        queue_ids = _validate_ids(snapshots["queue"], "job_id", "queue")
        del history_ids, queue_ids
        for record in snapshots["history"]:
            if record.get("preset_id") not in preset_ids:
                raise HTTPException(400, f"History record {record.get('id', 'unknown')} references an unknown preset.")
        for record in snapshots["queue"]:
            if record.get("preset_id") not in preset_ids:
                raise HTTPException(400, f"Queue record {record.get('job_id', 'unknown')} references an unknown preset.")

        referenced: set[str] = set()
        for record in snapshots["presets"]:
            referenced.add(_media_name_from_preset(record))
        for record in snapshots["history"]:
            referenced.add(_media_name_from_history(record))

        allowed = {"manifest.json", *(f"{name}.json" for name in _STORE_NAMES)}
        actual_media = set()
        for name in names:
            if name in allowed:
                continue
            if name.startswith("storage/") and name.removeprefix("storage/") in {f"{store}.json" for store in _STORE_NAMES}:
                continue
            media_name = name.removeprefix("storage/")
            if not any(media_name.startswith(f"{root}/") for root in _MEDIA_ROOTS):
                raise HTTPException(400, f"Backup contains an unexpected file: {name}")
            actual_media.add(media_name)
            if Path(media_name).name.lower() in _SECRET_NAMES or Path(media_name).suffix.lower() in _EXECUTABLE_SUFFIXES:
                raise HTTPException(400, "Backup contains a forbidden media file.")
        if actual_media != referenced:
            missing = sorted(referenced - actual_media)
            extra = sorted(actual_media - referenced)
            detail = "Backup media does not match the JSON stores."
            if missing:
                detail += f" Missing: {', '.join(missing)}."
            if extra:
                detail += f" Unexpected: {', '.join(extra)}."
            raise HTTPException(400, detail)

        for name in names:
            if name in {"manifest.json", *allowed} or name.startswith("storage/") and name.removeprefix("storage/") in {f"{store}.json" for store in _STORE_NAMES}:
                continue
            target = stage / name.removeprefix("storage/")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
        for name, records in snapshots.items():
            (stage / f"{name}.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
        return stage, snapshots
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _write_pre_restore_backup(payload: io.BytesIO) -> str:
    backup_dir = config.STORAGE_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    filename = f"homegrown-pre-restore-{stamp}.zip"
    target = backup_dir / filename
    temporary = backup_dir / f".{filename}.tmp"
    temporary.write_bytes(payload.getvalue())
    os.replace(temporary, target)
    return filename


def _merge_builtins(snapshots: dict[str, list]) -> None:
    current_builtin_presets = [record for record in persistence_stores._presets if record.get("is_builtin")]
    builtin_ids = {record.get("id") for record in current_builtin_presets}
    snapshots["presets"] = [record for record in snapshots["presets"] if record.get("id") not in builtin_ids]
    snapshots["presets"].extend(copy.deepcopy(current_builtin_presets))
    current_builtin_history = [record for record in persistence_stores._history if record.get("preset_id") in builtin_ids]
    history_ids = {record.get("id") for record in current_builtin_history}
    snapshots["history"] = [record for record in snapshots["history"] if record.get("id") not in history_ids]
    snapshots["history"].extend(copy.deepcopy(current_builtin_history))


def _preserve_builtin_media(stage: Path) -> None:
    """Carry protected built-in media across a user-data replacement."""
    builtin_presets = [record for record in persistence_stores._presets if record.get("is_builtin")]
    for record in builtin_presets:
        try:
            source = persistence_media_paths.resolve_stored_media_path(record.get("audio_path"), config.STORAGE_DIR)
            relative = source.relative_to(config.STORAGE_DIR.resolve())
        except (persistence_media_paths.StoredMediaPathError, ValueError):
            continue
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(source, target)
    builtin_ids = {record.get("id") for record in builtin_presets}
    for record in persistence_stores._history:
        if record.get("preset_id") not in builtin_ids:
            continue
        audio_url = record.get("audio_url")
        if not isinstance(audio_url, str) or not audio_url.startswith("/audio/"):
            continue
        source = (config.GEN_DIR / audio_url.removeprefix("/audio/")).resolve()
        try:
            relative = source.relative_to(config.STORAGE_DIR.resolve())
        except ValueError:
            continue
        if not source.is_file():
            continue
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(source, target)


def _replace_storage(stage: Path) -> Path:
    targets = [config.PRESETS_FILE, config.HISTORY_FILE, config.QUEUE_FILE, config.REF_DIR, config.GEN_DIR]
    transaction = Path(tempfile.mkdtemp(prefix="homegrown-restore-rollback-", dir=config.STORAGE_DIR.parent))
    moved_old: list[tuple[Path, Path]] = []
    moved_new: list[Path] = []
    try:
        for target in targets:
            if target.exists():
                old = transaction / target.name
                os.replace(target, old)
                moved_old.append((target, old))
        for target in targets:
            source = stage / target.name
            if source.exists():
                os.replace(source, target)
            elif target in (config.REF_DIR, config.GEN_DIR):
                target.mkdir(parents=True, exist_ok=True)
            moved_new.append(target)
    except Exception:
        for target in reversed(moved_new):
            if target.exists():
                shutil.rmtree(target, ignore_errors=True) if target.is_dir() else target.unlink(missing_ok=True)
        for target, old in reversed(moved_old):
            if old.exists():
                os.replace(old, target)
        shutil.rmtree(transaction, ignore_errors=True)
        raise
    return transaction


def _rollback_storage(transaction: Path) -> None:
    targets = [config.PRESETS_FILE, config.HISTORY_FILE, config.QUEUE_FILE, config.REF_DIR, config.GEN_DIR]
    for target in targets:
        if target.exists():
            shutil.rmtree(target, ignore_errors=True) if target.is_dir() else target.unlink(missing_ok=True)
    for target in targets:
        old = transaction / target.name
        if old.exists():
            os.replace(old, target)
    shutil.rmtree(transaction, ignore_errors=True)


@router.post("/api/backup/restore")
async def restore_backup(
    backup: UploadFile = File(...),
    _admin: None = Depends(dependencies.require_admin_password),
):
    payload = await backup.read()
    with generation_worker._jobs_lock:
        if any(job.get("status") in {"queued", "running", "canceling"} for job in generation_worker._jobs.values()):
            raise HTTPException(409, "Wait for generation to finish or cancel queued jobs before restoring a backup.")
        with persistence_stores._store_lock:
            if persistence_stores._active_reference_uploads:
                raise HTTPException(409, "Wait for voice cloning to finish before restoring a backup.")
            stage, snapshots = _validate_archive(payload)
            try:
                pre_restore_payload, _ = _build_backup()
                pre_restore_filename = _write_pre_restore_backup(pre_restore_payload)
                _merge_builtins(snapshots)
                _preserve_builtin_media(stage)
                for name, records in snapshots.items():
                    (stage / f"{name}.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
                transaction = _replace_storage(stage)
                persistence_stores._presets[:] = persistence_stores._load_json(config.PRESETS_FILE)
                persistence_stores._history[:] = persistence_stores._load_json(config.HISTORY_FILE)
                generation_worker._reload_queue_from_storage_locked()
                shutil.rmtree(transaction, ignore_errors=True)
            except Exception:
                if "transaction" in locals() and transaction.exists():
                    _rollback_storage(transaction)
                    persistence_stores._presets[:] = persistence_stores._load_json(config.PRESETS_FILE)
                    persistence_stores._history[:] = persistence_stores._load_json(config.HISTORY_FILE)
                shutil.rmtree(stage, ignore_errors=True)
                raise HTTPException(500, "Could not replace application data; the previous data was restored.")
            shutil.rmtree(stage, ignore_errors=True)
    return {"ok": True, "pre_restore_backup": pre_restore_filename}
