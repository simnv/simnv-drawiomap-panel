import { describe, expect, it } from 'vitest';
import {
  applyFieldOverrides,
  createTheme,
  type DataFrame,
  type DisplayValue,
  type Field,
  FieldColorModeId,
  FieldConfigOptionsRegistry,
  FieldMatcherID,
  FieldType,
  formattedValueToString,
  getFieldColorMode,
  ThresholdsMode,
  toDataFrame,
} from '@grafana/data';
import type { CapacitySource } from '../types';
import { fieldDisplay, type HistoryModel } from '../query/frames';
import { indexSeries } from '../query/seriesIndex';
import { directionHistory } from './rowData';
import { halfState, type HalfContext, percentText } from './engine';

const theme = createTheme();
const ctx: HalfContext = {
  theme,
  fieldThresholds: {
    mode: ThresholdsMode.Absolute,
    steps: [
      { value: -Infinity, color: 'green' },
      { value: 60, color: 'yellow' },
      { value: 85, color: 'red' },
    ],
  },
  display: (_s, v): DisplayValue => ({ text: `${v / 1e6}`, suffix: ' Mb/s', numeric: v, color: '#abcdef' }),
  linkWidth: { min: 2, max: 10 },
};
/** The display processor of the field, as the panel has it. */
const real: HalfContext = { ...ctx, display: (series, value) => fieldDisplay(series.field, theme)(value) };

/** A panel frame with one numeric field, as Grafana gives it to the panel. */
const frame = (refId: string, labels: Record<string, string>, values: number[], config: Field['config'] = {}) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'Time', type: FieldType.time, values: values.map((_, i) => 1000 + i) },
      { name: 'Value', type: FieldType.number, values, labels, config },
    ],
  });
/** The history of the one series of a refId, as the bind reads it. */
const historyOf = (frames: DataFrame[], refId = 'T'): HistoryModel => {
  const { series } = indexSeries(frames, refId);
  return directionHistory({
    snapshot: { state: 'ready', frames, fetchedAt: 1000, fromCache: false },
    series: series.slice(0, 1),
  });
};
const ready = (frames: DataFrame[], refId = 'T'): Extract<HistoryModel, { state: 'ready' }> => {
  const model = historyOf(frames, refId);
  if (model.state !== 'ready') {
    throw new Error('expected ready');
  }
  return model;
};
const cap = (amount?: number, source: CapacitySource = 'attr') => ({ amount, source });
const labels = { job: 'node-rtr-a', device: 'wan1' };
/** One half: the traffic of a field config, against a capacity in bit/s. */
const half = (config: Field['config'], value: number, amount?: number, context: HalfContext = real) =>
  halfState(historyOf([frame('T', labels, [value], config)]), 'T', cap(amount), context);

describe('halfState: the link halves', () => {
  const model = historyOf([frame('T', labels, [40e6, 41e6], { unit: 'bps' })]);
  it('colours a half against the capacity and gives the card text', () => {
    const { state, notes } = halfState(model, 'T', cap(1e8, 'attr'), ctx);
    expect(state).toMatchObject({ status: 'ok', value: 41e6, capacity: 1e8, capacitySource: 'attr' });
    expect(state.percent).toBeCloseTo(41);
    expect(state.stepIndex).toBe(0);
    expect(state.label).toMatch(/^41(\.0)? Mb\/s · 41% of 100 Mb\/s$/);
    expect(state.width).toBeCloseTo(2 + 8 * 0.41);
    expect(notes).toEqual([]);
  });
  it('reads the last value of the history', () => {
    expect(halfState(model, 'T', cap(1e8), ctx).state.value).toBe(41e6);
  });
  it('goes red at 90 percent', () => {
    const busy = historyOf([frame('T', labels, [90e6], { unit: 'bps' })]);
    expect(halfState(busy, 'T', cap(1e8), ctx).state.stepIndex).toBe(2);
  });
  it('is grey "no data" when the series has no value, and keeps the capacity', () => {
    const { state, notes } = halfState(
      { state: 'empty', fetchedAt: 0, fromCache: false },
      'T',
      cap(1e8, 'series'),
      ctx
    );
    expect(state).toMatchObject({
      status: 'nodata',
      stepIndex: -1,
      color: theme.colors.text.disabled,
      label: 'no data',
      width: 2,
      capacity: 1e8,
      capacitySource: 'series',
    });
    expect(state.percent).toBeUndefined();
    expect(notes).toEqual([]);
  });
  it.each([
    ['loading', { state: 'loading' }],
    ['error', { state: 'error', message: 'boom' }],
  ] as const)('is grey "no data" when the query is %s', (_, input) => {
    expect(halfState(input, 'T', cap(), ctx).state).toMatchObject({ status: 'nodata', label: 'no data' });
  });
  it('is grey "no data" when the history is ready and has no latest value', () => {
    const empty = { ...ready([frame('T', labels, [1], { unit: 'bps' })]), latestValue: undefined };
    expect(halfState(empty, 'T', cap(1e8), ctx).state.status).toBe('nodata');
  });
});

