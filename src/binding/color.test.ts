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
import { alphaOf, colorFor, linkStatusPaint, noDataColor, statusColor, statusPaint, tintFill, widthFor } from './color';
import type { StatusView } from './status';

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

describe('status colours', () => {
  const view = (state: StatusView['state']): StatusView => ({
    state,
    reason: 'r',
    queryIds: [],
    conditionKey: 'k',
    coverage: { available: 1, expected: 1 },
  });
  it('takes the palette red and orange of the theme, and the no-data grey for missing', () => {
    for (const t of [createTheme({ colors: { mode: 'light' } }), createTheme({ colors: { mode: 'dark' } })]) {
      const red = t.visualization.getColorByName('red');
      const orange = t.visualization.getColorByName('orange');
      expect(statusColor(view('down'), t)).toBe(red);
      expect(statusColor(view('critical'), t)).toBe(red);
      expect(statusColor(view('warning'), t)).toBe(orange);
      expect(statusColor(view('stale'), t)).toBe(orange);
      expect(statusColor(view('missing'), t)).toBe(noDataColor(t));
    }
    expect(statusColor(view('down'), createTheme({ colors: { mode: 'light' } }))).not.toBe(
      statusColor(view('down'), createTheme({ colors: { mode: 'dark' } }))
    );
  });
  it('statusPaint is a colour for a state that is not normal, else undefined', () => {
    expect(statusPaint(view('down'), theme)).toBe(named('red'));
    expect(statusPaint(view('missing'), theme)).toBe(noDataColor(theme));
    expect(statusPaint(view('normal'), theme)).toBeUndefined();
    expect(statusPaint(undefined, theme)).toBeUndefined();
  });
  it('linkStatusPaint leaves the halves alone for missing, and paints a link without halves grey', () => {
    const halves = { link: { a2b: { status: 'ok', color: '#0f0', width: 2, stepIndex: 0, label: '1' } } } as const;
    expect(linkStatusPaint({ ...halves, statusView: view('missing') }, theme)).toBeUndefined();
    expect(linkStatusPaint({ ...halves, statusView: view('down') }, theme)).toBe(named('red'));
    expect(linkStatusPaint({ statusView: view('missing') }, theme)).toBe(noDataColor(theme));
    expect(linkStatusPaint({ link: {}, statusView: view('missing') }, theme)).toBe(noDataColor(theme));
    expect(linkStatusPaint({ ...halves, statusView: view('normal') }, theme)).toBeUndefined();
    expect(linkStatusPaint({ ...halves }, theme)).toBeUndefined();
  });
});

describe('tintFill', () => {
  it('mixes a fifth of the status colour into an opaque fill', () => {
    // 213 + (255 - 213) * 0.2 = 221.4; 232 * 0.8 = 185.6; 212 * 0.8 = 169.6
    expect(tintFill('rgb(213, 232, 212)', '#ff0000')).toBe('rgb(221, 186, 170)');
    expect(tintFill('#d5e8d4', 'rgb(255, 0, 0)')).toBe('rgb(221, 186, 170)');
    expect(tintFill('#fff', '#000')).toBe('rgb(204, 204, 204)');
  });
  it('a status colour with an alpha mixes by ratio times alpha', () => {
    // 0.2 * 0.5 = 0.1: 255 - 255 * 0.1 = 229.5
    expect(tintFill('#ffffff', 'rgba(0, 0, 0, 0.5)')).toBe('rgb(230, 230, 230)');
  });
  it('gives nothing for a fill that is not an opaque colour, or a status colour that does not parse', () => {
    const fills = ['none', 'url(#g)', 'rgba(1, 2, 3, 0.5)', 'currentColor', 'transparent', '', 'light-dark(#fff, #000)'];
    for (const fill of fills) {
      expect(tintFill(fill, '#f00'), fill).toBeUndefined();
    }
    expect(tintFill('#ffffff', 'currentColor')).toBeUndefined();
  });
});

describe('alphaOf', () => {
  it.each([
    ['none', 0],
    ['transparent', 0],
    ['rgb(255, 0, 0)', 1],
    ['rgb(255 0 0)', 1],
    ['rgba(255, 0, 0, 0)', 0],
    ['rgba(255, 0, 0, 0.5)', 0.5],
    ['rgb(255 0 0 / 0)', 0],
    ['rgb(255 0 0 / 0%)', 0],
    ['rgb(255 0 0 / 50%)', 0.5],
    ['rgb(255 0 0 / none)', 0],
    ['hsl(120, 100%, 50%)', 1],
    ['hsla(120, 100%, 50%, 0)', 0],
    ['hsl(120 100% 50% / 0)', 0],
    ['hsl(120 100% 50% / 1)', 1],
    ['#f00', 1],
    ['#ff0000', 1],
    ['#f000', 0],
    ['#ff000000', 0],
    ['#ff0000ff', 1],
    ['red', 1],
    ['url(#grad)', 1],
    ['', 1],
    ['RGBA(255, 0, 0, 0.5)', 0.5],
    ['var(--fill)', 1],
    ['var(--fill, rgba(0, 0, 0, 0))', 1],
    ['light-dark(#fff, #000)', 1],
    ['light-dark(rgba(0, 0, 0, 0), white)', 1],
  ])('reads the alpha of %s as %s', (value, alpha) => {
    expect(alphaOf(value)).toBeCloseTo(alpha, 5);
  });
});
