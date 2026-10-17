#!/usr/bin/env bash
# Runs the steps of .forgejo/workflows/ci.yml in the same order, without the caches and the artifact uploads.
# Usage: npm run ci:local            (all steps)
#        SKIP_INSTALL=1 npm run ci:local   (keep node_modules: no npm ci)
#        SKIP_E2E=1 npm run ci:local       (job build-test only)
# The e2e steps use the compose stack on 127.0.0.1:3012, :3013 and :8428 and stop it at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n=== %s\n' "$*"; }

# Job build-test
if [ "${SKIP_INSTALL:-0}" != 1 ]; then
  step "npm ci"
  npm ci
fi
step "typecheck"; npm run typecheck
step "lint"; npm run lint
step "unit tests"; npm test
step "build"; npm run build
step "check:bundle"; npm run check:bundle
step "package"; npm run package
[ "${SKIP_E2E:-0}" = 1 ] && exit 0

# Job e2e, one run for each Grafana version of the matrix
step "playwright browsers"; npx playwright install chromium
for v in 12:3012 13:3013; do
  service="grafana${v%%:*}"
  port=${v##*:}
  step "e2e $service on :$port"
  docker compose up -d --force-recreate --wait victoriametrics metrics-gen "$service"
  ./scripts/wait-stack.sh "$port"
  GRAFANA_URL="http://localhost:$port" npx playwright test
  docker compose down -v
done
step "ci:local OK"
