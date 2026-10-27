/**
 * The history bench of the snapshot store design (docs/superpowers/specs/2026-10-25-simplify-step3, section 7).
 * It prints ms and KB per pass over a synthetic result of 300 cells with one series of 300 points each. Skipped
 * unless DMAP_BENCH=1. Run it alone, with the GC held:
 *   DMAP_BENCH=1 NODE_OPTIONS="--expose-gc --max-semi-space-size=512" npx vitest run src/query/history.bench.test.ts --maxWorkers=1
 */
import {
  createTheme,
  FieldType,
  getDefaultTimeRange,
  LoadingState,
  type DataFrame,
  type PanelData,
} from '@grafana/data';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BindingPlan } from '../binding/patterns';
import type { NamedQuery, QueryBinding } from '../model/config';
import type { QueryContext, QueryController, QuerySnapshot } from './types';

const CELLS = 300;
const POINTS = 300;
const PASSES = 20;

type Frames = typeof import('./frames');
type Engine = typeof import('../binding/engine');
type Store = typeof import('./store');
type Boundary = typeof import('./boundary');
type Reduce = typeof import('./reduce');

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
const query = (id: string): NamedQuery => ({
  id,
  name: id,
  source: { kind: 'datasource', datasource: { uid: 'prom' }, target: { refId: 'Q' }, parameters: {} },
});
const bindingOf = (i: number, queryId = 'q'): QueryBinding => ({
  queryId,
  match: { cell: cellId(i) },
  reducer: 'last',
});
const timeRange = getDefaultTimeRange();
const context: QueryContext = {
  timeRange,
  timeZone: 'utc',
  scopedVars: {},
  intervalMs: 60_000,
  refreshMs: 0,
  generation: 1,
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

describe.skipIf(!process.env.DMAP_BENCH)('history bench', () => {
  let frames: Frames;
  let engine: Engine;
  let store: Store;
  let boundary: Boundary;
  let reduce: Reduce;
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('./reduce', { spy: true });
    reduce = await import('./reduce');
    frames = await import('./frames');
    engine = await import('../binding/engine');
    store = await import('./store');
    boundary = await import('./boundary');
  });
  afterAll(() => {
    vi.doUnmock('./reduce');
    vi.resetModules();
  });

  it('prints the cost per pass and calls reduceValues once per (match, field, reducer)', () => {
    const result = Array.from({ length: CELLS }, (_, i) => series(i));
    const snapshot: QuerySnapshot = { state: 'ready', frames: result, fetchedAt: 1, fromCache: false };
    const bindings = Array.from({ length: CELLS }, (_, i) => bindingOf(i));
    const format = { theme: createTheme(), timeZone: 'utc' };
    const reduceValues = vi.mocked(reduce.reduceValues);
    reduceValues.mockClear();

    // 1. toHistory for every cell
    passes('toHistory, every cell', () => {
      for (const binding of bindings) {
        frames.historyOf(snapshot, binding, format);
      }
    });
    expect(reduceValues).toHaveBeenCalledTimes(CELLS);

    // 2. the frame scan with the matchers: the index of a result and one selection per cell
    passes('frame scan: index of a fresh array + 300 selections', () => {
      const index = frames.indexFrames([...result]);
      for (const binding of bindings) {
        frames.selectField(index, binding.match, binding.field);
      }
    });
    // 3. the array copies: once per result, at the boundary
    passes('boundary copy of the result', () => {
      boundary.copyFrames(result);
    });

    // 4. historySeries for every cell
    const models = bindings.map((binding) => frames.historyOf(snapshot, binding, format));
    passes('historySeries, every cell', () => {
      models.forEach((model, i) => {
        if (model.state === 'ready') {
          engine.historySeries(model, bindings[i]);
        }
      });
    });

    // 5. 600 resolves over 600 entries of the store (two queries per cell)
    const queries = [query('q'), query('q2')];
    const plan = {
      cells: Object.fromEntries(
        Array.from({ length: CELLS }, (_, i) => {
          // the demands come from the display; a display binding is a binding of the cell (one object)
          const status = bindingOf(i);
          const shape = bindingOf(i, 'q2');
          return [
            cellId(i),
            {
              cellId: cellId(i),
              scope: { cell: { key: cellId(i) } },
              bindings: [status, shape],
              display: {
                status: { kind: 'mapping', binding: status, default: { state: 'normal' }, mappings: [] },
                shape: { binding: shape },
              },
            },
          ];
        })
      ),
      widgets: [],
      diagnostics: [],
      config: { version: 3, queries, patterns: [], overrides: [], widgets: [] },
    } as unknown as BindingPlan;
    // the second query has its own result object over the same frames, as two controller entries have
    const second: QuerySnapshot = { ...snapshot };
    const controller: QueryController = {
      setPanelData: () => {},
      watch: (demand, listener) => {
        listener(demand.query.id === 'q' ? snapshot : second);
        return () => {};
      },
      dispose: () => {},
    };
    const data: PanelData = { state: LoadingState.Done, series: [], timeRange };
    const demands = store.demandsOf(plan, context, 264, 'visible');
    expect(demands).toHaveLength(2 * CELLS);
    const snapshots = store.createSnapshotStore(controller);
    snapshots.want('bench', 'visible', demands);
    const frame = snapshots.frame('bench', 'visible');
    expect(frame.size).toBe(2 * CELLS);
    const resolve = store.resolverFrom([frame], store.demandMap(demands), plan, data, format);
    const pairs = Object.values(plan.cells).flatMap((cell) =>
      cell.bindings.map((binding) => [cell.cellId, binding] as const)
    );
    passes('600 resolves over 600 store entries', () => {
      for (const [id, binding] of pairs) {
        resolve(id, binding);
      }
    });
    // the models of the first row are shared: no reduction ran again for q; q2 has its own 300
    expect(reduceValues).toHaveBeenCalledTimes(2 * CELLS);
    snapshots.dispose();
  });
});
