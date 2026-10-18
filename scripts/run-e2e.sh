#!/usr/bin/env bash
# Keep the readiness gate and browser on the same explicitly selected stack.
set -euo pipefail
port=$1
shift
export GRAFANA_URL=${GRAFANA_URL:-http://localhost:$port}
./scripts/wait-stack.sh
exec npx playwright test "$@"
