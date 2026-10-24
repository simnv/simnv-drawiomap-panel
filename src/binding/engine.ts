import { type Field, formattedValueToString, getValueFormat } from '@grafana/data';
import type {
  BindContext,
  CapacitySource,
  CellPatch,
  HalfState,
  SeriesInfo,
  ShapeTarget,
  TemplateScope,
} from '../types';
import { colorFor, noDataColor, widthFor } from './color';
import { resolveTemplate, shield } from './template';
import { toBitsPerSecond } from './units';
import { isAllowedUrl } from './url';
import {
  rowBindings,
  type Diagnostic,
  type HoverSpec,
  type LinkCapacity,
  type QueryBinding,
  type ShapeDisplay,
} from '../model/config';
import { toHistory, type HistoryModel, type HistoryFormat } from '../query/frames';
import type { BindingPlan } from './patterns';
import type { QuerySnapshot } from '../query/types';
import { evaluateStatus, summarizeStatuses, type StatusSummary, type StatusView } from './status';

export interface PlanCellPatch extends CellPatch {
  statusView?: StatusView;
  hover?: HoverSpec;
  unavailableHoverRows?: number[];
}
/** Read prepared models only. Query subscriptions belong to the caller. */
export type BindingResolver = (cellId: string, binding: QueryBinding) => HistoryModel;
export function resolveBinding(
  snapshot: QuerySnapshot,
  binding: QueryBinding,
  scope: TemplateScope,
  format?: HistoryFormat
): HistoryModel {
  const unresolved: string[] = [];
  const text = (template: string) => {
    const result = resolveTemplate(template, scope);
    unresolved.push(...result.unresolved);
    return result.text;
  };
  const resolved: QueryBinding = {
    ...binding,
    match: Object.fromEntries(Object.entries(binding.match).map(([key, template]) => [key, text(template)])),
    field: binding.field === undefined ? undefined : text(binding.field),
  };
  return unresolved.length
    ? { state: 'unsupported', message: `Unresolved binding metadata: ${[...new Set(unresolved)].join(', ')}` }
    : toHistory(snapshot, resolved, format);
}
export interface BindingDemand {
  cellId: string;
  binding: QueryBinding;
  role: 'visible' | 'hover';
  rowIndex?: number;
  /** the index in the series list of a combined row */
  seriesIndex?: number;
}
/** Describes visible data plus the open card's rows; does not register or execute queries. */
export function collectBindingDemands(plan: BindingPlan, openCellId?: string): BindingDemand[] {
  const demands: BindingDemand[] = [];
  for (const cell of Object.values(plan.cells)) {
    const d = cell.display;
    if (d.enabled === false) {
      continue;
    }
    const visible = [
      ...(d.link?.enabled === false
        ? []
        : [
            d.link?.a2bBinding,
            d.link?.b2aBinding,
            d.link?.capacityBinding,
            d.link?.capacityA2bBinding,
            d.link?.capacityB2aBinding,
          ]),
      d.shape?.enabled === false ? undefined : d.shape?.binding,
      d.status?.enabled === false ? undefined : d.status?.binding,
    ];
    for (const binding of visible) {
      if (binding && cell.bindings.includes(binding)) {
        demands.push({ cellId: cell.cellId, binding, role: 'visible' });
      }
    }
    if (cell.cellId === openCellId && d.hover?.enabled !== false) {
      d.hover?.rows.forEach((row, rowIndex) => {
        if ('series' in row) {
          row.series.forEach(({ binding }, seriesIndex) => {
            if (cell.bindings.includes(binding)) {
              demands.push({ cellId: cell.cellId, binding, role: 'hover', rowIndex, seriesIndex });
            }
          });
        } else if ('binding' in row && cell.bindings.includes(row.binding)) {
          demands.push({ cellId: cell.cellId, binding: row.binding, role: 'hover', rowIndex });
        }
      });
    }
  }
  return demands;
}
/** The one place that words a metric that did not resolve: no match, an ambiguous match, an error. */
export function metricProblem(
  model: HistoryModel,
  binding: QueryBinding
): { code: string; message: string } | undefined {
  if (model.state !== 'empty' && model.state !== 'unsupported' && model.state !== 'error') {
    return undefined;
  }
  const message = model.state === 'empty' ? `No metric matches query ${binding.queryId}.` : model.message;
  return {
    code:
      model.state === 'empty'
        ? 'unmatched-metric'
        : message.toLowerCase().includes('ambiguous')
          ? 'ambiguous-metric'
          : `${model.state}-metric`,
    message,
  };
}

