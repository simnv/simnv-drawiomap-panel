import { type DisplayValue, type Field, formattedValueToString } from '@grafana/data';
import type { BindContext, CellPatch, HalfState, SeriesInfo, ShapeTarget, TemplateScope } from '../types';
import { colorFor, noDataColor, widthFor } from './color';
import { resolveTemplate, shield } from './template';
import { isAllowedUrl } from './url';
import {
  cellPath,
  pathRelated,
  rowBindings,
  type Diagnostic,
  type HoverSpec,
  type QueryBinding,
  type ShapeDisplay,
} from '../model/config';
import { bitsWithNote, inFieldUnit, resolveCapacity, type ResolvedCapacity } from './capacity';
import { historyOf, type HistoryModel, type HistoryFormat } from '../query/frames';
import type { BindingPlan } from './patterns';
import type { QuerySnapshot } from '../query/types';
import { evaluateStatus, isPast, summarizeStatuses, type StatusSummary, type StatusView } from './status';

export interface PlanCellPatch extends CellPatch {
  statusView?: StatusView;
  /** the view that replaces `statusView` once the clock is after `after`; `staleStatuses` applies it */
  staleStatus?: { after: number; view: StatusView };
  hover?: HoverSpec;
  /** the rows whose value binding is not usable for the cell */
  unavailableHoverRows?: number[];
  /** the bindings that can run for the cell (`EffectiveCellBinding.bindings`); the card reads no other */
  bindings?: QueryBinding[];
}
/** Read prepared models only. Query subscriptions belong to the caller. */
export type BindingResolver = (cellId: string, binding: QueryBinding) => HistoryModel;
/** The binding with its match templates resolved against a cell scope, or the unresolved names. */
const resolvedBindings = new WeakMap<QueryBinding, WeakMap<TemplateScope, QueryBinding | string[]>>();
function resolveBindingScope(binding: QueryBinding, scope: TemplateScope): QueryBinding | string[] {
  let byScope = resolvedBindings.get(binding);
  if (!byScope) {
    byScope = new WeakMap();
    resolvedBindings.set(binding, byScope);
  }
  const seen = byScope.get(scope);
  if (seen) {
    return seen;
  }
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
  const value = unresolved.length ? [...new Set(unresolved)] : resolved;
  byScope.set(scope, value);
  return value;
}
export function resolveBinding(
  snapshot: QuerySnapshot,
  binding: QueryBinding,
  scope: TemplateScope,
  format?: HistoryFormat
): HistoryModel {
  const resolved = resolveBindingScope(binding, scope);
  return Array.isArray(resolved)
    ? { state: 'unsupported', message: `Unresolved binding metadata: ${resolved.join(', ')}` }
    : historyOf(snapshot, resolved, format);
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
  /** the sorted unique moments after which a status cell is stale; the clock reads again after each */
  deadlines: number[];
}

const seriesOf = new WeakMap<HistoryModel, Map<string, SeriesInfo>>();

/** The series of a model without its gaps, built once per model and query id. */
export function historySeries(model: Extract<HistoryModel, { state: 'ready' }>, binding: QueryBinding): SeriesInfo {
  let cache = seriesOf.get(model);
  if (!cache) {
    cache = new Map();
    seriesOf.set(model, cache);
  }
  const seen = cache.get(binding.queryId);
  if (seen) {
    return seen;
  }
  const values: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < model.values.length; i++) {
    const value = model.values[i];
    if (value !== null) {
      values.push(value);
      times.push(model.timestamps[i]);
    }
  }
  const series: SeriesInfo = {
    refId: binding.queryId,
    name: model.field.name,
    labels: model.field.labels ?? {},
    field: model.field,
    values,
    times,
    frame: { length: model.values.length, fields: [model.timeField, model.field] },
  };
  cache.set(binding.queryId, series);
  return series;
}

/** The cells with a status, for the summary band. */
const statusItems = (patches: Map<string, PlanCellPatch>) =>
  [...patches.values()].flatMap((p) => (p.statusView ? [{ cellId: p.cellId, status: p.statusView }] : []));

