import {
  type Field,
  FieldColorModeId,
  formattedValueToString,
  getFieldColorModeForField,
  getValueFormat,
  type GrafanaTheme2,
  MappingType,
  type Threshold,
  type ThresholdsConfig,
  ThresholdsMode,
  type ValueMapping,
} from '@grafana/data';
import type { PlanCellPatch } from '../binding/engine';
import type { StatusView } from '../binding/status';
import { noDataColor } from '../binding/color';
import { statusColor } from '../render/overlay';
import type { HalfState, SeriesInfo, ShapeState } from '../types';

/** One colour of a scale: a swatch and its threshold or mapping text. */
export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  /** the cells that show this colour now */
  cellIds: string[];
}

/** A continuous colour scheme: the colours from low to high and the texts at the two ends. */
export interface LegendGradient {
  colors: string[];
  min: string;
  max: string;
}

/** One colour scale of the bound cells. */
export interface LegendBlock {
  key: string;
  /** the unit or the kind of the scale; the no data block has no title */
  title?: string;
  entries: LegendEntry[];
  gradient?: LegendGradient;
  /** all cells that use this scale */
  cellIds: string[];
}

export interface LegendContext {
  theme: GrafanaTheme2;
  /** The panel default thresholds. They apply when a field has none (as in colorFor). */
  fieldThresholds?: ThresholdsConfig;
  /** The name of a query from its id (the refId of a series). */
  queryName?: (refId: string) => string | undefined;
}

interface Item {
  cellId: string;
  kind: 'link' | 'node';
  series: SeriesInfo;
  color: string;
  stepIndex: number;
  percent?: number;
  value?: number;
  /** the display text: the text of a value mapping when one matched */
  text?: string;
}

interface Draft extends LegendBlock {
  titles: string[];
  sources: string[];
  /** a continuous scheme without Min and Max: the range of the field values of all cells of the block */
  auto?: { min: number; max: number; format: (v: number) => string };
}

const GRADIENT_STOPS = 5;

const push = (list: string[], id: string) => {
  if (!list.includes(id)) {
    list.push(id);
  }
};

function mappingEntries(mappings: ValueMapping[] | undefined, theme: GrafanaTheme2): LegendEntry[] {
  const out: LegendEntry[] = [];
  const add = (label: string, color: string | undefined) => {
    if (color) {
      out.push({ key: `map-${out.length}`, label, color: theme.visualization.getColorByName(color), cellIds: [] });
    }
  };
  for (const m of mappings ?? []) {
    if (m.type === MappingType.ValueToText) {
      for (const [value, result] of Object.entries(m.options)) {
        add(result.text ?? value, result.color);
      }
    } else if (m.type === MappingType.RangeToText) {
      const { from, to, result } = m.options;
      add(result.text ?? `${from ?? '-∞'}–${to ?? '∞'}`, result.color);
    } else if (m.type === MappingType.RegexToText) {
      add(m.options.result.text ?? `/${m.options.pattern}/`, m.options.result.color);
    } else if (m.type === MappingType.SpecialValue) {
      add(m.options.result.text ?? m.options.match, m.options.result.color);
    }
  }
  return out;
}

function thresholdEntries(steps: Threshold[], text: (v: number) => string, theme: GrafanaTheme2): LegendEntry[] {
  // Grafana saves the base step as null, the loaded config has -Infinity
  const isBase = (s: Threshold, i: number) => i === 0 || s.value === null || s.value === -Infinity;
  return steps.map((s, i) => ({
    key: `step-${i}`,
    label: isBase(s, i) ? (steps.length > 1 ? `< ${text(steps[1].value)}` : 'All values') : `≥ ${text(s.value)}`,
    color: theme.visualization.getColorByName(s.color),
    cellIds: [],
  }));
}

/** The symbol of a Grafana unit, for example "W" for watt or "%" for percent. */
function unitSymbol(unit: string | undefined): string {
  if (!unit || unit === 'none') {
    return '';
  }
  const v = getValueFormat(unit)(1);
  return (v.suffix ?? '').trim() || (v.prefix ?? '').trim();
}

