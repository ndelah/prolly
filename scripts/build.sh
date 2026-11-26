#!/usr/bin/env bash
# Copy the files the extension runs into dist/<browser>/, with that browser's manifest.
#
#   scripts/build.sh            build dist/chrome and dist/firefox
#   scripts/build.sh firefox    build one of them (chrome or firefox)
#
# To try the Firefox build: about:debugging#/runtime/this-firefox → Load Temporary Add-on… →
# pick dist/firefox/manifest.json. (Chrome can load the repository folder itself, unpacked.)
set -euo pipefail
cd "$(dirname "$0")/.."

# Only the files the extension runs: no README, scripts, changelog or releases.
FILES=(background.js content shared popup options icons)

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then targets=(chrome firefox); fi

for t in "${targets[@]}"; do
  case "$t" in
    chrome | firefox) ;;
    *) echo "Unknown browser \"$t\". Use chrome or firefox." >&2; exit 1 ;;
  esac
  out="dist/$t"
  rm -rf "$out"
  mkdir -p "$out"
  cp -R "${FILES[@]}" "$out/"
  find "$out" -name '.DS_Store' -delete
  if [[ "$t" == firefox ]]; then
    node scripts/firefox-manifest.js > "$out/manifest.json"
  else
    cp manifest.json "$out/manifest.json"
  fi
  echo "Built $out"
done
