#!/usr/bin/env bash
# Keep the readiness gate and browser on the same explicitly selected stack.
set -euo pipefail
port=$1
shift

# A sleeping Mac stops the Docker VM and the run hangs. Keep the machine awake for the whole run.
if [ "$(uname)" = Darwin ] && [ -z "${CAFFEINATED:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  CAFFEINATED=1 exec caffeinate -dims "$0" "$port" "$@"
fi

# macOS has no timeout(1). A perl supervisor kills docker after 10 s (Go ignores SIGALRM) and exits 127 if exec fails.
if ! command -v docker >/dev/null 2>&1; then
  echo "run-e2e: docker command not found." >&2
  exit 1
fi
if ! perl -e 'my $p = fork; if (!$p) { exec @ARGV or exit 127 } $SIG{ALRM} = sub { kill 9, $p; exit 124 }; alarm 10; waitpid $p, 0; exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' docker info >/dev/null 2>&1; then
  echo "run-e2e: docker does not answer within 10 s." >&2
  echo "Check for clamshell sleep: pmset -g log | grep -E ' (Sleep|Wake) ' | tail -3" >&2
  echo "Do not restart OrbStack." >&2
  exit 1
fi

# Default to min(4, half of the CPUs) workers, and at least 2. PW_WORKERS or an explicit --workers argument overrides it.
workers=()
has_workers=0
for a in "$@"; do
  case "$a" in --workers | --workers=* | -j) has_workers=1 ;; esac
done
if [ "$has_workers" = 0 ]; then
  default_workers=$(node -p 'Math.max(2, Math.min(4, Math.floor(require("os").cpus().length / 2)))')
  workers=(--workers "${PW_WORKERS:-$default_workers}")
fi

# The port argument selects the stack. An inherited GRAFANA_URL is not used: it could point to another Grafana.
export GRAFANA_URL="http://${STACK_HOST:-localhost}:$port"
# DMAP_STACK_READY=1 means the caller has already run wait-stack.sh on this stack (scripts/ci-local.sh does).
if [ "${DMAP_STACK_READY:-0}" != 1 ]; then
  ./scripts/wait-stack.sh
fi
exec npx playwright test ${workers[@]+"${workers[@]}"} "$@"
