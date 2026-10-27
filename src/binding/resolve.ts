import type { PanelData } from '@grafana/data';
import { rowBindings, rowCapacityBindings, type QueryBinding } from '../model/config';
import type { HistoryFormat } from '../query/frames';
import { panelSnapshot } from '../query/panelSnapshot';
import { matchKeyOf, pairKey, shownSnapshot, type Frame, type Shown, type StoreDemand } from '../query/store';
import type { QueryContext, QuerySnapshot } from '../query/types';
import { resolveBinding, type BindingResolver } from './engine';
import type { BindingPlan, EffectiveCellBinding } from './patterns';

// The plan side of the snapshot store: what each role wants from the queries, and the resolver over the store frames.
// The store knows no plan.

export interface BindingDemand {
  /** the cell, or the anchor cell of a chart widget */
  cellId: string;
  binding: QueryBinding;
  role: 'visible' | 'hover' | 'widget';
  rowIndex?: number;
  /** the path of the binding in its row: `binding`, `capacityBinding`, `series[j].binding`, `series[j].capacityBinding` */
  path?: string;
}

/** A binding of a cell runs when the display of the cell is on and the plan kept the binding for the cell. */
const runs = (cell: EffectiveCellBinding, binding: QueryBinding | undefined): binding is QueryBinding =>
  !!binding && cell.display.enabled !== false && cell.bindings.includes(binding);

/** The bindings that paint the cells: link halves and capacities, shape and status. Does not run queries. */
export function visibleDemands(plan: BindingPlan): BindingDemand[] {
  const demands: BindingDemand[] = [];
  for (const cell of Object.values(plan.cells)) {
    const d = cell.display;
    const visible = [
      ...(d.link?.enabled === false
        ? []
        : [
            d.link?.a2b?.binding,
            d.link?.a2b?.capacityBinding,
            d.link?.b2a?.binding,
            d.link?.b2a?.capacityBinding,
            d.link?.capacityBinding,
          ]),
      d.shape?.enabled === false ? undefined : d.shape?.binding,
      d.status?.enabled === false ? undefined : d.status?.binding,
    ];
    for (const binding of visible) {
      if (runs(cell, binding)) {
        demands.push({ cellId: cell.cellId, binding, role: 'visible' });
      }
    }
  }
  return demands;
}

/** The bindings of the card rows of one cell. It reads that cell only: a card change costs no walk of the plan. */
export function hoverDemands(plan: BindingPlan, cellId: string): BindingDemand[] {
  const cell = plan.cells[cellId] as EffectiveCellBinding | undefined;
  const hover = cell?.display.hover;
  if (!cell || !hover || hover.enabled === false) {
    return [];
  }
  const demands: BindingDemand[] = [];
  hover.rows.forEach((row, rowIndex) => {
    for (const { binding, path } of [...rowBindings(row), ...rowCapacityBindings(row)]) {
      if (runs(cell, binding)) {
        demands.push({ cellId, binding, role: 'hover', rowIndex, path });
      }
    }
  });
  return demands;
}

/** The binding of each chart widget, at its anchor cell. */
export function widgetDemands(plan: BindingPlan): BindingDemand[] {
  return plan.widgets.map((entry) => ({ cellId: entry.anchorCellId, binding: entry.widget.binding, role: 'widget' }));
}

/**
 * The demands of one role of a plan: one per `(cellId, queryId)` pair, with the match key. A panel-source query is
 * not a demand: the resolver reads it from the panel data.
 */
export function demandsOf(
  plan: BindingPlan,
  context: QueryContext | undefined,
  maxDataPoints: number,
  role: BindingDemand['role'],
  openCellId?: string
): StoreDemand[] {
  if (!context) {
    return [];
  }
  const queries = new Map(plan.config.queries.map((query) => [query.id, query] as const));
  const seen = new Set<string>();
  const demands: StoreDemand[] = [];
  const selected =
    role === 'visible'
      ? visibleDemands(plan)
      : role === 'widget'
        ? widgetDemands(plan)
        : openCellId === undefined
          ? []
          : hoverDemands(plan, openCellId);
  for (const demand of selected) {
    const pair = pairKey(demand.cellId, demand.binding.queryId);
    if (seen.has(pair)) {
      continue;
    }
    const query = queries.get(demand.binding.queryId);
    const scope = plan.cells[demand.cellId]?.scope;
    if (!query || query.source.kind === 'panel' || !scope) {
      continue;
    }
    seen.add(pair);
    demands.push({
      cellId: demand.cellId,
      query,
      scope,
      context,
      maxDataPoints,
      matchKey: matchKeyOf(query, scope, context),
    });
  }
  return demands;
}

/** The demands by pair key, the first of a pair winning: the identities a resolver can be asked for. */
export function demandMap(...lists: StoreDemand[][]): Map<string, StoreDemand> {
  const map = new Map<string, StoreDemand>();
  for (const list of lists) {
    for (const demand of list) {
      const pair = pairKey(demand.cellId, demand.query.id);
      if (!map.has(pair)) {
        map.set(pair, demand);
      }
    }
  }
  return map;
}

const IDLE: QuerySnapshot = { state: 'idle' };

/**
 * The resolver of `bindPlan` and of the card over the frames of a render: a Map lookup per `(cellId, queryId)`,
 * then the history cache. `demands` holds every identity the resolver can be asked for.
 */
export function resolverFrom(
  frames: Frame[],
  demands: Map<string, StoreDemand>,
  plan: BindingPlan,
  data: PanelData,
  format: HistoryFormat
): BindingResolver {
  const queries = new Map(plan.config.queries.map((query) => [query.id, query] as const));
  return (cellId, binding) => {
    const query = queries.get(binding.queryId);
    const scope = plan.cells[cellId]?.scope;
    if (!query || !scope) {
      return { state: 'unsupported', message: 'The query or element is unavailable.' };
    }
    if (query.source.kind === 'panel') {
      return resolveBinding(panelSnapshot(data, query.source.refId), binding, scope, format);
    }
    const demand = demands.get(pairKey(cellId, binding.queryId));
    let shown: Shown | undefined;
    for (const frame of frames) {
      shown = frame.get(cellId, binding.queryId);
      if (shown) {
        break;
      }
    }
    return resolveBinding(demand && shown ? shownSnapshot(shown, demand) : IDLE, binding, scope, format);
  };
}
