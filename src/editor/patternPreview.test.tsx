import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame } from '@grafana/data';
import { BindingEditor } from './BindingEditor';
import { PanelQueryContext } from '../query/panel';
import { createQueryController } from '../query/controller';
import { DEFAULT_QUERY_POLICY, type QueryContext, type QuerySnapshot } from '../query/types';
import { buildCellIndex, cellMetas } from '../render/svgStage';
import { binding, nativeQuery } from '../fixtures/authoring-config';
import type { DiagramConfigV2 } from '../model/config';
vi.hoisted(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});
vi.mock('@grafana/runtime', async (original) => ({
  ...(await original<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({ get: async () => ({ components: {} }), getInstanceSettings: () => undefined }),
}));
function setup() {
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="device-2"><rect/></g></svg>';
  const cells = buildCellIndex(host.querySelector('svg')!);
  const config: DiagramConfigV2 = {
    version: 2,
    defaultDatasource: { uid: 'ds' },
    overrides: [],
    queries: ['shape', 'hover', 'widget'].map((id) => nativeQuery(id, '$dm_key', { dm_key: 'cell.key' })),
    patterns: [
      {
        id: 'shared',
        name: 'Shared',
        select: { ids: ['device-1', 'device-2'] },
        display: {
          shape: { binding: binding('shape') },
          status: {
            kind: 'mapping',
            binding: binding('shape'),
            default: { state: 'normal', reason: 'Healthy' },
            mappings: [{ value: 0, state: 'down', reason: 'Down' }],
          },
          link: { a2bBinding: binding('shape'), b2aBinding: binding('shape'), capacity: 100 },
          hover: {
            rows: [
              { kind: 'value', label: 'Detail', binding: binding('hover') },
              { kind: 'history', label: 'History', binding: binding('hover') },
            ],
          },
        },
      },
    ],
    widgets: [{ id: 'chart', label: 'Chart', anchorCellId: 'device-2', kind: 'sparkline', binding: binding('widget') }],
  };
  config.patterns.unshift({
    id: 'alternate',
    name: 'Alternate',
    select: { ids: ['device-1', 'device-2'] },
    display: {},
  });
  const pending: Array<{
    cell: string;
    ref: string;
    emit: (s: QuerySnapshot) => void;
    cancel: ReturnType<typeof vi.fn>;
  }> = [];
  const execute = vi.fn((request, emit) => {
    const cancel = vi.fn();
    pending.push({
      cell: request.request.scopedVars.dm_key.value,
      ref: request.request.targets[0].refId,
      emit,
      cancel,
    });
    return cancel;
  });
  const controller = createQueryController(execute);
  const context = {
    timeRange: getDefaultTimeRange(),
    timeZone: 'utc',
    scopedVars: {},
    refreshMs: 1000,
    intervalMs: 1000,
    generation: 1,
  };
  const save = vi.fn();
  const prepared = vi.fn();
  const editor = (nextContext = context, nextCells = cells) => (
    <PanelQueryContext.Provider value={{ controller, context: nextContext }}>
      <BindingEditor
        config={config}
        cells={nextCells}
        data={{ state: LoadingState.Done, series: [], timeRange: context.timeRange }}
        onSave={save}
        onPatternPreview={prepared}
      />
    </PanelQueryContext.Provider>
  );
  const view = render(editor());
  fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
  fireEvent.change(screen.getByLabelText('Edit scope'), { target: { value: 'pattern' } });
  return { controller, execute, pending, context, save, prepared, view, editor };
}
function ready(value: number): QuerySnapshot {
  return {
    state: 'ready',
    fetchedAt: Date.now(),
    fromCache: false,
    frames: [
      toDataFrame({
        fields: [
          { name: 'Time', type: FieldType.time, values: [Date.now()] },
          { name: 'Value', type: FieldType.number, values: [value] },
        ],
      }),
    ],
  };
}
describe('explicit full pattern preview', () => {
  it('loads every binding scope only on explicit action, reports progress and retains distinct prepared values', async () => {
    const { execute, pending, prepared, controller } = setup();
    fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Draft ${cell.key}' } });
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview all pattern matches' }));
    expect(screen.getByLabelText('Pattern preview progress').textContent).toContain('0 / 5');
    expect(execute).toHaveBeenCalledTimes(4);
    await act(async () => {
      pending[0].emit(ready(11));
      pending[1].emit(ready(12));
      pending[2].emit(ready(21));
      pending[3].emit({ state: 'error', message: 'Datasource unavailable' });
      pending[4].emit(ready(23));
    });
    expect(execute).toHaveBeenCalledTimes(5);
    expect(pending.map((p) => `${p.cell}:${p.ref}`)).toEqual([
      'device-1:SHAPE',
      'device-1:HOVER',
      'device-2:SHAPE',
      'device-2:HOVER',
      'device-2:WIDGET',
    ]);
    expect(screen.getByLabelText('Pattern preview progress').textContent).toContain('5 / 5');
    expect(screen.getByLabelText('Metric resolution preview').textContent).toContain('device-1: resolved');
    expect(screen.getByLabelText('Metric resolution preview').textContent).toContain('device-2: failed');
    expect(screen.getByLabelText('Metric resolution preview').textContent).toContain('Datasource unavailable');
    expect(screen.getByLabelText('Hover row preview').textContent).toContain('12');
    const results = prepared.mock.calls.at(-1)?.[0].previews;
    expect(
      results.find((p: { cellId: string; query: { id: string } }) => p.cellId === 'device-2' && p.query.id === 'shape')
        .snapshot.frames[0].fields[1].values[0]
    ).toBe(21);
    expect(pending.every((p) => p.cancel.mock.calls.length === 1)).toBe(true);
    controller.dispose();
  });
  it.each([
    'edit',
    'query',
    'scope',
    'pattern',
    'selector',
    'select',
    'context',
    'identities',
    'cancel',
    'apply',
    'unmount',
  ])('releases a pending run on %s and rejects uncancellable late results', async (action) => {
    const s = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview all pattern matches' }));
    const old = [...s.pending];
    if (action === 'edit') {
      fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Changed' } });
    }
    if (action === 'query') {
      fireEvent.change(screen.getByLabelText('Query name'), { target: { value: 'Changed query' } });
    }
    if (action === 'scope') {
      fireEvent.change(screen.getByLabelText('Edit scope'), { target: { value: 'element' } });
    }
    if (action === 'pattern') {
      fireEvent.change(screen.getByLabelText('Shared pattern'), { target: { value: 'alternate' } });
    }
    if (action === 'selector') {
      fireEvent.change(screen.getByLabelText('Pattern element IDs'), { target: { value: 'device-1' } });
    }
    if (action === 'select') {
      fireEvent.click(screen.getByRole('button', { name: 'Select device-2' }));
    }
    if (action === 'context') {
      s.view.rerender(s.editor({ ...s.context, generation: 2 }));
    }
    if (action === 'identities') {
      s.view.rerender(s.editor(s.context, new Map()));
    }
    if (action === 'cancel') {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    }
    if (action === 'apply') {
      fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    }
    if (action === 'unmount') {
      s.view.unmount();
    }
    const published = s.prepared.mock.calls.length;
    await act(async () => old.forEach((entry) => entry.emit(ready(999))));
    expect(old.every((entry) => entry.cancel.mock.calls.length === 1)).toBe(true);
    expect(s.execute).toHaveBeenCalledTimes(4);
    expect(s.prepared).toHaveBeenCalledTimes(published);
    expect(screen.queryByLabelText('Pattern preview progress')).toBeNull();
    expect(screen.queryByLabelText('Hover row preview')?.textContent ?? '').not.toContain('999');
    s.controller.dispose();
  });
});

// Controller-boundary scenarios use the same public run as the inspector action.
import { previewPattern } from './patternPreview';
import { resolvePatterns } from '../binding/patterns';
import type { QueryPreview } from './preview';
function batch(parameterized = true) {
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-cell-id="a"><rect/></g><g data-cell-id="b"><rect/></g></svg>';
  const q = nativeQuery('q', 'metric', parameterized ? { dm_key: 'cell.key' } : {});
  const config: DiagramConfigV2 = {
    version: 2,
    defaultDatasource: { uid: 'ds' },
    overrides: [],
    widgets: [],
    queries: [q, { ...q, id: 'alias', name: 'Alias' }],
    patterns: [
      {
        id: 'p',
        name: 'Pattern',
        select: {},
        display: {
          shape: { binding: binding('q') },
          hover: { rows: [{ kind: 'value', label: 'Alias', binding: binding('alias') }] },
        },
      },
    ],
  };
  const plan = resolvePatterns(cellMetas(buildCellIndex(host.querySelector('svg')!)), config);
  const context: QueryContext = {
    timeRange: getDefaultTimeRange(),
    timeZone: 'utc',
    scopedVars: {},
    refreshMs: 10,
    intervalMs: 1000,
    generation: 1,
    defaultDatasource: config.defaultDatasource,
  };
  return { config, plan, context };
}
it.each(['error', 'loading', 'unsupported', 'empty'] as const)(
  'full pattern preview prefers ready over %s in either prepared order',
  async (state) => {
    for (const readyFirst of [false, true]) {
      const s = batch(false);
      const execute = vi.fn(() => vi.fn());
      const controller = createQueryController(execute);
      const other: QuerySnapshot =
        state === 'empty'
          ? { state, fetchedAt: 1, fromCache: false }
          : state === 'loading'
            ? { state }
            : { state, message: 'Saved request did not succeed' };
      const prepared: QueryPreview[] = s.config.queries.flatMap((query) => {
        const values = [other, ready(42)];
        if (readyFirst) {
          values.reverse();
        }
        return values.map((snapshot) => ({ query, cellId: 'a', context: s.context, snapshot }));
      });
      const publish = vi.fn();
      const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, undefined, prepared);
      await Promise.resolve();
      expect(execute).not.toHaveBeenCalled();
      const results: QueryPreview[] = publish.mock.calls.at(-1)![0].previews;
      expect(results).toHaveLength(4);
      expect(
        results.map(({ snapshot }) =>
          snapshot.state === 'ready' ? snapshot.frames[0].fields[1].values[0] : snapshot.state
        )
      ).toEqual([42, 42, 42, 42]);
      stop();
      controller.dispose();
    }
  }
);
it.each(['error', 'loading', 'unsupported', 'empty'] as const)(
  'full pattern preview executes when saved %s cannot satisfy demand',
  async (state) => {
    const s = batch(false);
    const execute = vi.fn((_request, emit) => {
      emit(ready(84));
      return vi.fn();
    });
    const controller = createQueryController(execute);
    const snapshot: QuerySnapshot =
      state === 'empty'
        ? { state, fetchedAt: 1, fromCache: false }
        : state === 'loading'
          ? { state }
          : { state, message: 'Saved request failed' };
    const prepared = s.config.queries.map((query) => ({ query, cellId: 'a', context: s.context, snapshot }));
    const publish = vi.fn();
    const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, undefined, prepared);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(state === 'empty' ? 0 : 1);
    const results: QueryPreview[] = publish.mock.calls.at(-1)![0].previews;
    expect(
      results.map(({ snapshot }) =>
        snapshot.state === 'ready' ? snapshot.frames[0].fields[1].values[0] : snapshot.state
      )
    ).toEqual(state === 'empty' ? ['empty', 'empty', 'empty', 'empty'] : [84, 84, 84, 84]);
    stop();
    controller.dispose();
  }
);
it('coalesces equal native demands across query IDs and elements and retains their shared frames once', async () => {
  const s = batch(false);
  const execute = vi.fn((_request, emit) => {
    emit(ready(7));
    return vi.fn();
  });
  const controller = createQueryController(execute);
  const publish = vi.fn();
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, {
    ...DEFAULT_QUERY_POLICY,
    maxEntries: 1,
  });
  await Promise.resolve();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls.at(-1)?.[0].previews.map((p: { snapshot: QuerySnapshot }) => p.snapshot.state)).toEqual([
    'ready',
    'ready',
    'ready',
    'ready',
  ]);
  stop();
  controller.dispose();
});
it('keeps saved monitoring independent when it joins a pending one-shot preview', async () => {
  vi.useFakeTimers();
  try {
    const s = batch(false);
    const execute = vi.fn((_request, _emit) => vi.fn());
    const controller = createQueryController(execute);
    const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, vi.fn());
    const saved = vi.fn();
    const release = controller.watch(
      {
        consumerId: 'saved',
        query: s.config.queries[0],
        scope: s.plan.cells.a.scope,
        context: s.context,
        maxDataPoints: 160,
      },
      saved
    );
    execute.mock.calls[0][1](ready(7));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls.at(-1)?.[0].state).toBe('loading');
    stop();
    release();
    controller.dispose();
  } finally {
    vi.useRealTimers();
  }
});
it('reuses compatible prepared results without new execution but rejects an older refresh generation', async () => {
  const s = batch();
  const execute = vi.fn(() => vi.fn());
  const controller = createQueryController(execute);
  const prepared = ['a', 'b'].flatMap((cellId, i) =>
    s.config.queries.map((query) => ({ query, cellId, context: s.context, snapshot: ready(i === 0 ? 11 : 22) }))
  );
  const publish = vi.fn();
  const stop = previewPattern(
    controller,
    s.plan,
    s.config,
    ['a', 'b'],
    s.context,
    publish,
    DEFAULT_QUERY_POLICY,
    prepared
  );
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
  expect(publish.mock.calls.at(-1)?.[0].previews.map((p: { snapshot: QuerySnapshot }) => p.snapshot.state)).toEqual([
    'ready',
    'ready',
    'ready',
    'ready',
  ]);
  stop();
  previewPattern(
    controller,
    s.plan,
    s.config,
    ['a', 'b'],
    { ...s.context, generation: 2 },
    publish,
    DEFAULT_QUERY_POLICY,
    prepared
  )();
  expect(execute).toHaveBeenCalledTimes(2);
  controller.dispose();
});
it.each([
  ['entries', { maxEntries: 1 }],
  ['sample values', { maxCachedValues: 3 }],
  ['bytes', { maxCachedBytes: 600 }],
])('bounds aggregate prepared %s and reports an actionable result-limit failure', async (_name, limit) => {
  const s = batch();
  const execute = vi.fn((_request, emit) => {
    emit(ready(7));
    return vi.fn();
  });
  const controller = createQueryController(execute);
  const publish = vi.fn();
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, {
    ...DEFAULT_QUERY_POLICY,
    ...limit,
  });
  await Promise.resolve();
  const snapshots = publish.mock.calls.at(-1)?.[0].previews.map((p: { snapshot: QuerySnapshot }) => p.snapshot);
  expect(snapshots.filter((s: QuerySnapshot) => s.state === 'ready')).toHaveLength(2);
  expect(snapshots.filter((s: QuerySnapshot) => s.state === 'error')).toEqual([
    { state: 'error', message: expect.stringContaining('Reduce the pattern scope') },
    { state: 'error', message: expect.stringContaining('Reduce the pattern scope') },
  ]);
  stop();
  controller.dispose();
});
it.each([
  ['entries', { maxEntries: 1 }],
  ['sample values', { maxCachedValues: 3 }],
  ['bytes', { maxCachedBytes: 600 }],
])('accounts reused chart frames against aggregate prepared %s', async (_name, limit) => {
  const s = batch();
  const execute = vi.fn(() => vi.fn());
  const controller = createQueryController(execute);
  const compatible = ['a', 'b'].flatMap((cellId, index) => {
    const snapshot = ready(index === 0 ? 42 : 84);
    return s.config.queries.map((query) => ({ query, cellId, context: s.context, snapshot }));
  });
  const publish = vi.fn();
  const stop = previewPattern(
    controller,
    s.plan,
    s.config,
    ['a', 'b'],
    s.context,
    publish,
    {
      ...DEFAULT_QUERY_POLICY,
      ...limit,
    },
    compatible
  );
  const snapshots: QuerySnapshot[] = publish.mock.calls
    .at(-1)?.[0]
    .previews.map((p: { snapshot: QuerySnapshot }) => p.snapshot);
  expect(execute).not.toHaveBeenCalled();
  expect(snapshots.map((snapshot) => snapshot.state)).toEqual(['ready', 'ready', 'error', 'error']);
  expect(snapshots[2]).toEqual({ state: 'error', message: expect.stringContaining('Reduce the pattern scope') });
  stop();
  controller.dispose();
});
it('reports exhausted controller queue and active sample budgets as completed failures', async () => {
  const s = batch();
  const execute = vi.fn((_request, _emit) => vi.fn());
  const controller = createQueryController(execute, {
    ...DEFAULT_QUERY_POLICY,
    maxConcurrent: 1,
    maxQueued: 0,
    maxActiveResultValues: 1,
  });
  const publish = vi.fn();
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish);
  execute.mock.calls[0][1](ready(7));
  await Promise.resolve();
  const previews = publish.mock.calls.at(-1)?.[0].previews;
  expect(previews.map((p: { snapshot: QuerySnapshot }) => p.snapshot.state)).toEqual([
    'error',
    'error',
    'error',
    'error',
  ]);
  expect(previews[0].snapshot.message).toContain('active result budget');
  expect(previews[2].snapshot.message).toContain('queue is full');
  expect(execute).toHaveBeenCalledTimes(1);
  stop();
  controller.dispose();
});
it('collects a one-shot preview without scheduling background refresh and reuses eager data', async () => {
  vi.useFakeTimers();
  try {
    const s = batch(false);
    s.config.queries.push({ id: 'eager', name: 'Eager', source: { kind: 'panel', refId: 'A' } });
    s.plan.cells.a.bindings.push(binding('eager'));
    const execute = vi.fn((_request, emit) => {
      emit(ready(7));
      return vi.fn();
    });
    const controller = createQueryController(execute);
    const eager = ready(3);
    controller.setPanelData({
      state: LoadingState.Done,
      timeRange: s.context.timeRange,
      series: eager.state === 'ready' ? eager.frames.map((f) => ({ ...f, refId: 'A' })) : [],
    });
    const publish = vi.fn();
    const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      publish.mock.calls.at(-1)?.[0].previews.every((p: { snapshot: QuerySnapshot }) => p.snapshot.state === 'ready')
    ).toBe(true);
    stop();
    controller.dispose();
  } finally {
    vi.useRealTimers();
  }
});
it('rejects an uncancellable Promise after run cancellation', async () => {
  const s = batch(false);
  let finish!: (s: QuerySnapshot) => void;
  const promise = new Promise<QuerySnapshot>((resolve) => {
    finish = resolve;
  });
  const execute = vi.fn((_request, emit) => {
    void promise.then(emit);
    return vi.fn();
  });
  const controller = createQueryController(execute);
  const publish = vi.fn();
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish);
  stop();
  const count = publish.mock.calls.length;
  finish(ready(999));
  await promise;
  await Promise.resolve();
  expect(publish).toHaveBeenCalledTimes(count);
  controller.dispose();
});
it.each(['missing', 'ambiguous'])(
  'shows a nonrepresentative %s hover metric as failed after full preview',
  async (failure) => {
    const s = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview all pattern matches' }));
    await act(async () => {
      s.pending[0].emit(ready(11));
      s.pending[1].emit(ready(12));
      s.pending[2].emit(ready(21));
      const snapshot = ready(22);
      if (failure === 'ambiguous' && snapshot.state === 'ready') {
        snapshot.frames[0].fields.push({ name: 'Other', type: FieldType.number, config: {}, values: [33] });
      }
      s.pending[3].emit(failure === 'missing' ? { state: 'empty', fetchedAt: 1, fromCache: false } : snapshot);
      s.pending[4].emit(ready(23));
    });
    const preview = screen.getByLabelText('Affected metric resolution').textContent;
    expect(preview).toContain('device-1: resolved');
    expect(preview).toContain('device-2: failed');
    expect(preview).toContain(failure === 'missing' ? 'No metric matches query hover' : 'ambiguous');
    expect(screen.getByLabelText('Pattern preview progress').textContent).toContain('5 / 5');
    s.controller.dispose();
  }
);

it('applies a completed full preview once, discards prepared results, and makes Cancel restore that applied draft', async () => {
  const s = setup();
  fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Applied pattern' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview all pattern matches' }));
  await act(async () => {
    s.pending[0].emit(ready(11));
    s.pending[1].emit(ready(12));
    s.pending[2].emit(ready(21));
    s.pending[3].emit(ready(22));
    s.pending[4].emit(ready(23));
  });
  expect(screen.getByLabelText('Affected metric resolution').textContent).toContain('device-2: resolved');
  expect(s.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
  expect(s.save).toHaveBeenCalledTimes(1);
  expect(s.save.mock.calls[0][0].patterns.at(-1).display.label).toBe('Applied pattern');
  expect(screen.queryByLabelText('Pattern preview progress')).toBeNull();
  expect(screen.getByLabelText('Affected metric resolution').textContent).toContain('device-2: unvalidated');
  expect(s.prepared.mock.calls.at(-1)?.[0]).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Discard me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
  expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Applied pattern');
  expect(s.execute).toHaveBeenCalledTimes(5);
  s.controller.dispose();
});
