import {
  formattedValueToString,
  getFieldDisplayName,
  type DisplayValue,
  type Field,
  type FieldConfig,
  type GrafanaTheme2,
  LinkModel,
} from '@grafana/data';
import type { CardContext, CellPatch } from '../types';
import { defaultUrlTitle } from './links';
import { halfState, type HalfContext } from '../binding/engine';
import type { StatusView } from '../binding/status';
import { fieldDisplay, type HistoryModel } from '../query/frames';
import { noDataColor } from '../binding/color';
import { combinedTop, yDomain, type LowerBound } from '../visuals/domain';
import type { BindInputV4, BindResultV4, PatchV4 } from '../binding/bindV4';
import { effectiveClass } from '../binding/classes';
import { cadenceOf, freshnessMs, staleCheck } from '../binding/freshness';
import { linkFeeds } from '../binding/linkFeeds';
import { directionHistory, isInstant, shownField, snapshotV4 } from '../binding/rowData';
import { defaultReduce } from '../binding/units';
import type { Use } from '../binding/uses';
import { reduceAcross, unitFactors } from '../query/reduce';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { ChartV4, RowV4 } from '../model/v4';
import type { UsePath } from '../binding/report';
import { NO_DATA_ROW } from '../visuals/hoverSample';
import type { ChartLine } from '../visuals/SparklineView';

export interface ConfiguredCardRow {
  key: string;
  kind: RowV4['kind'] | 'status';
  /** the state of a status row: its word takes the status colour */
  status?: StatusView['state'];
  title: string;
  text: string;
  state: HistoryModel['state'];
  /** an `updown` row: one entry for each direction */
  directions?: DirectionRowModel[];
  /** the Y range of the chart of the row */
  domain?: [number, number];
  /** the lines of a history row, up to MAX_LINES (spec 3.7) */
  lines?: ChartLine[];
  /** the series after the drawn lines ("+N more") */
  more?: number;
  /** the series of the row are stale at the time of the bind (spec 3.5 step 6) */
  stale?: boolean;
  /** the row turns stale at this time on a relative range; the card reads the clock again then */
  staleAfter?: number;
  /** formats a value of a line, with the display processor of the first series and the row unit and decimals */
  format?: (value: number) => string;
  /** the field config of the first series with the row unit and decimals; the chart reads its unit and Min/Max */
  config?: FieldConfig;
  /** the reduced value of a `value` row, for the bar gauge of a chart region */
  display?: DisplayValue;
}

/** Height in px of the chart of a single-direction history row. */
export const SPARK_HEIGHT = 40;

/**
 * Chart height of a history row in px. A row with the zero line (up above, down mirrored below) is twice as tall as
 * a plain sparkline, so each half is as tall as one.
 */
export function chartHeight(row: Pick<ConfiguredCardRow, 'directions'>): number {
  return row.directions?.some((d) => d.mirrored) ? 2 * SPARK_HEIGHT : SPARK_HEIGHT;
}

/** One direction of an `updown` row. */
export interface DirectionRowModel {
  direction: 'up' | 'down';
  /** "↑" or "↓" by default */
  label: string;
  /** current value, for example "8.2 Mb/s · 8% of 100 Mb/s", or why there is no value */
  text: string;
  /** from the field config and thresholds of its own value, as a link half */
  color: string;
  /** drawn below the zero line (negative): down when the row has both directions */
  mirrored: boolean;
  history: HistoryModel;
}

/** The link-half context of a card: the field of the series formats the values and the capacity. */
function halfContext(ctx: CardContext): HalfContext {
  return {
    theme: ctx.theme,
    fieldThresholds: ctx.fieldThresholds,
    linkWidth: { min: 0, max: 0 },
    display: (series, value) => fieldDisplay(series.field, ctx.theme)(value),
  };
}

/**
 * True when the card of the cell has rows or links: a URL, a row of its class, or a status. It reads no series
 * values, so the panel can call it for all cells once per data update.
 */
export function opensCard(patch: CellPatch & Pick<PatchV4, 'rowsV4'>): boolean {
  return patch.urls.length > 0 || (patch.rowsV4?.length ?? 0) > 0 || patch.statusView !== undefined;
}

