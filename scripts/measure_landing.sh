#!/usr/bin/env bash
# Report how much the landing page and its details sheet overflow the viewport,
# at seven real window sizes. Both numbers must read 0 on every desktop row --
# the page is specified to need no scrolling, and neither does the sheet.
#
# There is no test suite in this repo; this is the check for that claim. It
# drives the installed Chrome headless, injects a probe that opens the sheet
# and reports scrollHeight against clientHeight, and reads the answer back out
# of <title> via --dump-dom.
#
#   bash scripts/measure_landing.sh [path/to/index.html]
set -u
SRC="${1:-landing-page/index.html}"
OUT="$(mktemp -d)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
[ -f "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME=)"; exit 1; }

python - "$SRC" "$OUT/measured.html" <<'PYEOF'
import io, sys
h = io.open(sys.argv[1], encoding="utf-8").read()
probe = """
<script>
(function () {
  var R = Math.round;
  setTimeout(function () {
    var t = document.getElementById('more'), doc = document.documentElement;
    var page = R(doc.scrollHeight);
    t.checked = true;
    var sheet = document.querySelector('.sheet'), sb = document.querySelector('.sheet-body');
    void sheet.offsetHeight;
    var over = R(sheet.scrollHeight) - R(sheet.clientHeight);
    var body = R(sb.getBoundingClientRect().height);
    t.checked = false;
    document.title = 'M:' + JSON.stringify({ vp: innerWidth + 'x' + innerHeight,
      pageOver: page - innerHeight, sheetOver: over, sheetH: body });
  }, 250);
})();
</script>
</body>"""
io.open(sys.argv[2], "w", encoding="utf-8").write(h.replace("</body>", probe, 1))
PYEOF

# mktemp -d gives a POSIX path; Chrome needs the Windows one for file:///.
URL="file:///$(cygpath -m "$OUT" 2>/dev/null || echo "$OUT")/measured.html"
for size in 1920,1080 1536,864 1440,900 1366,768 1280,720 1024,768 412,915; do
  printf '%-11s ' "$size"
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --virtual-time-budget=1500 --window-size="$size" --dump-dom "$URL" 2>/dev/null \
    | grep -o '<title>M:[^<]*' | sed 's|<title>M:||'
done
rm -rf "$OUT"
