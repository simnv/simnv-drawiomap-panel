#!/usr/bin/env bash
# Spec section 6 item 6: view mode must load no draw.io scripts.
# The importer legitimately parses <mxGraphModel>, so do not grep for "mxGraph". Check instead:
#  1. no draw.io / maxGraph package in the dependency tree,
#  2. no draw.io runtime globals in any plugin script dist/*.js, the lazy chunks too (GraphViewer, mxClient, viewer-static, @maxgraph),
#  3. the bundle stays small,
#  4. @grafana/react-detect finds no React 19 breakers,
#  5. the build is newer than each file in src/ (spec 5.3: no stale build),
#  6. dist/module.js holds no message text of the yaml package: the parser loads only in the lazy editor chunk
#     (spec 5.3, A13). A minifier renames functions but keeps string literals.
#  7. the YAML editor modules (options/yamlConfig.ts) are in one lazy chunk only: the bindings popup and the YAML
#     option editor share them (webpack.config.ts, cacheGroups.editorShared).
# The runtime check (no request to the editor origin in view mode) is tests/no-drawio.spec.ts.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
f="$root/dist/module.js"
[ -f "$f" ] || { echo "run npm run build first"; exit 1; }
bad=0
stale=$(find "$root/src" -type f -newer "$f" | head -n 1)
if [ -n "$stale" ]; then
  echo "FAIL: stale build: ${stale#"$root/"} is newer than dist/module.js; run npm run build"
  bad=1
fi
for text in 'Implicit keys need to be on a single line' 'Map keys must be unique'; do
  if grep -qF -- "$text" "$f"; then
    echo "FAIL: dist/module.js holds the yaml package text \"$text\"; load yaml only in a lazy chunk"
    bad=1
  fi
done
# yamlConfig.ts holds this text. Two chunks with it means the shared chunk does not work any more.
copies=$(grep -lF -- 'YAML anchors are not allowed.' "$root"/dist/*.js | wc -l | tr -d ' ')
if [ "$copies" != "1" ]; then
  echo "FAIL: the YAML editor modules are in $copies chunks of dist/, expected 1 (webpack.config.ts, cacheGroups.editorShared)"
  bad=1
fi
deps=$(node -e 'const p=require(process.argv[1]); console.log(Object.keys({...p.dependencies,...p.devDependencies}).join("\n"))' "$root/package.json")
for pkg in @maxgraph/core mxgraph drawio @drawio/mcp; do
  if printf '%s\n' "$deps" | grep -qx "$pkg"; then
    echo "FAIL: dependency $pkg is a draw.io runtime"
    bad=1
  fi
done
if (cd "$root" && npm ls @maxgraph/core mxgraph 2>/dev/null) | grep -qE '@maxgraph/core@|mxgraph@'; then
  echo "FAIL: transitive maxGraph/mxGraph package"
  bad=1
fi
# The popup lives in a lazy chunk next to module.js. The bundled editor is in dist/drawio and is not scanned.
for chunk in "$root"/dist/*.js; do
  for token in GraphViewer mxClient viewer-static '@maxgraph' 'maxgraph/core'; do
    if grep -q -- "$token" "$chunk"; then
      echo "FAIL: $token found in dist/$(basename "$chunk")"
      bad=1
    fi
  done
  echo "dist/$(basename "$chunk"): $(wc -c <"$chunk" | tr -d ' ') bytes"
done
size=$(wc -c <"$f" | tr -d ' ')
if [ "$size" -gt 400000 ]; then
  echo "FAIL: bundle larger than 400 KB"
  bad=1
fi
(cd "$root" && npx -y @grafana/react-detect@latest) || bad=1
[ "$bad" -eq 0 ] && echo "bundle OK"
exit $bad
