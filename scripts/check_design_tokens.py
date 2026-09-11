#!/usr/bin/env python3
"""Fail if any frontend surface uses a colour outside the design palette.

This app has three frontends -- the studio SPA, the launcher's loading page,
and the landing page -- and only the SPA can import
`frontend/src/styles/tokens.css`. The launcher's HTML is compiled into a
standalone .exe that must render offline, and the landing page is a separate
deployment with no build step, so both mirror the palette by hand. So does the
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

This script is the guard. tokens.css is the single source of truth; every
colour anywhere else must appear there.

    python scripts/check_design_tokens.py

Exits non-zero and lists offenders on drift.

TWO palettes, since tokens.css grew from one theme to five:

  full    every colour in tokens.css, all themes. Applies to the SPA, which
          can actually be any of them.
  strict  only the colours in the unnamed :root blocks -- i.e. Studio, the
          default. Applies to the launcher splash and the landing page.

The split matters. Without it, adding Tape made that theme's cream a legal
colour *everywhere*, including in surfaces that can never be Tape, and the
guard would have quietly stopped catching the one class of drift it was
written for. The launcher renders before a browser exists, so it cannot read
localStorage and cannot know the user's theme; the landing page is a separate
deployment and is not the studio. Both are permanently Studio-coloured.

THREE colour forms are scanned, not one. For a long time this matched only
6-digit hex, and the landing page drifted for months in the gaps it could not
see: `#fff` on a hover, hairlines at 9%/16% where the tokens say 10%/17%, and
two colours (#266a76, #8fbaff) that existed in no token file at all. A guard
that only reads one of the three ways a colour can be written is a guard that
mostly is not looking.
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
    # The launcher splash is authored here and compiled by
    # scripts/build_splash.py; _splash.py is generated from it, so checking the
    # source is what matters. launcher.py itself no longer carries any colour.
    ROOT / "launcher" / "splash.css",
    ROOT / "launcher" / "splash.html",
    ROOT / "launcher" / "launcher.py",
    ROOT / "landing-page" / "index.html",
]
TARGETS += sorted((ROOT / "frontend" / "src").rglob("*.tsx"))
TARGETS += sorted((ROOT / "frontend" / "src").rglob("*.ts"))

# Checked against the DEFAULT theme only, not the full five-theme palette.
# None of these can ever render as anything but Studio: the launcher paints
# before a browser (and so any stored preference) exists, and the landing page
# is a separate deployment that is not the studio at all.
STRICT_TARGETS = {
    ROOT / "launcher" / "splash.css",
    ROOT / "launcher" / "splash.html",
    ROOT / "launcher" / "launcher.py",
    ROOT / "landing-page" / "index.html",
}

# The negative lookahead on the 6-digit form stops an 8-digit #rrggbbaa being
# read as a 6-digit colour plus junk; the one on the 3-digit form stops it
# matching the first half of a 6-digit.
HEX6_RE = re.compile(r"(?:#|%23)([0-9a-fA-F]{6})(?![0-9a-fA-F])")
HEX3_RE = re.compile(r"(?:#|%23)([0-9a-fA-F]{3})(?![0-9a-fA-F])")
RGB_RE = re.compile(r"rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})")

# Colours allowed on top of tokens.css. Empty, and worth keeping that way.
#
# It used to hold #ffffff, for the inverted primary button's hover. That rule
# is gone -- the hover is --btn-invert-bg-hover now, because a literal white
# hover made the button vanish on the light themes. White still exists, as
# --line-ink and --sheen-ink in tokens.css, so it is approved the ordinary way.
EXTRA_ALLOWED: set[str] = set()

# Lines matching these are not colour declarations: SVG namespaces, and URLs
# in error copy.
IGNORE_LINE = re.compile(r"w3\.org/2000/svg|nvidia\.com|^\s*(#\s|//|--\s)")

# A mask is a stencil, not a picture. #000 and #fff inside a mask declaration
# are alpha -- "opaque here", "transparent there" -- and name no pigment at
# all. The landing page's two-layer edge fade uses four of them.
#
# Matched as a whole DECLARATION rather than per line, because the ones that
# matter span several: the value is a pair of gradients and the colours sit on
# continuation lines with no `mask:` anywhere near them. Blanked like a
# comment, so line numbers stay honest.
MASK_DECL = re.compile(r"(?:-webkit-)?mask[a-z-]*\s*:[^;}]*[;}]", re.S)
STENCIL = {"#000000", "#ffffff"}

# Comment bodies are blanked before scanning. Prose about a colour is not a
# use of one, and several comments in this repo name colours precisely because
# they are explaining that those colours were removed -- including, in the
# landing page, the two this guard was widened to catch. Reporting a comment
# that documents a rule as a violation of it is how a guard gets ignored.
#
# Blanked rather than deleted, so line numbers still point at the right place.
COMMENT_BLOCKS = (
    re.compile(r"/\*.*?\*/", re.S),  # CSS, and C-style in .ts/.tsx
    re.compile(r"<!--.*?-->", re.S),  # HTML
    re.compile(r'"""[\s\S]*?"""', re.S),  # Python docstrings
)


def blank(match: re.Match[str]) -> str:
    """Same length, same newlines, no content."""
    return re.sub(r"[^\n]", " ", match.group())


def strip_comments(text: str) -> str:
    for pat in COMMENT_BLOCKS:
        text = pat.sub(blank, text)
    return text


def strip_mask_stencils(text: str) -> str:
    """Blank the alpha values inside mask declarations, keep everything else.

    Only the stencil colours go -- a mask value that names a real pigment is
    still worth reporting, since that is a colour choice rather than a shape.
    """

    def scrub(m: re.Match[str]) -> str:
        out = m.group()
        for lit in ("#000000", "#000", "#ffffff", "#fff"):
            out = out.replace(lit, " " * len(lit))
        return out

    return MASK_DECL.sub(scrub, text)


def normalise(value: str) -> str:
    """Six hex digits, one leading hash, lowercase."""
    return "#" + value.lower().lstrip("#")


def expand3(value: str) -> str:
    """#abc -> #aabbcc, so the short form compares against the palette."""
    return "#" + "".join(ch * 2 for ch in value.lower().lstrip("#"))


