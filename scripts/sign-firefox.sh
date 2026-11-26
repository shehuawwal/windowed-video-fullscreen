#!/usr/bin/env bash
# Sign dist/firefox as an unlisted add-on on addons.mozilla.org.
# Needs AMO_JWT_ISSUER and AMO_JWT_SECRET (https://addons.mozilla.org/developers/addon/api/key/).
# Writes dist/windowed-video-fullscreen-<version>-firefox-signed.xpi
set -euo pipefail
cd "$(dirname "$0")/.."
: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER}" "${AMO_JWT_SECRET:?set AMO_JWT_SECRET}"
[[ -d dist/firefox ]] || ./scripts/build.sh
VERSION=$(jq -r .version manifests/firefox.json)
rm -rf dist/signed
npx --yes web-ext@8 sign \
  --channel unlisted \
  --source-dir dist/firefox \
  --artifacts-dir dist/signed \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
xpi=$(ls dist/signed/*.xpi | head -1)
mv "$xpi" "dist/windowed-video-fullscreen-$VERSION-firefox-signed.xpi"
echo "Signed: dist/windowed-video-fullscreen-$VERSION-firefox-signed.xpi"