/**
 * The patches of every cell of the plan from the results. The clock is not an input: the same plan, results and
 * context give the same patches at any moment. `staleStatuses` applies the time.
 */
export function bindPlan(plan: BindingPlan, resolve: BindingResolver, ctx: BindContext): PlanBindResult {
  const result: PlanBindResult = {
    patches: new Map(),
    diagnostics: [...plan.diagnostics],
    summaries: [],
    deadlines: [],
  };
  const deadlines = new Set<number>();
  for (const cell of Object.values(plan.cells)) {
    const display = cell.display;
    const patch: PlanCellPatch = {
      cellId: cell.cellId,
      scope: cell.scope,
      urls: [],
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
    // unavailable wins over enabled false: only an available cell that an override disables keeps its drawn look
    if (display.enabled === false) {
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
        result.diagnostics.push({ ...problem, path: cellPath(cell.cellId, path) });
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
    /** The reason a configured binding cannot run for this cell, as the plan reported it; undefined when it can. */
    const unbound = (binding: QueryBinding, path: string): string | undefined => {
      if (cell.bindings.includes(binding)) {
        return undefined;
      }
      const prefix = cellPath(cell.cellId, path);
      const reported = plan.diagnostics.find((d) => pathRelated(d.path, prefix));
      return reported?.message ?? 'The binding cannot run for this element.';
    };
    const missingView = (reason: string, binding: QueryBinding, path: string): StatusView => ({
      state: 'missing',
      reason,
      queryIds: [binding.queryId],
      conditionKey: JSON.stringify(['unavailable-binding', path, reason]),
      coverage: { available: 0, expected: 1 },
    });
    if (display.link?.enabled !== false && display.link) {
      const link = display.link;
      const states: HalfState[] = [];
      patch.link = { labelMode: link.label?.mode ?? 'none' };
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
          result.diagnostics.push({ ...d, path: cellPath(cell.cellId, d.path) });
        }
        const h = halfState(model, binding, cap, ctx);
        for (const note of new Set(h.notes)) {
          result.diagnostics.push({
            code: 'unit-not-rate',
            path: cellPath(cell.cellId, `${path}.binding`),
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
    if (display.shape?.enabled !== false && display.shape?.binding) {
      const reason = unbound(display.shape.binding, 'shape.binding');
      if (reason !== undefined) {
        // the binding cannot run for this cell: the shape is grey and says so, never the drawn colour
        patch.shape = {
          status: 'unbound',
          color: noDataColor(ctx.theme),
          target: targetOf(display.shape),
          stepIndex: -1,
          text: display.shape.text ? STATUS_TEXT.unavailable : undefined,
        };
        patch.statusView ??= missingView(reason, display.shape.binding, 'shape.binding');
      } else {
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
              path: cellPath(cell.cellId, 'label'),
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
    }
    if (display.status?.enabled !== false && display.status) {
      const reason = unbound(display.status.binding, 'status.binding');
      if (reason !== undefined) {
        patch.statusView = missingView(reason, display.status.binding, 'status.binding');
      } else {
        const model = read(display.status.binding, 'status.binding');
        if (model.state === 'ready') {
          primary ??= historySeries(model, display.status.binding);
        }
        const { view, stale } = evaluateStatus(display.status, [
          {
            queryId: display.status.binding.queryId,
            availability: model.state === 'empty' ? 'missing' : model.state === 'idle' ? 'loading' : model.state,
            value: model.state === 'ready' ? model.latestValue : undefined,
            sampleAt: model.state === 'ready' ? model.sampleAt : undefined,
          },
        ]);
        if (!patch.statusView || view.state !== 'normal') {
          patch.statusView = view;
        }
        if (stale) {
          // the clock is not an input of the bind: the pass over the patches applies the stale view in time
          patch.staleStatus = stale;
          deadlines.add(stale.after);
        }
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
          path: cellPath(cell.cellId, 'url'),
          message: url.unresolved.length
            ? `Unresolved ${url.unresolved.join(', ')}`
            : 'URL must use http, https or a relative path.',
        });
      }
    }
    result.patches.set(cell.cellId, patch);
  }
  result.summaries = summarizeStatuses(statusItems(result.patches));
  result.deadlines = [...deadlines].sort((a, b) => a - b);
  return result;
}

/** The latest result per bind result: one derived result, not one per stale set a held bind passed through. */
const staleOf = new WeakMap<PlanBindResult, { key: string; result: PlanBindResult }>();

/**
 * The result at `nowMs`: each status cell whose sample passed its deadline shows its stale view, and the summaries
 * follow. The patches of the other cells are the same objects. With nothing stale the result is the input; two
 * consecutive calls with the same stale set give the same object, so a tick that crosses no deadline changes nothing.
 */
export function staleStatuses(result: PlanBindResult, nowMs: number): PlanBindResult {
  const stale: string[] = [];
  for (const patch of result.patches.values()) {
    if (patch.staleStatus && isPast(patch.staleStatus.after, nowMs)) {
      stale.push(patch.cellId);
    }
  }
  if (!stale.length) {
    return result;
  }
  const key = stale.join('\n');
  const seen = staleOf.get(result);
  if (seen?.key === key) {
    return seen.result;
  }
  const patches = new Map(result.patches);
  for (const cellId of stale) {
    const patch = patches.get(cellId)!;
    // a stale view replaces whatever view the bind left on the cell, as the clock inside the bind did
    patches.set(cellId, { ...patch, statusView: patch.staleStatus!.view });
  }
  const shown: PlanBindResult = { ...result, patches, summaries: summarizeStatuses(statusItems(patches)) };
  staleOf.set(result, { key, result: shown });
  return shown;
}

const STATUS_TEXT = { nodata: 'no data', unbound: 'unbound', unavailable: 'unavailable' } as const;

/** "4.10" reads "4.1", "100.00" reads "100": a capacity is a round figure, its text carries no filler zeros. */
const withoutTrailingZeros = (shown: DisplayValue): DisplayValue =>
  /^-?\d+\.\d*0$/.test(shown.text) ? { ...shown, text: shown.text.replace(/\.?0+$/, '') } : shown;
/** The field a capacity is formatted with: the unit of the values, automatic decimals, no cached processor. */
const capacityField = (field: Field): Field => ({
  ...field,
  display: undefined,
  config: { ...field.config, decimals: undefined },
});

/** A value in the unit of its field, in bit/s. */
function bitsOf(value: number, s: SeriesInfo, notes: string[]): number {
  const rate = bitsWithNote(value, s.field.config?.unit);
  if (rate.note) {
    notes.push(rate.note);
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
  // the capacity, once, in the unit of the field with automatic decimals: the card and the labels show this text
  const capacityDisplay =
    capacity === undefined
      ? undefined
      : withoutTrailingZeros(
          ctx.display({ ...series, field: capacityField(series.field) }, inFieldUnit(capacity, series.field))
        );
  const { color, stepIndex } = colorFor(value, percent, series.field, display, ctx.fieldThresholds, ctx.theme);
  const text = formattedValueToString(display);
  const percentDisplay = percent === undefined ? undefined : percentText(percent);
  const label =
    percentDisplay === undefined || capacityDisplay === undefined
      ? text
      : `${text} · ${percentDisplay} of ${formattedValueToString(capacityDisplay)}`;
  return {
    state: {
      status: 'ok',
      color,
      width: widthFor(percent, ctx.linkWidth),
      label,
      stepIndex,
      value,
      percent,
      percentDisplay,
      capacity,
      capacitySource: capacity === undefined ? 'none' : cap.source,
      capacityDisplay,
      display,
      series,
    },
    notes,
  };
}

/**
 * The text of a load percent, the one for the card and the link labels: a real 0 is "0%", a load above 0 and under
 * 0.5 is "<1%" (never a good-looking "0%"), above 999 is ">999%", else the rounded whole percent.
 */
export function percentText(percent: number): string {
  if (percent > 0 && percent < 0.5) {
    return '<1%';
  }
  if (percent > 999) {
    return '>999%';
  }
  return `${Math.round(percent)}%`;
}

/** Only an explicit target colours the node. Saved dashboards without one keep their look. */
export function targetOf(shape: Pick<ShapeDisplay, 'target'>): ShapeTarget | 'none' {
  return shape.target ?? 'none';
}
