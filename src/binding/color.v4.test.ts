import { createTheme } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { linkStatusPaint, noDataColor, statusColor, statusPaint, statusPaintV4 } from './color';
import type { StatusV4 } from './statusV4';

const themes = [
  ['dark', createTheme({ colors: { mode: 'dark' } })],
  ['light', createTheme({ colors: { mode: 'light' } })],
] as const;

const status = (over: Partial<StatusV4>): StatusV4 => ({ state: 'normal', severity: 'normal', refId: 'up', ...over });

describe.each(themes)('statusPaintV4, %s theme', (_, theme) => {
  it('paints the exact colour of the value: magenta / Offline paints magenta', () => {
    const magenta = theme.visualization.getColorByName('magenta');
    expect(statusPaintV4(status({ color: magenta, text: 'Offline' }), theme)).toBe(magenta);
  });
  it('paints each value state with its colour, normal included', () => {
    expect(statusPaintV4(status({ color: '#73bf69', text: 'Up' }), theme)).toBe('#73bf69');
    expect(statusPaintV4(status({ state: 'critical', severity: 'critical', color: '#0000ff' }), theme)).toBe('#0000ff');
  });
  it('paints nothing for transparent: the cell keeps its drawn colour', () => {
    for (const color of ['transparent', theme.visualization.getColorByName('transparent'), 'rgba(255, 255, 255, 0)']) {
      expect(statusPaintV4(status({ color, text: 'Up' }), theme)).toBeNull();
    }
  });
  it('keeps the theme colours for missing (grey) and stale (orange)', () => {
    expect(statusPaintV4(status({ state: 'missing', severity: 'missing', text: '–' }), theme)).toBe(noDataColor(theme));
    expect(statusPaintV4(status({ state: 'stale', color: '#73bf69' }), theme)).toBe(
      theme.visualization.getColorByName('orange')
    );
  });
  it('a down with no value colour (missing: down) takes the theme red; a normal with no colour paints nothing', () => {
    expect(statusPaintV4(status({ state: 'down', severity: 'down', text: '–' }), theme)).toBe(
      statusColor({ state: 'down' }, theme)
    );
    expect(statusPaintV4(status({}), theme)).toBeNull();
  });
});

describe('statusPaint and linkStatusPaint read a v4 status', () => {
  const theme = createTheme();
  it('statusPaint paints a v4 status with its colour and keeps the v3 rule for a v3 status', () => {
    expect(statusPaint(status({ color: '#0000ff' }), theme)).toBe('#0000ff');
    expect(statusPaint(status({ color: 'transparent' }), theme)).toBeUndefined();
    expect(statusPaint({ state: 'normal' }, theme)).toBeUndefined();
    expect(statusPaint({ state: 'down' }, theme)).toBe(statusColor({ state: 'down' }, theme));
  });
  it('a missing v4 status on a link with halves paints nothing; on a link with no halves it paints grey', () => {
    const missing = status({ state: 'missing', severity: 'missing', text: '–' });
    const half = { status: 'ok' as const, color: '#00ff00', width: 2, label: '', stepIndex: 0 };
    expect(linkStatusPaint({ link: { a2b: half }, statusView: missing }, theme)).toBeUndefined();
    expect(linkStatusPaint({ statusView: missing }, theme)).toBe(noDataColor(theme));
    expect(linkStatusPaint({ link: { a2b: half }, statusView: status({ color: '#0000ff' }) }, theme)).toBe('#0000ff');
  });
});
