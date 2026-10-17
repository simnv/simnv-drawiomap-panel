import { DisplayValue, formattedValueToString, GrafanaTheme2, LinkModel, ScopedVars } from '@grafana/data';
import { reduceValues } from '../binding/reduce';
import { findSeries } from '../binding/series';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import type { BindStatus, CardRow, CellPatch, HalfState, SeriesInfo } from '../types';
import { buildScopedVars, primaryOf, Primary, resolveLinks } from './links';

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
  return {
    key,
    title: `${a} → ${b}`,
    text: h.label,
    status: h.status,
    color: h.color,
    values: h.status === 'ok' ? (h.series?.values ?? []) : [],
    times: h.status === 'ok' ? h.series?.times : undefined,
    href: rowHref(patch, patch.card?.url, primary, ctx),
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
  };
}

/** The default node row: the series that colours the node. */
function shapeRow(patch: CellPatch, ctx: CardContext): CardRowModel | undefined {
  const s = patch.shape;
  if (!s) {
    return undefined;
  }
  const primary: Primary = { status: s.status, series: s.series, display: s.display, value: s.value };
  return {
    key: 'shape',
    title: s.series?.name ?? 'state',
    text:
      s.status === 'ok' && s.display
        ? formattedValueToString(s.display)
        : STATUS_TEXT[s.status === 'ok' ? 'nodata' : s.status],
    status: s.status,
    color: s.color,
    values: s.status === 'ok' ? (s.series?.values ?? []) : [],
    times: s.status === 'ok' ? s.series?.times : undefined,
    href: rowHref(patch, undefined, primary, ctx),
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
  return { title: titleOf(patch), rows, links: resolveLinks(patch, primaryOf(patch), ctx.replaceVariables) };
}

/**
 * Polyline points of a sparkline in a w × h box with 1 px padding. Times map over the dashboard range;
 * without times or range the index is used. Values that are not finite are skipped.
 */
export function sparkPoints(
  values: number[],
  times: number[] | undefined,
  range: { from: number; to: number } | undefined,
  w: number,
  h: number
): string {
  // Long series: keep about two points per pixel. The loop finds the extrema (a spread call fails on big arrays).
  const step = Math.max(1, Math.floor(values.length / (2 * Math.max(w, 1))));
  const idx: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      continue;
    }
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (i % step === 0 || i === values.length - 1) {
      idx.push(i);
    }
  }
  if (idx.length < 2) {
    return '';
  }
  const span = max - min;
  const useTime = !!times && !!range && range.to > range.from;
  const x = (i: number) =>
    useTime ? ((times![i] - range!.from) / (range!.to - range!.from)) * w : (i / (values.length - 1)) * w;
  const y = (v: number) => (span ? 1 + (1 - (v - min) / span) * (h - 2) : h / 2);
  // points outside the dashboard range (a time shift, a late sample) stay on the edge
  const r = (n: number, max: number) => Math.round(Math.min(Math.max(n, 0), max) * 10) / 10;
  return idx.map((i) => `${r(x(i), w)},${r(y(values[i]), h)}`).join(' ');
}
