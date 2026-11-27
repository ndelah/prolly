#!/usr/bin/env bash
# Build versioned, zipped releases of the extension into releases/, one per browser.
#
#   scripts/release.sh           build releases/<name>-<version>.zip and <name>-<version>-firefox.zip
#   scripts/release.sh --force   rebuild them even if that version already exists
#
# <name>-<version>.zip is the file to upload to the Chrome Web Store, <name>-<version>-firefox.zip the
# one to upload to addons.mozilla.org. A .sha256 checksum is written next to each.
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
chrome_out="releases/${name}-${version}.zip"
firefox_out="releases/${name}-${version}-firefox.zip"

for out in "$chrome_out" "$firefox_out"; do
  if [[ -e "$out" && $force -eq 0 ]]; then
    echo "$out already exists. Raise \"version\" in manifest.json for a new release, or pass --force to rebuild this one." >&2
    exit 1
  fi
done

if ! grep -qE "^## \[?${version//./\\.}\]?([[:space:]]|$)" CHANGELOG.md; then
  echo "CHANGELOG.md has no \"## ${version}\" section. Add one describing this release first." >&2
  exit 1
fi

for f in background.js content/*.js shared/*.js popup/*.js options/*.js scripts/*.js; do
  node --check "$f"
done

scripts/build.sh chrome firefox > /dev/null

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p releases

# Zip dist/<browser> (manifest.json at the root of the ZIP), then check what is inside.
release() {
  local browser="$1" out="$2"
  rm -f "$out" "$out.sha256"
  (cd "dist/$browser" && zip -rqX "../../$out" . -x '*.DS_Store')

  # Every file the manifest points to must be inside the ZIP.
  local dir="$tmp/$browser"
  mkdir -p "$dir"
  unzip -q "$out" -d "$dir"
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, browser] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const bg = m.background || {};
    const refs = [bg.service_worker, ...(bg.scripts || []), m.action && m.action.default_popup,
      m.options_page, m.options_ui && m.options_ui.page,
      ...Object.values(m.icons || {}), ...Object.values((m.action && m.action.default_icon) || {}),
      ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])])].filter(Boolean);
    const missing = refs.filter((r) => !fs.existsSync(path.join(dir, r)));
    if (missing.length) { console.error(browser + ": missing from the ZIP: " + missing.join(", ")); process.exit(1); }
    if (browser === "firefox") {
      const g = (m.browser_specific_settings || {}).gecko || {};
      const problems = [];
      if (bg.service_worker) problems.push("background.service_worker (Firefox needs background.scripts)");
      if (!g.id) problems.push("no browser_specific_settings.gecko.id");
      if (!g.data_collection_permissions) problems.push("no data_collection_permissions (AMO requires it)");
      if (m.options_page) problems.push("options_page (use options_ui)");
      if (problems.length) { console.error("firefox manifest: " + problems.join("; ")); process.exit(1); }
    }
  ' "$dir" "$browser"

  (cd releases && shasum -a 256 "$(basename "$out")" > "$(basename "$out").sha256")
  echo "Built $out ($(du -k "$out" | cut -f1) KB, $(unzip -Z1 "$out" | grep -vc '/$') files)"
  echo "  SHA-256 $(cut -d' ' -f1 "$out.sha256")"
}

release chrome "$chrome_out"
release firefox "$firefox_out"

# Mozilla's own checks, when web-ext is installed (npm install --global web-ext).
if command -v web-ext > /dev/null; then
  web-ext lint --source-dir dist/firefox
else
  echo "Tip: install web-ext (npm install --global web-ext) and this script also runs Mozilla's linter on the Firefox build."
fi
