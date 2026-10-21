import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { createTheme, getDefaultTimeRange } from '@grafana/data';
import { expect, it, vi } from 'vitest';
import { Card } from './Card';
import type { CardModel, ConfiguredCardModel } from './cardModel';

const { sparkline } = vi.hoisted(() => ({
  sparkline: vi.fn((_props: any) => <canvas data-testid="grafana-sparkline" />),
}));
vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  IconButton: (props: any) => <button {...props} />,
  LinkButton: (props: any) => <a {...props} />,
  Sparkline: sparkline,
}));
it('renders configured history states through SparklineView and keeps a failure local to its row', () => {
  const model: ConfiguredCardModel = {
    title: 'Router',
    links: [],
    demands: [],
    diagnostics: [],
    rows: [
      { key: 'a', kind: 'history', title: 'CPU', text: 'Loading', state: 'loading', history: { state: 'loading' } },
      { key: 'b', kind: 'value', title: 'Temperature', text: '42 °C', state: 'ready' },
      {
        key: 'c',
        kind: 'history',
        title: 'Disk',
        text: 'Failed',
        state: 'error',
        history: { state: 'error', message: 'Query failed' },
      },
    ],
  };
  render(
    <Card
      model={model}
      pinned={false}
      x={20}
      y={20}
      width={800}
      height={600}
      onClose={() => {}}
      timeRange={getDefaultTimeRange()}
    />
  );
  expect(screen.getByText('Loading…')).toBeTruthy();
  expect(screen.getByText('Query failed')).toBeTruthy();
  expect(screen.getByText('42 °C')).toBeTruthy();
});
it('shows stale scalar rows using sample age and an explicit cadence policy', () => {
  const model: ConfiguredCardModel = {
    title: 'Router',
    links: [],
    demands: [],
    diagnostics: [],
    rows: [
      {
        key: 'a',
        kind: 'value',
        title: 'CPU',
        text: '42%',
        state: 'ready',
        sampleAt: 1000,
        freshness: { expectedIntervalMs: 1000, staleAfterMs: 5000 },
      },
    ],
  };
  render(
    <Card
      model={model}
      pinned={false}
      x={20}
      y={20}
      width={800}
      height={600}
      onClose={() => {}}
      timeRange={getDefaultTimeRange()}
    />
  );
  expect(screen.getByText('Stale data')).toBeTruthy();
  expect(screen.getByText('42%')).toBeTruthy();
});
it('expires a displayed scalar without data updates and cancels its clock when the card closes', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(4000);
    const model: ConfiguredCardModel = {
      title: 'Router',
      links: [],
      demands: [],
      diagnostics: [],
      rows: [
        {
          key: 'value',
          kind: 'value',
          title: 'CPU',
          text: '42%',
          state: 'ready',
          sampleAt: 3000,
          freshness: { expectedIntervalMs: 1000, staleAfterMs: 5000 },
        },
      ],
    };
    const { unmount } = render(
      <Card model={model} pinned={false} x={20} y={20} width={800} height={600} onClose={() => {}} />
    );
    expect(screen.queryByText('Stale data')).toBeNull();
    act(() => vi.advanceTimersByTime(4001));
    expect(screen.getByText('Stale data')).toBeTruthy();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('draws a legacy row sparkline in the Y range of the row (zero baseline, capacity)', () => {
  const model: CardModel = {
    title: 'isp-a ↔ rtr-a',
    links: [],
    rows: [
      {
        key: 'a2b',
        title: 'isp-a → rtr-a',
        text: '41 Mb/s · 41%',
        status: 'ok',
        color: '#0f0',
        values: [40, 41, 41],
        times: [1, 2, 3],
        domain: [0, 100],
      },
    ],
  };
  render(<Card model={model} pinned={false} x={20} y={20} width={800} height={600} onClose={() => {}} />);
  expect(sparkline.mock.calls.at(-1)![0].sparkline.y.state.range).toEqual({ min: 0, max: 100, delta: 100 });
});
it('passes the min and max of a configured row to its sparkline', () => {
  const history = {
    state: 'ready' as const,
    field: { name: 'v', type: 'number' as any, config: {}, values: [40, 41] },
    timeField: { name: 'Time', type: 'time' as any, config: {}, values: [1, 2] },
    timestamps: [1, 2],
    values: [40, 41],
    latestValue: 41,
    fetchedAt: 0,
    fromCache: false,
  };
  const model: ConfiguredCardModel = {
    title: 'Router',
    links: [],
    demands: [],
    diagnostics: [],
    rows: [{ key: 'a', kind: 'history', title: 'Temp', text: '41', state: 'ready', history, min: 'auto' }],
  };
  render(<Card model={model} pinned={false} x={20} y={20} width={800} height={600} onClose={() => {}} />);
  // "auto": no zero baseline, the minimum span is centred on the data
  const { min, max } = sparkline.mock.calls.at(-1)![0].sparkline.y.state.range;
  expect(min).toBeCloseTo(38.45);
  expect(max).toBeCloseTo(42.55);
});
it('renders a combined up/down row: both values with coloured direction labels and one mirrored chart', () => {
  const ready = (values: number[]) => ({
    state: 'ready' as const,
    field: { name: 'v', type: 'number' as any, config: {}, values },
    timeField: { name: 'Time', type: 'time' as any, config: {}, values: values.map((_, i) => i) },
    timestamps: values.map((_, i) => i),
    values,
    latestValue: values.at(-1),
    fetchedAt: 0,
    fromCache: false,
  });
  const model: ConfiguredCardModel = {
    title: 'wan1',
    links: [],
    demands: [],
    diagnostics: [],
    rows: [
      {
        key: 'a',
        kind: 'history',
        title: 'Traffic',
        text: '↑ 8.2 Mb/s  ↓ 1.1 Mb/s',
        state: 'ready',
        href: '/d/traffic',
        domain: [-10, 10],
        directions: [
          {
            direction: 'up',
            label: '↑',
            text: '8.2 Mb/s',
            color: 'rgb(1, 2, 3)',
            mirrored: false,
            history: ready([5, 8]),
          },
          {
            direction: 'down',
            label: '↓',
            text: '1.1 Mb/s',
            color: 'rgb(4, 5, 6)',
            mirrored: true,
            history: ready([2, 1]),
          },
        ],
      },
    ],
  };
  sparkline.mockClear();
  render(<Card model={model} pinned={true} x={20} y={20} width={800} height={600} onClose={() => {}} />);
  const row = screen.getByTestId('dmap-card-row');
  expect(row.getAttribute('href')).toBe('/d/traffic');
  expect(row.textContent).toContain('Traffic');
  expect(screen.getByTestId('dmap-card-value').textContent).toBe('↑ 8.2 Mb/s  ↓ 1.1 Mb/s');
  expect((screen.getByText('↑') as HTMLElement).style.color).toBe('rgb(1, 2, 3)');
  expect((screen.getByText('↓') as HTMLElement).style.color).toBe('rgb(4, 5, 6)');
  expect(screen.getByTestId('dmap-card-spark').querySelector('[data-testid="dmap-mirror-spark"]')).toBeTruthy();
  expect(row.querySelector('polyline[data-direction="down"]')?.getAttribute('data-mirrored')).toBe('true');
  expect(sparkline).not.toHaveBeenCalled();
});
