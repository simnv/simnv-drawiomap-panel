#!/usr/bin/env bash
# Checks that the compose stack answers and that the synthetic series have the expected rate.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/wait-stack.sh 3012 3013
q='rate(node_network_transmit_bytes_total{job="node-isp-a",device="pppoe"}[1m])*8'
val=$(curl -fsS --get http://localhost:8428/api/v1/query --data-urlencode "query=$q" | sed -E 's/.*"value":\[[0-9.]+,"([0-9.e+]+)"\].*/\1/')
echo "WAN link tx bit/s: $val"
awk -v v="$val" 'BEGIN { if (v < 40e6 || v > 42e6) { print "FAIL: expected ~41e6"; exit 1 } print "OK" }'
