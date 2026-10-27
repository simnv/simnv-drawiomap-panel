import { getDefaultTimeRange } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import type { DiagramConfig, NamedQuery, QueryBinding, Widget } from '../model/config';
import { matchKeyOf, type StoreDemand } from '../query/store';
import type { QueryContext } from '../query/types';
import type { BindingPlan } from './patterns';
import { demandsOf } from './resolve';

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
const config = (): DiagramConfig => ({
  version: 3,
  queries: [query(), query('speed', 'speed')],
  patterns: [],
  overrides: [],
  widgets: [widget],
});
const scope = { cell: { key: 'router' } };
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
        scope: { cell: { key: 'other' } },
        bindings: [binding],
        display: { hover: { rows: [{ kind: 'value', label: 'Value', binding }] } },
      },
    },
    widgets: [{ widget, anchorCellId: 'router', scope, index: 0 }],
    diagnostics: [],
    config: cfg,
  }) as unknown as BindingPlan;
const ctx: QueryContext = {
  timeRange: getDefaultTimeRange(),
  timeZone: 'utc',
  scopedVars: {},
  refreshMs: 0,
  intervalMs: 1000,
  generation: 1,
};
/** The demands of a role of the plan above, at the resolution 100. */
const demands = (role: 'visible' | 'hover' | 'widget', { open }: { open?: string } = {}) =>
  demandsOf(planOf(config()), ctx, 100, role, open);

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
    expect(d.matchKey).toBe(matchKeyOf(query(), scope, ctx));
    expect(d.maxDataPoints).toBe(100);
    expect(demandsOf(planOf(config()), undefined, 100, 'visible')).toEqual([]);
  });
  it('skips a panel-source query: the resolver reads it from the panel data', () => {
    const cfg: DiagramConfig = {
      ...config(),
      queries: [{ id: 'health', name: 'H', source: { kind: 'panel', refId: 'A' } }],
    };
    expect(demandsOf(planOf(cfg), ctx, 100, 'visible')).toEqual([]);
  });

  // One binding object per place: the plan keeps a binding for a cell by identity (`cell.bindings`).
  const on = (queryId: string): QueryBinding => ({ queryId, match: {}, reducer: 'last' });
  const cellOf = (cellId: string, display: object, bindings: QueryBinding[]) => ({
    cellId,
    scope: { cell: { key: cellId } },
    bindings,
    display,
  });
  const planWith = (cells: Array<ReturnType<typeof cellOf>>, widgets: object[] = []): BindingPlan =>
    ({
      cells: Object.fromEntries(cells.map((cell) => [cell.cellId, cell])),
      widgets,
      diagnostics: [],
      config: { ...config(), queries: [...config().queries, query('extra', 'extra')] },
    }) as unknown as BindingPlan;
  const pairs = (list: StoreDemand[]) => list.map((d) => [d.cellId, d.query.id]);

  it('keeps the plan order and the query, scope and context objects of the plan', () => {
    const [speed, health, extra, shape] = [on('speed'), on('health'), on('extra'), on('health')];
    const plan = planWith([
      cellOf('b', { status: { binding: extra }, link: { a2b: { binding: speed, capacityBinding: health } } }, [
        speed,
        health,
        extra,
      ]),
      cellOf('a', { shape: { binding: shape } }, [shape]),
    ]);
    const list = demandsOf(plan, ctx, 100, 'visible');
    expect(pairs(list)).toEqual([
      ['b', 'speed'],
      ['b', 'health'],
      ['b', 'extra'],
      ['a', 'health'],
    ]);
    expect(list[0].query).toBe(plan.config.queries[1]);
    expect(list[0].scope).toBe(plan.cells.b.scope);
    expect(list[3].scope).toBe(plan.cells.a.scope);
    expect(list[0].context).toBe(ctx);
  });

  it('demands the capacity bindings: of a link half, of the link, of a card row; a capacity alone too', () => {
    const [ua, ca, cap] = [on('health'), on('speed'), on('extra')];
    const halves = planWith([
      cellOf('l', { link: { a2b: { binding: ua, capacityBinding: ca }, capacityBinding: cap } }, [ua, ca, cap]),
    ]);
    expect(pairs(demandsOf(halves, ctx, 100, 'visible'))).toEqual([
      ['l', 'health'],
      ['l', 'speed'],
      ['l', 'extra'],
    ]);
    const only = on('speed');
    const capacityOnly = planWith([cellOf('l', { link: { capacityBinding: only } }, [only])]);
    expect(pairs(demandsOf(capacityOnly, ctx, 100, 'visible'))).toEqual([['l', 'speed']]);
    const rowCapacity = on('speed');
    const row = { kind: 'value', label: 'Speed', binding: rowCapacity };
    const card = planWith([cellOf('n', { hover: { rows: [row] } }, [rowCapacity])]);
    expect(pairs(demandsOf(card, ctx, 100, 'hover', 'n'))).toEqual([['n', 'speed']]);
    expect(demandsOf(card, ctx, 100, 'visible')).toEqual([]);
  });

  it('skips a disabled cell or section and a binding that the plan did not keep for the cell', () => {
    const [shape, status, link, row, dropped] = [on('health'), on('speed'), on('extra'), on('health'), on('speed')];
    const display = {
      shape: { binding: shape },
      status: { binding: status },
      link: { capacityBinding: link },
      hover: { rows: [{ kind: 'value', label: 'Value', binding: row }] },
    };
    const bindings = [shape, status, link, row];
    const visible = (cell: ReturnType<typeof cellOf>) => pairs(demandsOf(planWith([cell]), ctx, 100, 'visible'));
    const hover = (cell: ReturnType<typeof cellOf>) =>
      pairs(demandsOf(planWith([cell]), ctx, 100, 'hover', cell.cellId));
    expect(visible(cellOf('c', display, bindings))).toEqual([
      ['c', 'extra'],
      ['c', 'health'],
      ['c', 'speed'],
    ]);
    expect(visible(cellOf('c', { ...display, enabled: false }, bindings))).toEqual([]);
    expect(hover(cellOf('c', { ...display, enabled: false }, bindings))).toEqual([]);
    expect(visible(cellOf('c', { ...display, link: { enabled: false, capacityBinding: link } }, bindings))).toEqual([
      ['c', 'health'],
      ['c', 'speed'],
    ]);
    expect(visible(cellOf('c', { ...display, shape: { enabled: false, binding: shape } }, bindings))).toEqual([
      ['c', 'extra'],
      ['c', 'speed'],
    ]);
    expect(visible(cellOf('c', { ...display, status: { enabled: false, binding: status } }, bindings))).toEqual([
      ['c', 'extra'],
      ['c', 'health'],
    ]);
    expect(hover(cellOf('c', display, bindings))).toEqual([['c', 'health']]);
    expect(hover(cellOf('c', { ...display, hover: { ...display.hover, enabled: false } }, bindings))).toEqual([]);
    expect(visible(cellOf('c', { shape: { binding: dropped } }, []))).toEqual([]);
    expect(hover(cellOf('c', { hover: { rows: [{ kind: 'value', label: 'V', binding: dropped }] } }, []))).toEqual([]);
  });

  it('reads only the open cell when the card changes, however many cells the plan has', () => {
    const cells = Array.from({ length: 200 }, (_, i) => {
      const b = on('health');
      return cellOf(`c${i}`, { shape: { binding: b }, hover: { rows: [{ kind: 'value', label: 'V', binding: b }] } }, [
        b,
      ]);
    });
    const plan = planWith(cells);
    const visited = new Set<string>();
    const counted: BindingPlan = {
      ...plan,
      cells: new Proxy(plan.cells, {
        get: (target, key) => {
          visited.add(String(key));
          return Reflect.get(target, key);
        },
        ownKeys: (target) => {
          visited.add('every cell');
          return Reflect.ownKeys(target);
        },
      }),
    };
    for (const open of ['c7', 'c150']) {
      visited.clear();
      expect(pairs(demandsOf(counted, ctx, 100, 'hover', open))).toEqual([[open, 'health']]);
      expect([...visited]).toEqual([open]);
    }
  });

  it('gives no hover demand for a missing or closed card, and none for a cell that is not in the plan', () => {
    const plan = planOf(config());
    expect(demandsOf(plan, ctx, 100, 'hover', 'nowhere')).toEqual([]);
    expect(demandsOf(plan, ctx, 100, 'hover')).toEqual([]);
    // the widget anchor is not a cell of the plan: no scope, no demand
    const lost = planWith([], [{ widget, anchorCellId: 'gone', scope, index: 0 }]);
    expect(demandsOf(lost, ctx, 100, 'widget')).toEqual([]);
  });
});
