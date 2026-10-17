import { formattedValueToString, getValueFormat } from '@grafana/data';
import { endpointScope } from '../adapter/portograph';
import type {
  BindContext,
  BindResult,
  CapacitySource,
  CellMeta,
  CellPatch,
  HalfState,
  LinkRule,
  PatchMap,
  ReducerName,
  Rule,
  SeriesInfo,
  SeriesSelector,
  ShapeRule,
  ShapeState,
  ShapeTarget,
  TemplateScope,
} from '../types';
import { colorFor, noDataColor, widthFor } from './color';
import { reduceValues } from './reduce';
import { cellMatches, matcherError } from './select';
import { findSeries } from './series';
import { resolveTemplate } from './template';
import { toBitsPerSecond } from './units';
import { isAllowedUrl } from './url';

const UNBOUND = (ctx: BindContext): HalfState => ({
  status: 'unbound',
  color: noDataColor(ctx.theme),
  width: ctx.linkWidth.min,
  label: 'unbound',
  stepIndex: -1,
  capacitySource: 'none',
});

const STATUS_TEXT = { nodata: 'no data', unbound: 'unbound' } as const;

interface Effective {
  ruleNames: string[];
  link?: LinkRule;
  shape?: ShapeRule;
  reducer?: ReducerName;
  label?: string;
  url?: string;
  urlTitle?: string;
}

/** Later rules override earlier ones per property. */
function merge(rules: Rule[], cell: CellMeta): Effective | undefined {
  const eff: Effective = { ruleNames: [] };
  for (const r of rules) {
    if (!cellMatches(r.select, cell)) {
      continue;
    }
    eff.ruleNames.push(r.name);
    if (r.link) {
      eff.link = { ...eff.link, ...r.link };
    }
    if (r.shape) {
      eff.shape = { ...eff.shape, ...r.shape };
    }
    if (r.reducer) {
      eff.reducer = r.reducer;
    }
    if (r.label !== undefined) {
      eff.label = r.label;
    }
    // the title goes with the url of the same rule; a later rule can change only the title
    if (r.url !== undefined || r.urlTitle !== undefined) {
      eff.urlTitle = r.urlTitle;
    }
    if (r.url !== undefined) {
      eff.url = r.url;
    }
  }
  return eff.ruleNames.length ? eff : undefined;
}

export function scopeFor(cell: CellMeta): TemplateScope {
  return {
    cell: { ...cell.attrs, id: cell.id, key: cell.key, label: cell.labelText },
    from: endpointScope(cell.from),
    to: endpointScope(cell.to),
  };
}

interface Resolved {
  status: 'ok' | 'nodata' | 'unbound';
  series?: SeriesInfo;
  value?: number;
  unresolved: string[];
}

function resolveSeries(
  sel: SeriesSelector,
  series: SeriesInfo[],
  scope: TemplateScope,
  reducer: ReducerName
): Resolved {
  const f = findSeries(sel, series, scope);
  if (f.unresolved.length) {
    return { status: 'unbound', unresolved: f.unresolved };
  }
  if (!f.series) {
    return { status: 'nodata', unresolved: [] };
  }
  const value = reduceValues(f.series.values, reducer);
  return { status: value === undefined ? 'nodata' : 'ok', series: f.series, value, unresolved: [] };
}

const unitNote = (unit: string) => `unit "${unit}" is not a data rate, the raw value is used as bit/s`;

/** A value in the unit of its field, in bit/s. */
function bitsOf(value: number, s: SeriesInfo, notes: string[]): number {
  const rate = toBitsPerSecond(value, s.field.config?.unit);
  if (rate.unknownUnit) {
    notes.push(unitNote(rate.unknownUnit));
  }
  return rate.bits;
}

function half(
  sel: SeriesSelector,
  cap: LinkCapacity,
  eff: Effective,
  scope: TemplateScope,
  series: SeriesInfo[],
  ctx: BindContext
): { state: HalfState; unresolved: string[]; notes: string[] } {
  const r = resolveSeries(sel, series, scope, eff.reducer ?? 'last');
  if (r.status !== 'ok' || r.value === undefined || !r.series) {
    return {
      state: {
        status: r.status,
        color: noDataColor(ctx.theme),
        width: ctx.linkWidth.min,
        label: r.status === 'nodata' ? 'no data' : 'unbound',
        stepIndex: -1,
        capacity: cap.bits,
        capacitySource: cap.source,
      },
      unresolved: r.unresolved,
      notes: [],
    };
  }
  const notes: string[] = [];
  let { bits: capacity, source } = cap;
  // the last source: the Max of the field config (a standard option, also by override), in the field unit
  const max = r.series.field.config?.max;
  if (capacity === undefined && typeof max === 'number' && max > 0) {
    capacity = bitsOf(max, r.series, notes);
    source = 'fieldMax';
  }
  // the capacity is in bit/s; the field unit tells how to read the value
  const percent = capacity === undefined ? undefined : (bitsOf(r.value, r.series, notes) / capacity) * 100;
  const display = ctx.display(r.series, r.value);
  const { color, stepIndex } = colorFor(r.value, percent, r.series.field, display, ctx.fieldThresholds, ctx.theme);
  const value = formattedValueToString(display);
  const label =
    percent === undefined || capacity === undefined
      ? value
      : `${value} · ${Math.round(percent)}% of ${formattedValueToString(getValueFormat('bps')(capacity))}`;
  return {
    state: {
      status: 'ok',
      color,
      width: widthFor(percent, ctx.linkWidth),
      label,
      stepIndex,
      value: r.value,
      percent,
      capacity,
      capacitySource: capacity === undefined ? 'none' : source,
      display,
      series: r.series,
    },
    unresolved: [],
    notes,
  };
}

