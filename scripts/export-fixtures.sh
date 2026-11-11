#!/usr/bin/env bash
# Exports fixtures/demo/*.drawio and fixtures/hand/*.drawio to fixtures/demo/svg/<name>.svg with draw.io.
# Also writes fixtures/demo/svg/legacy-html-labels.svg: an html=1 variant of demo-l3 (see legacy-html-variant.py).
# Flags: -x export, -f svg, -u uncompressed, --embed-svg-metadata (data-meta-* per <object> attribute).
# The export runs in the rlespinasse/drawio-desktop-headless container, pinned by digest, so each machine
# makes the same bytes. Pinned image: draw.io 32.6.1, linux/arm64 image built 2026-10-26,
# digest sha256:617683fbcbc373fa30901999e05b83f5874f0e3165e177245ceb1d69154f2c54.
# To change the pin: pull the new tag, read the digest (docker inspect --format '{{index .RepoDigests 0}}'),
# then update IMAGE below, this comment and CONTRIBUTING.md, and export again.
# Opt-in: DRAWIO_LOCAL=1 uses the local draw.io CLI (drawio on PATH). Its output can differ from the committed files.
# The demo .drawio files come from the portograph CLI:
#   npx portograph render fixtures/demo/demo-l3.yaml --format drawio --output fixtures/demo/demo-l3.drawio
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out_dir="$root/fixtures/demo/svg"
mkdir -p "$out_dir"
tmp=$(mktemp -d "$root/fixtures/.legacy.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

IMAGE="rlespinasse/drawio-desktop-headless@sha256:617683fbcbc373fa30901999e05b83f5874f0e3165e177245ceb1d69154f2c54"

export_svg() {
  local in=$1 out=$2
  if [ "${DRAWIO_LOCAL:-}" = 1 ]; then
    command -v drawio >/dev/null 2>&1 || { echo "DRAWIO_LOCAL=1 but no drawio on PATH" >&2; exit 1; }
    drawio -x -f svg -u --embed-svg-metadata -o "$out" "$in"
  elif command -v docker >/dev/null 2>&1; then
    local rel=${in#"$root"/fixtures/} orel=${out#"$root"/fixtures/}
    docker run --rm -v "$root/fixtures:/data" "$IMAGE" \
      -x -f svg -u --embed-svg-metadata -o "/data/$orel" "/data/$rel"
  else
    echo "docker not found (or set DRAWIO_LOCAL=1)" >&2
    exit 1
  fi
}

python3 "$root/scripts/legacy-html-variant.py" "$root/fixtures/demo/demo-l3.drawio" "$tmp/legacy-html-labels.drawio"

for f in "$root"/fixtures/demo/*.drawio "$root"/fixtures/hand/*.drawio "$tmp/legacy-html-labels.drawio"; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .drawio)
  export_svg "$f" "$out_dir/$n.svg"
  # draw.io writes a random id (ge-svg-<random>) into the root <svg>. Replace only that id with a fixed one: same input, same bytes.
  node "$root/scripts/normalize-svg-id.mjs" "$out_dir/$n.svg" "$n"
  printf '%-20s %8d bytes, %3d cells\n' "$n" "$(wc -c <"$out_dir/$n.svg")" "$(grep -o 'data-cell-id=' "$out_dir/$n.svg" | wc -l)"
done
