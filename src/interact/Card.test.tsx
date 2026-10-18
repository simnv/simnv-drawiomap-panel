import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { createTheme, getDefaultTimeRange } from '@grafana/data';
import { expect, it, vi } from 'vitest';
import { Card } from './Card';
import type { ConfiguredCardModel } from './cardModel';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  IconButton: (props: any) => <button {...props} />,
  LinkButton: (props: any) => <a {...props} />,
  Sparkline: () => <canvas data-testid="grafana-sparkline" />,
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
