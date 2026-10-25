import { act, renderHook } from '@testing-library/react';
import { FieldType, getDefaultTimeRange, LoadingState, type DataFrame, type PanelData } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { createQueryController } from './controller';
import { testQueryService } from './testService';
import {
  asKept,
  createSnapshotStore,
  demandMap,
  demandsOf,
  EMPTY_FRAME,
  matchKeyOf,
  resolverFrom,
  shownSnapshot,
  type StoreDemand,
} from './store';
import { useBindings } from './useBindings';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfig, NamedQuery, QueryBinding, Widget } from '../model/config';
import type { QueryContext, QueryController, QueryExecutor, QuerySnapshot } from './types';

vi.mock('@grafana/runtime', () => ({ getTemplateSrv: () => ({ getVariables: () => [] }) }));

const query = (expr = 'up', id = 'health'): NamedQuery => ({
  id,
  name: 'Health',
  source: {
    kind: 'datasource',
    datasource: { uid: 'prom' },
    target: Object.assign({ refId: 'H' }, { expr }),
    parameters: {},
  },
});
const binding: QueryBinding = { queryId: 'health', match: {}, reducer: 'last' };
const capacity: QueryBinding = { queryId: 'speed', match: {}, reducer: 'last' };
const widget: Widget = { id: 'w', anchorCellId: 'router', kind: 'sparkline', label: 'Health', binding };
const config = (expr?: string): DiagramConfig => ({
  version: 3,
  queries: [query(expr), query('speed', 'speed')],
  patterns: [],
  overrides: [],
  widgets: [widget],
});
const scope = { cell: { key: 'router' } };
const otherScope = { cell: { key: 'other' } };
const planOf = (cfg: DiagramConfig): BindingPlan =>
  ({
    cells: {
      router: {
        cellId: 'router',
        scope,
        bindings: [binding, capacity],
        display: {
          status: { kind: 'mapping', binding, default: { state: 'normal', reason: 'Healthy' }, mappings: [] },
          hover: {
            rows: [
              { kind: 'value', label: 'Value', binding },
              { kind: 'combined', label: 'Traffic', series: [{ binding, direction: 'up', capacityBinding: capacity }] },
            ],
          },
        },
      },
      other: {
        cellId: 'other',
        scope: otherScope,
        bindings: [binding],
        display: { hover: { rows: [{ kind: 'value', label: 'Value', binding }] } },
      },
    },
    widgets: [{ widget, anchorCellId: 'router', scope, index: 0 }],
    diagnostics: [],
    config: cfg,
  }) as unknown as BindingPlan;
const range = getDefaultTimeRange();
const contexts = new Map<number, QueryContext>();
// One stable context object per generation, as PanelQueryProvider makes. Generation 3 has another default datasource.
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
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: [1000] },
    { name: 'Value', type: FieldType.number, config: {}, values: [value] },
  ],
});
const ready = (value: number): QuerySnapshot => ({
  state: 'ready',
  frames: [frame(value)],
  fetchedAt: 0,
  fromCache: false,
});
const data: PanelData = { state: LoadingState.Done, series: [], timeRange: range };

/** The demands of a role for a generation and a query text; `width` is the resolution. */
const demands = (
  role: 'visible' | 'hover' | 'widget',
  {
    generation = 1,
    expr,
    width = 100,
    open,
  }: { generation?: number; expr?: string; width?: number; open?: string } = {}
) => {
  const cfg = config(expr);
  return demandsOf(planOf(cfg), cfg, context(generation), width, role, open);
};

function setup() {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute);
  const store = createSnapshotStore(controller);
  const emit = (call: number, snapshot: QuerySnapshot) => execute.mock.calls[call][1](snapshot);
  const states = (owner: string, group?: string) => {
    const frame = store.frame(owner, group);
    return ['router', 'other'].flatMap((cellId) =>
      ['health', 'speed'].flatMap((queryId) => {
        const shown = frame.get(cellId, queryId);
        return shown ? [`${cellId}/${queryId}:${shown.snapshot.state}${shown.kept ? '+kept' : ''}`] : [];
      })
    );
  };
  return { execute, controller, store, emit, states };
}

