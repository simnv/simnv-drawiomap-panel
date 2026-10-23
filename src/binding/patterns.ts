import type { CellMeta, SeriesSelector, TemplateScope } from '../types';
import { cellMatches } from './select';
import {
  displayBindings,
  validateConfig,
  type DiagramConfigV2,
  type Diagnostic,
  type DisplayConfig,
  type QueryBinding,
  type Widget,
} from '../model/config';
import { cellIdentityDiagnostics, cellScope } from '../adapter/portograph';

export interface EffectiveCellBinding {
  cellId: string;
  scope: TemplateScope;
  display: DisplayConfig;
  patternIds: string[];
  overridden: boolean;
  bindings: QueryBinding[];
}
export interface BindingPlan {
  cells: Record<string, EffectiveCellBinding>;
  widgets: Array<{
    widget: Widget;
    anchorCellId: string;
    scope: TemplateScope;
    /** index in config.widgets */ index: number;
  }>;
  diagnostics: Diagnostic[];
}

function mergeFields<T extends object>(base: T | undefined, patch: T | undefined): T | undefined {
  return patch === undefined ? base : { ...base, ...patch };
}

function mergeSelector<T extends SeriesSelector | QueryBinding>(
  base: T | undefined,
  patch: T | undefined
): T | undefined {
  return patch === undefined ? base : { ...base, ...patch, match: mergeFields(base?.match, patch.match) };
}

/** Merge only the known nested settings. Arrays replace; changing a status kind replaces that rule. */
function mergeDisplay(base: DisplayConfig, patch: DisplayConfig | undefined): DisplayConfig {
  if (!patch) {
    return base;
  }
  const result: DisplayConfig = { ...base, ...patch };
  if (patch.link) {
    const previous = base.link;
    result.link = {
      ...previous,
      ...patch.link,
      a2b: mergeSelector(previous?.a2b, patch.link.a2b),
      b2a: mergeSelector(previous?.b2a, patch.link.b2a),
      a2bBinding: mergeSelector(previous?.a2bBinding, patch.link.a2bBinding),
      b2aBinding: mergeSelector(previous?.b2aBinding, patch.link.b2aBinding),
      capacityBinding: mergeSelector(previous?.capacityBinding, patch.link.capacityBinding),
      capacityA2bBinding: mergeSelector(previous?.capacityA2bBinding, patch.link.capacityA2bBinding),
      capacityB2aBinding: mergeSelector(previous?.capacityB2aBinding, patch.link.capacityB2aBinding),
      capacity:
        typeof patch.link.capacity === 'object'
          ? mergeSelector(typeof previous?.capacity === 'object' ? previous.capacity : undefined, patch.link.capacity)
          : (patch.link.capacity ?? previous?.capacity),
      card: mergeFields(previous?.card, patch.link.card),
    };
  }
  if (patch.shape) {
    result.shape = {
      ...base.shape,
      ...patch.shape,
      series: mergeSelector(base.shape?.series, patch.shape.series),
      binding: mergeSelector(base.shape?.binding, patch.shape.binding),
      sparkline: mergeSelector(base.shape?.sparkline, patch.shape.sparkline),
    };
  }
  if (patch.hover) {
    result.hover = mergeFields(base.hover, patch.hover);
  }
  if (patch.status && base.status?.kind === patch.status.kind) {
    result.status = {
      ...base.status,
      ...patch.status,
      binding: mergeSelector(base.status.binding, patch.status.binding)!,
      default: mergeFields(base.status.default, patch.status.default)!,
      freshness: mergeFields(base.status.freshness, patch.status.freshness),
    };
  }
  // The schema admits JSON settings only. Clone inherited arrays/records so cells never share mutable settings.
  return JSON.parse(JSON.stringify(result));
}

function activeBindings(display: DisplayConfig): ReturnType<typeof displayBindings> {
  if (display.enabled === false) {
    return [];
  }
  return displayBindings({
    ...display,
    link: display.link?.enabled === false ? undefined : display.link,
    shape: display.shape?.enabled === false ? undefined : display.shape,
    status: display.status?.enabled === false ? undefined : display.status,
    hover: display.hover?.enabled === false ? undefined : display.hover,
  });
}

export function resolvePatterns(cells: CellMeta[], input: DiagramConfigV2): BindingPlan {
  const plan: BindingPlan = { cells: Object.create(null), widgets: [], diagnostics: [] };
  const validated = validateConfig(input);
  plan.diagnostics.push(...validated.diagnostics, ...cellIdentityDiagnostics(cells));
  if (!validated.config || plan.diagnostics.length) {
    return plan;
  }
  const config = validated.config;
  const queries = new Map(config.queries.map((query) => [query.id, query]));
  const parameters = (binding: QueryBinding, scope: TemplateScope, path: string) => {
    const source = queries.get(binding.queryId)?.source;
    if (source?.kind !== 'datasource') {
      return true;
    }
    let valid = true;
    for (const [name, scopePath] of Object.entries(source.parameters)) {
      const [root, key] = scopePath.split('.') as ['cell' | 'from' | 'to', string];
      const values = scope[root];
      if (!values || !Object.prototype.hasOwnProperty.call(values, key) || typeof values[key] !== 'string') {
        valid = false;
        plan.diagnostics.push({
          code: 'missing-parameter-path',
          path: `${path}.parameters.${name}`,
          message: `Query ${binding.queryId} requires ${scopePath}. Add this metadata to the element or change parameter ${name}.`,
        });
      }
    }
    return valid;
  };
  for (const cell of cells) {
    const matching = config.patterns.filter((p) => cellMatches(p.select, cell));
    const override = config.overrides.find((o) => o.cellId === cell.id);
    let display: DisplayConfig = {};
    for (const patch of [...matching.map((p) => p.display), override?.display]) {
      display = mergeDisplay(display, patch);
    }
    const scope = cellScope(cell);
    const bindings = activeBindings(display).filter(({ binding, path }) =>
      parameters(binding, scope, `cells.${cell.id}.${path}`)
    );
    plan.cells[cell.id] = {
      cellId: cell.id,
      scope,
      display,
      patternIds: matching.map((p) => p.id),
      overridden: !!override,
      bindings: bindings.map(({ binding }) => binding),
    };
  }
  config.overrides.forEach((override, i) => {
    if (!plan.cells[override.cellId]) {
      plan.diagnostics.push({
        code: 'missing-cell',
        path: `overrides[${i}].cellId`,
        message: `Override refers to missing cell ${override.cellId}. Select an existing cell or remove the override.`,
      });
    }
  });
  config.widgets.forEach((widget, i) => {
    const anchor = plan.cells[widget.anchorCellId];
    if (!anchor) {
      plan.diagnostics.push({
        code: 'missing-anchor',
        path: `widgets[${i}].anchorCellId`,
        message: `Widget ${widget.id} needs anchor ${widget.anchorCellId}.`,
      });
    } else if (parameters(widget.binding, anchor.scope, `widgets[${i}].binding`)) {
      plan.widgets.push({ widget, anchorCellId: anchor.cellId, scope: anchor.scope, index: i });
    }
  });
  return plan;
}
