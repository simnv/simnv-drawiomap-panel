#!/usr/bin/env bash
# Keep the readiness gate and browser on the same explicitly selected stack.
set -euo pipefail
port=$1
shift

# A sleeping Mac stops the Docker VM and the run hangs. Keep the machine awake for the whole run.
if [ "$(uname)" = Darwin ] && [ -z "${CAFFEINATED:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  CAFFEINATED=1 exec caffeinate -dims "$0" "$port" "$@"
fi

# macOS has no timeout(1); perl alarm gives a 10 s limit.
if ! perl -e 'alarm 10; exec @ARGV' docker info >/dev/null 2>&1; then
  echo "run-e2e: docker does not answer within 10 s." >&2
  echo "Check for clamshell sleep: pmset -g log | grep -E ' (Sleep|Wake) ' | tail -3" >&2
  echo "Do not restart OrbStack." >&2
  exit 1
fi

# Default to 2 workers. PW_WORKERS or an explicit --workers argument overrides it.
workers=()
has_workers=0
for a in "$@"; do
  case "$a" in --workers | --workers=* | -j) has_workers=1 ;; esac
done
if [ "$has_workers" = 0 ]; then
  workers=(--workers "${PW_WORKERS:-2}")
fi

export GRAFANA_URL=${GRAFANA_URL:-http://localhost:$port}
./scripts/wait-stack.sh
exec npx playwright test ${workers[@]+"${workers[@]}"} "$@"
