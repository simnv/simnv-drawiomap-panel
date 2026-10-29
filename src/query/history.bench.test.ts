/**
 * The series bench of the v4 snapshot read. It prints ms and KB per pass over a synthetic result of 300 cells with
 * one series of 300 points each. Skipped unless DMAP_BENCH=1. Run it alone, with the GC held:
 *   DMAP_BENCH=1 NODE_OPTIONS="--expose-gc --max-semi-space-size=512" npx vitest run src/query/history.bench.test.ts --maxWorkers=1
 */
import { FieldType, type DataFrame } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { directionHistory } from '../binding/rowData';
import { copyFrames } from './boundary';
import { indexFrames } from './frames';
import { indexSeries } from './seriesIndex';
import type { QuerySnapshot } from './snapshot';

const CELLS = 300;
const POINTS = 300;
const PASSES = 20;

const cellId = (i: number) => `c${i}`;
const series = (i: number): DataFrame => {
  const timestamps = Array.from({ length: POINTS }, (_, p) => 1_700_000_000_000 + p * 60_000);
  const values = Array.from({ length: POINTS }, (_, p) => (p % 7 === 3 ? null : (i * 31 + p * 7) % 100));
  return {
    refId: 'Q',
    name: `series ${i}`,
    length: POINTS,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: timestamps },
      { name: 'Value', type: FieldType.number, config: { unit: 'percent' }, values, labels: { cell: cellId(i) } },
    ],
  };
};

const gc = () => (globalThis as { gc?: () => void }).gc?.();
/** One measured pass: the time and the heap growth of `run`. */
function measure(run: () => void): { ms: number; kb: number } {
  gc();
  const heap = process.memoryUsage().heapUsed;
  const start = performance.now();
  run();
  const ms = performance.now() - start;
  return { ms, kb: (process.memoryUsage().heapUsed - heap) / 1024 };
}
/** `PASSES` passes: the first one alone (it fills the caches), then the mean of the rest. */
function passes(name: string, run: () => void) {
  const first = measure(run);
  const rest = Array.from({ length: PASSES - 1 }, () => measure(run));
  const mean = (pick: (m: { ms: number; kb: number }) => number) =>
    rest.reduce((sum, m) => sum + pick(m), 0) / rest.length;
  const fmt = (m: { ms: number; kb: number }) => `${m.ms.toFixed(2)} ms, ${m.kb.toFixed(0)} KB`;
  console.log(`${name.padEnd(52)} first ${fmt(first)}; then ${fmt({ ms: mean((m) => m.ms), kb: mean((m) => m.kb) })}`);
}

describe.skipIf(!process.env.DMAP_BENCH)('series bench', () => {
  it('prints the cost per pass of the series index, the boundary copy and the history of a direction', () => {
    const result = Array.from({ length: CELLS }, (_, i) => series(i));

    // 1. the checks of every field, once per result (a fresh array has no cached index)
    passes('frame index of a fresh array', () => {
      indexFrames([...result]);
    });
    // 2. the series of a refId: the index, the merge of the samples and the order
    passes('series index of a fresh array', () => {
      expect(indexSeries([...result], 'Q').series).toHaveLength(CELLS);
    });
    // 3. the array copies: once per result, at the boundary
    passes('boundary copy of the result', () => {
      copyFrames(result);
    });
    // 4. the history of a direction for every cell: one series each
    const snapshot: QuerySnapshot = { state: 'ready', frames: result, fetchedAt: 1, fromCache: false };
    const { series: all, report } = indexSeries(result, 'Q');
    expect(report).toEqual([]);
    passes('history of a direction, every cell', () => {
      for (const one of all) {
        expect(directionHistory({ snapshot, series: [one] }).state).toBe('ready');
      }
    });
  });
});
