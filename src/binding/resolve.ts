import { rowBindings, rowCapacityBindings, type QueryBinding } from '../model/config';
import type { BindingPlan, EffectiveCellBinding } from './patterns';

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