/** The most lines of one history chart; the other series give "+N more" (spec 3.7, D9). */
export const MAX_LINES = 8;

/** A v4 history row: up to MAX_LINES lines in one Y range, then "+N more". */
export interface HistoryRowV4 extends ConfiguredCardRow {
  kind: 'history';
  lines: ChartLine[];
  more: number;
  domain: [number, number];
  stale: boolean;
}
export type CardRowV4 =
  HistoryRowV4 | (ConfiguredCardRow & { kind: 'value' | 'updown' | 'metadata' | 'status'; stale: boolean });

export interface CardModelV4 {
  title: string;
  rows: CardRowV4[];
  links: LinkModel[];
}

/** The inputs of the bind give the class of the cell (its freshness), the frames (the line labels) and the range. */
export type CardContextV4 = CardContext & Pick<BindInputV4, 'index' | 'validated' | 'data'>;

/** Eight distinct hues from the Grafana classic palette, in stable line order. */
function lineColor(theme: GrafanaTheme2, i: number): string {
  const palette = theme.visualization.palette;
  return theme.visualization.getColorByName(palette[[0, 1, 2, 3, 4, 5, 26, 30][i % MAX_LINES] % palette.length]);
}

const hasValue = (values: ReadonlyArray<number | null>) => values.some((v) => v !== null && Number.isFinite(v));

/** The data of one use for the cell: the snapshot of its refId, its series, or why the use has none. */
interface UseData {
  use: Use;
  snapshot: QuerySnapshot;
  series: Series[];
  problem?: string;
}

/**
 * The card of a v4 cell (spec 3.7, 3.5 step 6, 3.6): a status row when the status is not normal, then the rows of the
 * effective class in their order. A `history` row draws up to MAX_LINES lines in one `yDomain` range, a `value` row
 * reduces across its series, an `updown` row reduces each direction at each timestamp. The URL of the cell and the
 * `drilldown` rows are the links. A row is stale when one of its series is stale; on a relative range the row gives
 * the deadline (`staleAfter`) and the card reads the clock.
 */
export function buildCardV4(cellId: string, bound: BindResultV4, ctx: CardContextV4): CardModelV4 {
  const meta = ctx.index.get(cellId)?.meta;
  const title = meta ? meta.title || meta.labelText || meta.key : cellId;
  const card: CardModelV4 = { title, rows: [], links: [] };
  const patch = bound.patches.get(cellId);
  if (!patch) {
    return card;
  }
  const reader = readerOf(cellId, bound, ctx);
  for (const u of patch.urls) {
    card.links.push({ title: u.title ?? defaultUrlTitle(u.url, title), href: u.url, target: '_blank', origin: patch });
  }
  const slots = patch.rowsV4 ?? [];
  const status = patch.statusView;
  // a state that is not normal and its reason come first; a normal status shows only on a card with no rows
  if (status && (status.state !== 'normal' || !slots.length)) {
    card.rows.push({
      key: 'status',
      kind: 'status',
      status: status.state,
      title: status.state,
      text: status.reason || (patch.statusV4?.text ?? ''),
      state: 'ready',
      stale: false,
    });
  }
  slots.forEach((slot, i) => {
    const key = `row-${i}`;
    if (slot.kind === 'metadata') {
      card.rows.push({
        key,
        kind: slot.kind,
        title: slot.label ?? '',
        text: slot.text ?? '',
        state: 'ready',
        stale: false,
      });
      return;
    }
    if (slot.kind === 'drilldown') {
      // a drilldown is a footer link, not a row
      const href = slot.url ?? '';
      if (href && !card.links.some((l) => l.href === href)) {
        card.links.push({ title: slot.label ?? defaultUrlTitle(href, title), href, target: '_blank', origin: patch });
      }
      return;
    }
    const row = queryRowV4(key, slot.kind, slot.path, reader, ctx);
    if (row) {
      card.rows.push(row);
    }
  });
  return card;
}

/**
 * The chart region of a cell (spec 3.9): the `chart` of its effective class, built with the rules of a card row. A
 * `history` chart draws up to MAX_LINES lines, a `value` chart gives the reduced value for a bar gauge, an `updown`
 * chart gives its two directions. Undefined when the cell has no use at the path of the chart.
 */
