#!/usr/bin/env python3
"""Fail if a theme's colours collide in hue, or its surfaces fail to separate.

check_contrast.py already computes every WCAG ratio in tokens.css, and it
cannot catch any of what this checks -- a contrast ratio has no opinion about
HUE. Three real defects shipped through it, found only by putting screenshots
of all nine themes side by side:

  - tape's waveform (--accent-2 #a83f1c) sat 12 degrees from its own --danger
    (#a8231c) at the same lightness, so a finished voiceover and an error were
    the same colour;
  - vinyl was 19 degrees from danger and 13 from its own accent, i.e. visually
    monochrome;
  - booth's waveform was #ff3b30, a PURER alarm red than its --danger, so every
    completed voiceover read as a failure.

And two themes put the card within 4% luminance of the page (daylight 1.034,
score 1.044), so cards did not read as surfaces at all.

    python scripts/check_palette.py

Hue distance is used rather than a full perceptual delta-E on purpose: the
failures above are all "these two mean different things but look the same",
which is a hue question. Lightness is allowed to substitute for hue in ONE
place -- see TONAL_LIGHTNESS_DELTA -- so a deliberately tonal theme can stay
tonal without being flat.
"""
from __future__ import annotations

import colorsys
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "frontend" / "src" / "styles" / "tokens.css"

# Default floor for the tonal rule below. 40 degrees is roughly the point at
# which amber stops being confusable with rust, and rust with red -- the three
# pairs that actually failed. Per-pair floors live in HUE_PAIRS.
MIN_HUE_SEPARATION = 40.0
# Identity and audio are a TONAL pair by design -- separated by lightness, not
# hue -- and that is forced by arithmetic, not taste. With amber (progress),
# red (danger), violet (queued) and green all reserved as semantics, only three
# hue bands remain 40 degrees clear of every one of them: 76-100, 180-222 and
# 302-317. Exactly one of those (180-222) is wide enough to hold two hues that
# are also 40 degrees from each other. Requiring a hue split between identity
# and audio would therefore push all nine themes into the same cyan-blue band
# and make them MORE alike, which is the opposite of the point.
#
# 20 is comfortably reachable: measured against each theme's own surfaces, the
# lightness range that still clears 3:1 is 35-66 points wide (narrowest:
# daylight 35, score 40). Do not raise this without re-running that measurement.
TONAL_LIGHTNESS_DELTA = 20.0
# A card must read as a surface sitting ON the page, not as the page. Below
# this the border is doing all the work and the fill none of it.
MIN_BASE_CARD = 1.08
MIN_CARD_RAISED = 1.06

# Pairs that must never be confusable, with a per-pair floor. The floor is not
# uniform because the RISK is not uniform: what matters is whether the two
# colours can appear as the same kind of mark in the same place.
#
#   --accent-2 vs --danger is the strict one. A waveform and an error message
#   occupy the SAME slot -- line 2 of a voiceover row -- so one is read as the
#   other. This is where the real failures were: tape 12 degrees, vinyl 19,
#   booth 24.
#
#   --progress vs --danger is looser. Amber sits at hue ~36 and a warm red
#   danger at ~0-4, which is 32-38 degrees apart in every theme and always has
#   been. They are distinguishable in practice and, more to the point, never
#   occupy the same role: progress is a wide filled bar on a running row,
#   danger is text and borders on a failed one. Raising this to 40 would force
#   either a greenish progress or a pink danger in five themes to fix a
#   confusion nobody has.
HUE_PAIRS = [
    ("--accent-2", "--danger", 40.0, "a finished waveform must not look like an error"),
    ("--progress", "--danger", 30.0, "'working' must not look like 'failed'"),
    ("--progress", "--queued", 40.0, "'working' must not look like 'waiting'"),
]
# Same rule, but lightness may substitute for hue (see TONAL_LIGHTNESS_DELTA).
TONAL_PAIRS = [
    ("--accent", "--accent-2", "identity and audio would leave the theme flat"),
]

# Stated by every theme, or it silently inherits Studio's value -- which is the
# documented failure mode for layer 1 and the reason this list exists at all.
REQUIRED_PER_THEME = ["--accent", "--accent-2", "--progress", "--danger", "--queued"]


