#!/usr/bin/env bash
# Checks that the compose stack answers and that the synthetic series exist.
set -euo pipefail
wait_for() { for _ in $(seq 1 60); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 2; done; echo "timeout: $1"; return 1; }
wait_for http://localhost:3012/api/health
wait_for http://localhost:3013/api/health
wait_for http://localhost:8428/health
wait_for http://localhost:8080/
sleep 15
q='rate(node_network_transmit_bytes_total{job="node-wan1",device="pppoe"}[1m])*8'
val=$(curl -fsS --get http://localhost:8428/api/v1/query --data-urlencode "query=$q" | sed -E 's/.*"value":\[[0-9.]+,"([0-9.e+]+)"\].*/\1/')
echo "wan1 tx bit/s: $val"
awk -v v="$val" 'BEGIN { if (v < 40e6 || v > 42e6) { print "FAIL: expected ~41e6"; exit 1 } print "OK" }'
for p in 3012 3013; do
  curl -fsS "http://localhost:$p/api/plugins/simnv-drawiomap-panel/settings" | grep -q '"id":"simnv-drawiomap-panel"' && echo "plugin loaded on :$p"
done
