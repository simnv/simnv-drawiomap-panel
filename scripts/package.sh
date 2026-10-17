#!/usr/bin/env bash
# Makes artifacts/simnv-drawiomap-panel-<version>.zip from dist/, with the layout that Grafana expects:
# one top folder with the plugin id (https://grafana.com/developers/plugin-tools/publish-a-plugin/package-a-plugin).
# Run npm run build first. Prints the sizes and fails when the zip is larger than MAX_ZIP_MB (default 30).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/dist"
[ -f "$dist/plugin.json" ] || { echo "run npm run build first"; exit 1; }
id=$(node -p 'require(process.argv[1]).id' "$dist/plugin.json")
version=$(node -p 'require(process.argv[1]).info.version' "$dist/plugin.json")
max_mb=${MAX_ZIP_MB:-30}
out="$root/artifacts"
zip_file="$out/$id-$version.zip"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p "$out"
rm -f "$zip_file"
cp -R "$dist" "$stage/$id"
if command -v zip >/dev/null; then
  (cd "$stage" && zip -qrX "$zip_file" "$id")
else
  (cd "$stage" && python3 -I -m zipfile -c "$zip_file" "$id")
fi
(cd "$out" && shasum -a 256 "$(basename "$zip_file")" >"$(basename "$zip_file").sha256")

size=$(wc -c <"$zip_file" | tr -d ' ')
echo "dist/: $(du -sk "$dist" | cut -f1) KB, $(find "$dist" -type f | wc -l | tr -d ' ') files"
echo "dist/module.js: $(wc -c <"$dist/module.js" | tr -d ' ') bytes"
echo "dist/drawio/: $(du -sk "$dist/drawio" 2>/dev/null | cut -f1) KB"
echo "$zip_file: $size bytes"
if [ "$size" -gt $((max_mb * 1024 * 1024)) ]; then
  echo "FAIL: zip larger than $max_mb MB"
  exit 1
fi
