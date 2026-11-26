#!/usr/bin/env bash
# Run tests/harness.html in headless Chrome and report results.
# Usage: tests/run-harness.sh [path-to-chrome]
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${1:-${CHROME:-}}"
if [[ -z "$CHROME" ]]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then CHROME="$c"; break; fi
  done
fi
[[ -n "$CHROME" ]] || { echo "Chrome not found; pass its path as the first argument" >&2; exit 2; }

PORT=${PORT:-8765}
URL="http://127.0.0.1:$PORT/tests/harness.html"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
PROFILE=$(mktemp -d)
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$PROFILE"' EXIT
for _ in $(seq 1 50); do curl -fs -o /dev/null "$URL" && break; sleep 0.2; done
curl -fs -o /dev/null "$URL" || { echo "Test server did not start on port $PORT" >&2; exit 1; }

JSON=""
for attempt in 1 2 3; do
  OUT=$("$CHROME" --headless=new --disable-gpu --no-first-run --no-sandbox --user-data-dir="$PROFILE/$attempt" \
    --window-size=1280,800 --virtual-time-budget=15000 --dump-dom "$URL" 2>/dev/null || true)
  JSON=$(printf '%s' "$OUT" | grep -o '<pre id="results">WVFS_RESULTS .*' | sed 's/^<pre id="results">WVFS_RESULTS //; s/<\/pre>.*$//' | sed 's/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g' || true)
  [[ -n "$JSON" ]] && break
  echo "Attempt $attempt: no results from Chrome, retrying" >&2
done
[[ -n "$JSON" ]] || { echo "No results found in page output. Last output:" >&2; printf '%s\n' "$OUT" | tail -5 >&2; exit 1; }
printf '%s' "$JSON" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const r = JSON.parse(s);
    for (const t of r.results) console.log((t.pass ? "  ok   " : "  FAIL ") + t.name + (t.pass || !t.extra ? "" : "  -> " + t.extra));
    console.log(`\n${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed ? 1 : 0);
  });'
