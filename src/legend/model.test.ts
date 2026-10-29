import { describe, expect, it } from 'vitest';
import {
  createTheme,
  Field,
  FieldColorModeId,
  FieldConfig,
  FieldType,
  getFieldColorMode,
  MappingType,
  SpecialValueMatch,
  ThresholdsMode,
} from '@grafana/data';
import type { StatusView } from '../binding/status';
import type { CellPatch, HalfState, PatchMap, SeriesInfo, StatusV4Fields } from '../types';
import { buildLegendV4, chipSwatch, type LegendBlock, type LegendContext } from './model';

const theme = createTheme();
const named = (c: string) => theme.visualization.getColorByName(c);
const ctx: LegendContext = { theme };
const steps = [
  { value: -Infinity, color: 'green' },
  { value: 60, color: 'yellow' },
  { value: 85, color: 'red' },
];
const thresholds = { mode: ThresholdsMode.Absolute, steps };
const field = (config: FieldConfig): Field => ({ name: 'Value', type: FieldType.number, values: [], config });
const series = (config: FieldConfig, refId = 'A'): SeriesInfo => {
  const f = field(config);
  return { refId, name: 'Value', labels: {}, values: [], field: f, frame: { fields: [f], length: 0 } };
};
const half = (s: SeriesInfo, over: Partial<HalfState> = {}): HalfState => ({
  status: 'ok',
  color: named('green'),
  width: 2,
  label: '',
  stepIndex: 0,
  value: 1,
  series: s,
  ...over,
});
const link = (cellId: string, a2b?: HalfState, b2a?: HalfState): [string, CellPatch] => [
  cellId,
  { cellId, scope: { cell: {} }, urls: [], link: { a2b, b2a } },
];
type Status = StatusView & StatusV4Fields;
const status = (refId: string, color: string, text = '–'): Status => ({
  state: 'normal',
  severity: 'normal',
  reason: '',
  queryIds: [],
  conditionKey: '',
  coverage: { available: 1, expected: 1 },
  refId,
  color,
  text,
});
const node = (cellId: string, statusView: Status): [string, CellPatch] => [
  cellId,
  { cellId, scope: { cell: {} }, urls: [], statusView },
];
const legendOf = (cells: Array<[string, CellPatch]>, f: Field, refId: string, context = ctx) =>
  buildLegendV4(new Map(cells) as PatchMap, new Map([[refId, f]]), context);

describe('buildLegendV4: link load scales', () => {
  it('makes one block for links with a capacity, with percent labels in order and the cells of each step', () => {
    const s = series({ thresholds });
    const blocks = buildLegendV4(
      new Map([
        link('l1', half(s, { percent: 70, color: named('yellow'), stepIndex: 1 }), half(s, { percent: 10 })),
        link('l2', half(s, { percent: 90, color: named('red'), stepIndex: 2 })),
      ]),
      new Map(),
      ctx
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('Link load %');
    expect(blocks[0].entries.map((e) => [e.label, e.color])).toEqual([
      ['< 60%', named('green')],
      ['≥ 60%', named('yellow')],
      ['≥ 85%', named('red')],
    ]);
    expect(blocks[0].entries.map((e) => e.cellIds)).toEqual([['l1'], ['l1'], ['l2']]);
    expect(blocks[0].cellIds).toEqual(['l1', 'l2']);
  });
  it('shows a continuous scheme as a gradient: 0–100% with a capacity, else the field min and max', () => {
    const mode = { mode: FieldColorModeId.ContinuousGrYlRd };
    const calc = getFieldColorMode(FieldColorModeId.ContinuousGrYlRd).getCalculator(
      series({ color: mode }).field,
      theme
    );
    const capacity = buildLegendV4(
      new Map([link('l1', half(series({ color: mode, thresholds }), { percent: 40 }))]),
      new Map(),
      ctx
    );
    expect(capacity[0]).toMatchObject({ title: 'Link load %', entries: [], cellIds: ['l1'] });
    expect(capacity[0].gradient).toMatchObject({ min: '0%', max: '100%' });
    expect(capacity[0].gradient!.colors[0]).toBe(calc(0, 0));
    expect(capacity[0].gradient!.colors.at(-1)).toBe(calc(0, 1));
    const value = buildLegendV4(
      new Map([link('l1', half(series({ color: mode, unit: 'percent', min: 0, max: 50 })))]),
      new Map(),
      ctx
    );
    expect(value[0].gradient).toMatchObject({ min: '0%', max: '50%' });
    expect(value[0].title).toBe('Link %');
  });
  it('merges identical scales and keeps scales that an override changed apart', () => {
    const a = series({ thresholds }, 'A');
    const b = series({ thresholds }, 'B');
    const w = series({ thresholds: { ...thresholds, steps: [steps[0], { value: 50, color: 'red' }] } }, 'W');
    const blocks = buildLegendV4(
      new Map([
        link('l1', half(a, { percent: 1 })),
        link('l2', half(b, { percent: 1 })),
        link('l3', half(w, { percent: 1 })),
      ]),
      new Map(),
      ctx
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cellIds).toEqual(['l1', 'l2']);
    // two different scales with the same title get their sources
    expect(blocks.map((b) => b.title)).toEqual(['Link load % (A, B)', 'Link load % (W)']);
  });
  it('has no block for a colour per series: palette and Shades', () => {
    const palette = series({ color: { mode: FieldColorModeId.PaletteClassic } });
    const shades = series({ color: { mode: FieldColorModeId.Shades, fixedColor: 'blue' } });
    expect(buildLegendV4(new Map([link('l1', half(palette))]), new Map(), ctx)).toEqual([]);
    expect(buildLegendV4(new Map([link('l1', half(shades))]), new Map(), ctx)).toEqual([]);
  });
  it('shows a fixed colour as one swatch', () => {
    const s = series({ color: { mode: FieldColorModeId.Fixed, fixedColor: 'blue' } });
    const blocks = buildLegendV4(new Map([link('l1', half(s, { color: named('blue') }))]), new Map(), ctx);
    expect(blocks[0].entries).toEqual([{ key: 'fixed', label: 'All values', color: named('blue'), cellIds: ['l1'] }]);
  });
  it('an automatic continuous range spans the values of all fields of the scale', () => {
    const mode = { mode: FieldColorModeId.ContinuousGrYlRd };
    const withValues = (values: number[]) => {
      const s = series({ color: mode, unit: 'none' });
      s.field.values = values;
      return s;
    };
    const blocks = buildLegendV4(
      new Map([
        link('l1', half(withValues([0, 10, 20]), { value: 10 })),
        link('l2', half(withValues([5, 40]), { value: 40 })),
      ]),
      new Map(),
      ctx
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].gradient).toMatchObject({ min: '0', max: '40' });
    expect(blocks[0].cellIds).toEqual(['l1', 'l2']);
  });
});

