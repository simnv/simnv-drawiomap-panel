import { formattedValueToString, getFieldDisplayName, type GrafanaTheme2, LinkModel } from '@grafana/data';
import type { CardContext } from '../types';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import { buildScopedVars, defaultUrlTitle, primaryOf, Primary, resolveLinks } from './links';
import {
  halfState,
  historySeries,
  metricProblem,
  type BindingResolver,
  type HalfContext,
  type PlanCellPatch,
} from '../binding/engine';
import type { BindingDemand } from '../binding/resolve';
import { inFieldUnit, resolveCapacity, type CapacityDiagnostic } from '../binding/capacity';
import { INVALID_FRESHNESS_TEXT, type StatusView } from '../binding/status';
import { fieldDisplay, type HistoryModel } from '../query/frames';
import {
  cellPath,
  diagnosticKey,
  invalidBounds,
  invalidFreshness,
  rowBindings,
  type CombinedRow,
  type Diagnostic,
  type FreshnessPolicy,
  type HoverRow,
  type QueryBinding,
} from '../model/config';
import { noDataColor } from '../binding/color';
import { combinedTop, yDomain, type LowerBound } from '../visuals/domain';
import type { BindInputV4, BindResultV4 } from '../binding/bindV4';
import { effectiveClass } from '../binding/classes';
import { cadenceOf, freshnessMs, staleCheck } from '../binding/freshness';
import { linkFeeds } from '../binding/linkFeeds';
import { directionHistory, isInstant, shownField, snapshotV4 } from '../binding/rowData';
import { defaultReduce } from '../binding/units';
import type { Use } from '../binding/uses';
import { reduceAcross, unitFactors } from '../query/reduce';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { RowV4 } from '../model/v4';
import { alignedSamples } from '../visuals/hoverSample';
import type { ChartLine } from '../visuals/SparklineView';

