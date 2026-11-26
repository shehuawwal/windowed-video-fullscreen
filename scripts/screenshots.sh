#!/usr/bin/env bash
# Regenerate the store screenshots (amo/screenshots/*.png, 1280x800) in headless Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
./scripts/build.sh >/dev/null

# Extension pages with a stand-in for the browser's extension API.
STUB='<script>window.chrome={storage:{sync:{_d:{disabledSites:["example.com"]},get(){return Promise.resolve(this._d)},set(p){Object.assign(this._d,p);return Promise.resolve()}},onChanged:{addListener(){}}},runtime:{getManifest:()=>({version:"'$(jq -r .version manifests/chrome.json)'"}),openOptionsPage(){}},tabs:{query:()=>Promise.resolve([{id:1}]),sendMessage:()=>Promise.resolve({host:"localhost",page:{active:false,enabled:true,hasVideo:true}})}};</script>'
for p in options popup; do
  sed "s#<script src=\"../shared/settings.js\"></script>#${STUB}<script src=\"../shared/settings.js\"></script>#" "dist/chrome/$p/$p.html" > "dist/chrome/$p/_preview.html"
done

PORT=8767
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
PROFILE=$(mktemp -d)
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$PROFILE"' EXIT
until curl -fs -o /dev/null "http://127.0.0.1:$PORT/amo/shot.html"; do sleep 0.2; done

mkdir -p amo/screenshots
names=(1-windowed 2-click-safe 3-shortcuts 4-toolbar)
for i in 1 2 3 4; do
  "$CHROME" --headless=new --disable-gpu --no-first-run --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$PROFILE/$i" --window-size=1280,800 --virtual-time-budget=4000 \
    --screenshot="amo/screenshots/${names[$((i-1))]}.png" "http://127.0.0.1:$PORT/amo/shot.html?scene=$i" 2>/dev/null
done
ls -1 amo/screenshots
