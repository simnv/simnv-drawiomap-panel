import { act, renderHook } from '@testing-library/react';
import { FieldType, getDefaultTimeRange, type DataFrame } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { useBindingSnapshots } from './useBindingSnapshots';
import { createQueryController } from '../query/controller';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2, NamedQuery, QueryBinding } from '../model/config';
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
  ({ version: 2, queries: [query(expr)], patterns: [], overrides: [], widgets: [] }) as DiagramConfigV2;
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
        prepared
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
