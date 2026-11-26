#!/usr/bin/env bash
# Build unpacked extensions and store zips for every browser.
#   ./scripts/build.sh            -> dist/chrome, dist/firefox (+ zips in dist/)
# Chrome build also covers Edge, Brave, Opera, Vivaldi and Arc.
# Safari: run scripts/safari.sh on macOS after building.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(jq -r .version manifests/chrome.json)
FF_VERSION=$(jq -r .version manifests/firefox.json)
if [[ "$VERSION" != "$FF_VERSION" ]]; then
  echo "Version mismatch: chrome=$VERSION firefox=$FF_VERSION" >&2
  exit 1
fi

rm -rf dist
for browser in chrome firefox; do
  out="dist/$browser"
  mkdir -p "$out"
  cp -R src/. "$out/"
  cp "manifests/$browser.json" "$out/manifest.json"
  find "$out" -name '.DS_Store' -delete
  (cd "$out" && zip -qr -X "../windowed-video-fullscreen-$VERSION-$browser.zip" .)
done

echo "Built v$VERSION:"
ls -1 dist