/** The scale of one coloured value, without its cells. Undefined: the colour does not depend on the value. */
function scaleOf(item: Item, ctx: LegendContext): Draft | undefined {
  const { theme } = ctx;
  const field = item.series.field;
  const config = field.config ?? {};
  const thresholds = config.thresholds ?? ctx.fieldThresholds;
  const steps = thresholds?.steps ?? [];
  const capacity = item.percent !== undefined;
  const effective = { ...field, config: { ...config, thresholds } } as Field;
  const mode = getFieldColorModeForField(effective);
  const format = (v: number) => formattedValueToString(getValueFormat(config.unit ?? 'none')(v, config.decimals));
  // With a capacity the colour comes from the percent (colorFor), so the value mappings do not apply.
  const entries = capacity ? [] : mappingEntries(config.mappings, theme);
  let gradient: LegendGradient | undefined;
  let auto: Draft['auto'];
  if (mode.id === FieldColorModeId.Thresholds) {
    const percent = capacity || thresholds?.mode === ThresholdsMode.Percentage;
    entries.push(...thresholdEntries(steps, percent ? (v) => `${v}%` : format, theme));
  } else if (mode.isContinuous) {
    const calc = mode.getCalculator(effective, theme);
    const colors = Array.from({ length: GRADIENT_STOPS }, (_, i) => calc(0, i / (GRADIENT_STOPS - 1)));
    if (capacity) {
      gradient = { colors, min: '0%', max: '100%' };
    } else {
      const min = config.min ?? field.state?.range?.min ?? undefined;
      const max = config.max ?? field.state?.range?.max ?? undefined;
      if (min !== undefined && max !== undefined) {
        gradient = { colors, min: format(min), max: format(max) };
      } else {
        // as Grafana: without Min and Max, the range of the field values
        const values = [...(field.values ?? []), item.value].filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v)
        );
        auto = {
          min: min ?? (values.length ? Math.min(...values) : 0),
          max: max ?? (values.length ? Math.max(...values) : 0),
          format,
        };
        gradient = { colors, min: '', max: '' };
      }
    }
  } else if (mode.id === FieldColorModeId.Fixed) {
    entries.push({
      key: 'fixed',
      label: 'All values',
      color: theme.visualization.getColorByName(config.color?.fixedColor ?? 'gray'),
      cellIds: [],
    });
  } else if (!entries.length) {
    // one colour per series (classic palette): no value scale
    return undefined;
  }
  const name = ctx.queryName?.(item.series.refId ?? '') ?? (item.kind === 'link' ? 'Link' : 'Node');
  const symbol = unitSymbol(config.unit);
  const title = capacity ? 'Link load %' : (config.displayName ?? (symbol ? `${name} ${symbol}` : name));
  const key = JSON.stringify([entries.map((e) => [e.label, e.color]), gradient]);
  const source = ctx.queryName?.(item.series.refId ?? '') ?? item.series.refId ?? '';
  return { key, title, titles: [title], sources: source ? [source] : [], entries, gradient, auto, cellIds: [] };
}

/** The entry of a cell: the threshold step of its colour, else the first entry with its colour. */
function entryOf(block: LegendBlock, item: Item): LegendEntry | undefined {
  // a matched value mapping gives the display its text and colour
  const mapping = block.entries.find(
    (e) => e.key.startsWith('map-') && e.color === item.color && e.label === item.text
  );
  if (mapping) {
    return mapping;
  }
  const step = block.entries.find((e) => e.key === `step-${item.stepIndex}`);
  return step?.color === item.color ? step : block.entries.find((e) => e.color === item.color);
}

const STATUS_ENTRIES: Array<{ key: string; label: string; states: Array<StatusView['state']> }> = [
  { key: 'critical', label: 'Down, critical', states: ['down', 'critical'] },
  { key: 'warning', label: 'Warning, stale', states: ['warning', 'stale'] },
  { key: 'missing', label: 'Missing', states: ['missing'] },
];

