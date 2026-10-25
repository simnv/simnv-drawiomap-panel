import { act, renderHook } from '@testing-library/react';
import { FieldType, getDefaultTimeRange, type DataFrame } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { useBindingSnapshots } from './useBindingSnapshots';
import { createQueryController } from '../query/controller';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfig, NamedQuery, QueryBinding } from '../model/config';
import type { QueryContext, QueryExecutor } from '../query/types';
import { preparedSnapshot, type QueryPreview } from '../editor/preview';

const query = (expr = 'up'): NamedQuery => ({
  id: 'health',
  name: 'Health',
  source: {
    kind: 'datasource',
    datasource: { uid: 'prom' },
    target: Object.assign({ refId: 'H' }, { expr }),
    parameters: {},
  },
});
const binding: QueryBinding = { queryId: 'health', match: {}, reducer: 'last' };
const config = (expr?: string) =>
  ({ version: 3, queries: [query(expr)], patterns: [], overrides: [], widgets: [] }) as DiagramConfig;
const plan: BindingPlan = {
  cells: {
    router: {
      cellId: 'router',
      scope: { cell: { key: 'router' } },
      bindings: [binding],
      display: {
        status: { kind: 'mapping', binding, default: { state: 'normal', reason: 'Healthy' }, mappings: [] },
      },
    },
  },
  widgets: [],
  diagnostics: [],
} as unknown as BindingPlan;
const range = getDefaultTimeRange();
const contexts = new Map<number, QueryContext>();
// One stable context object per generation, as PanelQueryProvider makes.
const context = (generation: number): QueryContext => {
  if (!contexts.has(generation)) {
    contexts.set(generation, {
      timeRange: range,
      timeZone: 'utc',
      scopedVars: {},
      refreshMs: 0,
      intervalMs: 1000,
      generation,
      ...(generation === 3 ? { defaultDatasource: { uid: 'other' } } : {}),
    });
  }
  return contexts.get(generation)!;
};
const frame = (value: number): DataFrame => ({
  refId: 'H',
  length: 1,
  fields: [{ name: 'Value', type: FieldType.number, config: {}, values: [value] }],
});

function setup() {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute);
  const renders: string[][] = [];
  const hook = renderHook(
    ({ generation, expr, prepared }: { generation: number; expr?: string; prepared?: QueryPreview[] }) => {
      const previews = useBindingSnapshots(
        plan,
        config(expr),
        { controller, context: context(generation) },
        undefined,
        100,
        prepared,
        'test'
      );
      renders.push(previews.map((p) => p.snapshot.state));
      return previews;
    },
    { initialProps: { generation: 1 } as { generation: number; expr?: string; prepared?: QueryPreview[] } }
  );
  const emit = (call: number, value: number) =>
    act(() => execute.mock.calls[call][1]({ state: 'ready', frames: [frame(value)], fetchedAt: 0, fromCache: false }));
  const fail = (call: number) =>
    act(() => execute.mock.calls[call][1]({ state: 'error', message: 'Datasource query failed.' }));
  return { execute, hook, emit, fail, renders };
}

