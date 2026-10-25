import { buttonNamed, chooseOption, editorField, openQueryRow, selectStageCell } from './testUtils';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame } from '@grafana/data';
import { createQueryController } from '../query/controller';
import { testQueryService } from '../query/testService';
import { DEFAULT_QUERY_POLICY, type QueryContext, type QuerySnapshot } from '../query/types';
import { buildCellIndex, cellMetas } from '../render/svgStage';
import { renderEditor, svgOf } from './editorHarness';
import { binding, nativeQuery } from '../fixtures/authoring-config';
import type { DiagramConfig } from '../model/config';
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
  const config: DiagramConfig = {
    version: 3,
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
          link: { a2b: { binding: binding('shape') }, b2a: { binding: binding('shape') }, capacity: 100 },
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
    refreshMs: 0,
    intervalMs: 1000,
    generation: 1,
  };
  const view = renderEditor({
    config,
    svg: svgOf('device-1', 'device-2'),
    data: { state: LoadingState.Done, series: [], timeRange: context.timeRange },
    service: testQueryService(controller, context),
  });
  selectStageCell('device-1');
  chooseOption('Edit scope', 'All elements matching this pattern');
  // The popup watches the shape bindings of every cell and the hover rows of the open one on its own. These requests
  // end here, so that the limit of the controller does not hold back the run of the full preview.
  const auto = pending.length;
  const automatic = pending.slice(0, auto);
  act(() => {
    for (const request of automatic) {
      request.emit(ready(request.ref === 'HOVER' ? 12 : request.cell === 'device-1' ? 11 : 21));
    }
  });
  /** The requests that only the full preview started: the hover row and the chart of device-2. */
  const explicit = () => pending.slice(auto);
  const rerenderWith = (nextContext: QueryContext) => view.rerenderService(testQueryService(controller, nextContext));
  return { controller, execute, pending, automatic, explicit, context, save: view.save, view, rerenderWith };
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
  it('loads only the missing binding scopes on explicit action, reports progress and retains distinct prepared values', async () => {
    const { execute, pending, automatic, explicit, controller } = setup();
    expect(automatic.map((p) => `${p.cell}:${p.ref}`).sort()).toEqual([
      'device-1:HOVER',
      'device-1:SHAPE',
      'device-2:SHAPE',
    ]);
    fireEvent.change(editorField('Label template'), { target: { value: 'Draft ${cell.key}' } });
    expect(execute).toHaveBeenCalledTimes(3);
    fireEvent.click(buttonNamed('Preview all pattern matches'));
    // The run reuses the three results that the popup has, and asks for the two scopes that it does not have.
    expect(editorField('Pattern preview progress').textContent).toContain('3 / 5');
    expect(execute).toHaveBeenCalledTimes(5);
    await act(async () => {
      explicit()[0].emit({ state: 'error', message: 'Datasource unavailable' });
      explicit()[1].emit(ready(23));
    });
    expect(execute).toHaveBeenCalledTimes(5);
    expect(explicit().map((p) => `${p.cell}:${p.ref}`)).toEqual(['device-2:HOVER', 'device-2:WIDGET']);
    expect(editorField('Pattern preview progress').textContent).toContain('5 / 5');
    expect(editorField('Metric resolution preview').textContent).toContain('device-1: resolved');
    expect(editorField('Metric resolution preview').textContent).toContain('device-2: failed');
    expect(editorField('Metric resolution preview').textContent).toContain('Datasource unavailable');
    expect(editorField('Hover row preview').textContent).toContain('12');
    // The one-shot requests end with the run. The other requests are still watched by the popup.
    expect(explicit().every((p) => p.cancel.mock.calls.length === 1)).toBe(true);
    expect(pending.slice(0, 3).every((p) => p.cancel.mock.calls.length === 0)).toBe(true);
    controller.dispose();
  });
  it('releases a pending run on an edit, a pattern change or a query edit, and rejects uncancellable late results', async () => {
    const s = setup();
    const edits: Array<[string, () => void]> = [
      ['edit', () => fireEvent.change(editorField('Label template'), { target: { value: 'Changed' } })],
      ['pattern', () => chooseOption('Shared pattern', 'Alternate')],
      [
        'query',
        () => {
          openQueryRow('shape');
          fireEvent.change(editorField('Query name'), { target: { value: 'Changed query' } });
        },
      ],
    ];
    for (const [name, change] of edits) {
      const first = s.pending.length;
      fireEvent.click(buttonNamed('Preview all pattern matches'));
      const old = s.pending.slice(first);
      expect(old.length, name).toBeGreaterThan(0);
      change();
      const before = s.execute.mock.calls.length;
      await act(async () => old.forEach((entry) => entry.emit(ready(999))));
      expect(
        old.every((entry) => entry.cancel.mock.calls.length === 1),
        name
      ).toBe(true);
      expect(s.execute.mock.calls.length, name).toBe(before);
      expect(screen.queryByLabelText('Pattern preview progress'), name).toBeNull();
      expect(screen.queryByLabelText('Hover row preview')?.textContent ?? '', name).not.toContain('999');
    }
    s.controller.dispose();
  });
  it.each(['scope', 'selector', 'select', 'context', 'cancel', 'apply', 'unmount'])(
    'releases a pending run on %s and rejects uncancellable late results',
    async (action) => {
      const s = setup();
      fireEvent.click(buttonNamed('Preview all pattern matches'));
      const old = [...s.explicit()];
      expect(old).toHaveLength(2);
      if (action === 'scope') {
        chooseOption('Edit scope', 'This element');
      }
      if (action === 'selector') {
        fireEvent.change(editorField('Pattern element IDs'), { target: { value: 'device-1' } });
      }
      if (action === 'select') {
        selectStageCell('device-2');
      }
      if (action === 'context') {
        s.rerenderWith({ ...s.context, generation: 2 });
      }
      if (action === 'cancel') {
        // The Discard button waits for a change of the draft.
        fireEvent.change(editorField('Label template'), { target: { value: 'Changed' } });
        fireEvent.click(buttonNamed('Discard'));
      }
      if (action === 'apply') {
        fireEvent.click(buttonNamed('Apply bindings'));
      }
      if (action === 'unmount') {
        s.view.unmount();
      }
      const before = s.execute.mock.calls.length;
      await act(async () => old.forEach((entry) => entry.emit(ready(999))));
      expect(old.every((entry) => entry.cancel.mock.calls.length === 1)).toBe(true);
      expect(s.execute.mock.calls.length).toBe(before);
      expect(screen.queryByLabelText('Pattern preview progress')).toBeNull();
      expect(screen.queryByLabelText('Hover row preview')?.textContent ?? '').not.toContain('999');
      s.controller.dispose();
    }
  );
});

