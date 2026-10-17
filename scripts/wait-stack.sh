#!/usr/bin/env bash
# Readiness gate for the e2e tests. Polls until each condition is true, or fails after WAIT_TIMEOUT seconds:
#  1. VictoriaMetrics has the demo series, and rate() over it has a value (the counters have two samples),
#  2. each Grafana answers /api/health with database "ok",
#  3. each Grafana has loaded the plugin.
# Usage: scripts/wait-stack.sh [port ...]   (default: 3012 3013 on STACK_HOST)
# STACK_HOST (default localhost) and VM_PORT (default 8428) select the compose stack.
# CI (.woodpecker/e2e.yaml): VM_URL and GRAFANA_URL give the full URLs, for example http://victoriametrics:8428 and
# http://grafana:3000. GRAFANA_URL is used only when there are no port arguments.
# DEMO_SERIES is the series selector (default: a WAN counter of stack/metrics-gen).
set -euo pipefail
host=${STACK_HOST:-localhost}
vm=${VM_URL:-"http://$host:${VM_PORT:-8428}"}
timeout=${WAIT_TIMEOUT:-180}
plugin=simnv-drawiomap-panel
grafanas=()
if [ $# -gt 0 ]; then
  for port in "$@"; do grafanas+=("http://$host:$port"); done
elif [ -n "${GRAFANA_URL:-}" ]; then
  grafanas=("$GRAFANA_URL")
else
  grafanas=("http://$host:3012" "http://$host:3013")
fi
deadline=$((SECONDS + timeout))
series=${DEMO_SERIES:-'node_network_transmit_bytes_total{job="node-isp-a",device="pppoe"}'}

# wait_until <description> <command...>: runs the command every 2 s until it succeeds or the deadline passes.
wait_until() {
  local what=$1
  shift
  until "$@" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL: timeout after ${timeout}s: $what"
      return 1
    fi
    sleep 2
  done
  echo "ready: $what (${SECONDS}s)"
}

has_series() {
  curl -fsS --get "$vm/api/v1/series" --data-urlencode "match[]=$series" | grep -q '"__name__"'
}
has_rate() {
  curl -fsS --get "$vm/api/v1/query" --data-urlencode "query=rate(${series}[1m])" | grep -q '"value"'
}
grafana_ok() {
  curl -fsS "$1/api/health" | grep -q '"database": *"ok"'
}
plugin_loaded() {
  curl -fsS "$1/api/plugins/$plugin/settings" | grep -q "\"id\":\"$plugin\""
}

wait_until "VictoriaMetrics series $series" has_series
wait_until "VictoriaMetrics rate() of the demo series" has_rate
for url in "${grafanas[@]}"; do
  wait_until "Grafana $url /api/health" grafana_ok "$url"
  wait_until "plugin on Grafana $url" plugin_loaded "$url"
done
