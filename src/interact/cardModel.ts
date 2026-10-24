import { Field, formattedValueToString, GrafanaTheme2, LinkModel, ScopedVars, ThresholdsConfig } from '@grafana/data';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import { buildScopedVars, primaryOf, Primary, resolveLinks } from './links';
import {
  historySeries,
  metricProblem,
  type BindingDemand,
  type BindingResolver,
  type PlanCellPatch,
} from '../binding/engine';
import { fieldDisplay, type HistoryModel } from '../query/frames';
import {
  rowBindings,
  type Diagnostic,
  type FreshnessPolicy,
  type HoverRow,
  type QueryBinding,
  type RowCapacity,
} from '../model/config';
import { colorFor, noDataColor } from '../binding/color';
import { toBitsPerSecond } from '../binding/units';
import { combinedTop, yDomain, type LowerBound } from '../visuals/domain';

export interface ConfiguredCardRow {
  key: string;
  kind: HoverRow['kind'] | 'status';
  title: string;
  text: string;
  state: HistoryModel['state'];
  history?: HistoryModel;
  sampleAt?: number;
  freshness?: FreshnessPolicy;
  href?: string;
  /** Y range of the sparkline, see yDomain */
  min?: LowerBound;
  max?: number;
  /** a combined up/down row: one entry for each configured direction */
  directions?: DirectionRowModel[];
  /** Y range of a combined row: symmetric around zero when it has both directions */
  domain?: [number, number];
  /** chart height in px, from the row option "height"; see chartHeight for the default */
  height?: number;
}

/** Height in px of the chart of a single-direction history row. */
export const SPARK_HEIGHT = 40;

/**
 * Chart height of a history row in px. The row option "height" wins. Without it, a row with the zero line
 * (up above, down mirrored below) is twice as tall as a plain sparkline, so each half is as tall as one.
 */
export function chartHeight(row: Pick<ConfiguredCardRow, 'height' | 'directions'>): number {
  return row.height ?? (row.directions?.some((d) => d.mirrored) ? 2 * SPARK_HEIGHT : SPARK_HEIGHT);
}
export interface ConfiguredCardModel {
  title: string;
  rows: ConfiguredCardRow[];
  links: LinkModel[];
  demands: BindingDemand[];
  diagnostics: Diagnostic[];
}

