#!/usr/bin/env bash
# Vendors a pinned draw.io webapp (jgraph/drawio, Apache-2.0) into .drawio/webapp.
# webpack.config.ts copies .drawio/webapp to dist/drawio. Grafana serves it at /public/plugins/<id>/drawio/.
#
# Usage: scripts/vendor-drawio.sh [--full | --if-missing]
#   --full        keep every file of draw.war (for size measurements). Default: the embed-mode file set.
#   --if-missing  do nothing when .drawio/webapp already has DRAWIO_VERSION (npm prebuild/predev).
# Update: set DRAWIO_VERSION and DRAWIO_SHA256 to a new release of https://github.com/jgraph/drawio/releases
# (sha256 of draw.war), run the script, then run the editor e2e test.
set -euo pipefail

DRAWIO_VERSION=32.4.1
DRAWIO_SHA256=b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820

root=$(cd "$(dirname "$0")/.." && pwd)
cache="$root/.drawio/cache"
out="$root/.drawio/webapp"
stamp="$root/.drawio/webapp.version"
tmp="$root/.drawio/webapp.tmp"
war="$cache/draw-$DRAWIO_VERSION.war"
license="$cache/LICENSE-$DRAWIO_VERSION"
full=0
[ "${1:-}" = "--full" ] && full=1
if [ "${1:-}" = "--if-missing" ] && [ -d "$out" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$DRAWIO_VERSION" ]; then
  exit 0
fi

mkdir -p "$cache"
if [ ! -f "$war" ]; then
  curl -fsSL -o "$war.tmp" "https://github.com/jgraph/drawio/releases/download/v$DRAWIO_VERSION/draw.war"
  mv "$war.tmp" "$war"
fi
echo "$DRAWIO_SHA256  $war" | shasum -a 256 -c - >/dev/null || { echo "FAIL: sha256 of $war"; exit 1; }
if [ ! -f "$license" ]; then
  curl -fsSL -o "$license.tmp" "https://raw.githubusercontent.com/jgraph/drawio/v$DRAWIO_VERSION/LICENSE"
  mv "$license.tmp" "$license"
fi

# Build in a temporary folder. .drawio/webapp changes only when every step succeeds.
rm -rf "$tmp"
mkdir -p "$tmp"
unzip -q "$war" -d "$tmp"
out_final=$out
out=$tmp

# Server-side parts and pages that embed mode does not use.
rm -rf "$out/WEB-INF" "$out/META-INF" "$out/connect"
if [ "$full" -eq 0 ]; then
  (
    cd "$out"
    rm -f clear.html dropbox.html export3.html github.html gitlab.html onedrive3.html open.html teams.html \
      vsdxImporter.html monday-app-association.json service-worker.js service-worker.js.map workbox-*.js workbox-*.js.map
    # Development sources (dev=1 only) and bundles for other hosts: Confluence/Jira, viewer, lightbox.
    rm -rf js/diagramly js/grapheditor mxgraph/src js/integrate.min.js js/viewer.min.js js/viewer-static.min.js \
      js/embed.dev.js js/export.js js/export-init.js js/clear.js js/open.js js/vsdxImporter.js js/math-print.js \
      js/dropbox js/onedrive js/simplepeer
    # Template catalog (File > New, Insert > Template). The plugin loads one diagram from the panel options.
    rm -rf templates
    # Stencil scripts: js/shapes-14-6-5.min.js and js/stencils.min.js contain them.
    rm -rf shapes
    # draw.io plugins (p= URL parameter, Extras > Plugins). Offline mode does not load them.
    rm -rf plugins
  )
fi

# Offline configuration: no cloud storage, no service worker, no external services.
cat >"$out/js/PreConfig.js" <<'EOF'
/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 * Changed by simnv-drawiomap-panel: offline configuration for the bundled editor.
 */
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null;
window.DRAWIO_BASE_URL = null;
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null;
window.PLANT_URL = null;
urlParams['sync'] = 'manual';
urlParams['db'] = '0';
urlParams['gh'] = '0';
urlParams['tr'] = '0';
urlParams['gapi'] = '0';
urlParams['od'] = '0';
urlParams['gl'] = '0';
urlParams['offline'] = '1';
urlParams['stealth'] = '1';
urlParams['lockdown'] = '1';
urlParams['pwa'] = '0';
EOF
cat >"$out/js/PostConfig.js" <<'EOF'
/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 * Changed by simnv-drawiomap-panel: offline configuration for the bundled editor.
 */
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;
EditorUi.enableLogging = false;
EOF

# The panel shows the editor in an iframe with srcdoc (Grafana sends X-Frame-Options: deny for plugin files).
# An about:srcdoc document has no query string and its URL is not http(s), so:
#  1. bootstrap.js reads the URL parameters from <meta name="dmap-search"> when it is present,
#  2. bootstrap.js does not redirect when the protocol is not http(s).
patch_once() {
  local file=$1 from=$2 to=$3
  local n
  n=$(FROM="$from" perl -0ne '$c = () = /\Q$ENV{FROM}\E/g; print $c' "$file")
  [ "$n" = "1" ] || { echo "FAIL: expected one '$from' in $file, found $n. Update the patch for draw.io $DRAWIO_VERSION."; exit 1; }
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
}
patch_once "$out/js/bootstrap.js" \
  "var params = window.location.search.slice(1).split('&');" \
  "var dmapSearch = document.querySelector('meta[name=\"dmap-search\"]'); var params = (dmapSearch != null ? dmapSearch.getAttribute('content') : window.location.search).slice(1).split('&');"
patch_once "$out/js/bootstrap.js" \
  "if (href != window.location.href)" \
  "if (href != window.location.href && (proto == 'http:' || proto == 'https:'))"

cat >"$out/NOTICE" <<EOF
This directory contains draw.io $DRAWIO_VERSION (https://github.com/jgraph/drawio),
Copyright JGraph Holdings Ltd and draw.io AG, licensed under the Apache License 2.0 (LICENSE).
Source: https://github.com/jgraph/drawio/releases/download/v$DRAWIO_VERSION/draw.war (sha256 $DRAWIO_SHA256).
simnv-drawiomap-panel changed js/PreConfig.js, js/PostConfig.js and js/bootstrap.js and removed files
that embed mode does not use (see scripts/vendor-drawio.sh). Third-party licenses of bundled
libraries are in the license headers of the files and in the LICENSE files of their directories.
draw.io is a trademark of JGraph Holdings Ltd. This plugin is not affiliated with or endorsed by JGraph.
EOF
cp "$license" "$out/LICENSE"

rm -rf "$out_final"
mv "$tmp" "$out_final"
# A --full tree is for measurements only: --if-missing replaces it.
if [ "$full" -eq 0 ]; then echo "$DRAWIO_VERSION" >"$stamp"; else rm -f "$stamp"; fi
echo "draw.io $DRAWIO_VERSION in $out_final: $(du -sh "$out_final" | cut -f1), $(find "$out_final" -type f | wc -l | tr -d ' ') files"
