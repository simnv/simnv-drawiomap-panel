import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createTheme, getDefaultTimeRange, ThemeContext } from '@grafana/data';
import { SparklineView, type ChartLine } from './SparklineView';
import { BarGaugeView } from './BarGaugeView';

const { sparkline, bar } = vi.hoisted(() => ({
  sparkline: vi.fn((_props: any) => <canvas data-testid="grafana-sparkline" />),
  bar: vi.fn((_props: any) => <div data-testid="grafana-bar" />),
}));
vi.mock('@grafana/ui', () => ({
  Sparkline: sparkline,
  BarGauge: bar,
  useTheme2: () => React.useContext(ThemeContext),
}));

const line = (values: Array<number | null>, color = '#111111'): ChartLine => ({
  label: 'load',
  color,
  times: values.map((_, i) => 1000 + i * 1000),
  values,
  noData: !values.some((v) => v !== null),
});
const lastProps = () => sparkline.mock.calls.at(-1)![0] as any;

describe('SparklineView', () => {
  it('uses the domain of the chart for the range, not the min and max of the field config', () => {
    render(
      <SparklineView
        chart={{ lines: [line([10, 30])], domain: [0, 30] }}
        config={{ min: 5, max: 60 }}
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
      />
    );
    expect(lastProps().sparkline.y.state.range).toEqual({ min: 0, max: 30, delta: 30 });
    expect(lastProps().config).toMatchObject({ min: 0, max: 30 });
  });
  it.each(['light', 'dark'] as const)('passes the %s Grafana theme to the public visual', (mode) => {
    const theme = createTheme({ colors: { mode } });
    render(
      <ThemeContext.Provider value={theme}>
        <SparklineView
          chart={{ lines: [line([10, 30])], domain: [0, 30] }}
          width={180}
          height={70}
          timeRange={getDefaultTimeRange()}
          label="CPU"
        />
      </ThemeContext.Provider>
    );
    expect(lastProps().theme).toBe(theme);
  });
  it('keeps null gaps, the dashboard range and the value text at the public Grafana boundary', () => {
    const timeRange = getDefaultTimeRange();
    render(
      <SparklineView
        chart={{ lines: [line([10, null, 30])], domain: [0, 30] }}
        value="30%"
        width={180}
        height={70}
        timeRange={timeRange}
        label="CPU"
      />
    );
    expect(screen.getByText('30%')).toBeTruthy();
    expect(lastProps().sparkline.y.values).toEqual([10, null, 30]);
    expect(lastProps().sparkline.timeRange).toBe(timeRange);
    expect(lastProps().config.custom.spanNulls).toBe(false);
    expect(lastProps().config.custom.lineWidth).toBe(2);
  });
  it('hides the value text when showValue is off', () => {
    render(
      <SparklineView
        chart={{ lines: [line([10, 30])], domain: [0, 30] }}
        value="30%"
        showValue={false}
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
      />
    );
    expect(screen.queryByText('30%')).toBeNull();
  });
  it('keeps the gaps when the field config has a numeric no-value replacement', () => {
    render(
      <SparklineView
        chart={{ lines: [line([10, null, 30])], domain: [0, 30] }}
        config={{ noValue: '0', unit: 'percent' }}
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
      />
    );
    expect(lastProps().config.noValue).toBeUndefined();
    expect(lastProps().config.unit).toBe('percent');
  });
  it('shows the message of the chart in place of a chart', () => {
    sparkline.mockClear();
    render(
      <SparklineView
        chart={{ message: 'Select a numeric field' }}
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
      />
    );
    expect(screen.getByRole('status').textContent).toContain('Select a numeric field');
    expect(sparkline).not.toHaveBeenCalled();
    expect(screen.queryByTestId('grafana-sparkline')).toBeNull();
  });
  it('shows one sample and the stale state without a trend line', () => {
    sparkline.mockClear();
    render(
      <SparklineView
        chart={{ lines: [line([30])], domain: [0, 30] }}
        value="30%"
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
        stale
      />
    );
    expect(screen.getByText('One sample')).toBeTruthy();
    expect(screen.getByText('Stale data')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
    expect(sparkline).not.toHaveBeenCalled();
  });
});

describe('BarGaugeView', () => {
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
  it('shows the stale hint only when the chart is stale', () => {
    const value = { text: '30', numeric: 30 };
    const { rerender } = render(<BarGaugeView value={value} field={{ min: 0, max: 100 }} width={180} height={70} />);
    expect(screen.queryByText('Stale data')).toBeNull();
    rerender(<BarGaugeView value={value} field={{ min: 0, max: 100 }} width={180} height={70} stale />);
    expect(screen.getByText('Stale data')).toBeTruthy();
  });
});