export function chartRowV4(
  use: { cellId: string; chart: ChartV4; path: UsePath },
  bound: BindResultV4,
  ctx: CardContextV4
): CardRowV4 | undefined {
  return queryRowV4('chart', use.chart.kind, use.path, readerOf(use.cellId, bound, ctx), ctx);
}

/** The row of a query use: `history`, `value` or `updown` (two uses, `<path>.a2b` and `<path>.b2a`). */
function queryRowV4(
  key: string,
  kind: 'history' | 'value' | 'updown',
  path: UsePath,
  reader: UseReader,
  ctx: CardContextV4
): CardRowV4 | undefined {
  if (kind === 'updown') {
    const a2b = reader.dataOf(`${path}.a2b`);
    const b2a = reader.dataOf(`${path}.b2a`);
    return a2b && b2a ? updownRow(key, [a2b, b2a], reader.at, ctx, reader.staleOf([a2b, b2a])) : undefined;
  }
  const d = reader.dataOf(path);
  if (!d) {
    return undefined;
  }
  return kind === 'history'
    ? historyRowV4(key, d, ctx, reader.staleOf([d]))
    : valueRowV4(key, d, ctx, reader.staleOf([d]));
}

/** The data of the uses of one cell, and the stale check of a row (spec 3.5 step 6). */
interface UseReader {
  /** the `at` attribute of the cell: which end the key names (spec 3.8.2) */
  at?: string;
  dataOf(path: string): UseData | undefined;
  staleOf(data: UseData[]): { stale: boolean; staleAfter?: number };
}

function readerOf(cellId: string, bound: BindResultV4, ctx: CardContextV4): UseReader {
  const meta = ctx.index.get(cellId)?.meta;
  const config = ctx.validated.parsed.config;
  const bind = meta?.attrs.bind;
  const cls = bind === undefined ? undefined : ctx.validated.classes.get(bind);
  const eff = cls && config ? effectiveClass(cls, config.overrides[cellId], cellId) : undefined;
  const uses = bound.uses.get(cellId) ?? [];
  const targets = ctx.data.request ? new Set(ctx.data.request.targets.map((t) => t.refId)) : undefined;

  const dataOf = (path: string): UseData | undefined => {
    const use = uses.find((u) => u.path === path);
    if (!use) {
      return undefined;
    }
    const snapshot = snapshotV4(ctx.data, use.refId);
    const series = bound.series.get(cellId)?.get(path) ?? [];
    if (targets && !targets.has(use.refId)) {
      return { use, snapshot, series, problem: 'Unknown query' };
    }
    for (const entry of bound.report) {
      if ((entry.kind === 'missing-attr' || entry.kind === 'matcher-error') && entry.path === path) {
        if (entry.cellIds.includes(cellId)) {
          const problem = entry.kind === 'missing-attr' ? `Missing attribute ${entry.attr}` : 'Matcher error';
          return { use, snapshot, series, problem };
        }
      }
    }
    return { use, snapshot, series };
  };

  /** Spec 3.5 step 6: the row is stale when one of its series is stale. A relative range gives a deadline. */
  const staleOf = (data: UseData[]): { stale: boolean; staleAfter?: number } => {
    let stale = false;
    let staleAfter: number | undefined;
    for (const d of data) {
      if (!eff || !config || d.problem || d.snapshot.state !== 'ready') {
        continue;
      }
      const check = staleCheck(d.series, {
        timeRange: ctx.data.timeRange,
        request: ctx.data.request,
        freshnessMs: freshnessMs(eff.freshness ?? config.freshness, cadenceOf(d.use.refId, ctx.data.request, d.series)),
        instant: isInstant(ctx.data, d.use.refId),
      });
      stale ||= check.stale;
      if (check.deadline !== undefined) {
        staleAfter = Math.min(staleAfter ?? Infinity, check.deadline);
      }
    }
    return staleAfter === undefined ? { stale } : { stale, staleAfter };
  };
  return { at: meta?.attrs.at, dataOf, staleOf };
}

