import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, dateTime, FieldType, type TimeRange } from '@grafana/data';
import { ChartHover, formatSample, type HoverSeries } from './ChartHover';
import type { HistoryModel } from '../query/frames';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  Portal: ({ children }: any) => <div data-testid="portal">{children}</div>,
  VizTooltipContainer: ({ children }: any) => <div data-testid="container">{children}</div>,
  SeriesTable: ({ timestamp, series }: any) => (
    <div>
      <span data-testid="time">{timestamp}</span>
      {series.map((s: any) => (
        <p key={s.label} data-testid="series" data-color={s.color}>
          {s.label}={s.value}
        </p>
      ))}
    </div>
  ),
}));

const timeRange: TimeRange = { from: dateTime(0), to: dateTime(100), raw: { from: dateTime(0), to: dateTime(100) } };
const history = (values: Array<number | null>, unit = 'bps', decimals?: number): HistoryModel => ({
  state: 'ready',
  field: { name: 'v', type: FieldType.number, config: { unit, decimals }, values },
  timeField: { name: 'Time', type: FieldType.time, config: {}, values: [0, 50, 100] },
  timestamps: [0, 50, 100],
  values,
  fetchedAt: 0,
  fromCache: false,
});
const series = (...h: HistoryModel[]): HoverSeries[] =>
  h.map((history, i) => ({ name: i ? 'down' : 'up', color: i ? '#00f' : '#f00', history }));

// the jsdom box has no size: give the wrapper 100 px
const hover = (clientX: number, pointerType = 'mouse') => {
  const el = screen.getByTestId('dmap-chart-hover');
  el.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20 }) as DOMRect;
  fireEvent.pointerMove(el, { clientX, clientY: 5, pointerType });
  return el;
};

describe('ChartHover', () => {
  it('renders only the chart when the card is not pinned', () => {
    render(
      <ChartHover enabled={false} series={series(history([1, 2, 3]))} timeRange={timeRange}>
        <i data-testid="chart" />
      </ChartHover>
    );
    expect(screen.getByTestId('chart')).toBeTruthy();
    expect(screen.queryByTestId('dmap-chart-hover')).toBeNull();
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
  });

  it('shows no tooltip before the pointer is on the chart, then crosshair and values when pinned', () => {
    render(
      <ChartHover enabled series={series(history([1000, 2000, 3000]))} timeRange={timeRange} timeZone="browser">
        <i />
      </ChartHover>
    );
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
    hover(60);
    expect(screen.getByTestId('time').textContent).toMatch(/^19(69-12-31|70-01-01) \d\d:\d\d:\d\d$/);
    expect(screen.getByTestId('series').textContent).toBe('up=2 kb/s');
    expect(screen.getByTestId('dmap-chart-crosshair').style.left).toBe('60%');
    fireEvent.pointerLeave(screen.getByTestId('dmap-chart-hover'), { pointerType: 'mouse' });
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
  });

  it('shows both directions of a combined row in one tooltip, each in its colour', () => {
    render(
      <ChartHover
        enabled
        series={series(history([1, 2, 3], 'short'), history([4, 5, 6], 'short'))}
        timeRange={timeRange}
      >
        <i />
      </ChartHover>
    );
    hover(100);
    const rows = screen.getAllByTestId('series');
    expect(rows.map((r) => r.textContent)).toEqual(['up=3', 'down=6']);
    expect(rows.map((r) => r.getAttribute('data-color'))).toEqual(['#f00', '#00f']);
    expect(screen.getAllByTestId('time')).toHaveLength(1);
  });

  it('shows a dash for a gap', () => {
    render(
      <ChartHover enabled series={series(history([1, null, 3], 'short'))} timeRange={timeRange}>
        <i />
      </ChartHover>
    );
    hover(50);
    expect(screen.getByTestId('series').textContent).toBe('up=–');
  });

  it('shows the tooltip on touch and keeps it after the finger lifts', () => {
    render(
      <ChartHover enabled series={series(history([1, 2, 3], 'short'))} timeRange={timeRange}>
        <i />
      </ChartHover>
    );
    const el = hover(0, 'touch');
    fireEvent.pointerLeave(el, { pointerType: 'touch' });
    expect(screen.getByTestId('series').textContent).toBe('up=1');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
  });

  it('does not stop a click', () => {
    const onClick = vi.fn();
    render(
      <div onClick={onClick}>
        <ChartHover enabled series={series(history([1, 2, 3]))} timeRange={timeRange}>
          <i data-testid="chart" />
        </ChartHover>
      </div>
    );
    fireEvent.click(screen.getByTestId('chart'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ChartHover keyboard, alignment, width', () => {
  const pair = () =>
    series(history([1, 2, 3], 'short'), { ...history([4, 5, 6], 'short'), timestamps: [0, 60, 100] } as HistoryModel);
  it('renders the tooltip in a portal', () => {
    render(
      <ChartHover enabled series={series(history([1, 2, 3], 'short'))} timeRange={timeRange}>
        <i />
      </ChartHover>
    );
    hover(50);
    expect(screen.getByTestId('portal').querySelector('[data-testid="dmap-chart-tooltip"]')).toBeTruthy();
  });
  it('gives the wrapper the width of the chart', () => {
    render(
      <ChartHover enabled series={series(history([1, 2, 3]))} timeRange={timeRange} width={264}>
        <i />
      </ChartHover>
    );
    expect(screen.getByTestId('dmap-chart-hover').style.width).toBe('264px');
  });
  it('shows one time for a combined row and a dash for a series without a sample there', () => {
    render(
      <ChartHover enabled series={pair()} timeRange={timeRange}>
        <i />
      </ChartHover>
    );
    hover(52); // the nearest time is 50 (up only), the down series has 60
    expect(screen.getAllByTestId('series').map((r) => r.textContent)).toEqual(['up=2', 'down=–']);
    hover(58); // 60 is nearest: down only
    expect(screen.getAllByTestId('series').map((r) => r.textContent)).toEqual(['up=–', 'down=5']);
  });
  it('is focusable and the arrow keys move the sample, Escape hides, Enter follows the link', () => {
    const click = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <a href="/x" onClick={click}>
        <ChartHover enabled series={series(history([1, 2, 3], 'short'))} timeRange={timeRange} label="Traffic">
          <i />
        </ChartHover>
      </a>
    );
    const el = screen.getByTestId('dmap-chart-hover');
    el.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20 }) as DOMRect;
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-label')).toContain('Traffic');
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(screen.getByTestId('series').textContent).toBe('up=3');
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(screen.getByTestId('series').textContent).toBe('up=2');
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(screen.getByTestId('series').textContent).toBe('up=3');
    expect(el.getAttribute('data-tooltip-open')).toBe('true');
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('formatSample', () => {
  it('uses the field unit and decimals', () => {
    const h = history([1], 'percent', 1);
    if (h.state !== 'ready') {
      throw new Error('ready');
    }
    expect(formatSample(h.field, 12.345)).toBe('12.3%');
    expect(formatSample(h.field, null)).toBe('–');
    expect(formatSample(h.field, 5, undefined, undefined, (v) => `<${v}>`)).toBe('<5>');
  });
});
