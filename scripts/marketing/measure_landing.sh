#!/usr/bin/env bash
# Check the expanded landing page at real desktop and mobile window sizes.
# It may scroll vertically; it must not overflow horizontally. The probe also
# verifies that the #more dialog opens, fits inside the viewport, and closes.
set -u
SRC="${1:-apps/marketing/index.html}"
OUT="$(mktemp -d)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
[ -f "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME=)"; exit 1; }

python - "$SRC" "$OUT/measured.html" <<'PYEOF'
import io, sys
h = io.open(sys.argv[1], encoding="utf-8").read()
probe = """
<script>
setTimeout(function () {
  var R = Math.round, doc = document.documentElement, dialog = document.getElementById('more');
  document.getElementById('more-trigger').click();
  var rect = dialog.getBoundingClientRect(), opened = dialog.open;
  dialog.close();
  document.title = 'M:' + JSON.stringify({vp: innerWidth + 'x' + innerHeight,
    horizontal: R(doc.scrollWidth) - R(doc.clientWidth), opened: opened,
    fits: rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    closed: !dialog.open});
}, 1200);
</script>
</body>"""
io.open(sys.argv[2], "w", encoding="utf-8").write(h.replace("</body>", probe, 1))
PYEOF

URL="file:///$(cygpath -m "$OUT" 2>/dev/null || echo "$OUT")/measured.html"
failed=0
for size in 1920,1080 1536,864 1440,900 1366,768 1280,720 1024,768 412,915; do
  result=$("$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars --virtual-time-budget=3000 --window-size="$size" --dump-dom "$URL" 2>/dev/null | grep -o '<title>M:[^<]*' | sed 's|<title>M:||')
  printf '%-11s %s\n' "$size" "$result"
  echo "$result" | grep -q '"horizontal":0,"opened":true,"fits":true,"closed":true' || failed=1
done
rm -rf "$OUT"
exit "$failed"
