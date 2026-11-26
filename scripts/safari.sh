#!/usr/bin/env bash
# Wrap the Chrome build in a Safari app project (macOS + Xcode required).
# Then open the generated project in Xcode, run it, and enable the extension in
# Safari > Settings > Extensions (allow unsigned extensions in the Develop menu).
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d dist/chrome ]] || ./scripts/build.sh
xcrun safari-web-extension-converter dist/chrome \
  --project-location dist/safari \
  --app-name "Windowed Video Fullscreen" \
  --bundle-identifier io.github.shehuawwal.windowed-video-fullscreen \
  --swift --copy-resources --no-open --force
echo "Xcode project written to dist/safari"
