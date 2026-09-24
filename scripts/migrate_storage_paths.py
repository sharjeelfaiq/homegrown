"""Repair valid legacy media paths in local voice-api JSON stores.

The script is intentionally explicit: it backs up each changed JSON file,
never creates a replacement for a missing file, and prints every mutation.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from shutil import copy2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "voice-api"))

from media_paths import StoredMediaPathError, resolve_stored_media_path, storage_relative_path


def visit(value, storage: Path, file: Path, record_id: str = "<root>"):
    changes, unresolved = [], []
    if isinstance(value, dict):
        current_id = str(value.get("id", record_id))
        for key, child in value.items():
            if key.endswith("_path") and isinstance(child, str):
                try:
                    resolved = resolve_stored_media_path(child, storage)
                    replacement = storage_relative_path(resolved, storage)
                except StoredMediaPathError as exc:
                    if "backend" in child.replace("/", "\\").lower():
                        unresolved.append((file, current_id, key, child, str(exc)))
                    continue
                if child != replacement:
                    value[key] = replacement
                    changes.append((file, current_id, key, child, replacement))
            else:
                nested_changes, nested_unresolved = visit(child, storage, file, current_id)
                changes.extend(nested_changes)
                unresolved.extend(nested_unresolved)
    elif isinstance(value, list):
        for child in value:
            nested_changes, nested_unresolved = visit(child, storage, file, record_id)
            changes.extend(nested_changes)
            unresolved.extend(nested_unresolved)
    return changes, unresolved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write verified replacements")
    args = parser.parse_args()
    storage = ROOT / "services" / "voice-api" / "storage"
    all_changes, all_unresolved = [], []
    for path in sorted(storage.glob("*.json")):
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        changes, unresolved = visit(data, storage, path)
        all_changes.extend(changes)
        all_unresolved.extend(unresolved)
        if changes and args.apply:
            backup = path.with_name(f"{path.name}.migration-{time.strftime('%Y%m%d-%H%M%S')}.bak")
            copy2(path, backup)
            with path.open("w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2)
                fh.write("\n")
            print(f"backup: {backup}")
    for file, record_id, key, old, new in all_changes:
        print(f"changed: {file.name} id={record_id} {key}: {old} -> {new}")
    for file, record_id, key, old, reason in all_unresolved:
        print(f"unresolved: {file.name} id={record_id} {key}: {old} ({reason})")
    if not args.apply:
        print("dry run only; re-run with --apply to write verified replacements")
    return 1 if all_unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
