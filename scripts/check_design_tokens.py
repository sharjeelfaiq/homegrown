#!/usr/bin/env python3
"""Fail if any frontend surface uses a colour outside the design palette.

This app has four separate frontends -- the studio SPA, the launcher's loading
page, the landing page, and a canvas-painted waveform -- and only the SPA can
import `frontend/src/styles/tokens.css`. The launcher's HTML is a Python string
compiled into a standalone .exe that must render offline; `WaveRibbon.tsx`
paints to a canvas, which cannot read CSS custom properties. Both therefore
mirror the palette by hand.

Hand-mirroring is unavoidable. Silent drift is not, and it already happened
once: after the studio was rethemed, the launcher kept the old blue, so the
first screen a desktop user saw was a different product from the one that
loaded ten seconds later.

This script is the guard. tokens.css is the single source of truth; every hex
literal anywhere else must appear there.

    python scripts/check_design_tokens.py

Exits non-zero and lists offenders on drift.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "frontend" / "src" / "styles" / "tokens.css"

# Files that mirror the palette by hand, plus the SPA's own stylesheets.
TARGETS = [
    ROOT / "frontend" / "src" / "App.css",
    ROOT / "frontend" / "src" / "index.css",
    ROOT / "launcher" / "launcher.py",
    ROOT / "landing-page" / "index.html",
]
TARGETS += sorted((ROOT / "frontend" / "src").rglob("*.tsx"))
TARGETS += sorted((ROOT / "frontend" / "src").rglob("*.ts"))

HEX_RE = re.compile(r"(?:#|%23)([0-9a-fA-F]{6})")

# Colours allowed on top of tokens.css.
EXTRA_ALLOWED = {
    "#ffffff",  # pure white: :hover on the inverted primary button
}

# Lines matching these are not colour declarations: SVG namespaces, URLs in
# error copy, and prose inside comments (one offender was a CSS comment
# explaining which colour a value had been raised *from*).
IGNORE_LINE = re.compile(r"w3\.org/2000/svg|nvidia\.com|^\s*(#\s|/\*|\*|//|--\s)")


def normalise(value: str) -> str:
    """Six hex digits, no prefix, lowercase."""
    return "#" + value.lower().lstrip("#")


def approved_palette() -> set[str]:
    if not TOKENS.exists():
        sys.exit(f"tokens.css not found at {TOKENS}")
    found = {normalise(m) for m in HEX_RE.findall(TOKENS.read_text(encoding="utf-8"))}
    return found | EXTRA_ALLOWED


def main() -> int:
    palette = approved_palette()
    offenders: list[tuple[Path, int, str, str]] = []

    for path in TARGETS:
        if not path.exists() or path == TOKENS:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if IGNORE_LINE.search(line):
                continue
            for raw in HEX_RE.findall(line):
                if normalise(raw) not in palette:
                    offenders.append((path.relative_to(ROOT), lineno, normalise(raw), line.strip()[:80]))

    print(f"palette: {len(palette)} approved colours from {TOKENS.relative_to(ROOT)}")
    print(f"scanned: {sum(1 for p in TARGETS if p.exists())} files")

    if offenders:
        print(f"\n{len(offenders)} colour(s) outside the palette:\n")
        for path, lineno, raw, text in offenders:
            print(f"  {path}:{lineno}  {raw}")
            print(f"      {text}")
        print(
            "\nEither add the colour to frontend/src/styles/tokens.css, or use an\n"
            "existing token. Surfaces that cannot import the stylesheet still have\n"
            "to mirror a value that exists in it."
        )
        return 1

    print("\nOK: every colour resolves to the design palette.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
