"""Safe, backwards-compatible resolution of persisted media paths."""

from __future__ import annotations

import re
from pathlib import Path


class StoredMediaPathError(ValueError):
    """A persisted media path is missing, unsafe, or cannot be migrated."""


_LEGACY_STORAGE = re.compile(r"(?:^|[\\\\/])backend[\\\\/]storage[\\\\/](.+)$", re.IGNORECASE)


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def storage_relative_path(path: Path, storage_dir: Path) -> str:
    """Return the stable persisted form for a path owned by ``storage_dir``."""
    root = storage_dir.resolve()
    resolved = path.resolve()
    if not _inside(root, resolved):
        raise StoredMediaPathError(f"Media path is outside local storage: {path}")
    return resolved.relative_to(root).as_posix()


def resolve_stored_media_path(value: str, storage_dir: Path) -> Path:
    """Resolve a persisted path without allowing it to escape local storage.

    New records use paths relative to ``storage_dir``. Absolute paths from older
    source checkouts remain readable when they point inside the current storage
    directory or contain the retired ``backend/storage`` segment.
    """
    if not value or not isinstance(value, str):
        raise StoredMediaPathError("Reference clip has no stored path. Re-upload the clip.")

    root = storage_dir.resolve()
    raw = value.strip()
    legacy = _LEGACY_STORAGE.search(raw.replace("/", "\\\\"))
    if legacy:
        candidate = root / Path(legacy.group(1).replace("\\\\", "/"))
    else:
        supplied = Path(raw)
        candidate = supplied if supplied.is_absolute() else root / supplied

    resolved = candidate.resolve()
    if not _inside(root, resolved):
        raise StoredMediaPathError("Stored media path escapes local storage; re-upload the clip.")
    if not resolved.is_file():
        raise StoredMediaPathError(
            f"Reference clip is missing from local storage: {storage_relative_path(resolved, root)}"
        )
    return resolved
