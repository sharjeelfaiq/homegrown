#!/usr/bin/env python3
"""Fail if any theme's text colours drop below WCAG AA on the surfaces they sit on.

tokens.css records this mistake being made once already: --text-faint was
#71768a, which measured 4.05 / 3.64 / 3.30:1 against --bg-base / --bg-card /
--bg-raised and failed on all three. It colours nearly all secondary text in
the app -- empty states, counters, timestamps, voiceover lengths, voice names,
field labels -- so the whole product read as washed out.

That was one theme. There are now five, and eyeballing a cream palette is
harder than eyeballing a charcoal one. So the ratios are computed rather than
estimated.

    python scripts/check_contrast.py

Checks every theme block in tokens.css: the three text tokens against the
three surfaces a body of text can land on, and the status/accent colours
against the surfaces they are drawn on. Exits non-zero on any AA failure.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "frontend" / "src" / "styles" / "tokens.css"

# Body text must clear 4.5:1 (WCAG AA, normal weight).
AA_TEXT = 4.5
# Accents and status colours are borders, icons and large/bold labels rather
# than paragraphs. AA large-text / non-text contrast is 3.0:1.
AA_LARGE = 3.0

TEXT_TOKENS = ["--text-primary", "--text-muted", "--text-faint"]
SURFACES = ["--bg-base", "--bg-card", "--bg-raised"]
# Drawn ON a surface as a border, icon or bold label, never as a paragraph.
SIGNAL_TOKENS = ["--accent", "--accent-2", "--queued", "--danger", "--green"]
# --danger-text IS a paragraph colour, on the tinted error panel. The panel is
# --danger-soft over --bg-card; approximating with --bg-card is close enough
# and errs strict (the tint is 14%).
PARAGRAPH_ON_CARD = ["--danger-text"]


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (
        0.2126 * srgb_to_linear(r)
        + 0.7152 * srgb_to_linear(g)
        + 0.0722 * srgb_to_linear(b)
    )


def contrast(fg: str, bg: str) -> float:
    a, b = luminance(fg), luminance(bg)
    lo, hi = sorted((a, b))
    return (hi + 0.05) / (lo + 0.05)


BLOCK_RE = re.compile(r"(:root(?:\[data-theme='([a-z]+)'\])?)\s*\{(.*?)\n\}", re.S)
DECL_RE = re.compile(r"^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;", re.M)


def themes() -> dict[str, dict[str, str]]:
    """Every theme's raw hex tokens, with Studio's :root values as the base."""
    text = TOKENS.read_text(encoding="utf-8")
    base: dict[str, str] = {}
    out: dict[str, dict[str, str]] = {}
    for _, name, body in BLOCK_RE.findall(text):
        decls = dict(DECL_RE.findall(body))
        if not name:
            base.update(decls)  # layer 0/1/2 :root blocks accumulate
        else:
            out[name] = decls
    # Studio is the unnamed :root. Every named theme inherits anything it
    # does not restate -- the same cascade the browser applies.
    result = {"studio": base}
    for name, decls in out.items():
        merged = dict(base)
        merged.update(decls)
        result[name] = merged
    return result


def main() -> int:
    all_themes = themes()
    failures: list[str] = []

    for theme, tok in all_themes.items():
        print(f"\n{theme}")
        for name in TEXT_TOKENS:
            if name not in tok:
                failures.append(f"{theme}: {name} is not defined")
                continue
            ratios = []
            for surf in SURFACES:
                if surf not in tok:
                    failures.append(f"{theme}: {surf} is not defined")
                    continue
                r = contrast(tok[name], tok[surf])
                ratios.append(r)
                if r < AA_TEXT:
                    failures.append(
                        f"{theme}: {name} ({tok[name]}) on {surf} ({tok[surf]}) "
                        f"= {r:.2f}:1, below AA {AA_TEXT}"
                    )
            print(f"  {name:16} {tok[name]:8} " + " / ".join(f"{r:5.2f}" for r in ratios))

        for name in SIGNAL_TOKENS + PARAGRAPH_ON_CARD:
            if name not in tok:
                failures.append(f"{theme}: {name} is not defined")
                continue
            floor = AA_TEXT if name in PARAGRAPH_ON_CARD else AA_LARGE
            surfs = ["--bg-card"] if name in PARAGRAPH_ON_CARD else SURFACES
            ratios = []
            for surf in surfs:
                r = contrast(tok[name], tok[surf])
                ratios.append(r)
                if r < floor:
                    failures.append(
                        f"{theme}: {name} ({tok[name]}) on {surf} ({tok[surf]}) "
                        f"= {r:.2f}:1, below {floor}"
                    )
            print(f"  {name:16} {tok[name]:8} " + " / ".join(f"{r:5.2f}" for r in ratios))

    print(f"\nsurfaces compared, in order: {' / '.join(SURFACES)}")
    if failures:
        print(f"\n{len(failures)} contrast failure(s):\n")
        for f in failures:
            print(f"  {f}")
        return 1
    print("\nOK: every theme clears WCAG AA.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