/** The capacity of the link from the rule, in bit/s. Without it, each half can use the Max of its field. */
interface LinkCapacity {
  bits?: number;
  source: CapacitySource;
  unresolved: string[];
  notes: string[];
}

function capacityOf(link: LinkRule, scope: TemplateScope, series: SeriesInfo[], reducer: ReducerName): LinkCapacity {
  const c = link.capacity;
  if (c === undefined) {
    return { source: 'none', unresolved: [], notes: [] };
  }
  if (typeof c === 'number') {
    return c > 0
      ? { bits: c, source: 'number', unresolved: [], notes: [] }
      : { source: 'none', unresolved: [], notes: [`capacity ${c} is not a positive number`] };
  }
  if (typeof c === 'object') {
    const r = resolveSeries(c, series, scope, c.reducer ?? reducer);
    if (r.unresolved.length) {
      return { source: 'none', unresolved: r.unresolved, notes: [] };
    }
    if (r.value === undefined || !r.series) {
      return {
        source: 'none',
        unresolved: [],
        notes: ['capacity series not found, the field Max applies if it is set'],
      };
    }
    const notes: string[] = [];
    const bits = bitsOf(r.value, r.series, notes);
    return bits > 0
      ? { bits, source: 'series', unresolved: [], notes }
      : { source: 'none', unresolved: [], notes: [...notes, `capacity series value ${r.value} is not positive`] };
  }
  const r = resolveTemplate(c, scope);
  if (r.unresolved.length) {
    return { source: 'none', unresolved: r.unresolved, notes: [] };
  }
  const n = Number(r.text);
  return Number.isFinite(n) && n > 0
    ? { bits: n, source: c.includes('${') ? 'attr' : 'number', unresolved: [], notes: [] }
    : { source: 'none', unresolved: [`capacity "${r.text}" is not a number`], notes: [] };
}

/** The explicit target wins. Without it, the old fill and stroke flags decide; a text-only rule colours nothing. */
export function targetOf(sh: ShapeRule): ShapeTarget | 'none' {
  if (sh.target) {
    return sh.target;
  }
  if (sh.fill) {
    return 'shape';
  }
  if (sh.stroke) {
    return 'stroke';
  }
  return sh.text || sh.fill === false ? 'none' : 'icon';
}

function shape(
  sh: ShapeRule,
  eff: Effective,
  scope: TemplateScope,
  series: SeriesInfo[],
  ctx: BindContext
): { state?: ShapeState; unresolved: string[] } {
  const unresolved: string[] = [];
  if (!sh.series) {
    return { unresolved };
  }
  const target = targetOf(sh);
  const r = resolveSeries(sh.series, series, scope, eff.reducer ?? 'last');
  unresolved.push(...r.unresolved);
  if (r.status !== 'ok' || r.value === undefined || !r.series) {
    const status = r.status === 'ok' ? 'nodata' : r.status;
    const state: ShapeState = {
      status,
      color: noDataColor(ctx.theme),
      target,
      stepIndex: -1,
      // a text-only binding has no colour to show the state, so the text says it
      text: sh.text ? STATUS_TEXT[status] : undefined,
    };
    return { state, unresolved };
  }
  const display = ctx.display(r.series, r.value);
  const { color, stepIndex } = colorFor(r.value, undefined, r.series.field, display, ctx.fieldThresholds, ctx.theme);
  let text: string | undefined;
  if (sh.text) {
    const t = resolveTemplate(eff.label ?? '${value}', {
      ...scope,
      labels: r.series.labels,
      value: formattedValueToString(display),
    });
    unresolved.push(...t.unresolved);
    if (t.unresolved.length) {
      const state: ShapeState = {
        status: 'unbound',
        color: noDataColor(ctx.theme),
        target,
        stepIndex: -1,
        text: STATUS_TEXT.unbound,
        series: r.series,
      };
      return { state, unresolved };
    }
    text = t.text;
  }
  return {
    state: { status: 'ok', color, target, stepIndex, text, value: r.value, display, series: r.series },
    unresolved,
  };
}

