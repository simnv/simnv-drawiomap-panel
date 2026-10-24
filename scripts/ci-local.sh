#!/usr/bin/env bash
# Runs the steps of .woodpecker/build.yaml and .woodpecker/e2e.yaml in the same order, on a developer machine.
# Usage: npm run ci:local            (all steps)
#        SKIP_INSTALL=1 npm run ci:local   (keep node_modules: no npm ci)
#        SKIP_E2E=1 npm run ci:local       (build.yaml only)
# The e2e steps use the compose stack on 127.0.0.1:3012, :3013 and :8428 and stop it at the end. In CI, detached
# steps replace the compose stack.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n=== %s\n' "$*"; }

# Workflow build
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

# Workflow e2e, one run for each Grafana version of the matrix
step "playwright browsers"; npx playwright install chromium
for v in 12:3012 13:3013; do
  service="grafana${v%%:*}"
  port=${v##*:}
  step "e2e $service on :$port"
  docker compose up -d --force-recreate --wait victoriametrics metrics-gen "$service"
  ./scripts/wait-stack.sh "$port"
  # The version split (docs/research/test-cost-audit.md): 12 runs the project matrix, 13 runs both projects.
  projects=(--project=matrix)
  [ "$service" = grafana13 ] && projects+=(--project=plugin)
  GRAFANA_URL="http://localhost:$port" npx playwright test "${projects[@]}"
  docker compose down -v
done
step "ci:local OK"
