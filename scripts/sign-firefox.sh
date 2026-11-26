#!/usr/bin/env bash
# Submit dist/firefox to addons.mozilla.org.
#   AMO_CHANNEL=listed   (default) public listing: uploaded for Mozilla's review, listing
#                        text from amo/metadata.json. No .xpi comes back: users install
#                        from https://addons.mozilla.org/firefox/addon/windowed-video-fullscreen/
#   AMO_CHANNEL=unlisted signed straight away; writes dist/windowed-video-fullscreen-<v>-firefox-signed.xpi
#   AMO_VERSION_SUFFIX=.1 submit as <version>.1 (used for the GitHub .xpi, since the
#                        plain version number is taken by the listed submission)
# Needs AMO_JWT_ISSUER and AMO_JWT_SECRET (https://addons.mozilla.org/developers/addon/api/key/).
# AMO accepts each version number once, across both channels.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER}" "${AMO_JWT_SECRET:?set AMO_JWT_SECRET}"
CHANNEL="${AMO_CHANNEL:-listed}"
[[ -d dist/firefox ]] || ./scripts/build.sh
VERSION=$(jq -r .version manifests/firefox.json)${AMO_VERSION_SUFFIX:-}
rm -rf dist/signed
SRC=dist/firefox
if [[ -n "${AMO_VERSION_SUFFIX:-}" ]]; then
  SRC=dist/firefox-$VERSION
  rm -rf "$SRC" && cp -R dist/firefox "$SRC"
  jq --arg v "$VERSION" '.version = $v' dist/firefox/manifest.json > "$SRC/manifest.json"
fi

args=(--channel "$CHANNEL" --source-dir "$SRC" --artifacts-dir dist/signed
      --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET")
if [[ "$CHANNEL" == listed ]]; then
  args+=(--amo-metadata amo/metadata.json --approval-timeout 0)
fi
npx --yes web-ext@8 sign "${args[@]}"

shopt -s nullglob
xpis=(dist/signed/*.xpi)
if (( ${#xpis[@]} )); then
  mv "${xpis[0]}" "dist/windowed-video-fullscreen-$VERSION-firefox-signed.xpi"
  echo "Signed: dist/windowed-video-fullscreen-$VERSION-firefox-signed.xpi"
else
  echo "Submitted v$VERSION to the $CHANNEL channel; it goes live after Mozilla's review."
fi
