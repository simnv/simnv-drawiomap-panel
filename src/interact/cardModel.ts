import {
  DisplayValue,
  Field,
  formattedValueToString,
  GrafanaTheme2,
  LinkModel,
  ScopedVars,
  ThresholdsConfig,
} from '@grafana/data';
import { reduceValues } from '../binding/reduce';
import { findSeries } from '../binding/series';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import type { BindStatus, CardRow, CellPatch, HalfState, SeriesInfo } from '../types';
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

/** What the card shows for one series. */
export interface CardRowModel {
  key: string;
  title: string;
  /** current value, for example "41 Mb/s · 41%", or "no data" / "unbound" */
  text: string;
  status: BindStatus;
  color: string;
  values: number[];
  times?: number[];
  /** formats a value of the series like the row text (unit, decimals); the chart tooltip uses it */
  format?: (value: number) => string;
  /** click target after template and dashboard variable resolution */
  href?: string;
  /** smallest and largest value of the series, formatted like the value */
  min?: string;
  max?: string;
  /** Y range of the sparkline, see yDomain */
  domain?: [number, number];
}

export interface CardModel {
  title: string;
  rows: CardRowModel[];
  /** footer: the rule url and the field data links */
  links: LinkModel[];
}

export interface DisplayOverride {
  unit?: string;
  decimals?: number;
}

export interface CardContext {
  series: SeriesInfo[];
  theme: GrafanaTheme2;
  /** formats a value with the field display processor; the override replaces the unit and decimals */
  display: (series: SeriesInfo, value: number, override?: DisplayOverride) => DisplayValue;
  replaceVariables: (text: string, scopedVars?: ScopedVars) => string;
  /** the panel default thresholds: they apply when a field has none */
  fieldThresholds?: ThresholdsConfig;
}

const STATUS_TEXT = { nodata: 'no data', unbound: 'unbound' } as const;

/** The Min, Max and unit of the field config of a series, for yDomain. */
function fieldBounds(s: SeriesInfo) {
  const c = s.field.config ?? {};
  return { fieldMin: c.min, fieldMax: c.max, unit: c.unit };
}

/** The formatted min and max of the finite values; nothing for a row without values. */
function minMax(values: number[], format: (v: number) => string): Pick<CardRowModel, 'min' | 'max'> {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return min <= max ? { min: format(min), max: format(max) } : {};
}

