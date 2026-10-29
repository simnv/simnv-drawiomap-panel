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
import { linkStatusPaint, statusColor } from '../binding/color';
import type { HalfState, PatchMap, ShapeState } from '../types';

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

/** One segment of a bar: the place on the bar (0 to 1), the text of the step value at `from`, and the range text. */
export interface LegendBarSegment {
  from: number;
  to: number;
  /** the first segment is the base step: it has no value and no tick */
  tick?: string;
  range: string;
}

/**
 * The threshold steps of a link load scale as one bar: one segment of the same width for each step, with hard colour
 * stops between them. The bar is ordinal, not an axis: the step values of a scale are often near-logarithmic (0.1%,
 * 0.5%, 2%, 10%), and at linear places most colours would take a thin part of the bar. Segment n is the place of
 * entry n.
 */
export interface LegendBar {
  segments: LegendBarSegment[];
}

/** The number of cells of an entry, for its accessible name. */
export const plural = (n: number) => `${n} element${n === 1 ? '' : 's'}`;

/** A place or a length on a bar (0 to 1) as a CSS percent, to 0.1 %. */
export const barPercent = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** One colour scale of the bound cells. */
export interface LegendBlock {
  key: string;
  /** the unit or the kind of the scale; the no data block has no title */
  title?: string;
  entries: LegendEntry[];
  gradient?: LegendGradient;
  bar?: LegendBar;
  /** all cells that use this scale */
  cellIds: string[];
}

export interface LegendContext {
  theme: GrafanaTheme2;
  /** The panel default thresholds. They apply when a field has none (as in colorFor). */
  fieldThresholds?: ThresholdsConfig;
}