export interface ConfiguredCardRow {
  key: string;
  kind: HoverRow['kind'] | RowV4['kind'] | 'status';
  /** the state of a status row: its word takes the status colour */
  status?: StatusView['state'];
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
  /** v4: the lines of a history row, up to MAX_LINES (spec 3.7); a v3 row has `history` and one line through the shim */
  lines?: ChartLine[];
  /** v4: the series after the drawn lines ("+N more") */
  more?: number;
  /** v4: the series of the row are stale at the time of the bind (spec 3.5 step 6) */
  stale?: boolean;
  /** v4: the row turns stale at this time on a relative range; the card reads the clock again then */
  staleAfter?: number;
  /** v4: formats a value of a line, with the display processor of the first series and the row unit and decimals */
  format?: (value: number) => string;
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

const UNAVAILABLE_TEXT = 'Binding metadata is unavailable';

/** Why a data row cannot show its data, from its own options: a freshness policy or a range that cannot be met. */
function rowProblem(row: Extract<HoverRow, { kind: 'value' | 'history' | 'combined' }>): string | undefined {
  return invalidFreshness(row.freshness)
    ? INVALID_FRESHNESS_TEXT
    : invalidBounds(row.min, row.max)
      ? 'Invalid range'
      : undefined;
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
  // A state that is not normal and its reason come first: the element shows the colour, the card says why.
  // A normal status adds a row only to a card with no hover rows (the card then has something to show).
  if (patch.statusView && (patch.statusView.state !== 'normal' || !patch.hover)) {
    card.rows.push({
      key: 'status',
      kind: 'status',
      status: patch.statusView.state,
      title: patch.statusView.state,
      text: patch.statusView.reason,
      state: 'ready',
    });
  }
  if (!patch.hover) {
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
          path: cellPath(patch.cellId, `hover.rows[${i}].url`),
          message: 'Drilldown URL must use http, https or a relative path.',
        });
      } else if (!card.links.some((l) => l.href === href)) {
        card.links.push({ title: base.title, href, target: '_blank', origin: patch });
      }
    } else {
      // a row that cannot show data: its binding is not usable for the cell, or its own options cannot be met
      const blocked = patch.unavailableHoverRows?.includes(i) ? UNAVAILABLE_TEXT : rowProblem(row);
      const parts = rowBindings(row).map(({ binding, path }, j) => {
        if (blocked === undefined) {
          card.demands.push({ cellId: patch.cellId, binding, role: 'hover', rowIndex: i, path });
        }
        const model: HistoryModel =
          blocked !== undefined
            ? { state: 'unsupported', message: blocked }
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
      if (row.kind === 'combined') {
        const href = rowHref(patch, row.url, (parts.find((p) => p.primary.series) ?? parts[0]).primary, ctx);
        card.rows.push({
          ...base,
          freshness: row.freshness,
          href,
          height: row.height,
          ...(blocked !== undefined
            ? { state: 'unsupported', text: blocked }
            : combinedRow(
                row,
                parts.map((p) => p.model),
                ctx,
                { patch, rowIndex: i, resolve, card }
              )),
        });
        return;
      }
      const model = parts[0]?.model ?? { state: 'unsupported', message: UNAVAILABLE_TEXT };
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
    diagnostics.push({ ...problem, path: cellPath(patch.cellId, path) });
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
 * A combined up/down row. Up leaves the subject (tx), down enters it (rx). With both directions, up is above
 * the zero line and down is mirrored below it, in the symmetric range [-M, M]: M is the largest |value|,
 * the capacity or the row max. A single direction stays positive and uses yDomain.
 */
function combinedRow(
  row: CombinedRow,
  models: HistoryModel[],
  ctx: CardContext,
  at: { patch: PlanCellPatch; rowIndex: number; resolve: BindingResolver; card: ConfiguredCardModel }
): Pick<ConfiguredCardRow, 'text' | 'state' | 'sampleAt' | 'directions' | 'domain'> {
  const { patch, card } = at;
  const rowPath = `hover.rows[${at.rowIndex}]`;
  // The row capacity sources are resolved once per direction: one report of each problem, one read of each series.
  const reported = new Set<string>();
  const report = (d: CapacityDiagnostic) => {
    const key = diagnosticKey(d);
    if (!reported.has(key)) {
      reported.add(key);
      card.diagnostics.push({ ...d, path: cellPath(patch.cellId, d.path) });
    }
  };
  const reads = new Map<string, HistoryModel>();
  const read = (binding: QueryBinding, path: string): HistoryModel | undefined => {
    if (patch.bindings && !patch.bindings.includes(binding)) {
      return undefined;
    }
    const seen = reads.get(path);
    if (seen) {
      return seen;
    }
    // the demand names the place in the row, as hoverDemands does: `series[j].capacityBinding`
    card.demands.push({
      cellId: patch.cellId,
      binding,
      role: 'hover',
      rowIndex: at.rowIndex,
      path: path.slice(rowPath.length + 1),
    });
    const model = readBinding(patch, binding, path, undefined, at.resolve, ctx, card.diagnostics);
    reads.set(path, model);
    return model;
  };
  const halves = halfContext(ctx);
  const mirrored = row.series.length === 2;
  const capacities: Array<number | undefined> = [];
  const directions = row.series.map((s, j): DirectionRowModel => {
    const model = models[j];
    // a direction without data has no unit: it takes the unit of the other direction
    const unitModel = model.state === 'ready' ? model : models.find((m) => m.state === 'ready');
    const field = unitModel?.state === 'ready' ? unitModel.field : undefined;
    const cap = resolveCapacity({
      own: s,
      ownPath: `${rowPath}.series[${j}]`,
      shared: row,
      sharedPath: rowPath,
      numberUnit: 'field',
      scope: patch.scope,
      field,
      read,
    });
    cap.diagnostics.forEach(report);
    capacities.push(cap.amount === undefined ? undefined : inFieldUnit(cap.amount, field));
    const base = {
      direction: s.direction,
      label: s.label ?? (s.direction === 'up' ? '↑' : '↓'),
      mirrored: mirrored && s.direction === 'down',
      history: model,
    };
    if (model.state !== 'ready' || model.latestValue === undefined) {
      return { ...base, text: stateText(model), color: noDataColor(ctx.theme) };
    }
    const half = halfState(model, s.binding, cap, halves);
    for (const note of new Set(half.notes)) {
      report({ code: 'unit-not-rate', path: `${rowPath}.series[${j}].binding`, message: note });
    }
    return { ...base, text: half.state.label, color: half.state.color };
  });
  const ready = models.filter((m): m is Extract<HistoryModel, { state: 'ready' }> => m.state === 'ready');
  // for max "capacity": the larger capacity of the two directions, in the unit of the values
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

/* ---------- v4 cards (spec 3.7) ---------- */

/** The most lines of one history chart; the other series give "+N more" (spec 3.7, D9). */
export const MAX_LINES = 8;
/** The value text of a row or a tooltip line with no data (spec 3.6). */
const NO_DATA_ROW = 'no data';

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

/** Line i takes colour i of the Grafana classic palette (spec 3.7). */
function lineColor(theme: GrafanaTheme2, i: number): string {
  const palette = theme.visualization.palette;
  return theme.visualization.getColorByName(palette[i % palette.length]);
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
  for (const u of patch.urls) {
    card.links.push({ title: u.title ?? defaultUrlTitle(u.url, title), href: u.url, target: '_blank', origin: patch });
  }
  const slots = patch.rowsV4 ?? [];
  const status = patch.statusView;
  // as in v3: a state that is not normal and its reason come first; a normal status shows only on a card with no rows
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
      // a drilldown is a footer link, as in v3
      const href = slot.url ?? '';
      if (href && !card.links.some((l) => l.href === href)) {
        card.links.push({ title: slot.label ?? defaultUrlTitle(href, title), href, target: '_blank', origin: patch });
      }
      return;
    }
    if (slot.kind === 'updown') {
      const a2b = dataOf(`${slot.path}.a2b`);
      const b2a = dataOf(`${slot.path}.b2a`);
      if (a2b && b2a) {
        card.rows.push(updownRow(key, [a2b, b2a], meta?.attrs.at, ctx, staleOf([a2b, b2a])));
      }
      return;
    }
    const d = dataOf(slot.path);
    if (!d) {
      return;
    }
    card.rows.push(
      slot.kind === 'history' ? historyRowV4(key, d, ctx, staleOf([d])) : valueRowV4(key, d, ctx, staleOf([d]))
    );
  });
  return card;
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
function formatOf(first: Series, row: RowFields, ctx: CardContext): (value: number) => string {
  const display = fieldDisplay(shownField(first.field, row), ctx.theme);
  return (value) => formattedValueToString(display(value));
}

/** The default title of a query row: the display name of its one series, else the display name of the refId. */
function rowTitle(d: UseData, row: RowFields): string {
  if (row.label !== undefined) {
    return row.label;
  }
  const first = d.series[0];
  if (d.series.length === 1) {
    return lineLabel(d, first);
  }
  return first?.field.config.displayName ?? d.use.refId;
}

/** The label of a line: the display name of the field (spec 3.7). */
function lineLabel(d: UseData, s: Series): string {
  const frames = d.snapshot.state === 'ready' ? d.snapshot.frames : [];
  return getFieldDisplayName(s.field, frames[s.frameIndex], frames);
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
  const format = formatOf(first, row, ctx);
  // one line: its last value, as a v3 history row; N lines: the tooltip gives the values
  const last = lines.length === 1 ? lastValue(lines[0].values) : undefined;
  return {
    ...base,
    text: lines.length === 1 ? (last === undefined ? NO_DATA_ROW : format(last)) : '',
    state: 'ready',
    lines,
    more: d.series.length - lines.length,
    domain,
    format,
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
  return { ...base, text: formatOf(first, row, ctx)(reduced.value), state: 'ready' };
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
    const binding: QueryBinding = { queryId: d.use.refId, match: {}, reducer: 'last' };
    const half = halfState(history, binding, { source: 'none' }, halves).state;
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

/** One row of the pinned tooltip of a history row: the line label and colour, and its value at the hovered time. */
export interface LineTooltipRow {
  label: string;
  color: string;
  value: string;
}

/**
 * The pinned tooltip of a history row (spec 3.7): all drawn lines at the sample time nearest to `time`, then
 * "+N more". A line with no finite value shows "no data"; a gap of a line shows "–", as the v3 tooltip.
 */
export function lineTooltipV4(
  row: Pick<HistoryRowV4, 'lines' | 'more' | 'format'>,
  time: number
): { time: number; list: LineTooltipRow[]; more: number } | undefined {
  const picked = alignedSamples(
    row.lines.map((l) => ({ timestamps: l.times, values: l.values })),
    time
  );
  if (!picked) {
    return undefined;
  }
  const format = row.format ?? String;
  return {
    time: picked.time,
    list: row.lines.map((l, i) => {
      const v = picked.values[i];
      return { label: l.label, color: l.color, value: l.noData ? NO_DATA_ROW : v === null ? '–' : format(v) };
    }),
    more: row.more,
  };
}

/**
 * The time after which a row of a card is stale, or undefined. A v4 row gives it (`staleAfter`); the shim of a v3 row
 * gives the sample time plus the stale delay of its freshness policy.
 */
export function staleDeadline(row: ConfiguredCardRow): number | undefined {
  if (row.staleAfter !== undefined) {
    return row.staleAfter;
  }
  return row.sampleAt !== undefined && row.freshness ? row.sampleAt + row.freshness.staleAfterMs : undefined;
}