describe('buildLegendV4: status scales', () => {
  it('uses the panel thresholds when the field has none, and accepts a null base step', () => {
    const panel = { mode: ThresholdsMode.Absolute, steps: [{ value: null as unknown as number, color: 'blue' }] };
    const blocks = legendOf([node('n1', status('up', named('blue'), '5'))], field({}), 'up', {
      ...ctx,
      fieldThresholds: panel,
    });
    expect(blocks[0].entries.map((e) => [e.label, e.color, e.cellIds])).toEqual([
      ['All values', named('blue'), ['n1']],
    ]);
  });
  it('labels absolute thresholds of a status value in the field unit', () => {
    const f = field({ unit: 'watt', thresholds: { ...thresholds, steps: steps.slice(0, 2) } });
    const blocks = legendOf([node('n1', status('P', named('yellow'), '70 W'))], f, 'P', {
      ...ctx,
      queryName: (refId) => (refId === 'P' ? 'PoE' : undefined),
    });
    expect(blocks[0].title).toBe('PoE');
    expect(blocks[0].entries.map((e) => e.label)).toEqual(['< 60 W', '≥ 60 W']);
    expect(blocks[0].entries[1].cellIds).toEqual(['n1']);
  });
  it('lists value mapping colours of every kind before the thresholds, and skips a mapping with no colour', () => {
    const f = field({
      unit: 'none',
      thresholds: {
        mode: ThresholdsMode.Absolute,
        steps: [
          { value: -Infinity, color: 'red' },
          { value: 1, color: 'green' },
        ],
      },
      mappings: [
        {
          type: MappingType.ValueToText,
          options: { '0': { text: 'down', color: 'dark-red' }, '1': { text: 'up', color: 'dark-green' } },
        },
        { type: MappingType.RangeToText, options: { from: 2, to: 5, result: { color: 'orange' } } },
        {
          type: MappingType.SpecialValue,
          options: { match: SpecialValueMatch.Null, result: { text: 'gone', color: 'purple' } },
        },
        { type: MappingType.ValueToText, options: { '9': { text: 'no colour' } } },
      ],
    });
    const blocks = legendOf([node('n1', status('C', named('dark-green'), 'up'))], f, 'C');
    expect(blocks[0].entries.map((e) => [e.label, e.color])).toEqual([
      ['down', named('dark-red')],
      ['up', named('dark-green')],
      ['2–5', named('orange')],
      ['gone', named('purple')],
      ['< 1', named('red')],
      ['≥ 1', named('green')],
    ]);
    expect(blocks[0].entries[1].cellIds).toEqual(['n1']);
    expect(blocks[0].entries[5].cellIds).toEqual([]);
  });
  it('puts a cell into the mapping of its text when a threshold has the same colour', () => {
    const f = field({
      unit: 'none',
      thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
      mappings: [
        { type: MappingType.ValueToText, options: { '10': { text: 'Maintenance', color: 'green' } } },
        { type: MappingType.ValueToText, options: { '20': { text: 'Spare', color: 'green' } } },
      ],
    });
    const blocks = legendOf(
      [
        node('n1', status('S', named('green'), 'Maintenance')),
        node('n2', status('S', named('green'), 'Spare')),
        node('n3', status('S', named('green'), '5')),
      ],
      f,
      'S'
    );
    expect(blocks[0].entries.map((e) => [e.label, e.cellIds])).toEqual([
      ['Maintenance', ['n1']],
      ['Spare', ['n2']],
      ['All values', ['n3']],
    ]);
  });
});

describe('chipSwatch', () => {
  const block = (colors: string[], gradient = false): LegendBlock => ({
    key: 'k',
    entries: colors.map((color, i) => ({ key: `s${i}`, label: `${i}`, color, cellIds: [] })),
    gradient: gradient ? { colors, min: '0', max: '1' } : undefined,
    cellIds: [],
  });
  it('is a gradient of the first scale, a plain colour for one colour, and transparent without blocks', () => {
    expect(chipSwatch([block(['#0f0', '#f00'])])).toBe('linear-gradient(to right, #0f0, #f00)');
    expect(chipSwatch([block(['#0f0', '#ff0', '#f00'], true)])).toContain('#ff0');
    expect(chipSwatch([block(['#0f0'])])).toBe('#0f0');
    expect(chipSwatch([])).toBe('transparent');
  });
});
