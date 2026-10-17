"""Push synthetic node_exporter-like series to VictoriaMetrics every 5 s.

Stdlib only. Counters grow at a constant rate from process start, so
rate(...[1m]) * 8 is stable: wan1 41 Mb/s (41 % of 100M), wan2 90 Mb/s
(90 % of 100M), br-lan 480 Mb/s (48 % of 1G). lte has no traffic series and up=0.
node_network_speed_bytes gives the port speed of some ports (bytes/s, as node_exporter):
the demo reads the LAN capacity from it.
node_cpu_usage_percent moves slowly around a base value for each host that is up.
"""
import math
import os
import time
import urllib.request

VM = os.environ.get("VM_URL", "http://victoriametrics:8428")

# (job, device, transmit bytes/s, receive bytes/s)
LINKS = [
    ("node-net-dm", "lan", 60_000_000, 12_000_000),
    ("node-rtr-a", "br-lan", 60_000_000, 12_000_000),
    ("node-net-hm", "lan", 2_500_000, 1_000_000),
    ("node-rtr-b", "br-lan", 2_500_000, 1_000_000),
    ("node-wan1", "pppoe", 5_125_000, 1_250_000),
    ("node-rtr-a", "wan1", 1_250_000, 5_125_000),
    ("node-wan2", "dhcp", 11_250_000, 2_000_000),
    ("node-rtr-a", "wan2", 2_000_000, 11_250_000),
    ("node-isp-hm", "pppoe", 3_000_000, 500_000),
    ("node-rtr-b", "pppoe", 500_000, 3_000_000),
    ("node-rtr-a", "ts0", 400_000, 300_000),
    ("node-rtr-b", "ts0", 300_000, 400_000),
    ("node-rtr-a", "tun0", 200_000, 100_000),
    ("node-proxy-a", "in-3088", 100_000, 200_000),
    ("node-rtr-b", "tun0", 150_000, 90_000),
    ("node-proxy-b", "in-3088", 90_000, 150_000),
    ("node-proxy-a", "relay-out", 50_000, 20_000),
    ("node-proxy-b", "in-3089", 20_000, 50_000),
]
# port speed in bytes/s: rtr-a br-lan 1 Gb/s, rtr-b br-lan 100 Mb/s
SPEED = [
    ("node-rtr-a", "br-lan", 125_000_000),
    ("node-rtr-b", "br-lan", 12_500_000),
]
UP = {
    "node-net-dm": 1, "node-net-hm": 1, "node-rtr-a": 1, "node-rtr-b": 1,
    "node-wan1": 1, "node-wan2": 1, "node-lte": 0, "node-isp-hm": 1,
    "node-proxy-a": 1, "node-proxy-b": 1,
}
# base CPU usage in percent; the routers carry the traffic, so they are the busiest
CPU = {
    "node-rtr-a": 42, "node-rtr-b": 23, "node-net-dm": 8, "node-net-hm": 6,
    "node-wan1": 12, "node-wan2": 18, "node-isp-hm": 10,
    "node-proxy-a": 15, "node-proxy-b": 9,
}


def build(elapsed: float) -> bytes:
    lines = []
    for job, dev, tx, rx in LINKS:
        lines.append(f'node_network_transmit_bytes_total{{job="{job}",device="{dev}"}} {int(tx * elapsed)}')
        lines.append(f'node_network_receive_bytes_total{{job="{job}",device="{dev}"}} {int(rx * elapsed)}')
    for job, dev, speed in SPEED:
        lines.append(f'node_network_speed_bytes{{job="{job}",device="{dev}"}} {speed}')
    for i, (job, up) in enumerate(UP.items()):
        lines.append(f'up{{job="{job}"}} {up}')
        load = 1.0 + 0.8 * math.sin(elapsed / 60.0 + i)
        lines.append(f'node_load1{{job="{job}"}} {load:.3f}')
    for i, (job, base) in enumerate(CPU.items()):
        cpu = base * (1.0 + 0.35 * math.sin(elapsed / 45.0 + i)) + 4.0 * math.sin(elapsed / 7.0 + 2 * i)
        lines.append(f'node_cpu_usage_percent{{job="{job}"}} {min(100.0, max(0.0, cpu)):.2f}')
    return ("\n".join(lines) + "\n").encode()


def main() -> None:
    t0 = time.time()
    while True:
        body = build(time.time() - t0)
        req = urllib.request.Request(f"{VM}/api/v1/import/prometheus", data=body, method="POST")
        try:
            urllib.request.urlopen(req, timeout=5).read()
        except Exception as exc:  # noqa: BLE001
            print(f"push failed: {exc}", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    main()