function ruleMatchers(r: Rule): string[] {
  const out: string[] = [...Object.values(r.select.attrs ?? {})];
  if (r.select.label) {
    out.push(r.select.label);
  }
  const capacity = typeof r.link?.capacity === 'object' ? r.link.capacity : undefined;
  for (const sel of [r.link?.a2b, r.link?.b2a, capacity, r.shape?.series, ...(r.shape?.card ?? [])]) {
    if (sel?.name) {
      out.push(sel.name);
    }
    out.push(...Object.values(sel?.match ?? {}));
  }
  return out;
}

export function bind(rules: Rule[], cells: CellMeta[], series: SeriesInfo[], ctx: BindContext): BindResult {
  const patches: PatchMap = new Map();
  const warnings: string[] = [];
  for (const r of rules) {
    for (const m of new Set(ruleMatchers(r))) {
      const err = matcherError(m);
      if (err) {
        warnings.push(`${r.name}: ${err}`);
      }
    }
    if (r.thresholds !== undefined) {
      warnings.push(
        `${r.name}: thresholds is removed and ignored. Set Thresholds and Color scheme in the field config of the panel`
      );
    }
    if (r.shape?.sparkline) {
      warnings.push(`${r.name}: shape.sparkline is removed, use shape.card`);
    }
    if (r.link && r.label !== undefined && !r.shape?.text) {
      warnings.push(`${r.name}: label is ignored for links, the hover card shows the values`);
    }
  }
  for (const cell of cells) {
    const eff = merge(rules, cell);
    if (!eff) {
      continue;
    }
    const scope = scopeFor(cell);
    const patch: CellPatch = { cellId: cell.id, ruleNames: eff.ruleNames, scope, urls: [], warnings: [] };
    const unresolved: string[] = [];
    const notes: string[] = [];
    let primary: SeriesInfo | undefined;

    if (eff.link && (cell.isEdge || cell.kind === 'link')) {
      const cap = capacityOf(eff.link, scope, series, eff.reducer ?? 'last');
      unresolved.push(...cap.unresolved);
      notes.push(...cap.notes);
      patch.link = {};
      if (cap.unresolved.length) {
        // spec: a template that does not resolve makes the binding unbound (grey, warning in edit mode)
        if (eff.link.a2b) {
          patch.link.a2b = UNBOUND(ctx);
        }
        if (eff.link.b2a) {
          patch.link.b2a = UNBOUND(ctx);
        }
      } else if (eff.link.a2b) {
        const h = half(eff.link.a2b, cap, eff, scope, series, ctx);
        patch.link.a2b = h.state;
        unresolved.push(...h.unresolved);
        notes.push(...h.notes);
        primary = primary ?? h.state.series;
      }
      if (!cap.unresolved.length && eff.link.b2a) {
        const h = half(eff.link.b2a, cap, eff, scope, series, ctx);
        patch.link.b2a = h.state;
        unresolved.push(...h.unresolved);
        notes.push(...h.notes);
        primary = primary ?? h.state.series;
      }
    }
    if (eff.shape && !cell.isEdge) {
      const s = shape(eff.shape, eff, scope, series, ctx);
      patch.shape = s.state;
      unresolved.push(...s.unresolved);
      primary = primary ?? s.state?.series;
    }
    // The card resolves its rows only when it opens; here it keeps the configuration.
    if (patch.link) {
      patch.card = { reducer: eff.reducer ?? 'last', ...eff.link?.card };
    } else if (eff.shape && !cell.isEdge && (patch.shape || eff.shape.card)) {
      patch.card = { reducer: eff.reducer ?? 'last', ...(eff.shape.card ? { rows: eff.shape.card } : {}) };
    }
    if (eff.url) {
      const urlScope = { ...scope, labels: primary?.labels ?? {} };
      const u = resolveTemplate(eff.url, urlScope, encodeURIComponent);
      unresolved.push(...u.unresolved);
      if (!u.unresolved.length && isAllowedUrl(u.text)) {
        const t = eff.urlTitle === undefined ? undefined : resolveTemplate(eff.urlTitle, urlScope);
        // a title that does not resolve gets the default title, not a warning
        patch.urls.push(t && !t.unresolved.length ? { title: t.text, url: u.text } : { url: u.text });
      } else if (!u.unresolved.length) {
        notes.push('url scheme is not http, https or relative, the url is dropped');
      }
    }
    const prefix = `${eff.ruleNames.join('+')} / ${cell.id}`;
    const msgs = [...new Set(notes)].map((n) => `${prefix}: ${n}`);
    if (unresolved.length) {
      msgs.unshift(`${prefix}: unresolved ${[...new Set(unresolved)].join(', ')}`);
    }
    patch.warnings.push(...msgs);
    warnings.push(...msgs);
    if (patch.link || patch.shape || patch.card || patch.urls.length) {
      patches.set(cell.id, patch);
    }
  }
  return { patches, warnings };
}
