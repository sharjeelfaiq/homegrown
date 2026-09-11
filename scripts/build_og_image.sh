#!/usr/bin/env bash
# Render the landing page to landing-page/og.png at exactly 1200x630 — the
# image every social card points at.
#
# A screenshot of the real page rather than a hand-authored card, so it cannot
# misrepresent the product: it IS the product's page. The cost is that it has
# to be regenerated when the design changes, which is what the size/staleness
# note at the end is for.
#
# The output is COMMITTED. Vercel serves landing-page/ as-is with no build
# step (vercel.json: buildCommand null), so a generated-but-uncommitted file
# would 404 and every shared link would render bare — which is the exact
# failure this script exists to fix.
#
#   bash scripts/build_og_image.sh
#
# Same Chrome dependency and override as scripts/measure_landing.sh.
set -u

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."

SRC="landing-page/index.html"
OUT="landing-page/og.png"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"

[ -f "$SRC" ]    || { echo "landing page not found at: $SRC"; exit 1; }
[ -f "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME=)"; exit 1; }

# Chrome here is a Windows binary being handed paths by Git Bash, so BOTH the
# input URL and the --screenshot target need converting from /d/... to d:/...
# The output one is easy to miss: a relative path is resolved against Chrome's
# own working directory, not this script's, and it fails with a bare
# "cannot find the path specified" while still exiting 0.
win_path() { echo "$1" | sed 's|^/\([a-z]\)|\1:|'; }

ABS="$(pwd)/$SRC"
URL="file:///$(win_path "$ABS")"
OUT_ABS="$(win_path "$(pwd)/$OUT")"

# --virtual-time-budget, and generously. This page compiles its own Tailwind
# in the browser via the Play CDN, so a screenshot taken too early captures an
# UNSTYLED page — white background, no layout, no waveform. It is a silent
# failure: you get a valid 1200x630 PNG that happens to be wrong.
#
# scripts/measure_landing.sh hit exactly this and the tell was its numbers
# coming back identical at every viewport width. Here the tell is a white
# image, so check the first one you generate.
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=4000 \
  --window-size=1200,630 \
  --screenshot="$OUT_ABS" \
  "$URL" 2>/dev/null

[ -f "$OUT" ] || { echo "Chrome produced no file."; exit 1; }

python - "$OUT" <<'PY'
import struct, sys, pathlib
p = pathlib.Path(sys.argv[1])
b = p.read_bytes()
w, h = struct.unpack(">II", b[16:24])
kb = len(b) / 1024
print(f"  {p}  {w}x{h}  {kb:.0f} KB")
if (w, h) != (1200, 630):
    sys.exit(f"  expected 1200x630, got {w}x{h}")
# A page that never styled itself is overwhelmingly one flat colour and
# compresses to almost nothing. The real page is a dark gradient with a
# waveform and text, and does not.
if kb < 8:
    sys.exit(
        f"  only {kb:.0f} KB — this is almost certainly an unstyled capture.\n"
        "  Raise --virtual-time-budget and look at the file."
    )
print("  looks styled (size is consistent with a rendered page)")
PY
