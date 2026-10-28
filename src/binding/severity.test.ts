import { createTheme } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { severityOf } from './severity';

const themes = [
  ['dark', createTheme({ colors: { mode: 'dark' } })],
  ['light', createTheme({ colors: { mode: 'light' } })],
] as const;

const HUE_SEVERITY = {
  red: 'critical',
  orange: 'warning',
  yellow: 'warning',
  green: 'normal',
  blue: 'normal',
  purple: 'normal',
} as const;

describe.each(themes)('severityOf, %s theme', (_, theme) => {
  it('gives each named shade of the palette the severity of its hue', () => {
    for (const hue of theme.visualization.hues) {
      for (const shade of hue.shades) {
        const expected = HUE_SEVERITY[hue.name];
        expect([shade.name, severityOf({ text: '1', color: shade.name }, theme)]).toEqual([shade.name, expected]);
        // the display processor gives the resolved colour: the hex of the shade gives the same severity
        expect([shade.color, severityOf({ text: '1', color: shade.color }, theme)]).toEqual([shade.color, expected]);
        expect(severityOf({ text: '1', color: shade.color.toLowerCase() }, theme)).toBe(expected);
      }
    }
  });
  it.each([
    ['#ff0000', 'critical'],
    ['#d00000', 'critical'],
    ['rgb(230, 40, 60)', 'critical'],
    ['#ffa500', 'warning'],
    ['#ffff00', 'warning'],
    ['#00ff00', 'normal'],
    ['#0000ff', 'normal'],
    ['#73bf69', 'normal'],
    ['blue', 'normal'],
  ] as const)('maps the colour %s to the nearest named hue: %s', (color, severity) => {
    expect(severityOf({ text: '1', color }, theme)).toBe(severity);
  });
  it('gives normal to transparent and to a colour that does not parse', () => {
    expect(severityOf({ text: 'up', color: 'transparent' }, theme)).toBe('normal');
    expect(severityOf({ text: 'up', color: theme.visualization.getColorByName('transparent') }, theme)).toBe('normal');
    expect(severityOf({ text: 'up', color: 'var(--x)' }, theme)).toBe('normal');
    expect(severityOf({ text: 'up', color: '' }, theme)).toBe('normal');
  });
});

describe('severityOf, the text', () => {
  const theme = createTheme();
  it.each(['down', 'Down', 'DOWN'])('gives down for the mapping text %s, whatever the colour', (text) => {
    expect(severityOf({ text, color: 'green' }, theme)).toBe('down');
    expect(severityOf({ text, color: 'transparent' }, theme)).toBe('down');
  });
  it('reads only the text "down": other texts take the colour', () => {
    expect(severityOf({ text: 'Down link', color: 'green' }, theme)).toBe('normal');
    expect(severityOf({ text: 'Offline', color: 'red' }, theme)).toBe('critical');
  });
});