/** Resolve the binding of every chart region at its anchor cell, as bindPlan does for the cells. */
export function widgetDiagnostics(plan: BindingPlan, resolve: BindingResolver): Diagnostic[] {
  return plan.widgets.flatMap((entry) => {
    const problem = metricProblem(resolve(entry.anchorCellId, entry.widget.binding), entry.widget.binding);
    return problem ? [{ ...problem, path: `widgets[${entry.index}].binding` }] : [];
  });
}

export interface PlanBindResult {
  patches: Map<string, PlanCellPatch>;
  diagnostics: Diagnostic[];
  summaries: StatusSummary[];
}

export function historySeries(model: Extract<HistoryModel, { state: 'ready' }>, binding: QueryBinding): SeriesInfo {
  const numeric = model.values.flatMap((value, i) => (value === null ? [] : [{ value, time: model.timestamps[i] }]));
  return {
    refId: binding.queryId,
    name: model.field.name,
    labels: model.field.labels ?? {},
    field: model.field,
    values: numeric.map((v) => v.value),
    times: numeric.map((v) => v.time),
    frame: { length: model.values.length, fields: [model.timeField, model.field] },
  };
}

export function bindPlan(plan: BindingPlan, resolve: BindingResolver, ctx: BindContext, nowMs: number): PlanBindResult {
  const result: PlanBindResult = { patches: new Map(), diagnostics: [...plan.diagnostics], summaries: [] };
  for (const cell of Object.values(plan.cells)) {
    const display = cell.display;
    if (display.enabled === false) {
      continue;
    }
    const patch: PlanCellPatch = {
      cellId: cell.cellId,
      scope: cell.scope,
      ruleNames: cell.patternIds,
      urls: [],
      warnings: [],
    };
    let primary: SeriesInfo | undefined;
    patch.hover = display.hover;
    patch.unavailableHoverRows = display.hover?.rows.flatMap((row, i) =>
      rowBindings(row).some(({ binding }) => !cell.bindings.includes(binding)) ? [i] : []
    );
    const read = (binding: QueryBinding, path: string): HistoryModel => {
      const model = resolve(cell.cellId, binding);
      const problem = metricProblem(model, binding);
      if (problem) {
        const { message } = problem;
        result.diagnostics.push({ ...problem, path: `cells.${cell.cellId}.${path}` });
        patch.statusView ??= {
          state: 'missing',
          reason: message,
          queryIds: [binding.queryId],
          conditionKey: JSON.stringify(['availability', binding.queryId, model.state, message]),
          coverage: { available: 0, expected: 1 },
        };
      }
      return model;
    };
    if (display.link?.enabled !== false && display.link) {
      const link = display.link;
      let cap = capacityOf(link.capacity, cell.scope);
      if (cap.unresolved.length) {
        result.diagnostics.push({
          code: 'unresolved-metadata',
          path: `cells.${cell.cellId}.link.capacity`,
          message: `Capacity is not usable: ${[...new Set(cap.unresolved)].join(', ')}`,
        });
      }
      if (link.capacityBinding && cell.bindings.includes(link.capacityBinding)) {
        cap = capacityFromBinding(read(link.capacityBinding, 'link.capacityBinding'), link.capacityBinding) ?? cap;
      }
      const states: HalfState[] = [];
      patch.link = {};
      for (const direction of ['a2b', 'b2a'] as const) {
        const binding = link[`${direction}Binding`];
        if (!binding || !cell.bindings.includes(binding)) {
          continue;
        }
        const model = read(binding, `link.${direction}Binding`);
        // the capacity of this half: its own binding, its own number or template, then the shared capacity
        const key = direction === 'a2b' ? 'capacityA2b' : 'capacityB2a';
        let halfCap = cap;
        const own = link[key];
        if (own !== undefined) {
          const c = capacityOf(own, cell.scope);
          if (c.bits !== undefined) {
            halfCap = c;
          } else if (typeof own === 'string') {
            result.diagnostics.push({
              code: 'unresolved-metadata',
              path: `cells.${cell.cellId}.link.${key}`,
              message: `Capacity is not usable: ${[...new Set(c.unresolved)].join(', ')}`,
            });
          }
        }
        const ownBinding = link[`${key}Binding`];
        if (ownBinding && cell.bindings.includes(ownBinding)) {
          halfCap = capacityFromBinding(read(ownBinding, `link.${key}Binding`), ownBinding) ?? halfCap;
        }
        const h = half(model, binding, halfCap, ctx);
        for (const note of new Set(h.notes)) {
          result.diagnostics.push({
            code: 'unit-not-rate',
            path: `cells.${cell.cellId}.link.${direction}Binding`,
            message: note,
          });
        }
        patch.link[direction] = h.state;
        primary ??= h.state.series;
        states.push(h.state);
      }
      const available = states.filter((s) => s.status === 'ok').length;
      if (states.length && available < states.length) {
        patch.statusView = {
          state: 'missing',
          reason: `Incomplete coverage (${available}/${states.length} directions available)`,
          queryIds: [link.a2bBinding, link.b2aBinding].flatMap((b) => (b ? [b.queryId] : [])),
          conditionKey: JSON.stringify(['link-coverage', link.a2bBinding?.queryId, link.b2aBinding?.queryId]),
          coverage: { available, expected: states.length },
        };
      }
    }
    if (display.shape?.enabled !== false && display.shape?.binding && cell.bindings.includes(display.shape.binding)) {
      const model = read(display.shape.binding, 'shape.binding');
      const target = targetOf(display.shape);
      if (model.state === 'ready' && model.latestValue !== undefined) {
        const series = historySeries(model, display.shape.binding);
        primary ??= series;
        const value = model.latestValue;
        const shown = model.latestDisplayValue ?? ctx.display(series, value);
        const label = display.shape.text
          ? resolveTemplate(display.label ?? '${value}', {
              ...cell.scope,
              labels: model.field.labels,
              value: formattedValueToString(shown),
            })
          : undefined;
        if (label?.unresolved.length) {
          // a text that does not resolve has no value to show: the shape is unbound, in grey
          patch.shape = {
            status: 'unbound',
            color: noDataColor(ctx.theme),
            target,
            stepIndex: -1,
            text: STATUS_TEXT.unbound,
            value,
            display: shown,
            series,
          };
          result.diagnostics.push({
            code: 'unresolved-metadata',
            path: `cells.${cell.cellId}.label`,
            message: `Unresolved ${[...new Set(label.unresolved)].join(', ')}`,
          });
        } else {
          // the colour of the value from the field config of its series (thresholds, scheme, mappings)
          const { color, stepIndex } = colorFor(
            value,
            undefined,
            model.field as Field,
            shown,
            ctx.fieldThresholds,
            ctx.theme
          );
          patch.shape = { status: 'ok', color, target, stepIndex, value, display: shown, series, text: label?.text };
        }
      } else {
        patch.shape = {
          status: 'nodata',
          color: noDataColor(ctx.theme),
          target,
          stepIndex: -1,
          // a text-only binding has no colour to show the state, so the text says it
          text: display.shape.text ? STATUS_TEXT.nodata : undefined,
        };
      }
    }
    if (display.status?.enabled !== false && display.status && cell.bindings.includes(display.status.binding)) {
      const model = read(display.status.binding, 'status.binding');
      if (model.state === 'ready') {
        primary ??= historySeries(model, display.status.binding);
      }
      const status = evaluateStatus(
        display.status,
        [
          {
            queryId: display.status.binding.queryId,
            availability: model.state === 'empty' ? 'missing' : model.state === 'idle' ? 'loading' : model.state,
            value: model.state === 'ready' ? model.latestValue : undefined,
            sampleAt: model.state === 'ready' ? model.sampleAt : undefined,
          },
        ],
        nowMs
      );
      if (!patch.statusView || status.state !== 'normal') {
        patch.statusView = status;
      }
    }
    if (display.url !== undefined) {
      const scope = { ...cell.scope, labels: primary?.labels ?? {} };
      const url = resolveTemplate(display.url, scope, encodeURIComponent);
      if (!url.unresolved.length && isAllowedUrl(url.text)) {
        const title = display.urlTitle === undefined ? undefined : resolveTemplate(display.urlTitle, scope, shield);
        patch.urls.push(title && !title.unresolved.length ? { url: url.text, title: title.text } : { url: url.text });
      } else {
        result.diagnostics.push({
          code: url.unresolved.length ? 'unresolved-metadata' : 'invalid-url',
          path: `cells.${cell.cellId}.url`,
          message: url.unresolved.length
            ? `Unresolved ${url.unresolved.join(', ')}`
            : 'URL must use http, https or a relative path.',
        });
      }
    }
    result.patches.set(cell.cellId, patch);
  }
  result.summaries = summarizeStatuses(
    [...result.patches.values()].flatMap((p) => (p.statusView ? [{ cellId: p.cellId, status: p.statusView }] : []))
  );
  return result;
}

