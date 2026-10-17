#!/usr/bin/env bash
# Exports fixtures/demo/*.drawio and fixtures/hand/*.drawio to fixtures/demo/svg/<name>.svg with draw.io.
# Also writes fixtures/demo/svg/legacy-html-labels.svg: an html=1 variant of demo-l3 (see legacy-html-variant.py).
# Flags: -x export, -f svg, -u uncompressed, --embed-svg-metadata (data-meta-* per <object> attribute).
# Order of preference: local draw.io CLI (/opt/homebrew/bin/drawio), then the
# rlespinasse/drawio-desktop-headless container. Third option (manual): use the panel's Import button,
# which exports through the embed protocol with the same options.
# The demo .drawio files come from the portograph CLI:
#   npx portograph render fixtures/demo/demo-l3.yaml --format drawio --output fixtures/demo/demo-l3.drawio
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out_dir="$root/fixtures/demo/svg"
mkdir -p "$out_dir"
tmp=$(mktemp -d "$root/fixtures/.legacy.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

export_svg() {
  local in=$1 out=$2
  if command -v drawio >/dev/null 2>&1; then
    drawio -x -f svg -u --embed-svg-metadata -o "$out" "$in"
  elif command -v docker >/dev/null 2>&1; then
    local rel=${in#"$root"/fixtures/} orel=${out#"$root"/fixtures/}
    docker run --rm -v "$root/fixtures:/data" rlespinasse/drawio-desktop-headless:latest \
      -x -f svg -u --embed-svg-metadata -o "/data/$orel" "/data/$rel"
  else
    echo "no draw.io CLI and no docker" >&2
    exit 1
  fi
}

python3 "$root/scripts/legacy-html-variant.py" "$root/fixtures/demo/demo-l3.drawio" "$tmp/legacy-html-labels.drawio"

for f in "$root"/fixtures/demo/*.drawio "$root"/fixtures/hand/*.drawio "$tmp/legacy-html-labels.drawio"; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .drawio)
  export_svg "$f" "$out_dir/$n.svg"
  printf '%-20s %8d bytes, %3d cells\n' "$n" "$(wc -c <"$out_dir/$n.svg")" "$(grep -o 'data-cell-id=' "$out_dir/$n.svg" | wc -l)"
done