def parse_blocks(css: str) -> list[tuple[str, str]]:
    """Theme name -> the declarations in its block(s).

    Line-based rather than a regex over the whole file, for two reasons found
    the hard way: Studio is spread across THREE separate `:root` blocks (layer 0
    invariants, layer 1 raw values, layer 2 derivations) and all three have to be
    merged or its colours look unstated; and the file contains other top-level
    rules (`:focus-visible`, `.mono`, `@media`) whose closing braces a
    non-greedy regex happily stops at. A closing brace in column 0 ends a block;
    nested ones are indented.
    """
    blocks: dict[str, list[str]] = {}
    order: list[str] = []
    current: str | None = None
    for line in css.splitlines():
        if line.startswith(":root"):
            m = re.match(r":root\[data-theme='([a-z]+)'\]", line)
            current = m.group(1) if m else "studio"
            if current not in blocks:
                blocks[current] = []
                order.append(current)
            continue
        if current is not None and line == "}":
            current = None
            continue
        if current is not None:
            blocks[current].append(line)
    return [(name, "\n".join(blocks[name])) for name in order]


def token(body: str, name: str) -> str | None:
    m = re.search(rf"^\s*{re.escape(name)}:\s*(#[0-9a-fA-F]{{3,8}})", body, re.M)
    return m.group(1) if m else None


def rgb(hex_colour: str) -> tuple[float, float, float]:
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def hue_and_lightness(hex_colour: str) -> tuple[float, float]:
    r, g, b = rgb(hex_colour)
    h, l, _ = colorsys.rgb_to_hls(r, g, b)
    return h * 360.0, l * 100.0


def hue_gap(a: str, b: str) -> float:
    d = abs(hue_and_lightness(a)[0] - hue_and_lightness(b)[0]) % 360.0
    return min(d, 360.0 - d)


def luminance(hex_colour: str) -> float:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb(hex_colour)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    css = TOKENS.read_text(encoding="utf-8")
    blocks = parse_blocks(css)
    if not blocks:
        print("no theme blocks found in tokens.css"); return 1

    failures: list[str] = []
    for name, body in blocks:
        for required in REQUIRED_PER_THEME:
            if token(body, required) is None:
                failures.append(
                    f"{name}: {required} is not stated -- it will silently inherit Studio's value"
                )

        for a, b, floor, why in HUE_PAIRS:
            ca, cb = token(body, a), token(body, b)
            if not (ca and cb):
                continue
            gap = hue_gap(ca, cb)
            if gap < floor:
                failures.append(
                    f"{name}: {a} {ca} is only {gap:.0f}° from {b} {cb} "
                    f"(need {floor:.0f}°) -- {why}"
                )

        for a, b, why in TONAL_PAIRS:
            ca, cb = token(body, a), token(body, b)
            if not (ca and cb):
                continue
            gap = hue_gap(ca, cb)
            dl = abs(hue_and_lightness(ca)[1] - hue_and_lightness(cb)[1])
            if gap < MIN_HUE_SEPARATION and dl < TONAL_LIGHTNESS_DELTA:
                failures.append(
                    f"{name}: {a} {ca} is {gap:.0f}° from {b} {cb} and only "
                    f"{dl:.0f} lightness apart -- {why}. Separate one or the other."
                )

        base, card, raised = (token(body, t) for t in ("--bg-base", "--bg-card", "--bg-raised"))
        if base and card:
            r = contrast(base, card)
            if r < MIN_BASE_CARD:
                failures.append(
                    f"{name}: --bg-card is {r:.3f}x --bg-base (need {MIN_BASE_CARD}) "
                    "-- the card does not read as a surface"
                )
        if card and raised:
            r = contrast(card, raised)
            if r < MIN_CARD_RAISED:
                failures.append(
                    f"{name}: --bg-raised is {r:.3f}x --bg-card (need {MIN_CARD_RAISED}) "
                    "-- controls do not lift off the card"
                )

    if failures:
        print(f"palette: {len(failures)} problem(s)\n")
        for f in failures:
            print(f"  {f}")
        print("\nHue distance and surface separation are invisible to check_contrast.py;")
        print("that is why this file exists. See its docstring for what shipped without it.")
        return 1

    print(f"checked {len(blocks)} themes: hue separation and surface separation OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