export function buildConfiguredCard(
  patch: PlanCellPatch,
  resolve: BindingResolver,
  ctx: CardContext,
  open = true
): ConfiguredCardModel {
  const card: ConfiguredCardModel = { title: titleOf(patch), rows: [], links: [], demands: [], diagnostics: [] };
  if (!open || patch.hover?.enabled === false) {
    return card;
  }
  const primary = primaryOf(patch);
  card.links = resolveLinks(patch, primary, ctx.replaceVariables, card.title);
  if (!patch.hover) {
    if (patch.statusView) {
      card.rows.push({
        key: 'status',
        kind: 'status',
        title: patch.statusView.state,
        text: patch.statusView.reason,
        state: 'ready',
      });
    }
    return card;
  }
  patch.hover.rows.forEach((row, i) => {
    const base = { key: `row-${i}`, kind: row.kind, title: resolveTemplate(row.label, patch.scope).text };
    if (row.kind === 'metadata') {
      const value = resolveTemplate(`\${${row.path}}`, patch.scope);
      card.rows.push({
        ...base,
        text: value.unresolved.length ? 'Metadata unavailable' : value.text,
        state: value.unresolved.length ? 'empty' : 'ready',
      });
    } else if (row.kind === 'drilldown') {
      // A drilldown is a footer link, not a row: a row would show its label as the title and as the value.
      const href = rowHref(patch, row.url, primary, ctx);
      if (href === undefined) {
        card.diagnostics.push({
          code: 'invalid-url',
          path: `cells.${patch.cellId}.hover.rows[${i}].url`,
          message: 'Drilldown URL must use http, https or a relative path.',
        });
      } else if (!card.links.some((l) => l.href === href)) {
        card.links.push({ title: base.title, href, target: '_blank', origin: patch });
      }
    } else {
      const unavailable = patch.unavailableHoverRows?.includes(i);
      const combined = 'series' in row;
      const parts = rowBindings(row).map(({ binding, path }, j) => {
        if (!unavailable) {
          card.demands.push({
            cellId: patch.cellId,
            binding,
            role: 'hover',
            rowIndex: i,
            ...(combined ? { seriesIndex: j } : {}),
          });
        }
        const model: HistoryModel = unavailable
          ? { state: 'unsupported', message: 'Binding metadata is unavailable' }
          : readBinding(patch, binding, `hover.rows[${i}].${path}`, row.unit, resolve, ctx, card.diagnostics);
        const series = model.state === 'ready' ? historySeries(model, binding) : undefined;
        const primary: Primary = {
          status: model.state === 'ready' ? 'ok' : 'nodata',
          series,
          value: model.state === 'ready' ? model.latestValue : undefined,
          display: model.state === 'ready' ? model.latestDisplayValue : undefined,
        };
        return { model, primary };
      });
      if ('series' in row) {
        const href = rowHref(patch, row.url, (parts.find((p) => p.primary.series) ?? parts[0]).primary, ctx);
        card.rows.push({
          ...base,
          freshness: row.freshness,
          href,
          height: row.height,
          ...(unavailable
            ? { state: 'unsupported', text: 'Binding metadata is unavailable' }
            : combinedRow(
                row,
                parts.map((p) => p.model),
                ctx,
                { patch, rowIndex: i, diagnostics: card.diagnostics }
              )),
        });
        return;
      }
      const model = parts[0]?.model ?? { state: 'unsupported', message: 'Binding metadata is unavailable' };
      card.rows.push({
        ...base,
        text: stateText(model),
        state: model.state,
        sampleAt: model.state === 'ready' ? model.sampleAt : undefined,
        freshness: row.freshness,
        href: rowHref(patch, row.url, parts[0]?.primary ?? { status: 'nodata' }, ctx),
        min: row.min,
        max: row.max,
        ...(row.kind === 'history' ? { history: model, height: row.height } : {}),
      });
    }
  });
  return card;
}

/** The current value of a history, or why it has none. */
function stateText(model: HistoryModel): string {
  return model.state === 'ready' && model.latestDisplayValue
    ? formattedValueToString(model.latestDisplayValue)
    : model.state === 'error' || model.state === 'unsupported'
      ? model.message
      : model.state === 'idle' || model.state === 'loading'
        ? 'Loading data'
        : 'No data';
}

/** Resolves one hover binding, reports a missing or failed metric, and applies the unit of the row. */
function readBinding(
  patch: PlanCellPatch,
  binding: QueryBinding,
  path: string,
  unit: string | undefined,
  resolve: BindingResolver,
  ctx: CardContext,
  diagnostics: Diagnostic[]
): HistoryModel {
  const model = resolve(patch.cellId, binding);
  const problem = metricProblem(model, binding);
  if (problem) {
    diagnostics.push({ ...problem, path: `cells.${patch.cellId}.${path}` });
  }
  if (model.state !== 'ready' || unit === undefined) {
    return model;
  }
  // drop the display processor of the original field: it has the old unit
  const field = { ...model.field, display: undefined, config: { ...model.field.config, unit } };
  const display = fieldDisplay(field, ctx.theme);
  return {
    ...model,
    field,
    latestDisplayValue: model.latestValue === undefined ? undefined : display(model.latestValue),
  };
}

/** One direction of a combined row. */
export interface DirectionRowModel {
  direction: 'up' | 'down';
  /** "↑" or "↓" by default */
  label: string;
  /** current value, for example "8.2 Mb/s · 8%", or why there is no value */
  text: string;
  /** from the field config and thresholds of its own value, as a link half */
  color: string;
  /** drawn below the zero line (negative): down when the row has both directions */
  mirrored: boolean;
  history: HistoryModel;
}

