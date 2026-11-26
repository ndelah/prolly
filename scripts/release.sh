#!/usr/bin/env bash
# Build a versioned, zipped release of the extension into releases/.
#
#   scripts/release.sh           build releases/<name>-<version>.zip from manifest.json
#   scripts/release.sh --force   rebuild it even if that version already exists
#
# The ZIP is the file to upload to the Chrome Web Store. A .sha256 checksum is written next to it.
set -euo pipefail
cd "$(dirname "$0")/.."

force=0
if [[ "${1:-}" == "--force" ]]; then force=1; fi

# Name and version come from manifest.json, so a release always matches what it contains.
read -r name version < <(node -e '
  const m = require("./manifest.json");
  const name = (m.short_name || m.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  console.log(name, m.version);
')
out="releases/${name}-${version}.zip"

if [[ -e "$out" && $force -eq 0 ]]; then
  echo "$out already exists. Raise \"version\" in manifest.json for a new release, or pass --force to rebuild this one." >&2
  exit 1
fi

if ! grep -qE "^## \[?${version//./\\.}\]?([[:space:]]|$)" CHANGELOG.md; then
  echo "CHANGELOG.md has no \"## ${version}\" section. Add one describing this release first." >&2
  exit 1
fi

for f in background.js content/*.js shared/*.js popup/*.js options/*.js; do
  node --check "$f"
done

mkdir -p releases
rm -f "$out" "$out.sha256"
# Only the files the extension runs: no README, scripts, changelog or earlier releases.
zip -rqX "$out" manifest.json background.js content shared popup options icons -x '*.DS_Store'

# Check the ZIP: every file manifest.json points to must be inside it.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
unzip -q "$out" -d "$tmp"
node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const refs = [m.background && m.background.service_worker, m.action && m.action.default_popup, m.options_page,
    ...Object.values(m.icons || {}), ...Object.values((m.action && m.action.default_icon) || {}),
    ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])])].filter(Boolean);
  const missing = refs.filter((r) => !fs.existsSync(path.join(dir, r)));
  if (missing.length) { console.error("Missing from the ZIP: " + missing.join(", ")); process.exit(1); }
' "$tmp"

(cd releases && shasum -a 256 "$(basename "$out")" > "$(basename "$out").sha256")

echo "Built $out ($(du -k "$out" | cut -f1) KB, $(unzip -Z1 "$out" | grep -vc '/$') files)"
echo "SHA-256 $(cut -d' ' -f1 "$out.sha256")"
