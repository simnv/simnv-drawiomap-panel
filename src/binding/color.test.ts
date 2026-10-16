import { describe, expect, it } from 'vitest';
import { createTheme, DisplayValue, ThresholdsMode } from '@grafana/data';
import { colorFor, DEFAULT_PERCENT_STEPS, noDataColor, widthFor } from './color';

const theme = createTheme();
const rule = {
  mode: 'percent' as const,
  steps: [
    [0, 'green'],
    [60, 'yellow'],
    [85, 'red'],
  ] as Array<[number, string]>,
};
const field = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'blue' },
    { value: 50, color: 'orange' },
  ],
};
const display: DisplayValue = { text: '99', numeric: 99, color: '#abcdef' };
/** What Grafana puts in a new panel: base green, red at 80, absolute. */
const grafanaDefault = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: null as unknown as number, color: 'green' },
    { value: 80, color: 'red' },
  ],
};

describe('colorFor', () => {
  it('uses rule percent steps', () => {
    expect(colorFor(41e6, 41, rule, display, field, theme)).toEqual({
      color: theme.visualization.getColorByName('green'),
      stepIndex: 0,
    });
    expect(colorFor(90e6, 90, rule, display, field, theme).stepIndex).toBe(2);
    expect(colorFor(60e6, 60, rule, display, field, theme).stepIndex).toBe(1);
  });
  it('uses the default percent steps when a capacity exists and the rule has no thresholds', () => {
    expect(DEFAULT_PERCENT_STEPS).toEqual([
      [0, 'green'],
      [60, 'yellow'],
      [85, 'red'],
    ]);
    expect(colorFor(1, 70, undefined, display, grafanaDefault, theme)).toEqual({
      color: theme.visualization.getColorByName('yellow'),
      stepIndex: 1,
    });
    expect(colorFor(1, 90, undefined, display, undefined, theme).stepIndex).toBe(2);
  });
  it('finding 4: changed absolute field thresholds apply to the utilisation percent', () => {
    expect(colorFor(1, 70, undefined, display, field, theme)).toEqual({
      color: theme.visualization.getColorByName('orange'),
      stepIndex: 1,
    });
    expect(colorFor(1, 40, undefined, display, field, theme).stepIndex).toBe(0);
  });
  it('finding 4: percentage-mode field thresholds apply to the utilisation percent', () => {
    const pct = { ...grafanaDefault, mode: ThresholdsMode.Percentage };
    expect(colorFor(1, 85, undefined, display, pct, theme)).toEqual({
      color: theme.visualization.getColorByName('red'),
      stepIndex: 1,
    });
  });
  it('finding 4: rule thresholds still win over field thresholds', () => {
    expect(colorFor(1, 70, rule, display, field, theme).stepIndex).toBe(1);
    expect(colorFor(1, 70, rule, display, field, theme).color).toBe(theme.visualization.getColorByName('yellow'));
  });
  it('uses the field display colour and the field thresholds index without a capacity', () => {
    expect(colorFor(99, undefined, undefined, display, field, theme)).toEqual({ color: '#abcdef', stepIndex: 1 });
    expect(colorFor(10, undefined, undefined, display, field, theme).stepIndex).toBe(0);
  });
  it('falls back to theme green when there is no display colour', () => {
    expect(colorFor(10, undefined, undefined, undefined, undefined, theme)).toEqual({
      color: theme.visualization.getColorByName('green'),
      stepIndex: 0,
    });
  });
  it('absolute rule steps ignore percent', () => {
    const abs = {
      mode: 'absolute' as const,
      steps: [
        [0, 'red'],
        [1, 'green'],
      ] as Array<[number, string]>,
    };
    expect(colorFor(0, 500, abs, display, field, theme).stepIndex).toBe(0);
    expect(colorFor(1, undefined, abs, display, field, theme).stepIndex).toBe(1);
  });
  it('grey with stepIndex -1 when the value is missing', () => {
    expect(colorFor(undefined, undefined, rule, display, field, theme)).toEqual({
      color: noDataColor(theme),
      stepIndex: -1,
    });
  });
  it('accepts hex colours in rule steps', () => {
    expect(colorFor(5, 5, { mode: 'percent', steps: [[0, '#123456']] }, undefined, undefined, theme).color).toBe(
      '#123456'
    );
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