// Controller-boundary scenarios use the same public run as the inspector action.
import { previewPattern } from './patternPreview';
import { resolvePatterns } from '../binding/patterns';
import { usePreviewTime, type QueryPreview } from './preview';
function batch(parameterized = true) {
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-cell-id="a"><rect/></g><g data-cell-id="b"><rect/></g></svg>';
  const q = nativeQuery('q', 'metric', parameterized ? { dm_key: 'cell.key' } : {});
  const config: DiagramConfig = {
    version: 3,
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
/** The options of a run in the tests: the owner of the popup and the resolution of its entries. */
const run = (policy?: typeof DEFAULT_QUERY_POLICY) => ({ owner: 'popup:1', maxDataPoints: 160, policy });
it('joins a running request of the popup with the same identity instead of starting a second one', async () => {
  const s = batch(false);
  const execute = vi.fn((_request, _emit) => vi.fn());
  const controller = createQueryController(execute);
  const saved = vi.fn();
  // the popup's own entry of the query at the cell, at the same resolution
  const release = controller.watch(
    {
      consumerId: 'popup%3A1:bindings:a:q',
      query: s.config.queries[0],
      scope: s.plan.cells.a.scope,
      context: s.context,
      maxDataPoints: 160,
    },
    saved
  );
  const publish = vi.fn();
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, run());
  expect(execute).toHaveBeenCalledTimes(1);
  execute.mock.calls[0][1](ready(42));
  await Promise.resolve();
  const results: QueryPreview[] = publish.mock.calls.at(-1)![0].previews;
  expect(
    results.map(({ snapshot }) =>
      snapshot.state === 'ready' ? snapshot.frames[0].fields[1].values[0] : snapshot.state
    )
  ).toEqual([42, 42, 42, 42]);
  // another resolution is another request
  const other = previewPattern(controller, s.plan, s.config, ['a'], s.context, vi.fn(), {
    owner: 'popup:1',
    maxDataPoints: 300,
  });
  expect(execute).toHaveBeenCalledTimes(2);
  other();
  stop();
  release();
  controller.dispose();
});
it('prefixes the consumer ids with the owner', () => {
  const s = batch(false);
  const watch = vi.fn(() => vi.fn());
  const stop = previewPattern(
    { watch, setPanelData: vi.fn(), dispose: vi.fn() },
    s.plan,
    s.config,
    ['a'],
    s.context,
    vi.fn(),
    {
      owner: 'popup:7',
      maxDataPoints: 160,
    }
  );
  expect(watch.mock.calls.map(([demand]: any) => demand.consumerId)).toEqual([
    'popup:7:pattern-preview:0',
    'popup:7:pattern-preview:1',
  ]);
  stop();
});
it('coalesces equal native demands across query IDs and elements and retains their shared frames once', async () => {
  const s = batch(false);
  const execute = vi.fn((_request, emit) => {
    emit(ready(7));
    return vi.fn();
  });
  const controller = createQueryController(execute);
  const publish = vi.fn();
  const stop = previewPattern(
    controller,
    s.plan,
    s.config,
    ['a', 'b'],
    s.context,
    publish,
    run({ ...DEFAULT_QUERY_POLICY, maxEntries: 1 })
  );
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
    const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, vi.fn(), run());
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
    // The saved consumer keeps the last result while its query runs again.
    expect(saved.mock.calls.at(-1)?.[0]).toMatchObject({ state: 'ready', fromCache: true });
    stop();
    release();
    controller.dispose();
  } finally {
    vi.useRealTimers();
  }
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
  const stop = previewPattern(
    controller,
    s.plan,
    s.config,
    ['a', 'b'],
    s.context,
    publish,
    run({ ...DEFAULT_QUERY_POLICY, ...limit })
  );
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
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, run());
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
    const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, run());
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
  const stop = previewPattern(controller, s.plan, s.config, ['a', 'b'], s.context, publish, run());
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
    fireEvent.click(buttonNamed('Preview all pattern matches'));
    await act(async () => {
      const snapshot = ready(22);
      if (failure === 'ambiguous' && snapshot.state === 'ready') {
        snapshot.frames[0].fields.push({ name: 'Other', type: FieldType.number, config: {}, values: [33] });
      }
      s.explicit()[0].emit(failure === 'missing' ? { state: 'empty', fetchedAt: 1, fromCache: false } : snapshot);
      s.explicit()[1].emit(ready(23));
    });
    const preview = editorField('Affected metric resolution').textContent;
    expect(preview).toContain('device-1: resolved');
    expect(preview).toContain('device-2: failed');
    expect(preview).toContain(failure === 'missing' ? 'No metric matches query hover' : 'ambiguous');
    expect(editorField('Pattern preview progress').textContent).toContain('5 / 5');
    s.controller.dispose();
  }
);

