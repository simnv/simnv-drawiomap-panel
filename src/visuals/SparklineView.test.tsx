import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createTheme, getDefaultTimeRange, ThemeContext } from '@grafana/data';
import { SparklineView, type ChartLine } from './SparklineView';
import { BarGaugeView } from './BarGaugeView';
import { LINE_HEIGHT, MIN_PLOT_HEIGHT, plotHeightOf } from './StaleHint';

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
  it.each([true, false])(
    'keeps the plot, the value line and the stale hint inside the box (value shown: %s)',
    (showValue) => {
      sparkline.mockClear();
      render(
        <SparklineView
          chart={{ lines: [line([1, 2, 3])], domain: [0, 100] }}
          value="3%"
          width={180}
          height={70}
          timeRange={getDefaultTimeRange()}
          label="CPU"
          showValue={showValue}
          stale
        />
      );
      const hint = screen.getByText('Stale data');
      const hintH = parseFloat(hint.style.height);
      expect(hintH).toBeGreaterThan(0);
      const valueH = showValue ? LINE_HEIGHT : 0;
      expect(lastProps().height + valueH + hintH).toBeLessThanOrEqual(70);
      expect(hint.getAttribute('role')).toBe('status');
    }
  );
  it('gives the whole box to the plot of a fresh row without the value line', () => {
    sparkline.mockClear();
    render(
      <SparklineView
        chart={{ lines: [line([1, 2, 3])], domain: [0, 100] }}
        width={180}
        height={70}
        timeRange={getDefaultTimeRange()}
        label="CPU"
        showValue={false}
      />
    );
    expect(lastProps().height).toBe(70);
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

describe('the text lines and the compact rule of a chart box', () => {
  const view = (height: number, over: Partial<React.ComponentProps<typeof SparklineView>> = {}) =>
    render(
      <SparklineView
        chart={{ lines: [line([1, 2, 3])], domain: [0, 100] }}
        value="3%"
        width={60}
        height={height}
        timeRange={getDefaultTimeRange()}
        label="A very long title of a chart that does not fit its narrow region"
        {...over}
      />
    );
  it('keeps a long title on one line of the fixed height, with the full text in its title attribute', () => {
    sparkline.mockClear();
    const { container } = view(70, { stale: true });
    const title = container.querySelector<HTMLElement>('[title^="A very long title"]')!;
    expect(title.style.whiteSpace).toBe('nowrap');
    expect(title.style.textOverflow).toBe('ellipsis');
    expect(title.style.overflow).toBe('hidden');
    expect(parseFloat(title.style.height)).toBe(LINE_HEIGHT);
    expect(title.title).toContain('3%');
    const hint = screen.getByText('Stale data');
    expect(lastProps().height + parseFloat(title.style.height) + parseFloat(hint.style.height)).toBeLessThanOrEqual(70);
  });
  it.each([
    // value line and stale hint: two lines
    [44 + MIN_PLOT_HEIGHT, true, MIN_PLOT_HEIGHT],
    [44 + MIN_PLOT_HEIGHT - 1, false, null],
    [44 + MIN_PLOT_HEIGHT + 1, true, MIN_PLOT_HEIGHT + 1],
    [44, false, null],
    [30, false, null],
    [1, false, null],
  ])('with the value line and the hint: height %i draws a plot: %s', (height, drawn, plot) => {
    sparkline.mockClear();
    view(height, { stale: true });
    expect(screen.getByText('Stale data')).toBeTruthy();
    expect(sparkline.mock.calls.length > 0).toBe(drawn);
    if (drawn) {
      expect(lastProps().height).toBe(plot);
    }
  });
  it.each([
    [LINE_HEIGHT + MIN_PLOT_HEIGHT, true],
    [LINE_HEIGHT + MIN_PLOT_HEIGHT - 1, false],
  ])('with the value line only: height %i draws a plot: %s', (height, drawn) => {
    sparkline.mockClear();
    view(height);
    expect(sparkline.mock.calls.length > 0).toBe(drawn);
    expect(screen.getByText('3%')).toBeTruthy();
  });
  it('never gives a plot more than the room left in the box', () => {
    expect(plotHeightOf(70, 2)).toBe(26);
    expect(plotHeightOf(70, 0)).toBe(70);
    expect(plotHeightOf(10, 0)).toBeNull();
    expect(plotHeightOf(44, 2)).toBeNull();
  });
  it('shows the stale hint and the value of a bar gauge too small for a bar, and no bar', () => {
    bar.mockClear();
    const value = { text: '42', numeric: 42 } as any;
    render(<BarGaugeView value={value} field={{ min: 0, max: 100 }} width={180} height={LINE_HEIGHT + 5} stale />);
    expect(bar).not.toHaveBeenCalled();
    expect(screen.getByText('Stale data')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });
  it('gives a bar gauge at the threshold its room after the hint', () => {
    bar.mockClear();
    const value = { text: '42', numeric: 42 } as any;
    render(
      <BarGaugeView
        value={value}
        field={{ min: 0, max: 100 }}
        width={180}
        height={LINE_HEIGHT + MIN_PLOT_HEIGHT}
        stale
      />
    );
    expect((bar.mock.calls.at(-1)![0] as any).height).toBe(MIN_PLOT_HEIGHT);
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