/** The fields of a row that format and bound a value: the `show` fields, `reduce`, `min` and `max`. */
type RowFields = { label?: string; unit?: string; decimals?: number; reduce?: 'sum' | 'max' | 'mean' };

/** Why a use has nothing to show, with the state of the row; undefined when it has series. */
function noSeries(d: UseData): { text: string; state: HistoryModel['state'] } | undefined {
  if (d.problem) {
    return { text: d.problem, state: 'unsupported' };
  }
  const state = d.snapshot.state;
  if (state === 'error' || state === 'unsupported') {
    return { text: 'Query failed', state: 'error' };
  }
  if (state === 'loading' || state === 'idle') {
    return { text: 'Loading data', state: 'loading' };
  }
  if (!d.series.length) {
    return { text: NO_DATA_ROW, state: 'empty' };
  }
  if ('mismatch' in unitFactors(d.series)) {
    return { text: 'Mixed units', state: 'unsupported' };
  }
  return undefined;
}

/** The value text of a use: the display processor of the first series, with the row unit and decimals (spec 3.7). */
function formatOf(shown: Field, ctx: CardContext): (value: number) => string {
  const display = fieldDisplay(shown, ctx.theme);
  return (value) => formattedValueToString(display(value));
}

/**
 * The title of a query row: the row label, else the display name in the field config, else the refId. It does not
 * read the series labels, so the title stays the same when the count of series changes; the lines carry them.
 */
function rowTitle(d: UseData, row: RowFields): string {
  return row.label ?? d.series[0]?.field.config.displayName ?? d.use.refId;
}

/** The label of a line: the display name of the field (spec 3.7). */
function lineLabel(d: UseData, s: Series): string {
  const frames = d.snapshot.state === 'ready' ? d.snapshot.frames : [];
  const keys = Object.keys(s.labels)
    .filter((key) => d.series.slice(0, MAX_LINES).some((other) => other.labels[key] !== s.labels[key]))
    .sort();
  return keys.length
    ? `{${keys.map((key) => `${key}=${JSON.stringify(s.labels[key])}`).join(', ')}}`
    : getFieldDisplayName(s.field, frames[s.frameIndex], frames);
}

function historyRowV4(
  key: string,
  d: UseData,
  ctx: CardContext,
  stale: { stale: boolean; staleAfter?: number }
): HistoryRowV4 {
  const row = (d.use.row ?? {}) as RowFields & { min?: LowerBound; max?: number };
  const base = { key, kind: 'history' as const, title: rowTitle(d, row), ...stale, more: 0 };
  const missing = noSeries(d);
  if (missing) {
    return { ...base, ...missing, lines: [], domain: yDomain([], { min: row.min, max: row.max }) };
  }
  const first = d.series[0];
  const units = unitFactors(d.series);
  const factors = 'mismatch' in units ? [] : units.factors;
  const lines = d.series.slice(0, MAX_LINES).map((s, i): ChartLine => {
    const f = factors[i] ?? 1;
    const values = f === 1 ? s.values : s.values.map((v) => (v === null ? null : v * f));
    return {
      label: lineLabel(d, s),
      color: lineColor(ctx.theme, i),
      times: s.times,
      values,
      noData: !hasValue(values),
    };
  });
  const shown = shownField(first.field, row);
  const domain = yDomain(
    lines.flatMap((l) => l.values),
    {
      min: row.min,
      max: row.max,
      fieldMin: first.field.config.min,
      fieldMax: first.field.config.max,
      unit: shown.config.unit,
    }
  );
  const format = formatOf(shown, ctx);
  // one line: its last value; N lines: the tooltip gives the values
  const last = lines.length === 1 ? lastValue(lines[0].values) : undefined;
  return {
    ...base,
    text: lines.length === 1 ? (last === undefined ? NO_DATA_ROW : format(last)) : '',
    state: 'ready',
    lines,
    more: d.series.length - lines.length,
    domain,
    format,
    config: shown.config,
  };
}

function lastValue(values: ReadonlyArray<number | null>): number | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) {
      return v;
    }
  }
  return undefined;
}

