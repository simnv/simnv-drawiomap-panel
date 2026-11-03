#!/usr/bin/env bash
# Prepares the files for the Grafana steps of .woodpecker/ci.yaml. The CI steps have no bind mounts: Grafana reads the
# plugin and the provisioning from the workspace (GF_PATHS_PLUGINS, GF_PATHS_PROVISIONING).
#   ci/plugins/simnv-drawiomap-panel   copy of dist/ (run npm run build first)
#   ci/provisioning                    copy of provisioning/, with the dashboard path in the workspace
# The datasource URL http://victoriametrics:8428 stays: the step "victoriametrics" has this hostname.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/ci"
[ -f "$root/dist/plugin.json" ] || { echo "run npm run build first"; exit 1; }
rm -rf "$out"
mkdir -p "$out/plugins"
cp -R "$root/dist" "$out/plugins/simnv-drawiomap-panel"
cp -R "$root/provisioning" "$out/provisioning"
sed -i.bak "s|/etc/grafana/provisioning/dashboards|$out/provisioning/dashboards|" "$out/provisioning/dashboards/dashboards.yaml"
rm -f "$out/provisioning/dashboards/dashboards.yaml.bak"
grep -q "path: $out/provisioning/dashboards" "$out/provisioning/dashboards/dashboards.yaml" || {
  echo "FAIL: dashboard path not changed in $out/provisioning/dashboards/dashboards.yaml"
  exit 1
}
# Grafana runs as uid 472, gid 0. The files belong to the user of this step.
chmod -R a+rX "$out"
# Group root (gid 0 of the Grafana user) can write: Grafana installs its preinstalled plugins there.
chmod g+w "$out/plugins"
echo "Grafana files in $out: plugin $(node -p 'require(process.argv[1]).info.version' "$root/dist/plugin.json"), provisioning $(find "$out/provisioning" -type f | wc -l | tr -d ' ') files"