const STATUS_TEXT = { nodata: 'no data', unbound: 'unbound' } as const;

const unitNote = (unit: string) => `unit "${unit}" is not a data rate, the raw value is used as bit/s`;

/** A value in the unit of its field, in bit/s. */
function bitsOf(value: number, s: SeriesInfo, notes: string[]): number {
  const rate = toBitsPerSecond(value, s.field.config?.unit);
  if (rate.unknownUnit) {
    notes.push(unitNote(rate.unknownUnit));
  }
  return rate.bits;
}

/** The state of one link half from its history: the colour, the width and the card text. */
function half(
  model: HistoryModel,
  binding: QueryBinding,
  cap: ResolvedCapacity,
  ctx: BindContext
): { state: HalfState; notes: string[] } {
  if (model.state !== 'ready' || model.latestValue === undefined) {
    return {
      state: {
        status: 'nodata',
        color: noDataColor(ctx.theme),
        width: ctx.linkWidth.min,
        label: STATUS_TEXT.nodata,
        stepIndex: -1,
        capacity: cap.bits,
        capacitySource: cap.source,
      },
      notes: [],
    };
  }
  const series = historySeries(model, binding);
  const value = model.latestValue;
  const notes: string[] = [];
  let { bits: capacity, source } = cap;
  // the last source: the Max of the field config (a standard option, also by override), in the field unit
  const max = series.field.config?.max;
  if (capacity === undefined && typeof max === 'number' && max > 0) {
    capacity = bitsOf(max, series, notes);
    source = 'fieldMax';
  }
  // the capacity is in bit/s; the field unit tells how to read the value
  const percent = capacity === undefined ? undefined : (bitsOf(value, series, notes) / capacity) * 100;
  const display = model.latestDisplayValue ?? ctx.display(series, value);
  const { color, stepIndex } = colorFor(value, percent, series.field, display, ctx.fieldThresholds, ctx.theme);
  const text = formattedValueToString(display);
  const label =
    percent === undefined || capacity === undefined
      ? text
      : `${text} · ${Math.round(percent)}% of ${formattedValueToString(getValueFormat('bps')(capacity))}`;
  return {
    state: {
      status: 'ok',
      color,
      width: widthFor(percent, ctx.linkWidth),
      label,
      stepIndex,
      value,
      percent,
      capacity,
      capacitySource: capacity === undefined ? 'none' : source,
      display,
      series,
    },
    notes,
  };
}