describe('useBindingSnapshots keeps the last result during a refresh', () => {
  it('shows loading on the first load', () => {
    const { hook } = setup();
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['loading']);
  });

  it('keeps the previous result for the next generation until the new result arrives', () => {
    const { execute, hook, emit, renders } = setup();
    emit(0, 1);
    renders.length = 0;
    hook.rerender({ generation: 2 });
    expect(renders.flat().filter((state) => state !== 'ready')).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0].context.generation).toBe(2);
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', fromCache: true });
    emit(1, 2);
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', fromCache: false, frames: [frame(2)] });
  });

  it('keeps the previous error for the next generation until the new result arrives', () => {
    const { hook, emit, fail } = setup();
    fail(0);
    hook.rerender({ generation: 2 });
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['error']);
    emit(1, 2);
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['ready']);
  });

  it('does not show the result of a changed query', () => {
    const { hook, emit } = setup();
    emit(0, 1);
    hook.rerender({ generation: 1, expr: 'down' });
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['loading']);
  });

  it('keeps the last chart result that the binding reused, while its own query loads', () => {
    const { execute, hook } = setup();
    const chart: QueryPreview = {
      query: query(),
      cellId: 'chart',
      context: context(1),
      snapshot: { state: 'ready', frames: [frame(1)], fetchedAt: 0, fromCache: false },
    };
    hook.rerender({ generation: 1, prepared: [chart] });
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', fromCache: false });
    // The chart refreshes: its kept result has the previous context, so the binding runs its own query.
    hook.rerender({ generation: 2, prepared: [chart] });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(hook.result.current[0].context.generation).toBe(2);
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', fromCache: true });
  });

  it('marks the kept result, so that a preview does not reuse it as a result of the new context', () => {
    const { hook, emit } = setup();
    emit(0, 1);
    hook.rerender({ generation: 2 });
    const [kept] = hook.result.current;
    expect(kept.kept).toBe(true);
    expect(preparedSnapshot(query(), config(), 'router', undefined, [kept], 2)).toEqual({ state: 'idle' });
  });

  it('does not keep the result of another default datasource', () => {
    const { hook, emit } = setup();
    emit(0, 1);
    hook.rerender({ generation: 3 });
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['loading']);
  });
});

describe('useBindingSnapshots consumer owners', () => {
  const owned = (owner: string, service: Parameters<typeof useBindingSnapshots>[2]) =>
    renderHook(() => useBindingSnapshots(plan, config(), service, undefined, 100, undefined, owner));
  const consumerIds = (watch: { mock: { calls: unknown[][] } }) =>
    watch.mock.calls.map(([demand]) => (demand as { consumerId: string }).consumerId);

  it('prefixes every consumer id with the owner', () => {
    const watch = vi.fn(() => () => {});
    const service = { controller: { watch, setPanelData: vi.fn() }, context: context(1) };
    owned('panel:1', service as never);
    expect(consumerIds(watch)).toEqual([expect.stringMatching(/^panel:1:binding:/)]);
  });

  it('keeps the watches of two owners on one controller and releases only its own', () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const service = { controller: createQueryController(execute), context: context(1) };
    const panel = owned('panel:1', service);
    const popup = owned('popup:1', service);
    const emit = (call: number, value: number) =>
      act(() =>
        execute.mock.calls[call][1]({ state: 'ready', frames: [frame(value)], fetchedAt: 0, fromCache: false })
      );
    // Equal requests share one executor call: the second owner joins the first entry.
    expect(execute).toHaveBeenCalledTimes(1);
    emit(0, 5);
    expect(panel.result.current.map((p) => p.snapshot.state)).toEqual(['ready']);
    expect(popup.result.current.map((p) => p.snapshot.state)).toEqual(['ready']);
    popup.unmount();
    // The panel still holds its watch: a later result still reaches it.
    emit(0, 6);
    expect(panel.result.current[0].snapshot).toMatchObject({ state: 'ready', frames: [frame(6)] });
    // A new popup joins the cached entry and fills at once, without a new executor call.
    const again = owned('popup:1', service);
    expect(again.result.current.map((p) => p.snapshot.state)).toEqual(['ready']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not let a second owner with the same ids take the watch of the first', () => {
    const release = vi.fn();
    const watch = vi.fn(() => release);
    const service = { controller: { watch, setPanelData: vi.fn() }, context: context(1) };
    owned('panel:1', service as never);
    owned('popup:1', service as never);
    expect(new Set(consumerIds(watch)).size).toBe(2);
    expect(release).not.toHaveBeenCalled();
  });
});

