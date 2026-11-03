"""Checks of the seed logic of gen.py against a fake VictoriaMetrics. No docker, stdlib only.

Run: python3 stack/metrics-gen/test_gen.py
"""
import importlib.util
import contextlib
import io
import json
import os
import re
import sys
import unittest
import urllib.parse
from unittest import mock

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("gen", os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

NOW = 1_800_000_000.123  # a time with a fraction of a second


class FakeVM:
    """Answers the series query and records the pushes. `series` is the data of the answer; `error` is raised."""

    def __init__(self, series=None, error=None, body=None):
        self.series = series or []
        self.error = error
        self.body = body
        self.urls: list[str] = []
        self.pushed: list[bytes] = []

    def urlopen(self, url, timeout=None):
        self.urls.append(url)
        if self.error:
            raise self.error
        answer = self.body if self.body is not None else {"status": "success", "data": self.series}
        return io.BytesIO(json.dumps(answer).encode())

    def push(self, body):
        self.pushed.append(body)


def origin(vm: FakeVM) -> float:
    with mock.patch.object(gen.urllib.request, "urlopen", vm.urlopen), mock.patch.object(gen, "push", vm.push), \
            mock.patch.object(gen.time, "sleep"), mock.patch.object(gen.time, "time", return_value=NOW), \
            contextlib.redirect_stdout(io.StringIO()):
        return gen.start_origin()


def samples(body: bytes):
    """(metric, ts_ms, value) of each line of an import body."""
    out = []
    for line in body.decode().splitlines():
        m = re.match(r"(.+) ([-\d.]+) (\d+)$", line)
        out.append((m.group(1), int(m.group(3)), float(m.group(2))))
    return out


class Seed(unittest.TestCase):
    def test_empty_vm_is_seeded(self):
        vm = FakeVM(series=[])
        t0 = origin(vm)
        self.assertEqual(len(vm.pushed), 1)
        stamps = sorted({ts for _, ts, _ in samples(vm.pushed[0])})
        self.assertEqual(len(stamps), gen.SEED_SAMPLES)
        self.assertEqual(t0, int(NOW * 1000) / 1000 - gen.SEED_SAMPLES * gen.SEED_STEP)

    def test_the_check_asks_for_every_metric_name(self):
        vm = FakeVM(series=[])
        origin(vm)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(vm.urls[0]).query)
        self.assertEqual(sorted(query["match[]"]), gen.metric_names())
        self.assertIn("node_network_transmit_bytes_total", query["match[]"])
        self.assertIn("dmap_v4_gauge", query["match[]"])

    def test_any_data_is_not_seeded(self):
        for series in ([{"__name__": "up", "job": "node-lte"}], [{"__name__": "dmap_v4_gauge"}]):
            vm = FakeVM(series=series)
            t0 = origin(vm)
            self.assertEqual(vm.pushed, [])
            self.assertEqual(t0, NOW)

    def test_a_failed_check_is_not_seeded(self):
        failures = [
            FakeVM(error=TimeoutError("timed out")),
            FakeVM(error=OSError("connection refused")),
            FakeVM(body={"status": "error", "error": "boom"}),
            FakeVM(body={"unexpected": True}),
        ]
        for vm in failures:
            t0 = origin(vm)
            self.assertEqual(vm.pushed, [])
            self.assertEqual(t0, NOW)

    def test_a_failed_seed_starts_at_now(self):
        vm = FakeVM(series=[])
        with mock.patch.object(gen.urllib.request, "urlopen", vm.urlopen), \
                mock.patch.object(gen, "push", side_effect=OSError("down")), mock.patch.object(gen.time, "time", return_value=NOW), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(gen.start_origin(), NOW)

    def test_seed_goes_on_in_the_first_live_sample(self):
        vm = FakeVM(series=[])
        t0 = origin(vm)
        seeded = samples(vm.pushed[0])
        live_time = NOW + 0.4  # the first live push comes right after the seed
        live_ms = int(live_time * 1000)
        live = {m: v for m, _, v in samples(gen.build(live_time - t0, live_ms))}
        last_seed_ts = max(ts for _, ts, _ in seeded)
        self.assertLess(last_seed_ts, live_ms)
        self.assertEqual(last_seed_ts, int(NOW * 1000) - gen.SEED_STEP * 1000)
        last_seed = {m: v for m, ts, v in seeded if ts == last_seed_ts}
        self.assertEqual(set(last_seed), set(live))  # every series
        gap = (live_ms - last_seed_ts) / 1000  # about 5.4 s between the last seed and the live sample
        for job, dev, tx, _rx in gen.LINKS:
            metric = f'node_network_transmit_bytes_total{{job="{job}",device="{dev}"}}'
            self.assertGreater(live[metric], last_seed[metric], metric)
            self.assertAlmostEqual(live[metric] - last_seed[metric], tx * gap, delta=tx * 0.01)

    def test_counters_grow_with_the_same_rate_through_the_seed(self):
        vm = FakeVM(series=[])
        t0 = origin(vm)
        by_metric: dict[str, list[float]] = {}
        for metric, ts, value in sorted(samples(vm.pushed[0]), key=lambda x: x[1]):
            by_metric.setdefault(metric, []).append(value)
        for job, dev, tx, _rx in gen.LINKS:
            values = by_metric[f'node_network_transmit_bytes_total{{job="{job}",device="{dev}"}}']
            steps = [b - a for a, b in zip(values, values[1:])]
            self.assertTrue(all(abs(step - tx * gen.SEED_STEP) <= 1 for step in steps), (job, dev))

    def test_no_counter_is_negative(self):
        for now in (NOW, 1_800_000_000.0, 1_800_000_000.9993, 1_800_000_000.0007):
            vm = FakeVM(series=[])
            with mock.patch.object(gen.urllib.request, "urlopen", vm.urlopen), mock.patch.object(gen, "push", vm.push), \
                    mock.patch.object(gen.time, "time", return_value=now):
                t0 = gen.start_origin()
            for metric, _, value in samples(vm.pushed[0]):
                if "_bytes_total" in metric:
                    self.assertGreaterEqual(value, 0, metric)
            first_live = samples(gen.build(now + 0.1 - t0, 0))
            self.assertTrue(all(v >= 0 for m, _, v in first_live if "_bytes_total" in m))

    def test_v4_set_checks_only_its_own_names(self):
        with mock.patch.dict(os.environ, {"GEN_SET": "v4"}):
            names = gen.metric_names()
        self.assertEqual(names, ["dmap_v4_gauge", "dmap_v4_nine", "dmap_v4_three"])


if __name__ == "__main__":
    unittest.main()