describe('demandsOf', () => {
  it('gives one demand per (cell, query) pair of a role, with the match key', () => {
    expect(demands('visible').map((d) => [d.cellId, d.query.id])).toEqual([['router', 'health']]);
    // the value and the capacity of one combined row and a value row: two pairs, not three places
    expect(demands('hover', { open: 'router' }).map((d) => [d.cellId, d.query.id])).toEqual([
      ['router', 'health'],
      ['router', 'speed'],
    ]);
    expect(demands('widget').map((d) => [d.cellId, d.query.id])).toEqual([['router', 'health']]);
    const [d] = demands('visible');
    expect(d.matchKey).toBe(matchKeyOf(query(), scope, context(1)));
    expect(d.maxDataPoints).toBe(100);
    expect(demandsOf(planOf(config()), config(), undefined, 100, 'visible')).toEqual([]);
  });
  it('skips a panel-source query: the resolver reads it from the panel data', () => {
    const cfg: DiagramConfig = {
      ...config(),
      queries: [{ id: 'health', name: 'H', source: { kind: 'panel', refId: 'A' } }],
    };
    expect(demandsOf(planOf(cfg), cfg, context(1), 100, 'visible')).toEqual([]);
  });
});

describe('the store keeps the last result during a refresh', () => {
  it('shows loading on the first load', () => {
    const { store, states } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    expect(states('panel:1', 'visible')).toEqual(['router/health:loading']);
  });

  it('keeps the previous result for the next generation until the new result arrives', () => {
    const { store, emit, execute, states } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    emit(0, ready(1));
    store.want('panel:1', 'visible', demands('visible', { generation: 2 }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(states('panel:1', 'visible')).toEqual(['router/health:ready+kept']);
    const shown = store.frame('panel:1', 'visible').get('router', 'health')!;
    expect(shown.snapshot).toMatchObject({ state: 'ready', fromCache: true, frames: [frame(1)] });
    expect(shown.generation).toBe(1);
    emit(1, ready(2));
    const next = store.frame('panel:1', 'visible').get('router', 'health')!;
    expect(next).toMatchObject({ kept: false, generation: 2 });
    expect(next.snapshot).toMatchObject({ state: 'ready', fromCache: false, frames: [frame(2)] });
  });

  it('keeps the previous error for the next generation until the new result arrives', () => {
    const { store, emit, states } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    emit(0, { state: 'error', message: 'Datasource query failed.' });
    store.want('panel:1', 'visible', demands('visible', { generation: 2 }));
    expect(states('panel:1', 'visible')).toEqual(['router/health:error+kept']);
    emit(1, ready(2));
    expect(states('panel:1', 'visible')).toEqual(['router/health:ready']);
  });

  it('does not show the result of a changed query', () => {
    const { store, emit, states } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    emit(0, ready(1));
    store.want('panel:1', 'visible', demands('visible', { expr: 'down' }));
    expect(states('panel:1', 'visible')).toEqual(['router/health:loading']);
  });

  it('does not show the result of another default datasource', () => {
    const { store, emit, states } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    emit(0, ready(1));
    store.want('panel:1', 'visible', demands('visible', { generation: 3 }));
    expect(states('panel:1', 'visible')).toEqual(['router/health:loading']);
  });

  it('keeps the result of an earlier generation while a second new generation loads', () => {
    const { store, emit, states } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    emit(0, ready(1));
    store.want('panel:1', 'visible', demands('visible', { generation: 2 }));
    store.want('panel:1', 'visible', demands('visible', { generation: 4 }));
    expect(states('panel:1', 'visible')).toEqual(['router/health:ready+kept']);
    expect(store.frame('panel:1', 'visible').get('router', 'health')!.snapshot).toMatchObject({ frames: [frame(1)] });
  });
});

describe('sharing between consumers', () => {
  it('a binding and a widget of one query at one cell with the same width are one request, with different widths two', () => {
    const { store, execute } = setup();
    store.want('panel:1', 'visible', demands('visible', { width: 100 }));
    store.want('panel:1', 'widget:w', demands('widget', { width: 100 }));
    expect(execute).toHaveBeenCalledTimes(1);
    store.want('panel:1', 'widget:w', demands('widget', { width: 200 }));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('a resolution change of a widget keeps the last result as kept', () => {
    const { store, execute, emit, states } = setup();
    store.want('panel:1', 'widget:w', demands('widget', { width: 100 }));
    emit(0, ready(1));
    store.want('panel:1', 'widget:w', demands('widget', { width: 200 }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(states('panel:1', 'widget:w')).toEqual(['router/health:ready+kept']);
    emit(1, ready(2));
    expect(store.frame('panel:1', 'widget:w').get('router', 'health')!.snapshot).toMatchObject({ frames: [frame(2)] });
  });

  it('two owners with the same ids keep their own watches', () => {
    const release = vi.fn();
    const watch = vi.fn<QueryController['watch']>(() => release);
    const controller: QueryController = { watch, setPanelData: vi.fn(), dispose: vi.fn() };
    const store = createSnapshotStore(controller);
    store.want('panel:1', 'visible', demands('visible'));
    store.want('popup:1', 'visible', demands('visible'));
    expect(new Set(watch.mock.calls.map(([demand]) => demand.consumerId)).size).toBe(2);
    expect(watch.mock.calls.map(([demand]) => demand.consumerId)).toEqual([
      'panel:1:visible:router:health',
      'popup:1:visible:router:health',
    ]);
    expect(release).not.toHaveBeenCalled();
    store.want('popup:1', 'visible', []);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('the hook of a second owner joins the entry of the first and releases only its own watch', async () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    const service = testQueryService(controller, context(1));
    const visibleDemands = demands('visible');
    const own = (owner: string) => renderHook(() => useBindings(service, owner, 'visible', visibleDemands, false));
    const panel = own('panel:1');
    const popup = own('popup:1');
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => execute.mock.calls[0][1](ready(5)));
    expect(panel.result.current.get('router', 'health')!.snapshot.state).toBe('ready');
    expect(popup.result.current.get('router', 'health')!.snapshot.state).toBe('ready');
    popup.unmount();
    await act(async () => execute.mock.calls[0][1](ready(6)));
    expect(panel.result.current.get('router', 'health')!.snapshot).toMatchObject({ frames: [frame(6)] });
    const again = own('popup:1');
    expect(again.result.current.get('router', 'health')!.snapshot.state).toBe('ready');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('frames', () => {
  it('a hover group change gives a new card frame and the same visible frame object', () => {
    const { store } = setup();
    store.want('panel:1', 'visible', demands('visible'));
    store.want('panel:1', 'card', demands('hover', { open: 'router' }));
    const visible = store.frame('panel:1', 'visible');
    const card = store.frame('panel:1', 'card');
    store.want('panel:1', 'card', demands('hover', { open: 'other' }));
    expect(store.frame('panel:1', 'card')).not.toBe(card);
    expect(store.frame('panel:1', 'card').get('other', 'health')).toBeDefined();
    expect(store.frame('panel:1', 'visible')).toBe(visible);
  });

  it('the frame object is identical when no Shown and no membership changed', async () => {
    const { store, emit, execute } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.want('panel:1', 'visible', demands('visible'));
    const first = store.frame('panel:1', 'visible');
    // an equal set: nothing watched, nobody notified
    store.want('panel:1', 'visible', demands('visible'));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.frame('panel:1', 'visible')).toBe(first);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    // an emission of another group (the speed query of the card) leaves the frame alone
    store.want('panel:1', 'card', demands('hover', { open: 'router' }));
    emit(1, ready(2));
    expect(store.frame('panel:1', 'visible')).toBe(first);
    emit(0, ready(1));
    expect(store.frame('panel:1', 'visible')).not.toBe(first);
  });

  it('notifies once per microtask batch, also for a release and for dispose', async () => {
    const { store, emit } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.want('panel:1', 'visible', demands('visible'));
    store.want('panel:1', 'card', demands('hover', { open: 'router' }));
    emit(0, ready(1));
    emit(1, ready(2));
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    const before = store.frame('panel:1', 'card').version;
    store.want('panel:1', 'card', []);
    expect(store.frame('panel:1', 'card').size).toBe(0);
    expect(store.frame('panel:1', 'card').version).toBeGreaterThan(before);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);
    store.dispose();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.frame('panel:1', 'visible').size).toBe(0);
  });

  it('dispose releases every watch', () => {
    const release = vi.fn();
    const watch = vi.fn<QueryController['watch']>(() => release);
    const store = createSnapshotStore({ watch, setPanelData: vi.fn(), dispose: vi.fn() });
    store.want('panel:1', 'visible', demands('visible'));
    store.want('panel:1', 'card', demands('hover', { open: 'router' }));
    expect(watch).toHaveBeenCalledTimes(3);
    store.dispose();
    expect(release).toHaveBeenCalledTimes(3);
    store.want('panel:1', 'visible', demands('visible'));
    expect(watch).toHaveBeenCalledTimes(3);
  });

  it('the owner frame holds every group and changes when a widget group changes', () => {
    const { store, emit } = setup();
    store.want('popup:1', 'bindings', demands('visible'));
    store.want('popup:1', 'widget:w', demands('widget', { width: 200 }));
    const owner = store.frame('popup:1');
    expect(owner.size).toBe(1);
    // the same pair in two groups: the settled one wins
    emit(1, ready(7));
    const next = store.frame('popup:1');
    expect(next).not.toBe(owner);
    expect(next.get('router', 'health')!.snapshot).toMatchObject({ state: 'ready', frames: [frame(7)] });
    expect(store.frame('popup:1', 'bindings').get('router', 'health')!.snapshot.state).toBe('loading');
  });

  it('a widget identity resolves at its anchor cell', () => {
    const { store, emit } = setup();
    const widgetDemands = demands('widget', { width: 200 });
    store.want('popup:1', 'widget:w', widgetDemands);
    emit(0, ready(7));
    const resolve = resolverFrom([store.frame('popup:1')], demandMap(widgetDemands), planOf(config()), data, {});
    expect(resolve('router', widget.binding)).toMatchObject({ state: 'ready', latestValue: 7 });
    expect(resolve('other', widget.binding)).toMatchObject({ state: 'idle' });
  });
});

describe('the render check', () => {
  const plan = planOf(config());
  it('resolves a demand with a new match key to loading, a new generation to kept, never to the old result as fresh', () => {
    const { store, emit } = setup();
    const current = demands('visible');
    store.want('panel:1', 'visible', current);
    emit(0, ready(1));
    const live = store.frame('panel:1', 'visible');
    const shown = live.get('router', 'health')!;
    expect(shownSnapshot(shown, current[0])).toBe(shown.snapshot);
    expect(shownSnapshot(shown, demands('visible', { expr: 'down' })[0])).toEqual({ state: 'loading' });
    expect(shownSnapshot(shown, demands('visible', { generation: 3 })[0])).toEqual({ state: 'loading' });
    const kept = shownSnapshot(shown, demands('visible', { generation: 2 })[0]);
    expect(kept).toMatchObject({ state: 'ready', fromCache: true, frames: [frame(1)] });
    // the kept copy is made once per result
    expect(shownSnapshot(shown, demands('visible', { generation: 2 })[0])).toBe(kept);
    expect(asKept(kept)).toBe(kept);
    const resolve = resolverFrom([live], demandMap(demands('visible', { expr: 'down' })), plan, data, {});
    expect(resolve('router', binding)).toEqual({ state: 'loading' });
    const refreshed = resolverFrom([live], demandMap(demands('visible', { generation: 2 })), plan, data, {});
    expect(refreshed('router', binding)).toMatchObject({ state: 'ready', fromCache: true, latestValue: 1 });
    const same = resolverFrom([live], demandMap(current), plan, data, {});
    expect(same('router', binding)).toMatchObject({ state: 'ready', fromCache: false, latestValue: 1 });
    expect(same('router', binding)).toBe(same('router', binding));
  });

  it('is idle for a pair that no frame holds, and reads a panel-source query from the panel data', () => {
    const { store } = setup();
    const cfg: DiagramConfig = {
      ...config(),
      queries: [{ id: 'health', name: 'H', source: { kind: 'panel', refId: 'H' } }, query('speed', 'speed')],
    };
    const panelPlan = planOf(cfg);
    const resolve = resolverFrom(
      [store.frame('panel:1', 'visible')],
      demandMap(demandsOf(panelPlan, cfg, context(1), 100, 'hover', 'router')),
      panelPlan,
      { ...data, series: [frame(9)] },
      {}
    );
    expect(resolve('router', binding)).toMatchObject({ state: 'ready', latestValue: 9 });
    expect(resolve('router', capacity)).toEqual({ state: 'idle' });
    expect(resolve('missing', binding)).toMatchObject({ state: 'unsupported' });
    expect(resolve('router', { ...binding, queryId: 'nope' })).toMatchObject({ state: 'unsupported' });
  });

  it('reads the frames in order: the card frame before the visible one', () => {
    const { store, emit } = setup();
    const visible = demands('visible');
    const hover = demands('hover', { open: 'router' });
    store.want('panel:1', 'visible', visible);
    store.want('panel:1', 'card', hover);
    emit(0, ready(4));
    const resolve = resolverFrom(
      [store.frame('panel:1', 'card'), store.frame('panel:1', 'visible')],
      demandMap(hover, visible),
      plan,
      data,
      {}
    );
    expect(resolve('router', binding)).toMatchObject({ state: 'ready', latestValue: 4 });
    expect(resolve('router', capacity)).toMatchObject({ state: 'loading' });
  });
});

describe('useBindings', () => {
  function hookSetup() {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    const service = testQueryService(controller, context(1));
    let renders = 0;
    const hook = renderHook(
      ({ paused, list }: { paused: boolean; list: StoreDemand[] }) => {
        renders++;
        return useBindings(service, 'test', 'visible', list, paused);
      },
      { initialProps: { paused: false, list: demands('visible') } }
    );
    // the store notifies in a microtask: the act must await it
    const emit = (value: number) =>
      act(async () => {
        execute.mock.calls[0][1](ready(value));
      });
    return { execute, hook, emit, service, renders: () => renders };
  }

  it('returns the empty frame without a store and the group frame with one', async () => {
    const none = renderHook(() => useBindings(undefined, 'test', 'visible', [], false));
    expect(none.result.current).toBe(EMPTY_FRAME);
    const { hook, emit } = hookSetup();
    expect(hook.result.current.get('router', 'health')!.snapshot.state).toBe('loading');
    await emit(1);
    expect(hook.result.current.get('router', 'health')!.snapshot).toMatchObject({ frames: [frame(1)] });
  });

  it('renders nothing for an emission while paused; the first render after the pause has the latest result', async () => {
    const { hook, emit, renders } = hookSetup();
    await emit(1);
    const live = hook.result.current;
    hook.rerender({ paused: true, list: demands('visible') });
    const paused = renders();
    await emit(2);
    await emit(3);
    expect(renders()).toBe(paused);
    expect(hook.result.current).toBe(live);
    hook.rerender({ paused: false, list: demands('visible') });
    expect(renders() - paused).toBe(1);
    expect(hook.result.current.get('router', 'health')!.snapshot).toMatchObject({ frames: [frame(3)] });
  });

  it('1000 emissions while paused give one render at the resume', async () => {
    const { hook, emit, renders, execute } = hookSetup();
    await emit(0);
    hook.rerender({ paused: true, list: demands('visible') });
    const paused = renders();
    await act(async () => {
      for (let i = 1; i <= 1000; i++) {
        execute.mock.calls[0][1](ready(i));
      }
    });
    expect(renders()).toBe(paused);
    hook.rerender({ paused: false, list: demands('visible') });
    expect(renders() - paused).toBe(1);
    expect(hook.result.current.get('router', 'health')!.snapshot).toMatchObject({ frames: [frame(1000)] });
  });

  it('shows the result of a changed query as loading, and drops the old one when the effect re-watches', async () => {
    const { hook, emit, execute } = hookSetup();
    await emit(1);
    hook.rerender({ paused: false, list: demands('visible', { expr: 'down' }) });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(hook.result.current.get('router', 'health')!).toMatchObject({ kept: false });
    expect(hook.result.current.get('router', 'health')!.snapshot.state).toBe('loading');
  });

  it('releases its group on unmount', () => {
    const { hook, service } = hookSetup();
    expect(service.store!.frame('test', 'visible').size).toBe(1);
    hook.unmount();
    expect(service.store!.frame('test', 'visible').size).toBe(0);
  });
});
