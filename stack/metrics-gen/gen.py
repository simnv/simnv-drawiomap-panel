"""Push synthetic node_exporter-like series to VictoriaMetrics every 5 s.

Stdlib only. Counters grow at a constant rate from process start, so
rate(...[1m]) * 8 is stable: isp-a (wan1) 41 Mb/s (41 % of 100M), radio (wan2) 90 Mb/s
(90 % of 100M), br-lan 480 Mb/s (48 % of 1G). lte has no traffic series and up=0.
node_network_speed_bytes gives the port speed of some ports (bytes/s, as node_exporter):
the demo reads the LAN capacity from it.
node_cpu_usage_percent moves slowly around a base value for each host that is up.
On a new stack, gen.py first writes SEED_SAMPLES backdated samples (SEED_STEP s apart, the last one 5 s old), so
rate(...[1m]) has a value at once, and the charts have the history of the default range of the demo dashboard (15 min):
a crosshair snaps to the nearest sample, and with a short history the samples are too far apart for the tests.
The seed is only for a new stack: VictoriaMetrics has no sample of any metric of this process. The counters go on from
the seed: they do not start again at zero. In every other case (data exists, the check fails) there is no seed and the
counters start at zero, as on every restart: rate() handles the counter reset.
The v4 metrics use separate names. GEN_SET=v4 writes only those metrics. dmap_v4_three has no min or max
in the demo: its shared Y range comes from the values of the three lines.
"""
import json
import math
import os
import time
import urllib.parse
import urllib.request

VM = os.environ.get("VM_URL", "http://victoriametrics:8428")
SEED_SAMPLES = 180  # 15 min
SEED_STEP = 5

# (job, device, transmit bytes/s, receive bytes/s)
LINKS = [
    ("node-net-a", "lan", 60_000_000, 12_000_000),
    ("node-rtr-a", "br-lan", 60_000_000, 12_000_000),
    ("node-net-b", "lan", 2_500_000, 1_000_000),
    ("node-rtr-b", "br-lan", 2_500_000, 1_000_000),
    ("node-isp-a", "pppoe", 5_125_000, 1_250_000),
    ("node-rtr-a", "wan1", 1_250_000, 5_125_000),
    ("node-radio", "dhcp", 11_250_000, 2_000_000),
    ("node-rtr-a", "wan2", 2_000_000, 11_250_000),
    ("node-isp-b", "pppoe", 3_000_000, 500_000),
    ("node-rtr-b", "pppoe", 500_000, 3_000_000),
    ("node-rtr-a", "ts0", 400_000, 300_000),
    ("node-rtr-b", "ts0", 300_000, 400_000),
    ("node-rtr-a", "tun0", 200_000, 100_000),
    ("node-proxy-a", "tun-in", 100_000, 200_000),
    ("node-rtr-b", "tun0", 150_000, 90_000),
    ("node-proxy-b", "tun-in", 90_000, 150_000),
    ("node-proxy-a", "relay-out", 50_000, 20_000),
    ("node-proxy-b", "relay-in", 20_000, 50_000),
]
# port speed in bytes/s: rtr-a br-lan 1 Gb/s, rtr-b br-lan 100 Mb/s
SPEED = [
    ("node-rtr-a", "br-lan", 125_000_000),
    ("node-rtr-b", "br-lan", 12_500_000),
]
UP = {
    "node-net-a": 1, "node-net-b": 1, "node-rtr-a": 1, "node-rtr-b": 1,
    "node-isp-a": 1, "node-radio": 1, "node-lte": 0, "node-isp-b": 1,
    "node-proxy-a": 1, "node-proxy-b": 1,
}
# base CPU usage in percent; the routers carry the traffic, so they are the busiest
CPU = {
    "node-rtr-a": 42, "node-rtr-b": 23, "node-net-a": 8, "node-net-b": 6,
    "node-isp-a": 12, "node-radio": 18, "node-isp-b": 10,
    "node-proxy-a": 15, "node-proxy-b": 9,
}


