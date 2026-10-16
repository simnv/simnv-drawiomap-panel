import { formattedValueToString } from '@grafana/data';
import { endpointScope } from '../adapter/portograph';
import type {
  BindContext,
  BindResult,
  CellMeta,
  CellPatch,
  HalfState,
  LinkRule,
  PatchMap,
  ReducerName,
  Rule,
  RuleThresholds,
  SeriesInfo,
  SeriesSelector,
  ShapeRule,
  ShapeState,
  SparklineState,
  TemplateScope,
} from '../types';
import { colorFor, noDataColor, widthFor } from './color';
import { reduceValues } from './reduce';
import { cellMatches } from './select';
import { findSeries } from './series';
import { resolveTemplate } from './template';

interface Effective {
  ruleNames: string[];
  link?: LinkRule;
  shape?: ShapeRule;
  reducer?: ReducerName;
  label?: string;
  thresholds?: RuleThresholds;
  url?: string;
  urlRule?: string;
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
    if (r.thresholds) {
      eff.thresholds = r.thresholds;
    }
    if (r.url !== undefined) {
      eff.url = r.url;
      eff.urlRule = r.name;
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

function half(
  sel: SeriesSelector,
  capacity: number | undefined,
  eff: Effective,
  scope: TemplateScope,
  series: SeriesInfo[],
  ctx: BindContext
): { state: HalfState; unresolved: string[] } {
  const r = resolveSeries(sel, series, scope, eff.reducer ?? 'last');
  if (r.status !== 'ok' || r.value === undefined || !r.series) {
    return {
      state: {
        status: r.status,
        color: noDataColor(ctx.theme),
        width: ctx.linkWidth.min,
        label: r.status === 'nodata' ? 'no data' : 'unbound',
        stepIndex: -1,
      },
      unresolved: r.unresolved,
    };
  }
  const percent = capacity ? (r.value / capacity) * 100 : undefined;
  const display = ctx.display(r.series, r.value);
  const { color, stepIndex } = colorFor(
    r.value,
    percent,
    eff.thresholds,
    display,
    r.series.field.config?.thresholds ?? ctx.fieldThresholds,
    ctx.theme
  );
  const tpl = eff.label ?? (percent === undefined ? '${value}' : '${value} · ${percent}');
  const labelScope: TemplateScope = {
    ...scope,
    labels: r.series.labels,
    value: formattedValueToString(display),
    percent: percent === undefined ? undefined : `${Math.round(percent)}%`,
  };
  const label = resolveTemplate(tpl, labelScope);
  return {
    state: {
      status: 'ok',
      color,
      width: widthFor(percent, ctx.linkWidth),
      label: label.text,
      stepIndex,
      value: r.value,
      percent,
      display,
      series: r.series,
    },
    unresolved: label.unresolved,
  };
}

const UNBOUND = (ctx: BindContext): HalfState => ({
  status: 'unbound',
  color: noDataColor(ctx.theme),
  width: ctx.linkWidth.min,
  label: 'unbound',
  stepIndex: -1,
});

function capacityOf(link: LinkRule, scope: TemplateScope): { capacity?: number; unresolved: string[] } {
  if (link.capacity === undefined) {
    return { unresolved: [] };
  }
  if (typeof link.capacity === 'number') {
    return { capacity: link.capacity, unresolved: [] };
  }
  const r = resolveTemplate(link.capacity, scope);
  if (r.unresolved.length) {
    return { unresolved: r.unresolved };
  }
  const n = Number(r.text);
  return Number.isFinite(n) && n > 0
    ? { capacity: n, unresolved: [] }
    : { unresolved: [`capacity "${r.text}" is not a number`] };
}

function shape(
  sh: ShapeRule,
  eff: Effective,
  scope: TemplateScope,
  series: SeriesInfo[],
  ctx: BindContext
): { state?: ShapeState; spark?: SparklineState; unresolved: string[] } {
  const unresolved: string[] = [];
  let state: ShapeState | undefined;
  const wantFill = sh.fill ?? (!sh.stroke && !sh.text);
  if (sh.series) {
    const r = resolveSeries(sh.series, series, scope, eff.reducer ?? 'last');
    unresolved.push(...r.unresolved);
    if (r.status === 'ok' && r.value !== undefined && r.series) {
      const display = ctx.display(r.series, r.value);
      const { color, stepIndex } = colorFor(
        r.value,
        undefined,
        eff.thresholds,
        display,
        r.series.field.config?.thresholds ?? ctx.fieldThresholds,
        ctx.theme
      );
      let text: string | undefined;
      if (sh.text) {
        const t = resolveTemplate(eff.label ?? '${value}', {
          ...scope,
          labels: r.series.labels,
          value: formattedValueToString(display),
        });
        unresolved.push(...t.unresolved);
        text = t.text;
      }
      state = {
        status: 'ok',
        color,
        fill: wantFill,
        stroke: !!sh.stroke,
        stepIndex,
        text,
        value: r.value,
        display,
        series: r.series,
      };
    } else {
      state = { status: r.status, color: noDataColor(ctx.theme), fill: wantFill, stroke: !!sh.stroke, stepIndex: -1 };
    }
  }
  let spark: SparklineState | undefined;
  if (sh.sparkline) {
    const { position, ...sel } = sh.sparkline;
    const f = findSeries(sel, series, scope);
    unresolved.push(...f.unresolved);
    if (f.series && f.series.values.length) {
      spark = {
        values: f.series.values,
        color: state?.status === 'ok' ? state.color : ctx.theme.colors.text.secondary,
        position: position ?? 'bottom',
        series: f.series,
      };
    }
  }
  return { state, spark, unresolved };
}

export function bind(rules: Rule[], cells: CellMeta[], series: SeriesInfo[], ctx: BindContext): BindResult {
  const patches: PatchMap = new Map();
  const warnings: string[] = [];
  for (const cell of cells) {
    const eff = merge(rules, cell);
    if (!eff) {
      continue;
    }
    const scope = scopeFor(cell);
    const patch: CellPatch = { cellId: cell.id, ruleNames: eff.ruleNames, scope, urls: [], warnings: [] };
    const unresolved: string[] = [];
    let primary: SeriesInfo | undefined;

    if (eff.link && (cell.isEdge || cell.kind === 'link')) {
      const cap = capacityOf(eff.link, scope);
      unresolved.push(...cap.unresolved);
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
        const h = half(eff.link.a2b, cap.capacity, eff, scope, series, ctx);
        patch.link.a2b = h.state;
        unresolved.push(...h.unresolved);
        primary = primary ?? h.state.series;
      }
      if (!cap.unresolved.length && eff.link.b2a) {
        const h = half(eff.link.b2a, cap.capacity, eff, scope, series, ctx);
        patch.link.b2a = h.state;
        unresolved.push(...h.unresolved);
        primary = primary ?? h.state.series;
      }
    }
    if (eff.shape && !cell.isEdge) {
      const s = shape(eff.shape, eff, scope, series, ctx);
      patch.shape = s.state;
      patch.sparkline = s.spark;
      unresolved.push(...s.unresolved);
      primary = primary ?? s.state?.series;
    }
    if (eff.url) {
      const u = resolveTemplate(eff.url, { ...scope, labels: primary?.labels ?? {} });
      unresolved.push(...u.unresolved);
      if (!u.unresolved.length) {
        patch.urls.push({ title: eff.urlRule ?? eff.ruleNames[eff.ruleNames.length - 1], url: u.text });
      }
    }
    if (unresolved.length) {
      const msg = `${eff.ruleNames.join('+')} / ${cell.id}: unresolved ${[...new Set(unresolved)].join(', ')}`;
      patch.warnings.push(msg);
      warnings.push(msg);
    }
    if (patch.link || patch.shape || patch.sparkline) {
      patches.set(cell.id, patch);
    }
  }
  return { patches, warnings };
}