interface Item {
  cellId: string;
  kind: 'link' | 'node';
  field: Field;
  refId?: string;
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

/** One result of the value mappings of a field, in the order of Grafana, with the test of a finite value. */
interface MappingResult {
  label: string;
  color?: string;
  matches: (value: number) => boolean;
}

/**
 * The results of the value mappings, in the order that Grafana tests them (`getValueMappingResult`). A regex and a
 * special value never match a finite number, which is the only value of a status.
 */
function mappingResults(mappings: ValueMapping[] | undefined): MappingResult[] {
  const out: MappingResult[] = [];
  for (const m of mappings ?? []) {
    if (m.type === MappingType.ValueToText) {
      for (const [value, result] of Object.entries(m.options)) {
        out.push({ label: result.text ?? value, color: result.color, matches: (v) => String(v) === value });
      }
    } else if (m.type === MappingType.RangeToText) {
      const { from, to, result } = m.options;
      out.push({
        label: result.text ?? `${from ?? '-∞'}–${to ?? '∞'}`,
        color: result.color,
        matches: (v) => v >= (from ?? -Infinity) && v <= (to ?? Infinity),
      });
    } else if (m.type === MappingType.RegexToText) {
      out.push({
        label: m.options.result.text ?? `/${m.options.pattern}/`,
        color: m.options.result.color,
        matches: () => false,
      });
    } else if (m.type === MappingType.SpecialValue) {
      out.push({
        label: m.options.result.text ?? m.options.match,
        color: m.options.result.color,
        matches: () => false,
      });
    }
  }
  return out;
}

/** The mapping entries: one for each mapping result with a colour, with the key `map-<n>`. */
function mappingEntries(mappings: ValueMapping[] | undefined, theme: GrafanaTheme2): LegendEntry[] {
  return mappingResults(mappings)
    .filter((r) => r.color)
    .map((r, i) => ({
      key: `map-${i}`,
      label: r.label,
      color: theme.visualization.getColorByName(r.color!),
      cellIds: [],
    }));
}

/**
 * The key of the mapping entry that a value shows: `map-<n>` for the first mapping result that matches it, when that
 * result has a colour. Undefined when no result matches or the result has no colour: then a threshold step gives
 * the colour.
 */
function mappingKeyOf(mappings: ValueMapping[] | undefined, value: number): string | undefined {
  const results = mappingResults(mappings);
  const index = results.findIndex((r) => r.matches(value));
  if (index < 0 || !results[index].color) {
    return undefined;
  }
  return `map-${results.slice(0, index).filter((r) => r.color).length}`;
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

/** The text of a percent: a capacity, a step of a link load scale or a step in the percentage mode. */
const percentText = (v: number) => `${v}%`;

/**
 * The bar of the threshold steps of a link load scale. `entries` are the entries of the steps. Undefined when there is
 * no step, or when a step above the base step is not above the step before it: then two ticks have the same value,
 * and the entries show.
 */
function loadBar(steps: Threshold[], entries: LegendEntry[]): LegendBar | undefined {
  const values = steps.slice(1).map((s) => s.value);
  const rising = values.every((v, i) => Number.isFinite(v) && (i === 0 || v > values[i - 1]));
  if (!entries.length || !rising) {
    return undefined;
  }
  const n = entries.length;
  const segments = entries.map((e, i) => {
    const middle = i > 0 && i < n - 1;
    const range = middle ? `${percentText(values[i - 1])} to ${percentText(values[i])}` : e.label;
    return { from: i / n, to: (i + 1) / n, ...(i ? { tick: percentText(values[i - 1]) } : {}), range };
  });
  return { segments };
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
  const field = item.field;
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
  let bar: LegendBar | undefined;
  let auto: Draft['auto'];
  if (mode.id === FieldColorModeId.Thresholds) {
    const percent = capacity || thresholds?.mode === ThresholdsMode.Percentage;
    entries.push(...thresholdEntries(steps, percent ? percentText : format, theme));
    bar = capacity ? loadBar(steps, entries) : undefined;
  } else if (mode.isContinuous) {
    const calc = mode.getCalculator(effective, theme);
    const colors = Array.from({ length: GRADIENT_STOPS }, (_, i) => calc(0, i / (GRADIENT_STOPS - 1)));
    if (capacity) {
      gradient = { colors, min: percentText(0), max: percentText(100) };
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
  const name = item.kind === 'link' ? 'Link' : 'Node';
  const symbol = unitSymbol(config.unit);
  const title = capacity ? 'Link load %' : (config.displayName ?? (symbol ? `${name} ${symbol}` : name));
  const key = JSON.stringify([entries.map((e) => [e.label, e.color]), gradient, bar]);
  const source = item.refId ?? '';
  return { key, title, titles: [title], sources: source ? [source] : [], entries, gradient, bar, auto, cellIds: [] };
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

/**
 * The entry of a v4 status cell. With the value of the status: the mapping entry of the value (`mappingKeyOf`), else
 * the first threshold step with its colour, so that a colour-only mapping and a step of the same colour each keep
 * their cells. With no value: the mapping with its text and colour, else the first threshold step with its colour.
 * Then, in both cases, the first entry with its colour.
 */
function entryOfV4(block: LegendBlock, item: Item): LegendEntry | undefined {
  const isMapping = (e: LegendEntry) => e.key.startsWith('map-');
  const byColor = (e: LegendEntry) => e.color === item.color;
  let mapping: LegendEntry | undefined;
  if (item.value !== undefined) {
    const key = mappingKeyOf(item.field.config.mappings, item.value);
    mapping = key === undefined ? undefined : block.entries.find((e) => e.key === key && byColor(e));
  } else {
    mapping = block.entries.find((e) => isMapping(e) && byColor(e) && e.label === item.text);
  }
  return mapping ?? block.entries.find((e) => !isMapping(e) && byColor(e)) ?? block.entries.find(byColor);
}

/**
 * Adds the coloured value of a link half or a shape to `items`. A state with no data adds its cell to `nodata`. A
 * shape that colours nothing adds nothing.
 */
function addItem(
  items: Item[],
  nodata: string[],
  cellId: string,
  kind: Item['kind'],
  state: HalfState | ShapeState | undefined
) {
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
    field: state.series.field,
    refId: state.series.refId,
    color: state.color,
    stepIndex: state.stepIndex,
    percent,
    value: state.value,
    text: state.display?.text,
  });
}

/** One block for each distinct colour scale of the items. Identical scales merge into one block. */
function scaleBlocks(items: Item[], ctx: LegendContext): LegendBlock[] {
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
  return drafts.map(({ key, title, entries, gradient, bar, cellIds }) => ({
    key,
    title,
    entries,
    ...(gradient ? { gradient } : {}),
    ...(bar ? { bar } : {}),
    cellIds,
  }));
}

/** The state entries of the v4 legend, in this order. They have the theme colours of the painter. */
const STATE_ENTRIES_V4: Array<{ key: 'down' | 'stale' | 'missing'; label: string }> = [
  { key: 'down', label: 'Down, no data' },
  { key: 'stale', label: 'Stale' },
  { key: 'missing', label: 'No data' },
];

/**
 * The v4 legend (spec 3.4). First one block for each status refId in use, in the order of first use. The title is
 * the `displayName` of the field config of the refId, else the refId. `displayNameFromDS` and a name from the series
 * labels name one series, not the query, so the title never uses them. The entries are its value mappings and then
 * its threshold steps, each with its exact colour and text and the cells that show it. `fields` gives the field of
 * each status refId; a refId with no field has no block. Then one `State` block with a `down`, a `stale` and a
 * `missing` entry, each only when cells have that state: `down` is a down status with no value (`missing: down`),
 * which the painter paints in the theme red; a link half with no data is `missing`, and so is a missing status that
 * the painter paints grey. Then the link load scale of the link halves. A status with no refId (an unavailable cell)
 * is not in this legend. Last, blocks with the same content merge into one (`mergeSame`).
 */
export function buildLegendV4(patches: PatchMap, fields: Map<string, Field>, ctx: LegendContext): LegendBlock[] {
  const statusItems = new Map<string, Item[]>();
  const links: Item[] = [];
  const states: Record<(typeof STATE_ENTRIES_V4)[number]['key'], string[]> = { down: [], stale: [], missing: [] };
  for (const patch of patches.values()) {
    addItem(links, states.missing, patch.cellId, 'link', patch.link?.a2b);
    addItem(links, states.missing, patch.cellId, 'link', patch.link?.b2a);
    const view = patch.statusView;
    if (!view?.refId) {
      continue;
    }
    if (view.state === 'stale' || view.state === 'missing') {
      if (view.state === 'stale' || linkStatusPaint(patch, ctx.theme) !== undefined) {
        push(states[view.state], patch.cellId);
      }
      continue;
    }
    if (view.state === 'down' && !view.color) {
      // `missing: down` with no value: the painter paints the theme red
      push(states.down, patch.cellId);
      continue;
    }
    const field = fields.get(view.refId);
    if (field) {
      const items = statusItems.get(view.refId) ?? [];
      statusItems.set(view.refId, items);
      items.push({
        cellId: patch.cellId,
        kind: 'node',
        field,
        refId: view.refId,
        color: view.color ?? '',
        stepIndex: -1,
        value: view.value,
        text: view.text,
      });
    }
  }
  const out: LegendBlock[] = [];
  for (const [refId, items] of statusItems) {
    const scale = scaleOf(items[0], ctx);
    if (!scale) {
      continue;
    }
    const { auto, gradient } = scale;
    const config = items[0].field.config;
    const block: LegendBlock = {
      key: `status:${refId}`,
      title: config.displayName || refId,
      entries: scale.entries,
      ...(gradient
        ? { gradient: auto ? { ...gradient, min: auto.format(auto.min), max: auto.format(auto.max) } : gradient }
        : {}),
      cellIds: [],
    };
    for (const item of items) {
      push(block.cellIds, item.cellId);
      const entry = entryOfV4(block, item);
      if (entry) {
        push(entry.cellIds, item.cellId);
      }
    }
    out.push(block);
  }
  const entries = STATE_ENTRIES_V4.filter(({ key }) => states[key].length).map(({ key, label }) => ({
    key,
    label,
    color: statusColor({ state: key }, ctx.theme),
    cellIds: states[key],
  }));
  if (entries.length) {
    const cellIds: string[] = [];
    entries.forEach((e) => e.cellIds.forEach((id) => push(cellIds, id)));
    out.push({ key: 'state', title: 'State', entries, cellIds });
  }
  return mergeSame([...out, ...scaleBlocks(links, ctx)]);
}

/** What a block shows: the text and colour of each entry in order, the gradient with its end texts, and the bar. */
const contentOf = (block: LegendBlock) =>
  JSON.stringify([block.entries.map((e) => [e.label, e.color]), block.gradient ?? null, block.bar ?? null]);

/**
 * Blocks with the same content (`contentOf`) become one block at the place of the first. Its title is the titles of
 * the members joined with ' · '. Its cells, and the cells of each entry, are the cells of all members, so a highlight
 * shows the cells of every member. Its key is the sorted keys of the members in JSON, and its entry keys are those of
 * the member with the first key: they do not change when the order of the cells changes, and a query ID with a
 * separator in it cannot make the same key.
 */
function mergeSame(blocks: LegendBlock[]): LegendBlock[] {
  const groups = new Map<string, LegendBlock[]>();
  for (const block of blocks) {
    const content = contentOf(block);
    groups.set(content, [...(groups.get(content) ?? []), block]);
  }
  return [...groups.values()].map((members) => {
    if (members.length === 1) {
      return members[0];
    }
    const keys = members.map((m) => m.key).sort();
    const first = members.find((m) => m.key === keys[0])!;
    const union = (ids: (m: LegendBlock) => string[]) => {
      const out: string[] = [];
      members.forEach((m) => ids(m).forEach((id) => push(out, id)));
      return out;
    };
    const titles: string[] = [];
    members.forEach((m) => m.title && push(titles, m.title));
    return {
      key: `merged:${JSON.stringify(keys)}`,
      title: titles.length ? titles.join(' · ') : undefined,
      entries: first.entries.map((e, i) => ({ ...e, cellIds: union((m) => m.entries[i].cellIds) })),
      ...(first.gradient ? { gradient: first.gradient } : {}),
      ...(first.bar ? { bar: first.bar } : {}),
      cellIds: union((m) => m.cellIds),
    };
  });
}

/**
 * The swatch of the collapsed legend chip: the colours of the first scale, low to high. A bar keeps its hard colour
 * stops at the step values.
 */
export function chipSwatch(blocks: LegendBlock[]): string {
  const first = blocks[0];
  if (first?.bar) {
    const stops = first.bar.segments.map(
      (s, i) => `${first.entries[i].color} ${barPercent(s.from)} ${barPercent(s.to)}`
    );
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }
  const colors = first?.gradient?.colors ?? first?.entries.map((e) => e.color) ?? [];
  if (colors.length === 0) {
    return 'transparent';
  }
  if (colors.length === 1) {
    return colors[0];
  }
  return `linear-gradient(to right, ${colors.join(', ')})`;
}
