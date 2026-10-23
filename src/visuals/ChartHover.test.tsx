import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTheme, dateTime, FieldType, type TimeRange } from '@grafana/data';
import { ChartHover, formatSample, type HoverSeries } from './ChartHover';
import type { HistoryModel } from '../query/frames';

const counts = vi.hoisted(() => ({ table: 0, container: 0 }));
vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  Portal: ({ children }: any) => <div data-testid="portal">{children}</div>,
  VizTooltipContainer: ({ children }: any) => {
    counts.container++;
    return <div data-testid="container">{children}</div>;
  },
  SeriesTable: ({ timestamp, series }: any) => {
    counts.table++;
    return (
      <div>
        <span data-testid="time">{timestamp}</span>
        {series.map((s: any) => (
          <p key={s.label} data-testid="series" data-color={s.color}>
            {s.label}={s.value}
          </p>
        ))}
      </div>
    );
  },
}));

// a manual animation-frame queue: the hover coalesces pointer events to one update per frame
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrame = () =>
  act(() => {
    const due = [...frames.values()];
    frames = new Map();
    due.forEach((cb) => cb(0));
  });
beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  counts.table = 0;
  counts.container = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

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
  flushFrame();
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
    expect(screen.getByTestId('dmap-chart-crosshair').style.left).toBe('50%');
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

describe('ChartHover cost while scrubbing', () => {
  const box = (el: HTMLElement) => {
    el.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20 }) as DOMRect;
    return el;
  };
  const mount = (child: React.ReactNode = <i />) => {
    render(
      <ChartHover enabled series={series(history([1, 2, 3], 'short'))} timeRange={timeRange}>
        {child}
      </ChartHover>
    );
    return box(screen.getByTestId('dmap-chart-hover'));
  };
  const move = (el: HTMLElement, x: number) =>
    fireEvent.pointerMove(el, { clientX: x, clientY: 5, pointerType: 'mouse' });

  it('50 moves in one frame cause at most one tooltip render, with the last position', () => {
    const el = mount();
    for (let x = 0; x < 50; x++) {
      move(el, x);
    }
    expect(frames.size).toBe(1);
    expect(counts.table).toBe(0);
    flushFrame();
    expect(counts.table).toBeLessThanOrEqual(1);
    expect(screen.getByTestId('series').textContent).toBe('up=2'); // x=49: nearest sample is 50
  });

  it('moves inside the same sample do not render again', () => {
    const el = mount();
    move(el, 40);
    flushFrame();
    const before = counts.table;
    for (let x = 41; x < 60; x++) {
      move(el, x);
      flushFrame();
    }
    expect(counts.table).toBe(before);
    move(el, 90);
    flushFrame();
    expect(counts.table).toBe(before + 1);
    expect(screen.getByTestId('series').textContent).toBe('up=3');
  });

  it('does not render the chart child while scrubbing', () => {
    let renders = 0;
    const Chart = () => {
      renders++;
      return <i />;
    };
    const el = mount(<Chart />);
    expect(renders).toBe(1);
    for (const x of [0, 30, 60, 90, 10]) {
      move(el, x);
      flushFrame();
    }
    expect(renders).toBe(1);
  });

  it('cancels the pending frame on leave and on unmount', () => {
    const el = mount();
    move(el, 10);
    expect(frames.size).toBe(1);
    fireEvent.pointerLeave(el, { pointerType: 'mouse' });
    expect(frames.size).toBe(0);
    move(el, 10);
    expect(frames.size).toBe(1);
    cleanup();
    expect(frames.size).toBe(0);
  });

  it('does not show a tooltip when a frame lands after the pointer left', () => {
    const el = mount();
    move(el, 10);
    fireEvent.pointerLeave(el, { pointerType: 'mouse' });
    flushFrame();
    expect(screen.queryByTestId('dmap-chart-tooltip')).toBeNull();
  });

  it('keyboard updates at once, without a frame', () => {
    const el = mount();
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(screen.getByTestId('series').textContent).toBe('up=3');
    expect(frames.size).toBe(0);
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
