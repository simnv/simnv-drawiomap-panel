import { type Field, formattedValueToString } from '@grafana/data';
import type { BindContext, CellPatch, HalfState, SeriesInfo, ShapeTarget, TemplateScope } from '../types';
import { colorFor, noDataColor, widthFor } from './color';
import { resolveTemplate, shield } from './template';
import { toBitsPerSecond } from './units';
import { isAllowedUrl } from './url';
import {
  rowBindings,
  rowCapacityBindings,
  type Diagnostic,
  type HoverSpec,
  type QueryBinding,
  type ShapeDisplay,
} from '../model/config';
import { inFieldUnit, resolveCapacity, type ResolvedCapacity } from './capacity';
import { toHistory, type HistoryModel, type HistoryFormat } from '../query/frames';
import type { BindingPlan } from './patterns';
import type { QuerySnapshot } from '../query/types';
import { evaluateStatus, summarizeStatuses, type StatusSummary, type StatusView } from './status';

export interface PlanCellPatch extends CellPatch {
  statusView?: StatusView;
  hover?: HoverSpec;
  /** the rows whose value binding is not usable for the cell */
  unavailableHoverRows?: number[];
  /** the bindings that can run for the cell (`EffectiveCellBinding.bindings`); the card reads no other */
  bindings?: QueryBinding[];
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
  /** the path of the binding in its row: `binding`, `capacityBinding`, `series[j].binding`, `series[j].capacityBinding` */
  path?: string;
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
      if (binding && cell.bindings.includes(binding)) {
        demands.push({ cellId: cell.cellId, binding, role: 'visible' });
      }
    }
    if (cell.cellId === openCellId && d.hover?.enabled !== false) {
      d.hover?.rows.forEach((row, rowIndex) => {
        [...rowBindings(row), ...rowCapacityBindings(row)].forEach(({ binding, path }) => {
          if (cell.bindings.includes(binding)) {
            demands.push({ cellId: cell.cellId, binding, role: 'hover', rowIndex, path });
          }
        });
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
    if (cell.unavailable !== undefined) {
      // nothing binds: the cell is grey with the reason, and the status band counts it
      patch.unavailable = { reason: cell.unavailable, color: noDataColor(ctx.theme) };
      patch.statusView = {
        state: 'missing',
        reason: cell.unavailable,
        queryIds: [],
        conditionKey: JSON.stringify(['unavailable', cell.unavailable]),
        coverage: { available: 0, expected: 1 },
      };
      result.patches.set(cell.cellId, patch);
      continue;
    }
    let primary: SeriesInfo | undefined;
    patch.hover = display.hover;
    patch.bindings = cell.bindings;
    patch.unavailableHoverRows = display.hover?.rows.flatMap((row, i) =>
      rowBindings(row).some(({ binding }) => !cell.bindings.includes(binding)) ? [i] : []
    );
    // one read per path: both link directions read the shared capacity series, and it is reported once
    const models = new Map<string, HistoryModel>();
    const read = (binding: QueryBinding, path: string): HistoryModel => {
      const seen = models.get(path);
      if (seen) {
        return seen;
      }
      const model = resolve(cell.cellId, binding);
      models.set(path, model);
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
      const states: HalfState[] = [];
      patch.link = {};
      for (const direction of ['a2b', 'b2a'] as const) {
        const own = link[direction];
        const binding = own?.binding;
        if (!binding) {
          continue;
        }
        const path = `link.${direction}`;
        if (!cell.bindings.includes(binding)) {
          // configured but not usable for this cell: an explicit grey half, so the other half cannot cover it
          const unbound: HalfState = {
            status: 'unbound',
            color: noDataColor(ctx.theme),
            width: ctx.linkWidth.min,
            label: STATUS_TEXT.unavailable,
            stepIndex: -1,
          };
          patch.link[direction] = unbound;
          states.push(unbound);
          continue;
        }
        const model = read(binding, `${path}.binding`);
        const cap = resolveCapacity({
          own,
          ownPath: path,
          shared: link,
          sharedPath: 'link',
          numberUnit: 'canonical',
          scope: cell.scope,
          field: model.state === 'ready' ? model.field : undefined,
          read: (b, at) => (cell.bindings.includes(b) ? read(b, at) : undefined),
        });
        for (const d of cap.diagnostics) {
          result.diagnostics.push({ ...d, path: `cells.${cell.cellId}.${d.path}` });
        }
        const h = halfState(model, binding, cap, ctx);
        for (const note of new Set(h.notes)) {
          result.diagnostics.push({
            code: 'unit-not-rate',
            path: `cells.${cell.cellId}.${path}.binding`,
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
          queryIds: [link.a2b?.binding, link.b2a?.binding].flatMap((b) => (b ? [b.queryId] : [])),
          conditionKey: JSON.stringify(['link-coverage', link.a2b?.binding?.queryId, link.b2a?.binding?.queryId]),
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

const STATUS_TEXT = { nodata: 'no data', unbound: 'unbound', unavailable: 'unavailable' } as const;

const unitNote = (unit: string) => `unit "${unit}" is not a data rate, the raw value is used as bit/s`;

/** A value in the unit of its field, in bit/s. */
function bitsOf(value: number, s: SeriesInfo, notes: string[]): number {
  const rate = toBitsPerSecond(value, s.field.config?.unit);
  if (rate.unknownUnit) {
    notes.push(unitNote(rate.unknownUnit));
  }
  return rate.bits;
}

/** The context that `halfState` needs: the link engine has all of it, the card builds its own `display`. */
export type HalfContext = Pick<BindContext, 'theme' | 'fieldThresholds' | 'display' | 'linkWidth'>;

/**
 * The state of one direction from its history and its resolved capacity: the colour, the width and the card text.
 * A link half and a card direction both come from here. The capacity never produces a value on its own: without a
 * value the direction is grey "no data"; without a capacity it has no percent and the colour of the raw value.
 */
export function halfState(
  model: HistoryModel,
  binding: QueryBinding,
  cap: Pick<ResolvedCapacity, 'amount' | 'source'>,
  ctx: HalfContext
): { state: HalfState; notes: string[] } {
  if (model.state !== 'ready' || model.latestValue === undefined) {
    return {
      state: {
        status: 'nodata',
        color: noDataColor(ctx.theme),
        width: ctx.linkWidth.min,
        label: STATUS_TEXT.nodata,
        stepIndex: -1,
        capacity: cap.amount,
        capacitySource: cap.source,
      },
      notes: [],
    };
  }
  const series = historySeries(model, binding);
  const value = model.latestValue;
  const notes: string[] = [];
  const capacity = cap.amount;
  // the capacity is in the canonical unit; the field unit tells how to read the value
  const percent = capacity === undefined ? undefined : (bitsOf(value, series, notes) / capacity) * 100;
  const display = model.latestDisplayValue ?? ctx.display(series, value);
  // the capacity, once, in the unit of the field: the card and the labels show this text
  const capacityDisplay = capacity === undefined ? undefined : ctx.display(series, inFieldUnit(capacity, series.field));
  const { color, stepIndex } = colorFor(value, percent, series.field, display, ctx.fieldThresholds, ctx.theme);
  const text = formattedValueToString(display);
  const label =
    percent === undefined || capacityDisplay === undefined
      ? text
      : `${text} · ${Math.round(percent)}% of ${formattedValueToString(capacityDisplay)}`;
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
      capacitySource: capacity === undefined ? 'none' : cap.source,
      capacityDisplay,
      display,
      series,
    },
    notes,
  };
}

/** Only an explicit target colours the node. Saved dashboards without one keep their look. */
export function targetOf(shape: Pick<ShapeDisplay, 'target'>): ShapeTarget | 'none' {
  return shape.target ?? 'none';
}
