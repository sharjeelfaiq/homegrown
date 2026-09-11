#!/usr/bin/env python3
"""Fail if any frontend surface uses a colour outside the design palette.

This app has several frontends -- the studio SPA, the launcher's loading page,
and the landing page -- and only the SPA can import
`frontend/src/styles/tokens.css`. The launcher's HTML is a Python string
compiled into a standalone .exe that must render offline, and the landing page
is deployed separately, so both mirror the palette by hand. So does the
pre-paint theme script in `frontend/index.html`, which has to set a page
background before any stylesheet exists.

The canvas waveform used to be on that list -- `WaveRibbon.tsx` carried three
hardcoded colours because a canvas cannot read CSS custom properties. It no
longer does: theme.ts resolves them through a probe element and hands them to
the component. That mirror is gone, not merely guarded.

Hand-mirroring is unavoidable. Silent drift is not, and it already happened
once: after the studio was rethemed, the launcher kept the old blue, so the
first screen a desktop user saw was a different product from the one that
loaded ten seconds later.

This script is the guard. tokens.css is the single source of truth; every hex
literal anywhere else must appear there.

    python scripts/check_design_tokens.py

Exits non-zero and lists offenders on drift.

TWO palettes, since tokens.css grew from one theme to five:

  full    every hex in tokens.css, all themes. Applies to the SPA, which can
          actually be any of them.
  strict  only the hexes in the unnamed :root blocks -- i.e. Studio, the
          default. Applies to the launcher splash and the landing page.

The split matters. Without it, adding Tape made that theme's cream a legal
colour *everywhere*, including in surfaces that can never be Tape, and the
guard would have quietly stopped catching the one class of drift it was
written for. The launcher renders before a browser exists, so it cannot read
localStorage and cannot know the user's theme; the landing page is a separate
deployment and is not the studio. Both are permanently Studio-coloured.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "frontend" / "src" / "styles" / "tokens.css"

# Files that mirror the palette by hand, plus the SPA's own stylesheets.
TARGETS = [
    # App.css is gone -- the SPA is Tailwind utilities plus this one stylesheet.
    ROOT / "frontend" / "src" / "index.css",
    # Carries an inlined per-theme page background, because the pre-paint
    # frame in `vite dev` has no stylesheet at all. Five more hand-mirrored
    # hexes, so five more chances to drift.
    ROOT / "frontend" / "index.html",
    ROOT / "launcher" / "launcher.py",
    ROOT / "landing-page" / "index.html",
]
TARGETS += sorted((ROOT / "frontend" / "src").rglob("*.tsx"))
TARGETS += sorted((ROOT / "frontend" / "src").rglob("*.ts"))

# Checked against the DEFAULT theme only, not the full five-theme palette.
# Neither of these can ever render as anything but Studio: the launcher paints
# before a browser (and so any stored preference) exists, and the landing page
# is a separate deployment that is not the studio at all.
STRICT_TARGETS = {
    ROOT / "launcher" / "launcher.py",
    ROOT / "landing-page" / "index.html",
}

HEX_RE = re.compile(r"(?:#|%23)([0-9a-fA-F]{6})")

# Colours allowed on top of tokens.css. Empty, and worth keeping that way.
#
# It used to hold #ffffff, for the inverted primary button's hover. That rule
# is gone -- the hover is --btn-invert-bg-hover now, because a literal white
# hover made the button vanish on the light themes. White still exists, as
# --line-ink and --sheen-ink in tokens.css, so it is approved the ordinary way.
EXTRA_ALLOWED: set[str] = set()

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


# A :root block that carries no [data-theme=...] is the default theme, Studio.
# There are several of them (the token file is layered: invariants, raw
# palette, derived), which is why this collects all of them rather than the
# first.
DEFAULT_BLOCK_RE = re.compile(r"^:root\s*\{(.*?)^\}", re.S | re.M)


def strict_palette() -> set[str]:
    """Studio only -- for the surfaces that can never be another theme."""
    if not TOKENS.exists():
        sys.exit(f"tokens.css not found at {TOKENS}")
    text = TOKENS.read_text(encoding="utf-8")
    found: set[str] = set()
    for block in DEFAULT_BLOCK_RE.findall(text):
        found |= {normalise(m) for m in HEX_RE.findall(block)}
    return found | EXTRA_ALLOWED


def main() -> int:
    palette = approved_palette()
    strict = strict_palette()
    offenders: list[tuple[Path, int, str, str]] = []

    for path in TARGETS:
        if not path.exists() or path == TOKENS:
            continue
        allowed = strict if path in STRICT_TARGETS else palette
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if IGNORE_LINE.search(line):
                continue
            for raw in HEX_RE.findall(line):
                if normalise(raw) not in allowed:
                    offenders.append((path.relative_to(ROOT), lineno, normalise(raw), line.strip()[:80]))

    print(f"palette: {len(palette)} approved colours from {TOKENS.relative_to(ROOT)}")
    print(f"strict:  {len(strict)} (default theme only) for "
          + ", ".join(sorted(p.relative_to(ROOT).as_posix() for p in STRICT_TARGETS)))
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
        if any(ROOT / p in STRICT_TARGETS for p, _, _, _ in offenders):
            print(
                "\nAt least one offender is a STRICT target (the launcher splash or\n"
                "the landing page). Adding the colour to a [data-theme] block will\n"
                "NOT satisfy those -- they render as the default theme and nothing\n"
                "else, so the value has to exist in an unnamed :root block."
            )
        return 1

    print("\nOK: every colour resolves to the design palette.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