def rgb_to_hex(r: str, g: str, b: str) -> str:
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def colours_in(text: str) -> list[str]:
    """Every colour in `text`, normalised to #rrggbb.

    Alpha is deliberately dropped. The palette is a set of pigments, and how
    transparent one particular use of a pigment is belongs to the surface, not
    to the token -- tokens.css itself derives every soft and line variant with
    color-mix from a base. What this catches is a pigment that is not in the
    palette at all, which is what #266a76 and #8fbaff were.
    """
    out = [normalise(m) for m in HEX6_RE.findall(text)]
    out += [expand3(m) for m in HEX3_RE.findall(text)]
    out += [rgb_to_hex(*m) for m in RGB_RE.findall(text)]
    return out


def approved_palette() -> set[str]:
    if not TOKENS.exists():
        sys.exit(f"tokens.css not found at {TOKENS}")
    return set(colours_in(TOKENS.read_text(encoding="utf-8"))) | EXTRA_ALLOWED


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
        found |= set(colours_in(block))
    return found | EXTRA_ALLOWED


def main() -> int:
    palette = approved_palette()
    strict = strict_palette()
    offenders: list[tuple[Path, int, str, str]] = []

    for path in TARGETS:
        if not path.exists() or path == TOKENS:
            continue
        allowed = strict if path in STRICT_TARGETS else palette
        source = strip_mask_stencils(strip_comments(path.read_text(encoding="utf-8")))
        for lineno, line in enumerate(source.splitlines(), 1):
            if IGNORE_LINE.search(line):
                continue
            for colour in colours_in(line):
                if colour not in allowed:
                    offenders.append(
                        (path.relative_to(ROOT), lineno, colour, line.strip()[:80])
                    )

    print(f"palette: {len(palette)} approved colours from {TOKENS.relative_to(ROOT)}")
    print(
        f"strict:  {len(strict)} (default theme only) for "
        + ", ".join(sorted(p.relative_to(ROOT).as_posix() for p in STRICT_TARGETS))
    )
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