describe('halfState: the capacity source', () => {
  it('series: keeps the source and the percent of the capacity in bit/s', () => {
    const { state } = halfState(historyOf([frame('T', labels, [4e7], { unit: 'bps' })]), 'T', cap(1e8, 'series'), real);
    expect(state).toMatchObject({ capacitySource: 'series', capacity: 1e8 });
    expect(state.percent).toBeCloseTo(40);
    expect(state.label).toMatch(/^40(\.0)? Mb\/s · 40% of 100 Mb\/s$/);
  });
  it('attr: keeps the source of a cell attribute', () => {
    const { state } = halfState(historyOf([frame('T', labels, [4e7], { unit: 'bps' })]), 'T', cap(2e8, 'attr'), real);
    expect(state).toMatchObject({ capacitySource: 'attr', capacity: 2e8 });
    expect(state.percent).toBeCloseTo(20);
  });
  it('none: no capacity, no percent, the colour of the raw value', () => {
    const { state } = half({ unit: 'bps' }, 4e7);
    expect(state).toMatchObject({ capacitySource: 'none', capacity: undefined, percent: undefined });
    expect(state.label).toMatch(/^40(\.0)? Mb\/s$/);
  });
  it('none: a source without an amount counts as none', () => {
    const { state } = halfState(
      historyOf([frame('T', labels, [4e7], { unit: 'bps' })]),
      'T',
      cap(undefined, 'series'),
      real
    );
    expect(state.capacitySource).toBe('none');
    expect(state.percent).toBeUndefined();
  });
  it('width follows the percent between the minimum and the maximum', () => {
    expect(half({ unit: 'Bps' }, 5e6, 1e8).state.width).toBeCloseTo(2 + 8 * 0.4);
  });

  const pctFor = (unit: string | undefined, value: number) => half(unit ? { unit } : {}, value, 1e8).state.percent;
  it('byte-rate units convert to bit/s before the capacity percent', () => {
    expect(pctFor('Bps', 5e6)).toBeCloseTo(40);
    expect(pctFor('KBs', 5e3)).toBeCloseTo(40);
    expect(pctFor('MBs', 5)).toBeCloseTo(40);
    expect(pctFor('GBs', 0.005)).toBeCloseTo(40);
    expect(pctFor('binBps', 5e6)).toBeCloseTo(40);
    expect(pctFor('KiBs', 1000)).toBeCloseTo((1000 * 1024 * 8 * 100) / 1e8);
    expect(pctFor('MiBs', 1)).toBeCloseTo((1024 ** 2 * 8 * 100) / 1e8);
    expect(pctFor('GiBs', 0.01)).toBeCloseTo((0.01 * 1024 ** 3 * 8 * 100) / 1e8);
  });
  it('bit-rate units scale to bit/s', () => {
    expect(pctFor('bps', 4e7)).toBeCloseTo(40);
    expect(pctFor('binbps', 4e7)).toBeCloseTo(40);
    expect(pctFor('Kbits', 4e4)).toBeCloseTo(40);
    expect(pctFor('Mbits', 40)).toBeCloseTo(40);
    expect(pctFor('Gbits', 0.04)).toBeCloseTo(40);
    expect(pctFor('Mibits', 1)).toBeCloseTo((1024 ** 2 * 100) / 1e8);
    expect(pctFor(undefined, 4e7)).toBeCloseTo(40);
  });
  it('an unknown unit uses the raw value and gives a note', () => {
    const { state, notes } = half({ unit: 'percent' }, 4e7, 1e8);
    expect(state.percent).toBeCloseTo(40);
    expect(notes).toEqual([expect.stringContaining('unit "percent"')]);
  });
});

