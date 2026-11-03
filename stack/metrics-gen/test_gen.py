"""Checks of the seed logic of gen.py against fake VictoriaMetrics answers. No docker, stdlib only.

Run: python3 stack/metrics-gen/test_gen.py
"""
import importlib.util
import json
import os
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("gen", os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

NOW = 1_800_000_000.0
RATE = 60_000_000


def export(first_ms: int, last_ms: int, t0: float) -> str:
    """An /api/v1/export answer for samples every 5 s of a counter that started at t0 (as the old process wrote)."""
    ts = list(range(first_ms, last_ms + 1, 5000))
    return json.dumps({"metric": {}, "values": [int(RATE * (t / 1000 - t0)) for t in ts], "timestamps": ts})


class SeedPlan(unittest.TestCase):
    def test_new_stack_fills_the_window(self):
        t0, seed_ms = gen.plan(NOW, [], [])
        self.assertEqual(len(seed_ms), gen.SEED_SAMPLES)
        self.assertEqual(seed_ms[0], int(NOW * 1000) - 900_000)
        self.assertEqual(seed_ms[-1], int(NOW * 1000) - 5000)
        self.assertEqual(t0, NOW - 900)

    def test_restart_after_a_pause_adds_no_sample_over_retained_history(self):
        # The old process ran from 30 min ago to 130 s ago; the new one starts now.
        old_t0 = NOW - 1800
        history = gen.read_history(export(int((NOW - 1800) * 1000), int((NOW - 130) * 1000), old_t0))
        t0, seed_ms = gen.plan(NOW, *history)
        # The whole window had retained samples: only the last 130 s are missing and the live push fills them.
        self.assertEqual(seed_ms, [])
        self.assertAlmostEqual(t0, old_t0, places=3)
        # The next live value goes on from the last retained value: no reset, no spike.
        last_value = history[1][-1]
        next_value = int(RATE * (NOW - t0))
        self.assertGreaterEqual(next_value, last_value)
        self.assertAlmostEqual((next_value - last_value) / 130, RATE, delta=RATE * 0.001)

    def test_restart_with_short_history_seeds_only_before_the_oldest_sample(self):
        # The old process started 4 min ago and ran until 100 s ago.
        old_t0 = NOW - 240
        history = gen.read_history(export(int((NOW - 240) * 1000), int((NOW - 100) * 1000), old_t0))
        t0, seed_ms = gen.plan(NOW, *history)
        # The counter is 0 at old_t0: there is nothing to seed before it.
        self.assertEqual(seed_ms, [])
        self.assertAlmostEqual(t0, old_t0, places=3)

    def test_restart_with_history_that_starts_late_backfills_with_continuous_counters(self):
        # Samples of the last 3 min only (for example the retention of a test); the counter origin is 20 min ago.
        old_t0 = NOW - 1200
        history = gen.read_history(export(int((NOW - 180) * 1000), int((NOW - 100) * 1000), old_t0))
        t0, seed_ms = gen.plan(NOW, *history)
        oldest = history[0][0]
        self.assertTrue(seed_ms)
        self.assertTrue(all(ts < oldest for ts in seed_ms))
        self.assertGreaterEqual(min(seed_ms), int((NOW - 900) * 1000))
        # Seeded counters lie on the same line as the retained ones: they grow with time and match the rate.
        values = [int(RATE * (ts / 1000 - t0)) for ts in seed_ms]
        self.assertEqual(values, sorted(values))
        self.assertLess(values[-1], history[1][0])
        for a, b in zip(values, values[1:]):
            self.assertAlmostEqual((b - a) / 5, RATE, delta=RATE * 0.001)

    def test_no_seeded_counter_is_negative(self):
        for now in (NOW, NOW + 0.0007, NOW + 0.9993):
            t0, seed_ms = gen.plan(now, [], [])
            self.assertGreaterEqual(min(seed_ms[0] / 1000 - t0, 0), 0)

    def test_seed_body_has_explicit_timestamps(self):
        t0, seed_ms = gen.plan(NOW, [], [])
        body = gen.build(seed_ms[0] / 1000 - t0, seed_ms[0]).decode().splitlines()
        self.assertTrue(all(line.endswith(f" {seed_ms[0]}") for line in body))


class History(unittest.TestCase):
    def test_read_history_merges_and_sorts_series(self):
        text = "\n".join(
            [
                json.dumps({"metric": {}, "values": [3, 4], "timestamps": [3000, 4000]}),
                json.dumps({"metric": {}, "values": [1, 2], "timestamps": [1000, 2000]}),
                "",
            ]
        )
        self.assertEqual(gen.read_history(text), ([1000, 2000, 3000, 4000], [1.0, 2.0, 3.0, 4.0]))

    def test_empty_answer_is_a_new_stack(self):
        self.assertEqual(gen.read_history(""), ([], []))


if __name__ == "__main__":
    unittest.main()