/**
 * The colour legend of the bound cells: one block for each distinct colour scale (the field Color scheme,
 * Thresholds and Value mappings, incl. overrides), then the status markers, then the no data colour.
 * Identical scales merge into one block.
 */
export function buildLegend(patches: Map<string, PlanCellPatch>, ctx: LegendContext): LegendBlock[] {
  const items: Item[] = [];
  const nodata: string[] = [];
  const statuses: Array<{ cellId: string; state: StatusView['state'] }> = [];
  const add = (cellId: string, kind: Item['kind'], state: HalfState | ShapeState | undefined) => {
    if (!state || ('target' in state && state.target === 'none')) {
      return;
    }
    if (state.status !== 'ok' || !state.series) {
      push(nodata, cellId);
      return;
    }
    const percent = 'percent' in state ? state.percent : undefined;
    items.push({
      cellId,
      kind,
      series: state.series,
      color: state.color,
      stepIndex: state.stepIndex,
      percent,
      value: state.value,
      text: state.display?.text,
    });
  };
  for (const patch of patches.values()) {
    add(patch.cellId, 'link', patch.link?.a2b);
    add(patch.cellId, 'link', patch.link?.b2a);
    add(patch.cellId, 'node', patch.shape);
    if (patch.statusView) {
      statuses.push({ cellId: patch.cellId, state: patch.statusView.state });
    }
  }
  const blocks = new Map<string, Draft>();
  for (const item of items) {
    const scale = scaleOf(item, ctx);
    if (!scale) {
      continue;
    }
    const block = blocks.get(scale.key) ?? scale;
    blocks.set(scale.key, block);
    if (block.auto && scale.auto && block !== scale) {
      block.auto.min = Math.min(block.auto.min, scale.auto.min);
      block.auto.max = Math.max(block.auto.max, scale.auto.max);
    }
    scale.titles.forEach((t) => push(block.titles, t));
    scale.sources.forEach((s) => push(block.sources, s));
    push(block.cellIds, item.cellId);
    const entry = entryOf(block, item);
    if (entry) {
      push(entry.cellIds, item.cellId);
    }
  }
  const drafts = [...blocks.values()];
  for (const d of drafts) {
    d.title = d.titles.join(' · ');
    if (d.auto && d.gradient) {
      d.gradient = { ...d.gradient, min: d.auto.format(d.auto.min), max: d.auto.format(d.auto.max) };
    }
  }
  // Different scales with the same title: the sources tell them apart.
  const shared = drafts.filter((d) => d.sources.length && drafts.some((o) => o !== d && o.title === d.title));
  for (const d of shared) {
    d.title = `${d.title} (${d.sources.join(', ')})`;
  }
  const out: LegendBlock[] = drafts.map(({ key, title, entries, gradient, cellIds }) => ({
    key,
    title,
    entries,
    ...(gradient ? { gradient } : {}),
    cellIds,
  }));
  if (statuses.length) {
    const cellIds: string[] = [];
    statuses.forEach((s) => push(cellIds, s.cellId));
    out.push({
      key: 'status',
      title: 'Status',
      entries: STATUS_ENTRIES.map(({ key, label, states }) => ({
        key,
        label,
        color: statusColor({ state: states[0] } as StatusView, ctx.theme),
        cellIds: statuses.filter((s) => states.includes(s.state)).map((s) => s.cellId),
      })),
      cellIds,
    });
  }
  if (nodata.length) {
    out.push({
      key: 'nodata',
      entries: [{ key: 'nodata', label: 'No data', color: noDataColor(ctx.theme), cellIds: nodata }],
      cellIds: nodata,
    });
  }
  return out;
}

/** The swatch of the collapsed legend chip: the colours of the first scale, low to high. */
export function chipSwatch(blocks: LegendBlock[]): string {
  const first = blocks[0];
  const colors = first?.gradient?.colors ?? first?.entries.map((e) => e.color) ?? [];
  if (colors.length === 0) {
    return 'transparent';
  }
  if (colors.length === 1) {
    return colors[0];
  }
  return `linear-gradient(to right, ${colors.join(', ')})`;
}
