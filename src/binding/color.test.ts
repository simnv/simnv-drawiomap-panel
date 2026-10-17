import { describe, expect, it } from 'vitest';
import {
  createTheme,
  DisplayValue,
  Field,
  FieldColorModeId,
  FieldConfig,
  FieldType,
  getFieldColorMode,
  ThresholdsMode,
} from '@grafana/data';
import { colorFor, noDataColor, widthFor } from './color';

const theme = createTheme();
const named = (c: string) => theme.visualization.getColorByName(c);
const fld = (config: FieldConfig): Field => ({ name: 'Value', type: FieldType.number, values: [], config });
const steps = (mode: ThresholdsMode) => ({
  mode,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 60, color: 'yellow' },
    { value: 85, color: 'red' },
  ],
});
const display: DisplayValue = { text: '99', numeric: 99, color: '#abcdef' };

describe('colorFor with a capacity (percent)', () => {
  it('reads absolute thresholds as percent of the capacity', () => {
    const f = fld({ thresholds: steps(ThresholdsMode.Absolute) });
    // the value is large (bit/s); only the percent counts
    expect(colorFor(7e8, 70, f, display, undefined, theme)).toEqual({ color: named('yellow'), stepIndex: 1 });
    expect(colorFor(9e8, 90, f, display, undefined, theme)).toEqual({ color: named('red'), stepIndex: 2 });
    expect(colorFor(1e8, 10, f, display, undefined, theme)).toEqual({ color: named('green'), stepIndex: 0 });
  });
  it('reads percentage thresholds the same way', () => {
    const f = fld({ thresholds: steps(ThresholdsMode.Percentage) });
    expect(colorFor(7e8, 70, f, display, undefined, theme)).toEqual({ color: named('yellow'), stepIndex: 1 });
  });
  it('uses the panel thresholds when the field has none', () => {
    expect(colorFor(1, 90, fld({}), display, steps(ThresholdsMode.Absolute), theme)).toEqual({
      color: named('red'),
      stepIndex: 2,
    });
  });
  it('maps the percent to 0..1 for a continuous scheme (GrYlRd)', () => {
    const f = fld({
      color: { mode: FieldColorModeId.ContinuousGrYlRd },
      thresholds: steps(ThresholdsMode.Absolute),
    });
    const calc = getFieldColorMode(FieldColorModeId.ContinuousGrYlRd).getCalculator(f, theme);
    expect(colorFor(1, 0, f, display, undefined, theme).color).toBe(calc(0, 0));
    expect(colorFor(1, 50, f, display, undefined, theme).color).toBe(calc(0, 0.5));
    expect(colorFor(1, 100, f, display, undefined, theme).color).toBe(calc(0, 1));
    expect(calc(0, 0)).not.toBe(calc(0, 1));
    // out of range percents clamp
    expect(colorFor(1, 250, f, display, undefined, theme).color).toBe(calc(0, 1));
    expect(colorFor(1, -5, f, display, undefined, theme).color).toBe(calc(0, 0));
    // the step index still follows the thresholds in percent
    expect(colorFor(1, 90, f, display, undefined, theme).stepIndex).toBe(2);
  });
  it('gives a fixed colour for the single colour scheme', () => {
    const f = fld({ color: { mode: FieldColorModeId.Fixed, fixedColor: 'purple' } });
    expect(colorFor(1, 90, f, display, undefined, theme).color).toBe(named('purple'));
  });
});

describe('colorFor without a capacity', () => {
  it('uses the display colour of the raw value', () => {
    const f = fld({ thresholds: steps(ThresholdsMode.Absolute) });
    expect(colorFor(99, undefined, f, display, undefined, theme)).toEqual({ color: '#abcdef', stepIndex: 2 });
    expect(colorFor(10, undefined, f, display, undefined, theme).stepIndex).toBe(0);
  });
  it('takes the step index from the display percent in percentage mode', () => {
    const f = fld({ thresholds: steps(ThresholdsMode.Percentage) });
    expect(colorFor(5, undefined, f, { ...display, percent: 0.7 }, undefined, theme).stepIndex).toBe(1);
  });
  it('without a display colour, uses the active threshold colour', () => {
    expect(colorFor(70, undefined, fld({}), undefined, steps(ThresholdsMode.Absolute), theme)).toEqual({
      color: named('yellow'),
      stepIndex: 1,
    });
  });
  it('grey with stepIndex -1 when the value is missing', () => {
    expect(colorFor(undefined, 50, fld({}), display, undefined, theme)).toEqual({
      color: noDataColor(theme),
      stepIndex: -1,
    });
  });
});

describe('widthFor', () => {
  it('interpolates and clamps', () => {
    expect(widthFor(0, { min: 2, max: 10 })).toBe(2);
    expect(widthFor(50, { min: 2, max: 10 })).toBe(6);
    expect(widthFor(500, { min: 2, max: 10 })).toBe(10);
    expect(widthFor(undefined, { min: 2, max: 10 })).toBe(2);
  });
});