function valueRowV4(
  key: string,
  d: UseData,
  ctx: CardContext,
  stale: { stale: boolean; staleAfter?: number }
): CardRowV4 {
  const row = (d.use.row ?? {}) as RowFields;
  const base = { key, kind: 'value' as const, title: rowTitle(d, row), ...stale };
  const missing = noSeries(d);
  if (missing) {
    return { ...base, ...missing };
  }
  const first = d.series[0];
  const reduced = reduceAcross(d.series, row.reduce ?? defaultReduce(first.field.config.unit));
  if ('mismatch' in reduced || reduced.value === null) {
    return { ...base, text: NO_DATA_ROW, state: 'empty' };
  }
  const shown = shownField(first.field, row);
  const display = fieldDisplay(shown, ctx.theme)(reduced.value);
  return { ...base, text: formattedValueToString(display), state: 'ready', display, config: shown.config };
}

/**
 * An `updown` row: up above the zero line, down mirrored below it, in one symmetric range (spec 3.7, 3.8.3). The
 * history of a direction is the reduce of its series at each timestamp; a missing member gives a gap. The colour and
 * the text of a direction come from `halfState`, as a link half.
 */
function updownRow(
  key: string,
  data: [UseData, UseData],
  at: string | undefined,
  ctx: CardContext,
  stale: { stale: boolean; staleAfter?: number }
): CardRowV4 {
  const row = (data[0].use.row ?? {}) as RowFields & { up?: string; down?: string };
  const feeds = linkFeeds(at, 'up', 'down');
  const byDirection = { [feeds.a2b]: data[0], [feeds.b2a]: data[1] } as Record<'up' | 'down', UseData>;
  const allSeries = data.flatMap((d) => d.series);
  const units = unitFactors(allSeries);
  if ('mismatch' in units) {
    return {
      key,
      kind: 'updown',
      title: row.label ?? `${row.up ?? ''} / ${row.down ?? ''}`,
      text: 'Mixed units',
      state: 'unsupported',
      ...stale,
    };
  }
  let offset = 0;
  for (const direction of ['up', 'down'] as const) {
    const d = byDirection[direction];
    offset = d === data[0] ? 0 : data[0].series.length;
    byDirection[direction] = {
      ...d,
      series: d.series.map((s) => {
        const factor = units.factors[offset++];
        return {
          ...s,
          field: { ...s.field, config: { ...s.field.config, unit: units.unit }, display: undefined },
          values: s.values.map((v) => (v === null ? null : v * factor)),
        };
      }),
    };
  }
  const halves = halfContext(ctx);
  const directions = (['up', 'down'] as const).map((direction): DirectionRowModel => {
    const d = byDirection[direction];
    const label = direction === 'up' ? '↑' : '↓';
    const mirrored = direction === 'down';
    const missing = noSeries(d);
    if (missing) {
      const history: HistoryModel =
        missing.state === 'empty'
          ? { state: 'empty', fetchedAt: 0, fromCache: false }
          : { state: 'unsupported', message: missing.text };
      return { direction, label, mirrored, history, text: missing.text, color: noDataColor(ctx.theme) };
    }
    const reduced = directionHistory(d, row.reduce);
    const history: HistoryModel =
      reduced.state === 'ready'
        ? { ...reduced, field: shownField(reduced.field, row) as typeof reduced.field }
        : reduced;
    const half = halfState(history, d.use.refId, { source: 'none' }, halves).state;
    return { direction, label, mirrored, history, text: half.label, color: half.color };
  });
  const ready = directions.flatMap((d) => (d.history.state === 'ready' ? [d.history] : []));
  const top = combinedTop(ready.flatMap((h) => h.values));
  return {
    key,
    kind: 'updown',
    title: row.label ?? `${row.up ?? ''} / ${row.down ?? ''}`,
    text: directions.map((d) => `${d.label} ${d.text}`).join('  '),
    state: ready.length ? 'ready' : directions[0].history.state,
    directions,
    domain: [-top, top],
    ...stale,
  };
}

/** The time after which a row of a card is stale on a relative range (`staleAfter`), or undefined. */
export function staleDeadline(row: ConfiguredCardRow): number | undefined {
  return row.staleAfter;
}