/** The capacity of a link in bit/s, from the display. Without it, each half can use the Max of its field. */
interface ResolvedCapacity {
  bits?: number;
  source: CapacitySource;
  unresolved: string[];
}

/** The capacity from a read binding: its latest value through the field unit, when it is positive. */
function capacityFromBinding(model: HistoryModel, binding: QueryBinding): ResolvedCapacity | undefined {
  if (model.state !== 'ready' || model.latestValue === undefined) {
    return undefined;
  }
  const bits = bitsOf(model.latestValue, historySeries(model, binding), []);
  return bits > 0 ? { bits, source: 'series', unresolved: [] } : undefined;
}

/** A number, or a template that resolves to a positive number. Anything else gives no capacity. */
function capacityOf(c: LinkCapacity | undefined, scope: TemplateScope): ResolvedCapacity {
  if (c === undefined) {
    return { source: 'none', unresolved: [] };
  }
  if (typeof c === 'number') {
    return c > 0 ? { bits: c, source: 'number', unresolved: [] } : { source: 'none', unresolved: [] };
  }
  const r = resolveTemplate(c, scope);
  if (r.unresolved.length) {
    return { source: 'none', unresolved: r.unresolved };
  }
  const n = Number(r.text);
  return Number.isFinite(n) && n > 0
    ? { bits: n, source: c.includes('${') ? 'attr' : 'number', unresolved: [] }
    : { source: 'none', unresolved: [`capacity "${r.text}" is not a number`] };
}

/** The explicit target wins. Without it, a text-only binding colours nothing; else the icon takes the colour. */
export function targetOf(shape: Pick<ShapeDisplay, 'target' | 'text'>): ShapeTarget | 'none' {
  return shape.target ?? (shape.text ? 'none' : 'icon');
}