const positive = (v: unknown): number | undefined => (typeof v === 'number' && v > 0 ? v : undefined);

/** A capacity from the row: an amount in the unit of the values, or in bit/s (a template). */
interface RowCapacityValue {
  amount?: number;
  bitsPerSecond: boolean;
  /** the author set a capacity and it gives no usable number */
  failed: boolean;
}

/** Resolves a capacity of a combined row. An unusable template gives a diagnostic and no number. */
function resolveRowCapacity(
  spec: RowCapacity | undefined,
  patch: PlanCellPatch,
  path: string,
  diagnostics: Diagnostic[]
): RowCapacityValue {
  if (spec === undefined) {
    return { bitsPerSecond: false, failed: false };
  }
  if (typeof spec === 'number') {
    const amount = positive(spec);
    return { amount, bitsPerSecond: false, failed: amount === undefined };
  }
  const resolved = resolveTemplate(spec, patch.scope);
  const amount = resolved.unresolved.length || resolved.text.trim() === '' ? NaN : Number(resolved.text);
  if (Number.isFinite(amount) && amount > 0) {
    return { amount, bitsPerSecond: true, failed: false };
  }
  diagnostics.push({
    code: 'unresolved-metadata',
    path: `cells.${patch.cellId}.${path}`,
    message: resolved.unresolved.length
      ? `Unresolved ${[...new Set(resolved.unresolved)].join(', ')}`
      : `Capacity "${resolved.text}" is not a positive number of bit/s.`,
  });
  return { bitsPerSecond: true, failed: true };
}

/** The capacity in the unit of the values of a series (a number already has it; bit/s is converted). */
function inValueUnit(c: RowCapacityValue, model: HistoryModel | undefined): number | undefined {
  if (c.amount === undefined || !c.bitsPerSecond) {
    return c.amount;
  }
  const unit = model?.state === 'ready' ? model.field.config?.unit : undefined;
  return c.amount / toBitsPerSecond(1, unit).bits;
}

/**
 * A combined up/down row. Up leaves the subject (tx), down enters it (rx). With both directions, up is above
 * the zero line and down is mirrored below it, in the symmetric range [-M, M]: M is the largest |value|,
 * the capacity or the row max. A single direction stays positive and uses yDomain.
 */