it('applies a completed full preview once, discards prepared results, and makes Cancel restore that applied draft', async () => {
  const s = setup();
  fireEvent.change(editorField('Label template'), { target: { value: 'Applied pattern' } });
  fireEvent.click(buttonNamed('Preview all pattern matches'));
  await act(async () => {
    s.explicit()[0].emit(ready(22));
    s.explicit()[1].emit(ready(23));
  });
  expect(editorField('Affected metric resolution').textContent).toContain('device-2: resolved');
  expect(s.save).not.toHaveBeenCalled();
  fireEvent.click(buttonNamed('Apply bindings'));
  expect(s.save).toHaveBeenCalledTimes(1);
  expect(s.save.mock.calls[0][0].patterns.at(-1).display.label).toBe('Applied pattern');
  expect(screen.queryByLabelText('Pattern preview progress')).toBeNull();
  fireEvent.change(editorField('Label template'), { target: { value: 'Discard me' } });
  fireEvent.click(buttonNamed('Discard'));
  expect((editorField('Label template') as HTMLInputElement).value).toBe('Applied pattern');
  expect(s.execute).toHaveBeenCalledTimes(5);
  s.controller.dispose();
});

describe('usePreviewTime', () => {
  afterEach(() => vi.useRealTimers());
  it('reevaluates each sample-age deadline and releases timers on change and unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const view = renderHook(({ deadlines }) => usePreviewTime(undefined, 1, undefined, 0, deadlines), {
      initialProps: { deadlines: [2001, 3001] },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(view.result.current).toBe(1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(view.result.current).toBe(2001);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(view.result.current).toBe(3001);
    view.rerender({ deadlines: [5001] });
    expect(vi.getTimerCount()).toBe(1);
    view.rerender({ deadlines: [] });
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ deadlines: [5001] });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
