import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  Portal: (props: any) => <div>{props.children}</div>,
  VizTooltipContainer: (props: any) => <div>{props.children}</div>,
  SeriesTable: (props: any) => (
    <div data-testid="series-table">{props.series.map((r: any) => `${r.label}=${r.value}`).join(';')}</div>
  ),
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

const readyHistory = (values: number[]) => ({
  state: 'ready' as const,
  field: { name: 'v', type: 'number' as any, config: {}, values },
  timeField: { name: 'Time', type: 'time' as any, config: {}, values: values.map((_, i) => i) },
  timestamps: values.map((_, i) => i),
  values,
  latestValue: values.at(-1),
  fetchedAt: 0,
  fromCache: false,
});
const chartRow = (extra: Record<string, unknown>): ConfiguredCardModel['rows'][number] => ({
  key: 'r',
  kind: 'history',
  title: 'Traffic',
  text: '',
  state: 'ready',
  ...extra,
});
const cardOf = (row: ConfiguredCardModel['rows'][number]): ConfiguredCardModel => ({
  title: 'wan1',
  links: [],
  demands: [],
  diagnostics: [],
  rows: [row],
});
const directions = (mirrored: boolean) => [
  { direction: 'up' as const, label: '↑', text: '8', color: 'red', mirrored: false, history: readyHistory([5, 8]) },
  ...(mirrored
    ? [
        {
          direction: 'down' as const,
          label: '↓',
          text: '1',
          color: 'blue',
          mirrored: true,
          history: readyHistory([2, 1]),
        },
      ]
    : []),
];
const chartPx = () => {
  const box = screen.getByTestId('dmap-card-spark') as HTMLElement;
  return { box: box.style.height, svg: box.querySelector('svg')?.getAttribute('height') };
};
const renderCard = (model: ConfiguredCardModel) =>
  render(<Card model={model} pinned={true} x={20} y={20} width={800} height={600} onClose={() => {}} />);

it('draws a combined up/down row twice as tall as a single sparkline', () => {
  renderCard(cardOf(chartRow({ domain: [-10, 10], directions: directions(true) })));
  expect(chartPx()).toEqual({ box: '80px', svg: '80' });
});
it('draws a combined row with one direction at the normal sparkline height', () => {
  renderCard(cardOf(chartRow({ domain: [0, 10], directions: directions(false) })));
  expect(chartPx()).toEqual({ box: '40px', svg: '40' });
});
it('draws a single history row at the normal height', () => {
  sparkline.mockClear();
  renderCard(cardOf(chartRow({ history: readyHistory([1, 2]) })));
  expect(chartPx().box).toBe('40px');
  expect(sparkline.mock.calls.at(-1)![0].height).toBe(40);
});
it('takes the row height option for a combined row and for a single row', () => {
  const { unmount } = renderCard(cardOf(chartRow({ height: 120, domain: [-10, 10], directions: directions(true) })));
  expect(chartPx()).toEqual({ box: '120px', svg: '120' });
  const svg = screen.getByTestId('dmap-mirror-spark');
  expect(svg.getAttribute('viewBox')).toBe('0 0 264 120');
  expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  expect(screen.getByTestId('dmap-zero-line').getAttribute('y1')).toBe('60');
  unmount();
  sparkline.mockClear();
  renderCard(cardOf(chartRow({ height: 64, history: readyHistory([1, 2]) })));
  expect(chartPx().box).toBe('64px');
  expect(sparkline.mock.calls.at(-1)![0].height).toBe(64);
});

const hoverChart = () => {
  const el = screen.getByTestId('dmap-chart-hover');
  el.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 40, right: 100, bottom: 40 }) as DOMRect;
  // the hover updates on an animation frame: run it at once
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 5, pointerType: 'mouse' });
  vi.unstubAllGlobals();
};
it('shows the chart tooltip for a single history row only in the pinned card', () => {
  const model = cardOf(chartRow({ history: readyHistory([1, 2]) }));
  const { unmount } = renderCard(model);
  hoverChart();
  expect(screen.getByTestId('series-table').textContent).toBe('Traffic=2');
  unmount();
  render(<Card model={model} pinned={false} x={20} y={20} width={800} height={600} onClose={() => {}} />);
  expect(screen.queryByTestId('dmap-chart-hover')).toBeNull();
  expect(screen.queryByTestId('series-table')).toBeNull();
});
it('shows both directions of a combined row in the pinned card tooltip', () => {
  renderCard(cardOf(chartRow({ domain: [-10, 10], directions: directions(true) })));
  hoverChart();
  expect(screen.getByTestId('series-table').textContent).toBe('↑=8;↓=1');
});