describe('useBindingSnapshots while paused', () => {
  function pausedSetup() {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    const hook = renderHook(
      ({ generation, expr, paused }: { generation: number; expr?: string; paused: boolean }) =>
        useBindingSnapshots(
          plan,
          config(expr),
          { controller, context: context(generation) },
          undefined,
          100,
          undefined,
          'test',
          paused
        ),
      { initialProps: { generation: 1, paused: false } as { generation: number; expr?: string; paused: boolean } }
    );
    const emit = (call: number, value: number) =>
      act(() =>
        execute.mock.calls[call][1]({ state: 'ready', frames: [frame(value)], fetchedAt: 0, fromCache: false })
      );
    return { execute, hook, emit };
  }

  it('does not show a controller emission while paused, and shows it after the pause', () => {
    const { hook, emit } = pausedSetup();
    emit(0, 1);
    const live = hook.result.current;
    hook.rerender({ generation: 1, paused: true });
    emit(0, 2);
    expect(hook.result.current).toBe(live);
    expect(hook.result.current[0].snapshot).toMatchObject({ frames: [frame(1)] });
    hook.rerender({ generation: 1, paused: false });
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', frames: [frame(2)] });
  });

  it('drops a result whose query changed during the pause when the pause ends', () => {
    const { hook, emit } = pausedSetup();
    emit(0, 1);
    hook.rerender({ generation: 1, paused: true });
    hook.rerender({ generation: 1, expr: 'down', paused: true });
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', frames: [frame(1)] });
    hook.rerender({ generation: 1, expr: 'down', paused: false });
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['loading']);
  });

  it('renders nothing for an emission while paused and applies the latest one at the resume', () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    let renders = 0;
    const hook = renderHook(
      ({ paused }: { paused: boolean }) => {
        renders++;
        return useBindingSnapshots(
          plan,
          config(),
          { controller, context: context(1) },
          undefined,
          100,
          undefined,
          'test',
          paused
        );
      },
      { initialProps: { paused: false } }
    );
    const emit = (value: number) =>
      act(() => execute.mock.calls[0][1]({ state: 'ready', frames: [frame(value)], fetchedAt: 0, fromCache: false }));
    emit(1);
    hook.rerender({ paused: true });
    const paused = renders;
    emit(2);
    emit(3);
    expect(renders).toBe(paused);
    hook.rerender({ paused: false });
    // The rerender and one update for the buffered emissions; the result is the latest one.
    expect(renders - paused).toBeLessThanOrEqual(2);
    expect(hook.result.current[0].snapshot).toMatchObject({ frames: [frame(3)] });
  });

  it('drops a buffered emission of a consumer that was released before the resume', () => {
    const { hook, emit } = pausedSetup();
    emit(0, 1);
    hook.rerender({ generation: 1, paused: true });
    emit(0, 2);
    hook.rerender({ generation: 1, expr: 'down', paused: true });
    hook.rerender({ generation: 1, expr: 'down', paused: false });
    expect(hook.result.current.map((p) => p.snapshot.state)).toEqual(['loading']);
  });

  it('shows the latest buffered result as the kept result when the resume comes with a new generation', () => {
    const { hook, emit } = pausedSetup();
    emit(0, 1);
    hook.rerender({ generation: 1, paused: true });
    emit(0, 2);
    // The resume brings a new generation (a new request key): the new request loads, the display keeps 2, not 1.
    hook.rerender({ generation: 2, paused: false });
    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0]).toMatchObject({ kept: true });
    expect(hook.result.current[0].snapshot).toMatchObject({ state: 'ready', frames: [frame(2)], fromCache: true });
  });

  it('keeps one buffered value per consumer: 1000 emissions while paused give one update at the resume', () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    let renders = 0;
    const hook = renderHook(
      ({ paused }: { paused: boolean }) => {
        renders++;
        return useBindingSnapshots(
          plan,
          config(),
          { controller, context: context(1) },
          undefined,
          100,
          undefined,
          'test',
          paused
        );
      },
      { initialProps: { paused: false } }
    );
    const emit = (value: number) =>
      act(() => execute.mock.calls[0][1]({ state: 'ready', frames: [frame(value)], fetchedAt: 0, fromCache: false }));
    emit(0);
    hook.rerender({ paused: true });
    const paused = renders;
    for (let i = 1; i <= 1000; i++) {
      emit(i);
    }
    expect(renders).toBe(paused);
    hook.rerender({ paused: false });
    expect(renders - paused).toBe(2);
    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0].snapshot).toMatchObject({ frames: [frame(1000)] });
  });
});
