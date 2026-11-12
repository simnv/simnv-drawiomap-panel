import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { colorManipulator, createTheme, getDefaultTimeRange } from '@grafana/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from './Card';
import type { CardModelV4, CardRowV4, HistoryRowV4 } from './cardModel';
import { statusTextColor } from '../binding/color';
import type { StatusView } from '../binding/status';

const { sparkline, transitions } = vi.hoisted(() => ({
  sparkline: vi.fn((_props: any) => <canvas data-testid="grafana-sparkline" />),
  /** When set, the transitions of the card queue here instead of running; a test runs them in an `act`. */
  transitions: { queue: null as Array<() => void> | null },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    startTransition: (cb: () => void) => (transitions.queue ? transitions.queue.push(cb) : actual.startTransition(cb)),
  };
});
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
const line = (values: Array<number | null>, label = 'Traffic') => ({
  label,
  color: '#111111',
  times: values.map((_, i) => i),
  values,
  noData: !values.some((v) => v !== null),
});
const historyRow = (over: Partial<HistoryRowV4> = {}): HistoryRowV4 => ({
  key: 'r',
  kind: 'history',
  title: 'Traffic',
  text: '2',
  state: 'ready',
  lines: [line([1, 2])],
  more: 0,
  domain: [0, 2],
  stale: false,
  ...over,
});
const valueRow = (over: { text?: string; stale?: boolean; staleAfter?: number } = {}): CardRowV4 => ({
  key: 'v',
  kind: 'value',
  title: 'Temperature',
  text: '42 °C',
  state: 'ready',
  stale: false,
  ...over,
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
const updownRow = (mirrored = true): CardRowV4 => ({
  key: 'r',
  kind: 'updown',
  title: 'Traffic',
  text: '↑ 8  ↓ 1',
  state: 'ready',
  stale: false,
  domain: mirrored ? [-10, 10] : [0, 10],
  directions: directions(mirrored),
});
const cardOf = (...rows: CardRowV4[]): CardModelV4 => ({ title: 'wan1', links: [], rows });
const chartPx = () => {
  const box = screen.getByTestId('dmap-card-spark') as HTMLElement;
  return { box: box.style.height, svg: box.querySelector('svg')?.getAttribute('height') };
};
const renderCard = (model: CardModelV4) =>
  render(<Card model={model} pinned={true} x={20} y={20} width={800} height={600} onClose={() => {}} />);

it('shows a history row that has no chart as its text, and keeps a failure local to its row', () => {
  const failed = (key: string, title: string, text: string, state: HistoryRowV4['state']) =>
    historyRow({ key, title, text, state, lines: [], domain: [0, 1] });
  renderCard(
    cardOf(failed('a', 'CPU', 'Loading data', 'loading'), valueRow(), failed('c', 'Disk', 'Query failed', 'error'))
  );
  expect(screen.getAllByText('Loading data').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Query failed').length).toBeGreaterThan(0);
  expect(screen.getByText('42 °C')).toBeTruthy();
  expect(screen.queryByTestId('grafana-sparkline')).toBeNull();
});
it('keeps the whole chart box for the plot of a stale history row, with one hint in the row head', () => {
  sparkline.mockClear();
  renderCard(cardOf(historyRow({ stale: true, lines: [line([1, 2, 3])] })));
  expect(screen.getAllByText('Stale data')).toHaveLength(1);
  expect(screen.getByLabelText('Traffic').getAttribute('data-state')).toBe('stale');
  expect((sparkline.mock.calls.at(-1)![0] as any).height).toBe(40);
});
it('shows a stale value row with the stale hint, and a fresh one without it', () => {
  const { unmount } = renderCard(cardOf(valueRow({ text: '42%', stale: true })));
  expect(screen.getByText('Stale data')).toBeTruthy();
  expect(screen.getByText('42%')).toBeTruthy();
  unmount();
  renderCard(cardOf(valueRow({ text: '42%' })));
  expect(screen.queryByText('Stale data')).toBeNull();
});
it('expires a displayed value row at its deadline without data updates and cancels its clock when the card closes', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(4000);
    const model = cardOf(valueRow({ text: '42%', staleAfter: 5000 }));
    const { unmount } = render(
      <Card model={model} pinned={false} x={20} y={20} width={800} height={600} onClose={() => {}} />
    );
    expect(screen.queryByText('Stale data')).toBeNull();
    act(() => vi.advanceTimersByTime(1001));
    expect(screen.getByText('Stale data')).toBeTruthy();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('renders an up/down row: both values with coloured direction labels and one mirrored chart', () => {
  sparkline.mockClear();
  renderCard(cardOf({ ...updownRow(), text: '↑ 8.2 Mb/s  ↓ 1.1 Mb/s' }));
  const row = screen.getByTestId('dmap-card-row');
  expect(row.textContent).toContain('Traffic');
  expect(screen.getByTestId('dmap-card-value').textContent).toBe('↑ 8  ↓ 1');
  expect((screen.getByText('↑') as HTMLElement).style.color).toBe('red');
  expect((screen.getByText('↓') as HTMLElement).style.color).toBe('blue');
  expect(screen.getByTestId('dmap-card-spark').querySelector('[data-testid="dmap-mirror-spark"]')).toBeTruthy();
  expect(row.querySelector('polyline[data-direction="down"]')?.getAttribute('data-mirrored')).toBe('true');
  expect(sparkline).not.toHaveBeenCalled();
});
it('draws an up/down row twice as tall as a single sparkline, with the zero line in the middle', () => {
  renderCard(cardOf(updownRow()));
  expect(chartPx()).toEqual({ box: '80px', svg: '80' });
  const svg = screen.getByTestId('dmap-mirror-spark');
  expect(svg.getAttribute('viewBox')).toBe('0 0 264 80');
  expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  expect(screen.getByTestId('dmap-zero-line').getAttribute('y1')).toBe('40');
});
it('draws an up/down row with one direction at the normal sparkline height', () => {
  renderCard(cardOf(updownRow(false)));
  expect(chartPx()).toEqual({ box: '40px', svg: '40' });
});
it('draws a history row at the normal height', () => {
  sparkline.mockClear();
  renderCard(cardOf(historyRow()));
  expect(chartPx().box).toBe('40px');
  expect(sparkline.mock.calls.at(-1)![0].height).toBe(40);
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
it('shows the chart tooltip for a history row only in the pinned card', () => {
  const model = cardOf(historyRow());
  const { unmount } = renderCard(model);
  hoverChart();
  expect(screen.getByTestId('series-table').textContent).toBe('Traffic=2');
  unmount();
  render(<Card model={model} pinned={false} x={20} y={20} width={800} height={600} />);
  expect(screen.queryByTestId('dmap-chart-hover')).toBeNull();
  expect(screen.queryByTestId('series-table')).toBeNull();
});
it('shows both directions of an up/down row in the pinned card tooltip', () => {
  renderCard(cardOf(updownRow()));
  hoverChart();
  expect(screen.getByTestId('series-table').textContent).toBe('↑=8;↓=1');
});

it('sets the hover width of a history chart to the chart width, not the row', () => {
  renderCard(cardOf(historyRow()));
  expect(screen.getByTestId('dmap-chart-hover').style.width).toBe('264px');
});
it('renders the inline variant in the page flow: no sheet, no close button, no placement, full width', () => {
  const model: CardModelV4 = {
    title: 'Router',
    links: [{ title: 'Docs', href: '/docs', target: '_blank', origin: {} as never }],
    rows: [valueRow()],
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
  const model: CardModelV4 = { title: 'Router', links: [], rows: [] };
  render(<Card model={model} pinned={true} x={0} y={0} width={300} height={300} onClose={() => {}} />);
  expect(screen.getByTestId('dmap-card').getAttribute('data-sheet')).toBe('true');
  expect(screen.getByTestId('dmap-card').getAttribute('data-variant')).toBe('floating');
});
it('shows the close button and the footer links of a pinned card, and calls onClose', () => {
  const onClose = vi.fn();
  const model: CardModelV4 = {
    title: 'Router',
    links: [{ title: 'Docs', href: '/docs', target: '_blank', origin: {} as never }],
    rows: [],
  };
  render(<Card model={model} pinned x={0} y={0} width={800} height={600} onClose={onClose} />);
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Router');
  expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('shows the hint "Click for links" and no close button in a hover card with links', () => {
  const model: CardModelV4 = {
    title: 'Router',
    links: [{ title: 'Docs', href: '/docs', target: '_blank', origin: {} as never }],
    rows: [],
  };
  render(<Card model={model} pinned={false} x={0} y={0} width={800} height={600} />);
  expect(screen.getByRole('tooltip')).toBeTruthy();
  expect(screen.getByText('Click for links')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Docs' })).toBeNull();
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
const followModel: CardModelV4 = { title: 'Router', links: [], rows: [] };
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
it.each([
  ['floating', 800, 'floating'],
  ['sheet', 400, 'floating'],
  ['inline', 800, 'inline'],
] as const)('names its cell in data-dmap-cell (%s)', (_name, width, variant) => {
  render(<Card model={followModel} cellId="rtr-a" pinned={false} variant={variant} width={width} height={600} />);
  expect(screen.getByTestId('dmap-card').getAttribute('data-dmap-cell')).toBe('rtr-a');
});

describe('deferred charts', () => {
  const queued = () => {
    transitions.queue = [];
    sparkline.mockClear();
  };
  afterEach(() => {
    transitions.queue = null;
  });
  const runTransitions = () =>
    act(() => {
      transitions.queue?.splice(0).forEach((cb) => cb());
    });
  const threeRows = (): CardModelV4 =>
    cardOf(historyRow({ key: 'h', title: 'CPU', text: '2 %' }), { ...updownRow(), key: 'c' }, valueRow());
  const boxes = () => screen.getAllByTestId('dmap-card-spark').map((el) => [el.style.height, el.childElementCount]);
  it('a hover card has the texts and empty chart boxes in the first commit; the charts come in the transition', () => {
    queued();
    render(<Card model={threeRows()} pinned={false} x={20} y={20} width={800} height={600} />);
    expect(screen.getByText('CPU')).toBeTruthy();
    expect(screen.getByText('2 %')).toBeTruthy();
    expect(screen.getByText('42 °C')).toBeTruthy();
    expect(boxes()).toEqual([
      ['40px', 0],
      ['80px', 0],
    ]);
    expect(sparkline).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dmap-mirror-spark')).toBeNull();
    expect(transitions.queue).toHaveLength(1);
    runTransitions();
    expect(sparkline).toHaveBeenCalled();
    expect(screen.getByTestId('dmap-mirror-spark')).toBeTruthy();
    // the box of every chart keeps its height: the card does not change its height between the commits
    expect(boxes()).toEqual([
      ['40px', 1],
      ['80px', 1],
    ]);
  });
  it('a hover card that unmounts before the transition pays for the texts only', () => {
    queued();
    const { unmount } = render(<Card model={threeRows()} pinned={false} x={20} y={20} width={800} height={600} />);
    unmount();
    runTransitions();
    expect(sparkline).not.toHaveBeenCalled();
  });
  it.each([
    ['pinned', { pinned: true, variant: 'floating' }],
    ['inline', { pinned: false, variant: 'inline' }],
  ] as const)('the %s card has its charts in the first commit', (_name, props) => {
    queued();
    render(<Card model={threeRows()} {...props} x={20} y={20} width={800} height={600} />);
    expect(sparkline).toHaveBeenCalled();
    expect(screen.getByTestId('dmap-mirror-spark')).toBeTruthy();
    expect(transitions.queue).toEqual([]);
  });
});

describe('the status row', () => {
  const statusRow = (status: StatusView['state']): CardRowV4 => ({
    key: 'status',
    kind: 'status',
    title: status,
    text: 'probe delay over 400 ms',
    state: 'ready',
    status,
    stale: false,
  });
  const theme = createTheme();
  const colourOf = (v: string) => {
    const probe = document.createElement('span');
    probe.style.color = v;
    return probe.style.color;
  };
  it.each([
    ['down', theme.colors.error.text],
    ['critical', theme.colors.error.text],
    ['warning', theme.colors.warning.text],
    ['stale', theme.colors.warning.text],
    ['missing', theme.colors.text.secondary],
  ] as const)('shows the state word %s in the text-safe colour and the reason in the plain colour', (status, want) => {
    renderCard(cardOf(statusRow(status)));
    expect(screen.getByText(status).style.color).toBe(colourOf(want));
    expect(screen.getByText('probe delay over 400 ms').style.color).toBe('');
  });
  it('keeps the warning word readable on the light card', () => {
    const light = createTheme({ colors: { mode: 'light' } });
    expect(statusTextColor({ state: 'warning' }, light)).toBe(light.colors.warning.text);
    expect(
      colorManipulator.getContrastRatio(statusTextColor({ state: 'warning' }, light), light.colors.background.primary)
    ).toBeGreaterThanOrEqual(4.5);
  });
});

it('shows the value of a history row with no data in grey', () => {
  const model = cardOf(
    historyRow({ title: 'CPU', text: 'No data', lines: [line([null, null], 'CPU')], domain: [0, 1] })
  );
  render(<Card model={model} pinned x={20} y={20} width={800} height={600} onClose={() => {}} />);
  const expected = document.createElement('span');
  expected.style.color = createTheme().colors.text.secondary;
  document.body.append(expected);
  expect(getComputedStyle(screen.getByTestId('dmap-card-value')).color).toBe(getComputedStyle(expected).color);
  expected.remove();
});