it('uses the row formatter of a legacy row in the tooltip', () => {
  const model = {
    title: 'n',
    links: [],
    rows: [
      {
        key: 'r',
        title: 'CPU',
        text: '2 kb/s',
        status: 'ok',
        color: 'red',
        values: [1, 2],
        times: [0, 10],
        format: (v: number) => `${v} kb/s`,
      },
    ],
  };
  renderCard(model as any);
  hoverChart();
  expect(screen.getByTestId('series-table').textContent).toBe('CPU=2 kb/s');
});
it('sorts a legacy row by time for the sparkline and for the tooltip', () => {
  const model = {
    title: 'n',
    links: [],
    rows: [{ key: 'r', title: 'CPU', text: '', status: 'ok', color: 'red', values: [3, 2, 1], times: [30, 20, 10] }],
  };
  sparkline.mockClear();
  renderCard(model as any);
  const props = sparkline.mock.calls.at(-1)![0];
  expect(Array.from(props.sparkline.x.values)).toEqual([10, 20, 30]);
  expect(Array.from(props.sparkline.y.values)).toEqual([1, 2, 3]);
});
it('sets the hover width of a single chart to the chart width, not the row', () => {
  renderCard(cardOf(chartRow({ history: readyHistory([1, 2]) })));
  expect(screen.getByTestId('dmap-chart-hover').style.width).toBe('264px');
});
it('renders the inline variant in the page flow: no sheet, no close button, no placement, full width', () => {
  const model: ConfiguredCardModel = {
    title: 'Router',
    links: [{ title: 'Docs', href: '/docs', target: '_blank', origin: {} as never }],
    demands: [],
    diagnostics: [],
    rows: [{ key: 'b', kind: 'value', title: 'Temperature', text: '42 °C', state: 'ready' }],
  };
  // A narrow width would make a floating card a bottom sheet.
  render(<Card model={model} pinned={true} variant="inline" width={300} timeRange={getDefaultTimeRange()} />);
  const card = screen.getByTestId('dmap-card');
  expect(card.getAttribute('data-variant')).toBe('inline');
  expect(card.getAttribute('data-sheet')).toBe('false');
  expect(card.getAttribute('role')).toBe('group');
  expect(card.style.left).toBe('');
  expect(card.style.top).toBe('');
  expect(card.style.width).toBe('');
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  expect(screen.getByText('42 °C')).toBeTruthy();
  // The inline card has no click to pin: it shows the links as they are, and no "Click for links" hint.
  expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs');
  expect(screen.queryByText('Click for links')).toBeNull();
});
it('keeps the floating card a sheet below the breakpoint', () => {
  const model: ConfiguredCardModel = { title: 'Router', links: [], demands: [], diagnostics: [], rows: [] };
  render(<Card model={model} pinned={true} x={0} y={0} width={300} height={300} onClose={() => {}} />);
  expect(screen.getByTestId('dmap-card').getAttribute('data-sheet')).toBe('true');
  expect(screen.getByTestId('dmap-card').getAttribute('data-variant')).toBe('floating');
});

/** A manual frame queue for the card that follows the pointer. */
const frames = () => {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.set(next, cb);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void queue.delete(id));
  const flush = () => {
    const run = [...queue.values()];
    queue.clear();
    run.forEach((cb) => cb(0));
  };
  flush.pending = () => queue.size;
  return flush;
};
const followModel: CardModel = { title: 'Router', links: [], rows: [] };
const panelRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) as DOMRect;
type FollowProps = Partial<React.ComponentProps<typeof Card>>;
const follow = (props: FollowProps = {}) => {
  const moveRef = { current: null } as React.MutableRefObject<(() => void) | null>;
  const pointerRef = { current: { x: 20, y: 20 } } as React.MutableRefObject<{ x: number; y: number } | null>;
  const anchor = document.createElement('div');
  anchor.getBoundingClientRect = panelRect;
  const ui = (p: FollowProps) => (
    <Card
      key={`${p.model?.title ?? 'Router'}:${!!p.pinned}`}
      model={followModel}
      pinned={false}
      x={20}
      y={20}
      width={800}
      height={600}
      anchor={anchor}
      pointerRef={pointerRef}
      moveRef={moveRef}
      {...p}
    />
  );
  const view = render(ui(props));
  const pointer = (x: number, y: number) => {
    pointerRef.current = { x, y };
    act(() => moveRef.current!());
  };
  return { pointer, rerender: (p: FollowProps) => view.rerender(ui(p)) };
};
const left = () => screen.getByTestId('dmap-card').style.left;
it('drops a queued pointer move when the card is pinned before the frame runs', () => {
  const flush = frames();
  const { pointer, rerender } = follow();
  pointer(300, 200);
  rerender({ pinned: true, x: 50, y: 60 });
  expect(flush.pending()).toBe(0);
  const place = left();
  flush();
  expect(left()).toBe(place);
  vi.unstubAllGlobals();
});
it('keeps the moved place when a data update renders the card again with the entry position', () => {
  const flush = frames();
  const { pointer, rerender } = follow();
  pointer(300, 200);
  flush();
  const moved = left();
  expect(moved).toBe('314px');
  rerender({ model: { ...followModel } });
  expect(left()).toBe(moved);
  vi.unstubAllGlobals();
});
it('drops a queued move when another cell with the same title takes the card', () => {
  const flush = frames();
  const { pointer, rerender } = follow();
  pointer(300, 200);
  rerender({ key: 'other' } as FollowProps);
  expect(flush.pending()).toBe(0);
  const place = left();
  flush();
  expect(left()).toBe(place);
  vi.unstubAllGlobals();
});
it('a pin after a move back to the entry point keeps the pin place, not the hover place', () => {
  const flush = frames();
  const { pointer, rerender } = follow();
  pointer(300, 200);
  flush();
  pointer(20, 20);
  rerender({ pinned: true, x: 20, y: 20 });
  const place = left();
  flush();
  rerender({ pinned: true, x: 20, y: 20, model: { ...followModel } });
  expect(left()).toBe(place);
  expect(left()).toBe('34px');
  vi.unstubAllGlobals();
});
it('a queued pointer move leaves the viewport place of a sheet alone', () => {
  const flush = frames();
  const { pointer } = follow({ width: 400 });
  const before = [left(), screen.getByTestId('dmap-card').style.top];
  pointer(300, 200);
  flush();
  expect(screen.getByTestId('dmap-card').getAttribute('data-sheet')).toBe('true');
  expect([left(), screen.getByTestId('dmap-card').style.top]).toEqual(before);
  vi.unstubAllGlobals();
});
