"""One-time migration: stamp every existing presets.json / history.json /
queue.json record with a user_id, so pre-auth data becomes visible to a
single "owner" account after the Clerk auth rollout.

Run manually, once, after signing up through the new frontend:

    python backend/migrate_to_multiuser.py --owner-user-id user_clerk_abc123

Get <user_id> from the Clerk Dashboard, or from the auto-created entry in
backend/storage/users.json after your first sign-in.
"""

import argparse
import json
import shutil
import time
from pathlib import Path

STORAGE_DIR = Path(__file__).parent / "storage"
FILES = ["presets.json", "history.json", "queue.json"]


def _load(path: Path) -> list:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save(path: Path, data: list) -> None:
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-user-id", required=True, help="Clerk user_id to stamp existing records with")
    args = parser.parse_args()

    backup_dir = STORAGE_DIR / f"backup_pre_multiuser_{int(time.time())}"
    backup_dir.mkdir(parents=True, exist_ok=False)

    for filename in FILES:
        path = STORAGE_DIR / filename
        if not path.exists():
            continue

        shutil.copy2(path, backup_dir / filename)

        records = _load(path)
        stamped = 0
        for record in records:
            if not record.get("user_id"):
                record["user_id"] = args.owner_user_id
                stamped += 1
        _save(path, records)
        print(f"{filename}: stamped {stamped}/{len(records)} record(s) -- backup at {backup_dir / filename}")

    print(f"Done. Backup of pre-migration files: {backup_dir}")


if __name__ == "__main__":
    main()
