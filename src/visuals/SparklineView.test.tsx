import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createTheme, FieldType, getDefaultTimeRange, ThemeContext } from '@grafana/data';
import { SparklineView } from './SparklineView';
import { BarGaugeView } from './BarGaugeView';
import type { HistoryModel } from '../query/frames';

const { sparkline, bar } = vi.hoisted(() => ({
  sparkline: vi.fn((_props: any) => <canvas data-testid="grafana-sparkline" />),
  bar: vi.fn((_props: any) => <div data-testid="grafana-bar" />),
}));
vi.mock('@grafana/ui', () => ({
  Sparkline: sparkline,
  BarGauge: bar,
  useTheme2: () => React.useContext(ThemeContext),
}));
export const history = (): HistoryModel => ({
  state: 'ready',
  field: { name: 'load', type: FieldType.number, config: {}, values: [10, null, 30] },
  timeField: { name: 'Time', type: FieldType.time, config: {}, values: [1000, 2000, 3000] },
  timestamps: [1000, 2000, 3000],
  values: [10, null, 30],
  latestValue: 30,
  latestDisplayValue: { text: '30', numeric: 30, suffix: '%' },
  sampleAt: 3000,
  fetchedAt: 4000,
  fromCache: false,
});
describe('SparklineView', () => {
  it.each(['light', 'dark'] as const)('passes the %s Grafana theme to the public visual', (mode) => {
    const theme = createTheme({ colors: { mode } });
    render(
      <ThemeContext.Provider value={theme}>
        <SparklineView model={history()} width={180} height={70} timeRange={getDefaultTimeRange()} label="CPU" />
      </ThemeContext.Provider>
    );
    expect(sparkline.mock.calls.at(-1)![0].theme).toBe(theme);
  });
  it('preserves null gaps, prepared range, formatting and dashboard range at the public Grafana boundary', () => {
    const timeRange = getDefaultTimeRange();
    render(<SparklineView model={history()} width={180} height={70} timeRange={timeRange} label="CPU" />);
    expect(screen.getByText('30%')).toBeTruthy();
    const props = sparkline.mock.calls.at(-1)![0] as any;
    expect(props.sparkline.y.values).toEqual([10, null, 30]);
    expect(props.sparkline.y.state.range).toEqual({ min: 10, max: 30, delta: 20 });
    expect(props.sparkline.timeRange).toBe(timeRange);
    expect(props.config.custom.spanNulls).toBe(false);
    expect(props.config.custom.lineWidth).toBe(2);
  });
  it('preserves gaps even when the source field config specifies a numeric no-value replacement', () => {
    const model = history();
    if (model.state !== 'ready') {
      throw new Error();
    }
    model.field.config.noValue = '0';
    render(<SparklineView model={model} width={180} height={70} timeRange={getDefaultTimeRange()} label="CPU" />);
    expect(sparkline.mock.calls.at(-1)![0].config.noValue).toBeUndefined();
  });
  it('shows a sample as stale only after its configured deadline while it stays open', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(4000);
      const { unmount } = render(
        <SparklineView
          model={history()}
          width={180}
          height={70}
          timeRange={getDefaultTimeRange()}
          label="CPU"
          freshness={{ expectedIntervalMs: 1000, staleAfterMs: 5000 }}
        />
      );
      expect(screen.queryByText('Stale data')).toBeNull();
      act(() => vi.advanceTimersByTime(4000));
      expect(screen.queryByText('Stale data')).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByText('Stale data')).toBeTruthy();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    [{ state: 'loading' }, 'Loading…'],
    [{ state: 'empty', fetchedAt: 1, fromCache: false }, 'No data'],
    [{ state: 'error', message: 'Query failed' }, 'Query failed'],
    [{ state: 'unsupported', message: 'Select a numeric field' }, 'Select a numeric field'],
  ] as const)('explains %j locally', (model, text) => {
    render(<SparklineView model={model} width={180} height={70} timeRange={getDefaultTimeRange()} label="CPU" />);
    expect(screen.getByRole('status').textContent).toContain(text);
    expect(screen.queryByTestId('grafana-sparkline')).toBeNull();
  });
  it('shows a single value and explicit stale state without inventing a trend', () => {
    const model = history();
    if (model.state !== 'ready') {
      throw new Error();
    }
    model.values = [30];
    render(<SparklineView model={model} width={180} height={70} timeRange={getDefaultTimeRange()} label="CPU" stale />);
    expect(screen.getByText('One sample')).toBeTruthy();
    expect(screen.getByText('Stale data')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
    expect(screen.queryByTestId('grafana-sparkline')).toBeNull();
  });
  it('uses explicit sample freshness even with a fresh cache and a recent fetch', () => {
    const model = history();
    if (model.state !== 'ready') {
      throw new Error();
    }
    model.fetchedAt = Date.now();
    model.fromCache = true;
    const { rerender } = render(
      <SparklineView
        model={model}
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
        freshness={{ expectedIntervalMs: 1000, staleAfterMs: 5000 }}
      />
    );
    expect(screen.getByText('Stale data')).toBeTruthy();
    rerender(<SparklineView model={model} width={180} height={70} timeRange={getDefaultTimeRange()} label="CPU" />);
    expect(screen.queryByText('Stale data')).toBeNull();
  });
  it('uses a numeric fallback without meaningful bounds, then uses the public BarGauge with configured bounds', () => {
    const value = { text: '30', numeric: 30, suffix: ' Mb/s' };
    const { rerender } = render(<BarGaugeView value={value} field={{}} width={180} height={70} />);
    expect(screen.getByText('30 Mb/s')).toBeTruthy();
    expect(screen.getByText(/Set a meaningful/)).toBeTruthy();
    expect(screen.queryByTestId('grafana-bar')).toBeNull();
    rerender(<BarGaugeView value={value} field={{ min: 0, max: 100 }} width={180} height={70} />);
    expect(screen.getByTestId('grafana-bar')).toBeTruthy();
    expect(bar.mock.calls.at(-1)![0].field).toMatchObject({ min: 0, max: 100 });
  });
});
