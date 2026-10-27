import { renderHook } from '@testing-library/react';
import { createTheme, getDefaultTimeRange, LoadingState, type PanelData } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { bindContextFor } from '../binding/context';
import type { DiagramConfig, NamedQuery } from '../model/config';
import type { PanelQueryService } from '../query/panel';
import { EMPTY_FRAME, matchKeyOf, type Frame, type SnapshotStore } from '../query/store';
import type { QueryContext } from '../query/types';
import type { CellMeta } from '../types';
import { useBoundDiagram, type BindGroups, type BoundDiagramInputs } from './useBoundDiagram';

vi.mock('@grafana/runtime', () => ({ getTemplateSrv: () => ({ getVariables: () => [] }) }));

const binding = { queryId: 'q', match: {}, reducer: 'last' } as const;
const widgetBinding = { ...binding, queryId: 'w' };
const query = (id: string): NamedQuery => ({
  id,
  name: id,
  source: { kind: 'datasource', datasource: { uid: 'ds' }, target: { refId: 'D' }, parameters: {} },
});
const config: DiagramConfig = {
  version: 3,
  queries: [query('q'), query('w')],
  overrides: [],
  widgets: [{ id: 'w', anchorCellId: 'b', kind: 'sparkline', label: 'W', binding: widgetBinding }],
  patterns: [
    {
      id: 'p',
      name: 'All',
      select: {},
      display: { shape: { binding }, hover: { rows: [{ kind: 'value', label: 'V', binding }] } },
    },
  ],
};
const meta = (id: string): CellMeta => ({ id, kind: 'node', key: id, attrs: {}, labelText: id, isEdge: false });
const metas = [meta('a'), meta('b')];
const context: QueryContext = {
  timeRange: getDefaultTimeRange(),
  timeZone: 'utc',
  scopedVars: {},
  refreshMs: 0,
  intervalMs: 1000,
  generation: 1,
};
const data: PanelData = { state: LoadingState.Done, series: [], timeRange: context.timeRange };
const theme = createTheme();
const bindContext = bindContextFor({
  theme,
  replaceVariables: (text) => text,
  timeZone: 'utc',
  linkWidth: { min: 1, max: 4 },
});
const format = { theme, timeZone: 'utc' };

/** A store that records the wanted groups. The owner frame holds an empty result of the widget query at `b`. */
function spyService() {
  const want = vi.fn<SnapshotStore['want']>();
  const owner: Frame = {
    version: 1,
    size: 1,
    get: (cellId, queryId) => {
      if (cellId !== 'b' || queryId !== 'w') {
        return undefined;
      }
      const demand = want.mock.calls.flatMap(([, , demands]) => demands).find((d) => d.cellId === 'b')!;
      const matchKey = matchKeyOf(query('w'), demand.scope, context);
      const snapshot = { state: 'ready' as const, frames: [], fetchedAt: 1, fromCache: false };
      return { snapshot, kept: false, generation: 1, matchKey, maxDataPoints: 264, demand };
    },
  };
  const frame = vi.fn<SnapshotStore['frame']>((_, group) => (group === undefined ? owner : EMPTY_FRAME));
  const store: SnapshotStore = { want, frame, subscribe: () => () => {}, dispose: () => {} };
  const service = { controller: {} as never, store, context } as PanelQueryService;
  const wanted = () =>
    want.mock.calls.map(([owner, group, demands]) => `${owner}/${group}: ${demands.map((d) => d.cellId).join(',')}`);
  return { service, want, frame, wanted };
}

function render(groups: BindGroups, service: PanelQueryService) {
  const inputs = (openCellId?: string): BoundDiagramInputs => ({
    metas,
    config,
    service,
    owner: 'o',
    groups,
    maxDataPoints: 264,
    data,
    bindContext,
    format,
    openCellId,
    paused: false,
  });
  const hook = renderHook((props: { openCellId?: string }) => useBoundDiagram(inputs(props.openCellId)), {
    initialProps: {},
  });
  return { ...hook, open: (cellId: string) => hook.rerender({ openCellId: cellId }) };
}

describe('useBoundDiagram', () => {
  it('with a card group, the open card is a group of its own and a new open cell keeps the diagram resolver and bind', () => {
    const { service, wanted, frame } = spyService();
    const { result, open } = render({ visible: 'visible', card: 'card' }, service);
    const { resolve, bound, cardResolve } = result.current;
    expect(cardResolve).toBe(resolve);
    open('a');
    expect(result.current.resolve).toBe(resolve);
    expect(result.current.bound).toBe(bound);
    expect(result.current.cardResolve).not.toBe(resolve);
    expect(wanted()).toEqual(['o/visible: a,b', 'o/card: ', 'o/card: a']);
    // each reader reads its own group
    expect(new Set(frame.mock.calls.map(([, group]) => group))).toEqual(new Set(['visible', 'card']));
  });

  it('without a card group, the hover rows join the one group, the resolver reads the owner frame and knows the widgets', () => {
    const { service, wanted, frame } = spyService();
    const { result, open } = render({ visible: 'bindings' }, service);
    open('a');
    expect(wanted()).toEqual(['o/bindings: a,b', 'o/bindings: a,b,a']);
    expect(new Set(frame.mock.calls.map(([, group]) => group))).toEqual(new Set([undefined]));
    expect(result.current.cardResolve).toBe(result.current.resolve);
    // the widget at `b` resolves through the owner frame: its result, not an unknown identity
    expect(result.current.resolve('b', widgetBinding).state).toBe('empty');
  });

  it('puts the override layer over the saved resolver', () => {
    const { service } = spyService();
    const override = vi.fn(() => () => ({ state: 'loading' as const }));
    const { result } = renderHook(() =>
      useBoundDiagram({
        metas,
        config,
        service,
        owner: 'o',
        groups: { visible: 'bindings' },
        maxDataPoints: 264,
        data,
        bindContext,
        format,
        openCellId: undefined,
        paused: false,
        override,
      })
    );
    expect(override).toHaveBeenCalledWith(expect.any(Function), result.current.plan);
    expect(result.current.resolve('a', binding).state).toBe('loading');
  });
});
