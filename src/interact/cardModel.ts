import {
  DisplayValue,
  formattedValueToString,
  getDisplayProcessor,
  GrafanaTheme2,
  LinkModel,
  ScopedVars,
} from '@grafana/data';
import { reduceValues } from '../binding/reduce';
import { findSeries } from '../binding/series';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import type { BindStatus, CardRow, CellPatch, HalfState, SeriesInfo } from '../types';
import { buildScopedVars, primaryOf, Primary, resolveLinks } from './links';
import { historySeries, type BindingDemand, type BindingResolver, type PlanCellPatch } from '../binding/engine';
import type { HistoryModel } from '../query/frames';
import type { Diagnostic, HoverRow } from '../model/config';

export interface ConfiguredCardRow {
  key: string;
  kind: HoverRow['kind'] | 'status';
  title: string;
  text: string;
  state: HistoryModel['state'];
  history?: HistoryModel;
  href?: string;
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
      card.rows.push({ ...base, text: base.title, state: 'ready', href: rowHref(patch, row.url, primary, ctx) });
    } else {
      const unavailable = patch.unavailableHoverRows?.includes(i);
      if (!unavailable) {
        card.demands.push({ cellId: patch.cellId, binding: row.binding, role: 'hover', rowIndex: i });
      }
      let model: HistoryModel = unavailable
        ? { state: 'unsupported', message: 'Binding metadata is unavailable' }
        : resolve(patch.cellId, row.binding);
      if (model.state === 'empty' || model.state === 'error' || model.state === 'unsupported') {
        const message = model.state === 'empty' ? `No metric matches query ${row.binding.queryId}.` : model.message;
        card.diagnostics.push({
          code:
            model.state === 'empty'
              ? 'unmatched-metric'
              : message.toLowerCase().includes('ambiguous')
                ? 'ambiguous-metric'
                : `${model.state}-metric`,
          path: `cells.${patch.cellId}.hover.rows[${i}].binding`,
          message,
        });
      }
      if (model.state === 'ready' && row.unit !== undefined) {
        const field = { ...model.field, config: { ...model.field.config, unit: row.unit } };
        const display = getDisplayProcessor({ field, theme: ctx.theme });
        model = {
          ...model,
          field,
          latestDisplayValue: model.latestValue === undefined ? undefined : display(model.latestValue),
        };
      }
      const series = model.state === 'ready' ? historySeries(model, row.binding) : undefined;
      const rowPrimary: Primary = {
        status: model.state === 'ready' ? 'ok' : 'nodata',
        series,
        value: model.state === 'ready' ? model.latestValue : undefined,
        display: model.state === 'ready' ? model.latestDisplayValue : undefined,
      };
      const text =
        model.state === 'ready' && model.latestDisplayValue
          ? formattedValueToString(model.latestDisplayValue)
          : model.state === 'error' || model.state === 'unsupported'
            ? model.message
            : model.state === 'idle' || model.state === 'loading'
              ? 'Loading data'
              : 'No data';
      card.rows.push({
        ...base,
        text,
        state: model.state,
        href: rowHref(patch, row.url, rowPrimary, ctx),
        ...(row.kind === 'history' ? { history: model } : {}),
      });
    }
  });
  return card;
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
  /** click target after template and dashboard variable resolution */
  href?: string;
  /** smallest and largest value of the series, formatted like the value */
  min?: string;
  max?: string;
  /** Y range of the sparkline, see sparkDomain */
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
}

const STATUS_TEXT = { nodata: 'no data', unbound: 'unbound' } as const;

/** Units with a fixed top: percent is 0 to 100, percentunit is 0 to 1. */
const UNIT_TOP: Record<string, number> = { percent: 100, percentunit: 1 };

/**
 * The Y range of a sparkline.
 * A series without negative values starts at 0, so a small change does not look like a big climb.
 * The top is the largest value, the capacity of the row or the top of the unit (percent), whichever is largest.
 * A series with negative values uses min to max, but the span is at least 10% of |max| (1 when max is 0),
 * centred on the data.
 */
export function sparkDomain(values: number[], opts: { unit?: string; capacity?: number } = {}): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (min > max) {
    return [0, 1];
  }
  if (min < 0) {
    const minSpan = max === 0 ? 1 : Math.abs(max) / 10;
    if (max - min >= minSpan) {
      return [min, max];
    }
    const centre = (min + max) / 2;
    return [centre - minSpan / 2, centre + minSpan / 2];
  }
  const cap = opts.capacity !== undefined && opts.capacity > 0 ? opts.capacity : 0;
  const top = Math.max(max, cap, UNIT_TOP[opts.unit ?? ''] ?? 0);
  return [0, top > 0 ? top : 1];
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
  // The state keeps the percent of the capacity, so the capacity in the unit of the series is value / percent.
  const capacity = h.value !== undefined && h.percent ? (h.value * 100) / h.percent : undefined;
  return {
    key,
    title: `${a} → ${b}`,
    text: h.label,
    status: h.status,
    color: h.color,
    values,
    times: s?.times,
    href: rowHref(patch, patch.card?.url, primary, ctx),
    ...(s ? minMax(values, (v) => formattedValueToString(ctx.display(s, v))) : {}),
    ...(s ? { domain: sparkDomain(values, { unit: s.field.config?.unit, capacity }) } : {}),
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
    href: rowHref(patch, row.url, primary, ctx),
    ...minMax(f.series.values, (v) => formattedValueToString(ctx.display(f.series!, v, override))),
    domain: sparkDomain(f.series.values, { unit: row.unit ?? f.series.field.config?.unit }),
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
    href: rowHref(patch, undefined, primary, ctx),
    ...(series ? minMax(series.values, (v) => formattedValueToString(ctx.display(series, v))) : {}),
    ...(series ? { domain: sparkDomain(series.values, { unit: series.field.config?.unit }) } : {}),
  };
}

function titleOf(patch: CellPatch): string {
  const cell = patch.scope.cell;
  const fallback = cell.label || cell.key || patch.cellId;
  if (patch.card?.title === undefined) {
    return fallback;
  }
  const r = resolveTemplate(patch.card.title, patch.scope);
  return r.unresolved.length ? fallback : r.text;
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
 * The Y range is the domain, by default sparkDomain of the values.
 */
export function sparkPoints(
  values: number[],
  times: number[] | undefined,
  range: { from: number; to: number } | undefined,
  w: number,
  h: number,
  domain: [number, number] = sparkDomain(values)
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
