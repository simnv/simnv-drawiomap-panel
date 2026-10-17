#!/usr/bin/env bash
# Exports every fixtures/**/*.drawio to fixtures/svg/<name>.svg with draw.io.
# Flags: -x export, -f svg, -u uncompressed, --embed-svg-metadata (data-meta-* per <object> attribute).
# Order of preference: local draw.io CLI (/opt/homebrew/bin/drawio), then the
# rlespinasse/drawio-desktop-headless container. Third option (manual): use the panel's Import button,
# which exports through the embed protocol with the same options.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$root/fixtures/svg"

export_svg() {
  local in=$1 out=$2
  if command -v drawio >/dev/null 2>&1; then
    drawio -x -f svg -u --embed-svg-metadata -o "$out" "$in"
  elif command -v docker >/dev/null 2>&1; then
    local rel=${in#"$root"/fixtures/}
    docker run --rm -v "$root/fixtures:/data" rlespinasse/drawio-desktop-headless:latest \
      -x -f svg -u --embed-svg-metadata -o "/data/svg/$(basename "$out")" "/data/$rel"
  else
    echo "no draw.io CLI and no docker" >&2
    exit 1
  fi
}

for f in "$root"/fixtures/portograph/*.drawio "$root"/fixtures/hand/*.drawio; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .drawio)
  export_svg "$f" "$root/fixtures/svg/$n.svg"
  printf '%-14s %8d bytes, %3d cells\n' "$n" "$(wc -c <"$root/fixtures/svg/$n.svg")" "$(grep -o 'data-cell-id=' "$root/fixtures/svg/$n.svg" | wc -l)"
done