describe('halfState: the colours from the Grafana field config', () => {
  const steps = {
    mode: ThresholdsMode.Absolute,
    steps: [
      { value: -Infinity, color: 'green' },
      { value: 60, color: 'yellow' },
      { value: 85, color: 'red' },
    ],
  };
  // the standard options of Grafana core that the overrides below use
  const registry = new FieldConfigOptionsRegistry(() =>
    ['unit', 'color', 'thresholds', 'max'].map(
      (id) =>
        ({ id, path: id, name: id, process: (v: unknown) => v, shouldApply: () => true, override: () => null }) as never
    )
  );
  // query A: a continuous GrYlRd scheme by an override; query B: the thresholds of the defaults
  const frames = applyFieldOverrides({
    data: [frame('A', { device: 'eth0' }, [5e7]), frame('B', { device: 'eth0' }, [7e8])],
    fieldConfig: {
      defaults: { unit: 'bps', color: { mode: FieldColorModeId.Thresholds }, thresholds: steps },
      overrides: [
        {
          matcher: { id: FieldMatcherID.byFrameRefID, options: 'A' },
          properties: [{ id: 'color', value: { mode: FieldColorModeId.ContinuousGrYlRd } }],
        },
      ],
    },
    fieldConfigRegistry: registry,
    replaceVariables: (s) => s,
    theme,
  });
  // no panel thresholds: the colours come from the field config only
  const gctx: HalfContext = { ...real, fieldThresholds: undefined };
  const at = (refId: string, amount?: number) => halfState(historyOf(frames, refId), refId, cap(amount), gctx).state;

  it('colours a half by the continuous scheme of its field at the percent of the capacity', () => {
    const h = at('A', 1e8);
    expect(h.percent).toBeCloseTo(50);
    const calc = getFieldColorMode(FieldColorModeId.ContinuousGrYlRd).getCalculator(frames[0].fields[1], theme);
    expect(h.color).toBe(calc(0, 0.5));
  });
  it('colours a half by the thresholds in percent of the capacity', () => {
    const h = at('B', 1e9);
    expect(h.percent).toBeCloseTo(70);
    expect(h.color).toBe(theme.visualization.getColorByName('yellow'));
    expect(h.stepIndex).toBe(1);
  });
  it('colours a half without capacity by the display colour of the raw value', () => {
    const h = at('B');
    expect(h.capacitySource).toBe('none');
    // 7e8 against the absolute steps: red
    expect(h.color).toBe(theme.visualization.getColorByName('red'));
  });
});

