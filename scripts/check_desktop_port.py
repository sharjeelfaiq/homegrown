#!/usr/bin/env python3
"""Fail if the desktop build's two copies of its port number disagree.

`backend/run.py` binds the port; `launcher/launcher.py` polls it, opens the
browser on it, and decides from it whether Homegrown is already running. They
are separately frozen PyInstaller bundles -- `launcher.spec` declares no datas
and no hiddenimports -- so there is no import path between them and the number
has to be written twice.

Hand-mirroring is unavoidable, same as the design palette next door. Silent
drift is not, and drift here fails in a way that points at the wrong component:
the launcher polls a port nothing ever binds, waits out STALL_TIMEOUT_S, and
reports that the backend timed out during startup. The backend is fine. It is
listening on a port nobody is asking.

The port is 8731 rather than 8000 because 8000 belongs to dev (`dev.sh`) and to
LAN mode (`start_server.bat`). Sharing it let the launcher's health probe find a
dev uvicorn, conclude the app was already up, and return without ever starting
backend.exe.

    python scripts/check_desktop_port.py

Exits non-zero and prints both values on drift.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Both are module-level `PORT = <int>`; the regex is anchored so a mention
# inside a comment or a docstring cannot be mistaken for the declaration.
SOURCES = [
    ROOT / "backend" / "run.py",
    ROOT / "launcher" / "launcher.py",
]
PORT_RE = re.compile(r"^PORT = (\d+)\s*$", re.MULTILINE)


def main() -> int:
    found: list[tuple[Path, str | None]] = []
    for path in SOURCES:
        if not path.exists():
            print(f"MISSING: {path.relative_to(ROOT)}")
            return 1
        matches = PORT_RE.findall(path.read_text(encoding="utf-8"))
        if len(matches) != 1:
            print(
                f"{path.relative_to(ROOT)}: expected exactly one module-level "
                f"`PORT = <int>`, found {len(matches)}."
            )
            return 1
        found.append((path, matches[0]))

    for path, value in found:
        print(f"  {path.relative_to(ROOT)}: {value}")

    values = {value for _, value in found}
    if len(values) != 1:
        print(
            "\nThe desktop build's port disagrees between the process that binds it\n"
            "and the process that polls it. The launcher would wait out its stall\n"
            "timeout on a dead port and blame the backend. Make them match."
        )
        return 1

    print("\nOK: the desktop build's port matches in both places.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
