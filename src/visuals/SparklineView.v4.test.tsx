import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createTheme, dateTime, FieldColorModeId, getDefaultTimeRange, ThemeContext } from '@grafana/data';
import { SparklineView, type ChartLine } from './SparklineView';
import { Card } from '../interact/Card';
import type { CardModelV4, HistoryRowV4 } from '../interact/cardModel';

const { sparkline } = vi.hoisted(() => ({
  sparkline: vi.fn((_props: any) => <canvas data-testid="grafana-sparkline" />),
}));
vi.mock('@grafana/ui', () => ({
  Sparkline: sparkline,
  useTheme2: () => React.useContext(ThemeContext),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  IconButton: (props: any) => <button {...props} />,
  LinkButton: (props: any) => <a {...props} />,
  Portal: (props: any) => <div>{props.children}</div>,
  SeriesTable: (props: any) => (
    <div data-testid="series-table">{props.series.map((r: any) => `${r.label}=${r.value}`).join(';')}</div>
  ),
}));

const line = (label: string, color: string, values: Array<number | null>): ChartLine => ({
  label,
  color,
  times: values.map((_, i) => 1000 + i * 1000),
  values,
  noData: !values.some((v) => v !== null),
});
const calls = () => sparkline.mock.calls.map((c) => c[0] as any);

describe('SparklineView: N lines in one chart', () => {
  it('draws each line with its colour in the one shared range', () => {
    sparkline.mockClear();
    const lines = [line('a', '#111111', [49, 49]), line('b', '#222222', [51, 51])];
    render(
      <SparklineView
        chart={{ lines, domain: [0, 51] }}
        width={180}
        height={40}
        timeRange={getDefaultTimeRange()}
        label="L"
      />
    );
    expect(screen.getAllByTestId('grafana-sparkline')).toHaveLength(2);
    const props = calls();
    expect(props.map((p) => p.sparkline.y.state.range)).toEqual([
      { min: 0, max: 51, delta: 51 },
      { min: 0, max: 51, delta: 51 },
    ]);
    expect(props.map((p) => [p.config.min, p.config.max])).toEqual([
      [0, 51],
      [0, 51],
    ]);
    expect(props.map((p) => p.config.color)).toEqual([
      { mode: FieldColorModeId.Fixed, fixedColor: '#111111' },
      { mode: FieldColorModeId.Fixed, fixedColor: '#222222' },
    ]);
    expect(props.map((p) => p.sparkline.y.values)).toEqual([
      [49, 49],
      [51, 51],
    ]);
    // no fill under N lines: a fill would hide the lines below it
    expect(props.map((p) => p.config.custom.fillOpacity)).toEqual([0, 0]);
    expect(props.every((p) => p.config.custom.spanNulls === false && p.config.noValue === undefined)).toBe(true);
  });

  it('keeps the fill of a single line, as the v3 sparkline has it', () => {
    sparkline.mockClear();
    render(
      <SparklineView
        chart={{ lines: [line('a', '#111111', [1, 2])], domain: [0, 2] }}
        width={180}
        height={40}
        timeRange={getDefaultTimeRange()}
        label="L"
      />
    );
    expect(calls()[0].config.custom.fillOpacity).toBe(15);
  });

  it('a line with no data keeps its slot: it draws nothing and the other lines keep their colours', () => {
    sparkline.mockClear();
    const lines = [line('a', '#111111', [1, 2]), line('b', '#222222', [null, null]), line('c', '#333333', [3, 4])];
    render(
      <SparklineView
        chart={{ lines, domain: [0, 4] }}
        width={180}
        height={40}
        timeRange={getDefaultTimeRange()}
        label="L"
      />
    );
    expect(calls().map((p) => p.config.color.fixedColor)).toEqual(['#111111', '#333333']);
  });

  it('says "One sample" when no line has two values, and "No data" when no line has a value', () => {
    const { rerender } = render(
      <SparklineView
        chart={{ lines: [line('a', '#111111', [1])], domain: [0, 1] }}
        width={180}
        height={40}
        timeRange={getDefaultTimeRange()}
        label="L"
      />
    );
    expect(screen.getByText('One sample')).toBeTruthy();
    rerender(
      <SparklineView
        chart={{ lines: [line('a', '#111111', [null])], domain: [0, 1] }}
        width={180}
        height={40}
        timeRange={getDefaultTimeRange()}
        label="L"
      />
    );
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('shows the stale state that the card gives', () => {
    render(
      <SparklineView
        chart={{ lines: [line('a', '#111111', [1, 2])], domain: [0, 2] }}
        width={180}
        height={40}
        timeRange={getDefaultTimeRange()}
        label="L"
        stale
      />
    );
    expect(screen.getByText('Stale data')).toBeTruthy();
  });
});

describe('Card: a history row with N lines', () => {
  const row = (over: Partial<HistoryRowV4> = {}): HistoryRowV4 => ({
    key: 'r0',
    kind: 'history',
    title: 'Clients',
    text: '',
    state: 'ready',
    lines: [line('s0', '#111111', [1, 2]), line('s1', '#222222', [3, 4])],
    more: 1,
    domain: [0, 4],
    stale: false,
    format: (v) => `${v} clients`,
    ...over,
  });
  const cardOf = (r: HistoryRowV4): CardModelV4 => ({ title: 'AP 1', rows: [r], links: [] });

  it('draws the lines of the row and "+N more"', () => {
    sparkline.mockClear();
    render(<Card model={cardOf(row())} pinned={false} x={0} y={0} width={800} height={600} />);
    expect(screen.getAllByTestId('grafana-sparkline')).toHaveLength(2);
    expect(screen.getByText('+1 more')).toBeTruthy();
  });

  it('lists each drawn line in the pinned tooltip, with the format of the row', () => {
    render(
      <Card
        model={cardOf(row())}
        pinned
        x={0}
        y={0}
        width={800}
        height={600}
        timeRange={{ from: dateTime(1000), to: dateTime(2000), raw: { from: dateTime(1000), to: dateTime(2000) } }}
      />
    );
    const hover = screen.getByTestId('dmap-chart-hover');
    hover.getBoundingClientRect = () =>
      ({ left: 0, width: 100, top: 0, height: 40, right: 100, bottom: 40 }) as DOMRect;
    // the hover updates on an animation frame: run it at once
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    fireEvent.pointerMove(hover, { clientX: 100, clientY: 5, pointerType: 'mouse' });
    vi.unstubAllGlobals();
    expect(screen.getByTestId('series-table').textContent).toBe('s0=2 clients;s1=4 clients');
  });

  it('shows "Stale data" for a stale row, and turns stale at the deadline with no new data', () => {
    const { unmount } = render(<Card model={cardOf(row({ stale: true }))} pinned={false} width={800} height={600} />);
    expect(screen.getByText('Stale data')).toBeTruthy();
    unmount();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(4000);
      const later = render(<Card model={cardOf(row({ staleAfter: 5000 }))} pinned={false} width={800} height={600} />);
      expect(screen.queryByText('Stale data')).toBeNull();
      act(() => vi.advanceTimersByTime(1001));
      expect(screen.getByText('Stale data')).toBeTruthy();
      later.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