describe('halfState: the capacity text in the unit of the field', () => {
  it('bps: "41 Mb/s · 41% of 100 Mb/s", the capacity formatted once', () => {
    const { state } = half({ unit: 'bps' }, 41e6, 1e8);
    expect(state.label).toMatch(/^41(\.0)? Mb\/s · 41% of 100 Mb\/s$/);
    expect(formattedValueToString(state.capacityDisplay!)).toBe('100 Mb/s');
  });
  it('the capacity takes automatic decimals, not the decimals of the value field', () => {
    const { state } = half({ unit: 'bps', decimals: 1 }, 41e6, 1e8);
    expect(state.label).toBe('41.0 Mb/s · 41% of 100 Mb/s');
    expect(formattedValueToString(state.capacityDisplay!)).toBe('100 Mb/s');
    expect(half({ unit: 'm3', decimals: 3 }, 2.05, 4.1).state.label).toBe('2.050 m³ · 50% of 4.1 m³');
  });
  it('Bps: a capacity of 1 Gb/s shows as 125 MB/s; the percent does not change', () => {
    const { state } = half({ unit: 'Bps' }, 12.5e6, 1e9);
    expect(state.percent).toBeCloseTo(10);
    expect(state.label).toMatch(/of 125 MB\/s$/);
  });
  it('a unit that is not a data rate: the raw value against the raw capacity, shown in that unit', () => {
    const { state } = half({ unit: 'm3' }, 2.05, 4.1);
    expect(state.percent).toBeCloseTo(50);
    expect(state.label).toMatch(/of 4\.1\d* m³$/);
  });
  it('no data stays grey without a percent; no capacity gives no percent and no capacity text', () => {
    const { state: nodata } = halfState({ state: 'empty', fetchedAt: 0, fromCache: false }, 'T', cap(1e8), real);
    expect(nodata).toMatchObject({ status: 'nodata', label: 'no data', capacity: 1e8 });
    expect(nodata.percent).toBeUndefined();
    expect(nodata.capacityDisplay).toBeUndefined();
    const { state: free } = half({ unit: 'bps' }, 41e6);
    expect(free).toMatchObject({ status: 'ok', capacitySource: 'none' });
    expect(free.percent).toBeUndefined();
    expect(free.capacityDisplay).toBeUndefined();
    expect(free.label).toMatch(/^41(\.0)? Mb\/s$/);
  });
});

describe('percentText', () => {
  it('a real 0 is 0%, under 0.5 is <1%, above 999 is >999%, else the rounded percent', () => {
    expect(percentText(0)).toBe('0%');
    expect(percentText(0.4)).toBe('<1%');
    expect(percentText(0.5)).toBe('1%');
    expect(percentText(41.4)).toBe('41%');
    expect(percentText(999)).toBe('999%');
    expect(percentText(1200)).toBe('>999%');
  });
  it('percentDisplay is the percent part of the card label, and absent without a capacity', () => {
    const at = (amount?: number) => half({ unit: 'bps' }, 0.4e6, amount, ctx).state;
    const small = at(1e8);
    expect(small.percentDisplay).toBe('<1%');
    expect(small.label).toMatch(/ · <1% of 100 Mb\/s$/);
    expect(at(1e6).percentDisplay).toBe('40%');
    expect(at().percentDisplay).toBeUndefined();
  });
});

describe('halfState: the series of the state', () => {
  const model = () =>
    ready([
      toDataFrame({
        refId: 'T',
        fields: [
          { name: 'Time', type: FieldType.time, values: [1000, 2000, 3000, 4000] },
          { name: 'Value', type: FieldType.number, labels: { job: 'a' }, values: [1, null, 3, 4] },
        ],
      }),
    ]);
  const seriesOf = (m: HistoryModel, refId = 'T') => halfState(m, refId, cap(), ctx).state.series!;
  it('gives the same SeriesInfo object twice for one model and one refId', () => {
    const m = model();
    const first = seriesOf(m);
    expect(seriesOf(m)).toBe(first);
    expect(seriesOf(m, 'other')).not.toBe(first);
    expect(seriesOf(model())).not.toBe(first);
  });
  it('leaves a null gap out of the values and the times', () => {
    const series = seriesOf(model());
    expect(series.values).toEqual([1, 3, 4]);
    expect(series.times).toEqual([1000, 3000, 4000]);
    expect(series).toMatchObject({ refId: 'T', name: 'Value', labels: { job: 'a' } });
    expect(series.frame.length).toBe(4);
  });
});
