#!/usr/bin/env bash
# Runs the steps of .woodpecker/ci.yaml in the same order, on a developer machine.
# Usage: npm run ci:local            (all steps)
#        SKIP_INSTALL=1 npm run ci:local   (keep node_modules: no npm ci)
#        SKIP_E2E=1 npm run ci:local       (stop after the package step)
# The e2e steps use the compose stack on 127.0.0.1:3011, :3012, :3013 and :8428 and stop it at the end. In CI, detached
# steps replace the compose stack.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n=== %s\n' "$*"; }

# Install, checks, build and package
if [ "${SKIP_INSTALL:-0}" != 1 ]; then
  step "npm ci"
  npm ci
fi

# The checks do not use each other's output: they run at the same time, each one with its output in a file. Each step
# prints in a fixed order, as soon as it ends and the steps before it have printed. One failed step fails the script.
# ESLint and Prettier run without `npm run lint`: that script also runs the import guards (check:imports), and the
# full unit suite runs the same two test files.
# Each check runs in its own process group (job control on while it starts). A cancel (SIGINT, SIGTERM) or an exit
# stops every group, with the Vitest workers and the other descendants, before the logs go away. A cancel exits non-zero.
check_names=("typecheck" "eslint" "prettier" "unit tests")
check_cmds=("npm run typecheck" "npx eslint --cache ." "npm run format:check" "npm test")
check_logs=$(mktemp -d)
check_pids=()
stop_checks() {
  local pid i alive
  for pid in ${check_pids[@]+"${check_pids[@]}"}; do
    [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null || true
  done
  # Up to 2 s for the groups to end after SIGTERM; then SIGKILL.
  for i in 1 2 3 4 5 6 7 8 9 10; do
    alive=0
    for pid in ${check_pids[@]+"${check_pids[@]}"}; do
      if [ -n "$pid" ] && kill -0 -- "-$pid" 2>/dev/null; then
        alive=1
      fi
    done
    [ "$alive" = 0 ] && break
    sleep 0.2
  done
  for pid in ${check_pids[@]+"${check_pids[@]}"}; do
    [ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null || true
  done
  for pid in ${check_pids[@]+"${check_pids[@]}"}; do
    [ -n "$pid" ] && wait "$pid" 2>/dev/null || true
  done
  check_pids=()
}
cleanup() {
  trap - EXIT INT TERM
  stop_checks
  rm -rf "$check_logs"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
set -m
for i in "${!check_names[@]}"; do
  bash -c "${check_cmds[$i]}" >"$check_logs/$i.log" 2>&1 &
  check_pids+=("$!")
done
set +m
checks_failed=0
for i in "${!check_names[@]}"; do
  if wait "${check_pids[$i]}"; then
    step "${check_names[$i]}: ok"
  else
    step "${check_names[$i]}: FAILED"
    checks_failed=1
  fi
  check_pids[i]=""
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

# e2e, one run for each Grafana version of the matrix
step "playwright browsers"; npx playwright install chromium
for v in 123:3011 12:3012 13:3013; do
  service="grafana${v%%:*}"
  port=${v##*:}
  step "e2e $service on :$port"
  docker compose up -d --force-recreate --wait victoriametrics metrics-gen "$service"
  ./scripts/wait-stack.sh "$port"
  # The version split (docs/research/test-cost-audit.md): 12 runs the project matrix, 13 runs both projects.
  projects=(--project=matrix)
  [ "$service" = grafana13 ] && projects+=(--project=plugin)
  # wait-stack.sh has run: run-e2e.sh does not run it again. It also keeps the Mac awake and sets the worker count.
  GRAFANA_URL="http://localhost:$port" DMAP_STACK_READY=1 ./scripts/run-e2e.sh "$port" "${projects[@]}"
  docker compose down -v
done
step "ci:local OK"
