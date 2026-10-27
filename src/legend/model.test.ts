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
import type { PlanCellPatch } from '../binding/engine';
import type { StatusView } from '../binding/status';
import type { HalfState, SeriesInfo, ShapeState } from '../types';
import { buildLegend, chipSwatch, type LegendBlock, type LegendContext } from './model';

const theme = createTheme();
const named = (c: string) => theme.visualization.getColorByName(c);
const ctx: LegendContext = { theme };
const steps = [
  { value: -Infinity, color: 'green' },
  { value: 60, color: 'yellow' },
  { value: 85, color: 'red' },
];
const thresholds = { mode: ThresholdsMode.Absolute, steps };
const series = (config: FieldConfig, refId = 'A'): SeriesInfo => {
  const field: Field = { name: 'Value', type: FieldType.number, values: [], config };
  return { refId, name: 'Value', labels: {}, values: [], field, frame: { fields: [field], length: 0 } };
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
const link = (cellId: string, a2b?: HalfState, b2a?: HalfState): [string, PlanCellPatch] => [
  cellId,
  { cellId, ruleNames: [], scope: { cell: {} }, urls: [], link: { a2b, b2a } },
];
const node = (cellId: string, shape?: ShapeState, statusView?: StatusView): [string, PlanCellPatch] => [
  cellId,
  { cellId, ruleNames: [], scope: { cell: {} }, urls: [], shape, statusView },
];
const status = (state: StatusView['state']): StatusView => ({
  state,
  reason: state,
  queryIds: ['q'],
  conditionKey: state,
  coverage: { available: 1, expected: 1 },
});

describe('buildLegend', () => {
  it('makes one threshold block for links with a capacity, with percent labels in order', () => {
    const s = series({ thresholds });
    const blocks = buildLegend(
      new Map([
        link('l1', half(s, { percent: 70, color: named('yellow'), stepIndex: 1 }), half(s, { percent: 10 })),
        link('l2', half(s, { percent: 90, color: named('red'), stepIndex: 2 })),
      ]),
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
  it('uses the panel thresholds when the field has none, and accepts a null base step', () => {
    const s = series({});
    const panel = { mode: ThresholdsMode.Absolute, steps: [{ value: null as unknown as number, color: 'blue' }] };
    const blocks = buildLegend(new Map([link('l1', half(s, { percent: 5, color: named('blue') }))]), {
      ...ctx,
      fieldThresholds: panel,
    });
    expect(blocks[0].entries.map((e) => [e.label, e.color])).toEqual([['All values', named('blue')]]);
  });
  it('labels absolute thresholds of a value without capacity in the field unit', () => {
    const s = series({ unit: 'watt', thresholds: { ...thresholds, steps: steps.slice(0, 2) } }, 'P');
    const blocks = buildLegend(
      new Map([node('n1', { status: 'ok', color: named('yellow'), target: 'icon', stepIndex: 1, series: s })]),
      {
        ...ctx,
        queryName: (refId) => (refId === 'P' ? 'PoE' : undefined),
      }
    );
    expect(blocks[0].title).toBe('PoE W');
    expect(blocks[0].entries.map((e) => e.label)).toEqual(['< 60 W', '≥ 60 W']);
    expect(blocks[0].entries[1].cellIds).toEqual(['n1']);
  });
  it('shows a continuous scheme as a gradient: 0–100% with a capacity, else the field min and max', () => {
    const mode = { mode: FieldColorModeId.ContinuousGrYlRd };
    const calc = getFieldColorMode(FieldColorModeId.ContinuousGrYlRd).getCalculator(
      series({ color: mode }).field,
      theme
    );
    const capacity = buildLegend(
      new Map([link('l1', half(series({ color: mode, thresholds }), { percent: 40 }))]),
      ctx
    );
    expect(capacity[0]).toMatchObject({ title: 'Link load %', entries: [], cellIds: ['l1'] });
    expect(capacity[0].gradient).toMatchObject({ min: '0%', max: '100%' });
    expect(capacity[0].gradient!.colors[0]).toBe(calc(0, 0));
    expect(capacity[0].gradient!.colors.at(-1)).toBe(calc(0, 1));
    const value = buildLegend(
      new Map([link('l1', half(series({ color: mode, unit: 'percent', min: 0, max: 50 })))]),
      ctx
    );
    expect(value[0].gradient).toMatchObject({ min: '0%', max: '50%' });
    expect(value[0].title).toBe('Link %');
  });
  it('lists value mapping colours before the thresholds, and puts a cell into its mapping', () => {
    const s = series(
      {
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
      },
      'C'
    );
    const blocks = buildLegend(
      new Map([
        node('n1', { status: 'ok', color: named('dark-green'), target: 'icon', stepIndex: 1, value: 1, series: s }),
      ]),
      ctx
    );
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
  it('makes a status block with the marker colours and a no data entry', () => {
    const blocks = buildLegend(
      new Map([
        node('n1', undefined, status('down')),
        node('n2', undefined, status('stale')),
        node('n3', undefined, status('normal')),
        link('l1', half(series({}), { status: 'nodata', series: undefined, stepIndex: -1 })),
      ]),
      ctx
    );
    expect(blocks.map((b) => b.title)).toEqual(['Status', undefined]);
    expect(blocks[0].entries.map((e) => [e.label, e.color, e.cellIds])).toEqual([
      ['Down, critical', theme.visualization.getColorByName('red'), ['n1']],
      ['Warning, stale', theme.visualization.getColorByName('orange'), ['n2']],
      ['Missing', theme.colors.text.disabled, []],
    ]);
    expect(blocks[0].cellIds).toEqual(['n1', 'n2', 'n3']);
    expect(blocks[1].entries).toEqual([
      { key: 'nodata', label: 'No data', color: theme.colors.text.disabled, cellIds: ['l1'] },
    ]);
  });
  it('merges identical scales and keeps scales that an override changed apart', () => {
    const a = series({ thresholds }, 'A');
    const b = series({ thresholds }, 'B');
    const w = series({ thresholds: { ...thresholds, steps: [steps[0], { value: 50, color: 'red' }] } }, 'W');
    const blocks = buildLegend(
      new Map([
        link('l1', half(a, { percent: 1 })),
        link('l2', half(b, { percent: 1 })),
        link('l3', half(w, { percent: 1 })),
      ]),
      ctx
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cellIds).toEqual(['l1', 'l2']);
    // two different scales with the same title get their sources
    expect(blocks.map((b) => b.title)).toEqual(['Link load % (A, B)', 'Link load % (W)']);
  });
  it('ignores shapes that colour nothing and fields with a colour per series', () => {
    const s = series({ thresholds });
    const blocks = buildLegend(
      new Map([
        node('n1', { status: 'ok', color: '#888', target: 'none', stepIndex: -1, series: s }),
        link('l1', half(series({ color: { mode: FieldColorModeId.PaletteClassic } }))),
      ]),
      ctx
    );
    expect(blocks).toEqual([]);
  });
  it('shows a fixed colour as one swatch', () => {
    const s = series({ color: { mode: FieldColorModeId.Fixed, fixedColor: 'blue' } });
    const blocks = buildLegend(new Map([link('l1', half(s, { color: named('blue') }))]), ctx);
    expect(blocks[0].entries).toEqual([{ key: 'fixed', label: 'All values', color: named('blue'), cellIds: ['l1'] }]);
  });
  it('puts a cell into the mapping of its text when a threshold has the same colour', () => {
    const s = series({
      unit: 'none',
      thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
      mappings: [
        { type: MappingType.ValueToText, options: { '10': { text: 'Maintenance', color: 'green' } } },
        { type: MappingType.ValueToText, options: { '20': { text: 'Spare', color: 'green' } } },
      ],
    });
    const shape = (text: string) => ({
      status: 'ok' as const,
      color: named('green'),
      target: 'icon' as const,
      stepIndex: 0,
      series: s,
      display: { text, numeric: 0 },
    });
    const blocks = buildLegend(
      new Map([node('n1', shape('Maintenance')), node('n2', shape('Spare')), node('n3', shape('5'))]),
      ctx
    );
    expect(blocks[0].entries.map((e) => [e.label, e.cellIds])).toEqual([
      ['Maintenance', ['n1']],
      ['Spare', ['n2']],
      ['All values', ['n3']],
    ]);
  });
  it('an automatic continuous range spans the values of all fields of the scale', () => {
    const mode = { mode: FieldColorModeId.ContinuousGrYlRd };
    const withValues = (values: number[]) => {
      const s = series({ color: mode, unit: 'none' });
      s.field.values = values;
      return s;
    };
    const blocks = buildLegend(
      new Map([
        link('l1', half(withValues([0, 10, 20]), { value: 10 })),
        link('l2', half(withValues([5, 40]), { value: 40 })),
      ]),
      ctx
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].gradient).toMatchObject({ min: '0', max: '40' });
    expect(blocks[0].cellIds).toEqual(['l1', 'l2']);
  });
  it('has no block for Shades: each series has its own shade', () => {
    const s = series({ color: { mode: FieldColorModeId.Shades, fixedColor: 'blue' } });
    expect(buildLegend(new Map([link('l1', half(s))]), ctx)).toEqual([]);
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