/** Row url: the row template (resolved with the row series labels, encoded), else the first rule url. */
function rowHref(patch: CellPatch, tpl: string | undefined, primary: Primary, ctx: CardContext): string | undefined {
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

function halfRow(patch: CellPatch, key: 'a2b' | 'b2a', h: HalfState, ctx: CardContext): CardRowModel {
  const { from, to } = patch.scope;
  const [a, b] = key === 'a2b' ? [from?.node ?? 'A', to?.node ?? 'B'] : [to?.node ?? 'B', from?.node ?? 'A'];
  const primary: Primary = { status: h.status, series: h.series, display: h.display, value: h.value };
  const s = h.status === 'ok' ? h.series : undefined;
  const values = s?.values ?? [];
  // The state keeps the capacity in bit/s: convert it to the unit of the series (an unknown unit is bit/s).
  // Without it, the capacity is value / percent.
  const capacity =
    s && h.capacity !== undefined
      ? h.capacity / toBitsPerSecond(1, s.field.config?.unit).bits
      : h.value !== undefined && h.percent
        ? (h.value * 100) / h.percent
        : undefined;
  return {
    key,
    title: `${a} → ${b}`,
    text: h.label,
    status: h.status,
    color: h.color,
    values,
    times: s?.times,
    href: rowHref(patch, patch.card?.url, primary, ctx),
    ...(s ? { format: (v: number) => formattedValueToString(ctx.display(s, v)) } : {}),
    ...(s ? minMax(values, (v) => formattedValueToString(ctx.display(s, v))) : {}),
    ...(s ? { domain: yDomain(values, { ...fieldBounds(s), capacity }) } : {}),
  };
}

function seriesRow(patch: CellPatch, row: CardRow, i: number, ctx: CardContext): CardRowModel {
  const scope = patch.scope;
  const f = findSeries(row, ctx.series, scope);
  const title = (s?: SeriesInfo) =>
    resolveTemplate(row.title ?? s?.name ?? `row ${i + 1}`, { ...scope, labels: s?.labels ?? {} }).text;
  // a row without data keeps its url: the target dashboard can tell why
  const base = (s?: SeriesInfo) => ({
    key: `row-${i}`,
    title: title(s),
    color: ctx.theme.colors.text.disabled,
    values: [],
    href: rowHref(patch, row.url, { status: 'nodata', series: s }, ctx),
  });
  if (f.unresolved.length) {
    return { ...base(), text: STATUS_TEXT.unbound, status: 'unbound' };
  }
  const value = f.series ? reduceValues(f.series.values, patch.card?.reducer ?? 'last') : undefined;
  if (!f.series || value === undefined) {
    return { ...base(f.series), text: STATUS_TEXT.nodata, status: 'nodata' };
  }
  const override =
    row.unit !== undefined || row.decimals !== undefined ? { unit: row.unit, decimals: row.decimals } : undefined;
  const display = ctx.display(f.series, value, override);
  const primary: Primary = { status: 'ok', series: f.series, display, value };
  return {
    key: `row-${i}`,
    title: title(f.series),
    text: formattedValueToString(display),
    status: 'ok',
    color: display.color ?? ctx.theme.colors.text.secondary,
    values: f.series.values,
    times: f.series.times,
    format: (v: number) => formattedValueToString(ctx.display(f.series!, v, override)),
    href: rowHref(patch, row.url, primary, ctx),
    ...minMax(f.series.values, (v) => formattedValueToString(ctx.display(f.series!, v, override))),
    domain: yDomain(f.series.values, { ...fieldBounds(f.series), unit: row.unit ?? f.series.field.config?.unit }),
  };
}

/** The default node row: the series that colours the node. */
function shapeRow(patch: CellPatch, ctx: CardContext): CardRowModel | undefined {
  const s = patch.shape;
  if (!s) {
    return undefined;
  }
  const primary: Primary = { status: s.status, series: s.series, display: s.display, value: s.value };
  const series = s.status === 'ok' ? s.series : undefined;
  return {
    key: 'shape',
    title: s.series?.name ?? 'state',
    text:
      s.status === 'ok' && s.display
        ? formattedValueToString(s.display)
        : STATUS_TEXT[s.status === 'ok' ? 'nodata' : s.status],
    status: s.status,
    color: s.color,
    values: series?.values ?? [],
    times: series?.times,
    ...(series ? { format: (v: number) => formattedValueToString(ctx.display(series, v)) } : {}),
    href: rowHref(patch, undefined, primary, ctx),
    ...(series ? minMax(series.values, (v) => formattedValueToString(ctx.display(series, v))) : {}),
    ...(series ? { domain: yDomain(series.values, fieldBounds(series)) } : {}),
  };
}

/** The card title: the title template of the pattern (hover.title, link.card.title), else the title of the cell. */
function titleOf(patch: CellPatch & { hover?: { title?: string } }): string {
  const cell = patch.scope.cell;
  const fallback = patch.scope.cellTitle || cell.label || cell.key || patch.cellId;
  const template = patch.hover?.title ?? patch.card?.title;
  if (template === undefined) {
    return fallback;
  }
  const r = resolveTemplate(template, patch.scope);
  return r.unresolved.length || !r.text.trim() ? fallback : r.text;
}

/**
 * True when the card of the cell has rows or links. It reads no series values, so the panel can call it for all
 * cells once per data update. `configured`: the patch comes from the authoring configuration (buildConfiguredCard).
 */
export function opensCard(patch: PlanCellPatch, configured: boolean, ctx: CardContext): boolean {
  if (configured) {
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
  } else if (patch.link?.a2b || patch.link?.b2a || patch.card?.rows?.length || patch.shape) {
    return true;
  }
  return resolveLinks(patch, primaryOf(patch), ctx.replaceVariables, '').length > 0;
}

/** Resolves the card of one cell. The panel calls it only for the cell under the pointer or the pinned cell. */
export function buildCard(patch: CellPatch, ctx: CardContext): CardModel {
  const rows: CardRowModel[] = [];
  if (patch.link) {
    for (const key of ['a2b', 'b2a'] as const) {
      const h = patch.link[key];
      if (h) {
        rows.push(halfRow(patch, key, h, ctx));
      }
    }
  } else if (patch.card?.rows) {
    rows.push(...patch.card.rows.map((r, i) => seriesRow(patch, r, i, ctx)));
  } else {
    const r = shapeRow(patch, ctx);
    if (r) {
      rows.push(r);
    }
  }
  const title = titleOf(patch);
  return { title, rows, links: resolveLinks(patch, primaryOf(patch), ctx.replaceVariables, title) };
}

/**
 * Polyline points of a sparkline in a w × h box with 1 px padding. Values that are not finite are skipped.
 * Times map over the part of the dashboard range that has data (first to last sample), so the line fills
 * the width also when the series starts late or stops early. Without times or range the index is used.
 * The Y range is the domain, by default yDomain of the values.
 */
export function sparkPoints(
  values: number[],
  times: number[] | undefined,
  range: { from: number; to: number } | undefined,
  w: number,
  h: number,
  domain: [number, number] = yDomain(values)
): string {
  // Long series: keep about two points per pixel.
  const step = Math.max(1, Math.floor(values.length / (2 * Math.max(w, 1))));
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      continue;
    }
    if (i % step === 0 || i === values.length - 1) {
      idx.push(i);
    }
  }
  if (idx.length < 2) {
    return '';
  }
  const [lo, hi] = domain;
  const span = hi - lo;
  let t0 = 0;
  let t1 = 0;
  if (times && range && range.to > range.from) {
    t0 = Math.max(range.from, times[idx[0]]);
    t1 = Math.min(range.to, times[idx[idx.length - 1]]);
    if (!(t1 > t0)) {
      [t0, t1] = [range.from, range.to];
    }
  }
  const useTime = t1 > t0;
  const x = (i: number) => (useTime ? ((times![i] - t0) / (t1 - t0)) * w : (i / (values.length - 1)) * w);
  const y = (v: number) => (span ? 1 + (1 - (v - lo) / span) * (h - 2) : h / 2);
  // points outside the dashboard range (a time shift, a late sample) stay on the edge
  const r = (n: number, max: number) => Math.round(Math.min(Math.max(n, 0), max) * 10) / 10;
  return idx.map((i) => `${r(x(i), w)},${r(y(values[i]), h)}`).join(' ');
}
