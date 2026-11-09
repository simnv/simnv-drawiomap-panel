#!/bin/sh
# Turns the hero video of the docs screenshot run into src/img/screenshots/hero.gif (two passes: palette, then GIF).
# Input: test-results/docs-hero/hero.webm and start.txt (seconds of loading to cut), both written by tests/docs.
set -eu
cd "$(dirname "$0")/.."

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "docs:screenshots needs ffmpeg to make hero.gif. Install it (for example: brew install ffmpeg) and run again." >&2
  exit 1
fi

DIR=test-results/docs-hero
VIDEO=$DIR/hero.webm
OUT=src/img/screenshots/hero.gif
if [ ! -f "$VIDEO" ]; then
  echo "The video $VIDEO is missing: the hero test did not run." >&2
  exit 1
fi
START=$(cat "$DIR/start.txt")
LENGTH=${HERO_SECONDS:-6}
FILTERS="crop=iw:ih-40:0:0,fps=${HERO_FPS:-10},scale=${HERO_WIDTH:-960}:-1:flags=lanczos"

ffmpeg -v error -y -ss "$START" -t "$LENGTH" -i "$VIDEO" -vf "$FILTERS,palettegen=max_colors=40:stats_mode=diff" "$DIR/palette.png"
ffmpeg -v error -y -ss "$START" -t "$LENGTH" -i "$VIDEO" -i "$DIR/palette.png" \
  -lavfi "$FILTERS [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$OUT"
ls -l "$OUT"