function combinedRow(
  row: Extract<HoverRow, { series: unknown }>,
  models: HistoryModel[],
  ctx: CardContext,
  at: { patch: PlanCellPatch; rowIndex: number; diagnostics: Diagnostic[] }
): Pick<ConfiguredCardRow, 'text' | 'state' | 'sampleAt' | 'directions' | 'domain'> {
  const rowPath = `hover.rows[${at.rowIndex}]`;
  const rowCapacity = resolveRowCapacity(row.capacity, at.patch, `${rowPath}.capacity`, at.diagnostics);
  // The capacity of a direction: its own, else the row capacity, else the Max of its field config.
  // A capacity that the author set and that gives no number is not replaced: the direction has no percent.
  const capacities = row.series.map((s, j): number | undefined => {
    const own =
      s.capacity === undefined
        ? rowCapacity
        : resolveRowCapacity(s.capacity, at.patch, `${rowPath}.series[${j}].capacity`, at.diagnostics);
    const model = models[j];
    // a direction without data has no unit: it takes the unit of the other direction
    const unitModel = model.state === 'ready' ? model : models.find((m) => m.state === 'ready');
    return own.failed
      ? undefined
      : (inValueUnit(own, unitModel) ?? (model.state === 'ready' ? positive(model.field.config.max) : undefined));
  });
  const mirrored = row.series.length === 2;
  const directions = row.series.map((s, j): DirectionRowModel => {
    const model = models[j];
    const base = {
      direction: s.direction,
      label: s.label ?? (s.direction === 'up' ? '↑' : '↓'),
      mirrored: mirrored && s.direction === 'down',
      history: model,
    };
    if (model.state !== 'ready' || model.latestValue === undefined) {
      return { ...base, text: stateText(model), color: noDataColor(ctx.theme) };
    }
    const capacity = capacities[j];
    const percent = capacity ? (model.latestValue / capacity) * 100 : undefined;
    const { color } = colorFor(
      model.latestValue,
      percent,
      model.field as Field,
      model.latestDisplayValue,
      ctx.fieldThresholds,
      ctx.theme
    );
    const value = stateText(model);
    return { ...base, text: percent === undefined ? value : `${value} · ${Math.round(percent)}%`, color };
  });
  const ready = models.filter((m): m is Extract<HistoryModel, { state: 'ready' }> => m.state === 'ready');
  // for max "capacity": the larger capacity of the two directions
  const known = capacities.filter((c): c is number => c !== undefined);
  const capacity = known.length ? Math.max(...known) : undefined;
  // One shared scale for both directions: the data, not the capacity, unless the row says so.
  const top = combinedTop(
    ready.flatMap((m) => m.values),
    { max: row.max, capacity }
  );
  let domain: [number, number];
  if (mirrored) {
    domain = [-top, top];
  } else {
    const config = ready[0]?.field.config ?? {};
    domain = yDomain(ready[0]?.values ?? [], { min: row.min, max: top, fieldMin: config.min, unit: config.unit });
  }
  const samples = ready.flatMap((m) => (m.sampleAt === undefined ? [] : [m.sampleAt]));
  return {
    text: directions.map((d) => `${d.label} ${d.text}`).join('  '),
    // the row is ready when one direction has data; the other direction tells why it has none
    state: ready.length ? 'ready' : models[0].state,
    // the oldest sample decides if the row is stale
    sampleAt: samples.length ? Math.min(...samples) : undefined,
    directions,
    domain,
  };
}

export interface CardContext {
  theme: GrafanaTheme2;
  replaceVariables: (text: string, scopedVars?: ScopedVars) => string;
  /** the panel default thresholds: they apply when a field has none */
  fieldThresholds?: ThresholdsConfig;
}

/** Row url: the row template (resolved with the row series labels, encoded), else the display url. */
function rowHref(
  patch: PlanCellPatch,
  tpl: string | undefined,
  primary: Primary,
  ctx: CardContext
): string | undefined {
  let url: string | undefined = patch.urls[0]?.url;
  if (tpl !== undefined) {
    const r = resolveTemplate(tpl, { ...patch.scope, labels: primary.series?.labels ?? {} }, encodeURIComponent);
    url = !r.unresolved.length && isAllowedUrl(r.text) ? r.text : undefined;
  }
  if (url === undefined) {
    return undefined;
  }
  // a dashboard variable can put a scheme into the url, so check the final text again
  const href = ctx.replaceVariables(url, buildScopedVars(patch, primary));
  return isAllowedUrl(href) ? href : undefined;
}

/** The card title: the hover title template of the pattern, else the title of the cell. */
function titleOf(patch: PlanCellPatch): string {
  const cell = patch.scope.cell;
  const fallback = patch.scope.cellTitle || cell.label || cell.key || patch.cellId;
  const template = patch.hover?.title;
  if (template === undefined) {
    return fallback;
  }
  const r = resolveTemplate(template, patch.scope);
  return r.unresolved.length || !r.text.trim() ? fallback : r.text;
}

/**
 * True when the card of the cell has rows or links. It reads no series values, so the panel can call it for all
 * cells once per data update.
 */
export function opensCard(patch: PlanCellPatch, ctx: CardContext): boolean {
  if (patch.hover?.enabled === false) {
    return false;
  }
  const rows = patch.hover?.rows;
  const primary = primaryOf(patch);
  if (rows?.some((row) => row.kind !== 'drilldown' || rowHref(patch, row.url, primary, ctx))) {
    return true;
  }
  if (!patch.hover && patch.statusView) {
    return true;
  }
  return resolveLinks(patch, primary, ctx.replaceVariables, '').length > 0;
}
