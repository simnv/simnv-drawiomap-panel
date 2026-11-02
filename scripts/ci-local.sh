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

# The checks do not use each other's output: they run at the same time, each one with its output in a file. The
# output prints for each step, in a fixed order, after all steps end. One failed step fails the script.
# ESLint runs without `npm run lint`: that script also runs the import guards (check:imports), and the full unit
# suite runs the same two test files.
check_names=("typecheck" "eslint" "unit tests")
check_cmds=("npm run typecheck" "npx eslint --cache ." "npm test")
check_logs=$(mktemp -d)
trap 'rm -rf "$check_logs"' EXIT
check_pids=()
for i in "${!check_names[@]}"; do
  bash -c "${check_cmds[$i]}" >"$check_logs/$i.log" 2>&1 &
  check_pids+=("$!")
done
checks_failed=0
for i in "${!check_names[@]}"; do
  if wait "${check_pids[$i]}"; then
    step "${check_names[$i]}: ok"
  else
    step "${check_names[$i]}: FAILED"
    checks_failed=1
  fi
  cat "$check_logs/$i.log"
done
if [ "$checks_failed" != 0 ]; then
  echo
  echo "ci:local FAILED: a check failed, see above"
  exit 1
fi

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