def build(elapsed: float, ts_ms: int | None = None) -> bytes:
    """The lines for one sample. Without ts_ms, VictoriaMetrics uses the time of the request."""
    # Each nine line steps by one every 5 s, with a phase for each line: the tooltip test reads two times
    # that differ and can tell values of one sample from values of another.
    tick = int(elapsed // 5)
    lines = [
        f'dmap_v4_nine{{job="node-rtr-a",line="line-{i}"}} {(i + 1) * 10 + (tick + i) % 5}'
        for i in range(9)
    ]
    for job in ("node-rtr-a", "node-net-b"):
        for i in range(3):
            value = 20 * (i + 1) + 5 * math.sin(elapsed / 15 + i)
            lines.append(f'dmap_v4_three{{job="{job}",line="line-{i}"}} {value:.2f}')
    lines.append('dmap_v4_gauge{job="node-proxy-a"} 42')
    if os.environ.get("GEN_SET") != "v4":
        lines += full_set(elapsed)
    suffix = "" if ts_ms is None else f" {ts_ms}"
    return "".join(f"{line}{suffix}\n" for line in lines).encode()


def full_set(elapsed: float) -> list[str]:
    lines: list[str] = []
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
    return lines


def push(body: bytes) -> None:
    req = urllib.request.Request(f"{VM}/api/v1/import/prometheus", data=body, method="POST")
    urllib.request.urlopen(req, timeout=5).read()


def metric_names() -> list[str]:
    """The names of all the metrics that build() writes."""
    return sorted({line.split("{", 1)[0] for line in build(0).decode().splitlines()})


def vm_has_data() -> bool:
    """True when VictoriaMetrics has a sample of any metric that this process writes, in the retention period."""
    query = [("match[]", name) for name in metric_names()]
    query += [("start", str(int(time.time()) - 3 * 86400)), ("end", str(int(time.time()) + 3600))]
    url = f"{VM}/api/v1/series?{urllib.parse.urlencode(query)}"
    with urllib.request.urlopen(url, timeout=5) as response:
        body = json.load(response)
    if body.get("status") != "success":
        raise RuntimeError(f"series query failed: {body}")
    return bool(body["data"])


def seed(now_ms: int) -> None:
    """Writes SEED_SAMPLES samples, SEED_STEP s apart, the last one SEED_STEP s before now_ms.

    The origin of the live samples is SEED_SAMPLES * SEED_STEP s before now_ms: sample k has elapsed time
    k * SEED_STEP, so the first live sample (elapsed time about SEED_SAMPLES * SEED_STEP) goes on from the last seed.
    """
    body = b""
    for k in range(SEED_SAMPLES):
        body += build(k * SEED_STEP, now_ms - (SEED_SAMPLES - k) * SEED_STEP * 1000)
    push(body)


def start_origin() -> float:
    """The time at which the counters are 0. A new stack gets a seed and an origin in the past. In every other case the
    origin is now (counters start again at 0; rate() handles the reset): when VictoriaMetrics has data, when the
    check fails, and when the seed fails."""
    # VictoriaMetrics can start after this process: ask for up to 30 s, then do not seed.
    for _ in range(60):
        try:
            has_data = vm_has_data()
            break
        except Exception as exc:  # noqa: BLE001
            print(f"seed check failed: {exc}", flush=True)
            time.sleep(0.5)
    else:
        return time.time()
    if has_data:
        return time.time()
    now_ms = int(time.time() * 1000)
    try:
        seed(now_ms)
    except Exception as exc:  # noqa: BLE001
        print(f"seed failed: {exc}", flush=True)
        return time.time()
    return now_ms / 1000 - SEED_SAMPLES * SEED_STEP


def main() -> None:
    t0 = start_origin()
    while True:
        try:
            push(build(time.time() - t0))
        except Exception as exc:  # noqa: BLE001
            print(f"push failed: {exc}", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    main()
