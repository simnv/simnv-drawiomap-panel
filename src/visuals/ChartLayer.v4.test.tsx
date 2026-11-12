import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  type DataFrame,
  type DataQueryRequest,
  type FieldConfig,
  type Labels,
  type PanelData,
  type TimeRange,
} from '@grafana/data';
import { ChartLayer, chartUsesV4 } from './ChartLayer';
import { LINE_HEIGHT } from './StaleHint';
import { tooltipRows } from './hoverSample';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { bindContextFor } from '../binding/context';
import { bindV4 } from '../binding/bindV4';
import { validateConfig } from '../model/validate';
import { chartRowV4, type CardContextV4, type HistoryRowV4 } from '../interact/cardModel';

const { sparkline, barBox } = vi.hoisted(() => ({
  sparkline: vi.fn((_props: any) => <canvas data-testid="sparkline" />),
  barBox: vi.fn((_props: any) => null),
}));
vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: any) => fn(createTheme()),
  Portal: ({ children }: any) => <div>{children}</div>,
  SeriesTable: ({ series }: any) => (
    <div>
      {series.map((s: any, i: number) => (
        <p key={i} data-testid="hover-row">
          {s.label}={s.value}
        </p>
      ))}
    </div>
  ),
  Sparkline: sparkline,
  BarGauge: (props: {
    field: { min?: number; max?: number };
    value: { numeric: number; text: string };
    height: number;
  }) => {
    barBox(props);
    return (
      <div data-testid="bar-props">
        {props.field.min}..{props.field.max}: {props.value.text}
      </div>
    );
  },
}));

const theme = createTheme();
const bindCtx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
const T = [0, 60_000, 120_000];
const palette = (i: number) =>
  theme.visualization.getColorByName(theme.visualization.palette[[0, 1, 2, 3, 4, 5, 26, 30][i]]);
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function frame(
  refId: string,
  labels: Labels,
  values: Array<number | null>,
  config: FieldConfig = {},
  times = T.slice(T.length - values.length)
): DataFrame {
  return {
    refId,
    length: values.length,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: times },
      { name: 'Value', type: FieldType.number, config, labels, values },
    ],
  };
}

const range = (rawTo: TimeRange['raw']['to'] = dateTime(120_000)): TimeRange => ({
  from: dateTime(0),
  to: dateTime(120_000),
  raw: { from: dateTime(0), to: rawTo },
});

function panelData(series: DataFrame[], refIds: string[], state = LoadingState.Done): PanelData {
  const timeRange = range();
  const request: DataQueryRequest = {
    requestId: 'demo',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range: timeRange,
    timezone: 'browser',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: refIds.map((refId) => ({ refId })),
  };
  return { state, series, timeRange, request };
}

/** The diagram: one rectangle `cpu` of 180 × 70 px at (12, 5), with the cell attributes of the test. */
function stage(attrs: Record<string, string>) {
  const host = document.createElement('div');
  document.body.append(host);
  const meta = Object.entries(attrs)
    .map(([k, v]) => ` data-meta-${k}="${v}"`)
    .join('');
  const root = mountSvg(
    host,
    `<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="cpu"${meta}><rect width="180" height="70"/></g></svg>`
  );
  const cells = buildCellIndex(root);
  const rect = cells.get('cpu')!.shape!;
  Object.assign(rect.parentElement!, { getCTM: () => identity });
  Object.assign(rect, {
    getCTM: () => ({ ...identity, e: 12, f: 5 }),
    getBBox: () => ({ x: 0, y: 0, width: 180, height: 70 }),
    getBoundingClientRect: () => ({ left: 20, top: 20, right: 200, bottom: 90, width: 180, height: 70 }),
  });
  Object.assign(host, {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
  });
  // The UA stylesheet of jsdom 31 clips a nested svg (overflow: hidden), as browsers do: give the root svg the box of its host.
  Object.assign(root, { getBoundingClientRect: host.getBoundingClientRect });
  return { host, root, cells };
}

/** Bind the class `host` for the cell `cpu` and give the props of the chart layer. */
function setup(
  cls: Record<string, unknown>,
  frames: DataFrame[],
  opts: { attrs?: Record<string, string>; refIds?: string[]; state?: LoadingState } = {}
) {
  const s = stage({ bind: 'host', key: 'ap-1', ...opts.attrs });
  const validated = validateConfig({ version: 4, classes: { host: { match: { key: 'job' }, ...cls } } });
  const refIds = opts.refIds ?? [...new Set(frames.map((f) => f.refId!))];
  const data = panelData(frames, refIds, opts.state);
  const bound = bindV4({ index: s.cells, validated, data, ctx: bindCtx });
  const ctx: CardContextV4 = { theme, replaceVariables: (v) => v, index: s.cells, validated, data };
  return { ...s, bound, ctx, charts: chartUsesV4(bound) };
}

const cpuFrames = (n: number) =>
  Array.from({ length: n }, (_, i) => frame('cpu', { job: 'ap-1', core: `c${i}` }, [i, i + 1, i + 2]));

describe('chartUsesV4', () => {
  it('lists the chart of each bound cell with its YAML path', () => {
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, cpuFrames(1));
    expect(s.charts).toEqual([{ cellId: 'cpu', chart: { kind: 'history', query: 'cpu' }, path: 'classes.host.chart' }]);
  });

  it('gives one chart for the two uses of an updown chart', () => {
    const s = setup({ chart: { kind: 'updown', up: 'tx', down: 'rx' } }, [
      frame('tx', { job: 'ap-1' }, [1]),
      frame('rx', { job: 'ap-1' }, [2]),
    ]);
    expect(s.charts.map((c) => [c.cellId, c.path, c.chart.kind])).toEqual([['cpu', 'classes.host.chart', 'updown']]);
  });

  it('gives no chart for a cell whose class has none', () => {
    expect(setup({ status: 'cpu' }, cpuFrames(1)).charts).toEqual([]);
  });
});

describe('ChartLayer: v4 chart regions (spec 3.9)', () => {
  it('chart {kind: history} draws in the box of the cell, N lines in one shared range', () => {
    sparkline.mockClear();
    const s = setup({ chart: { kind: 'history', query: 'cpu', label: 'CPU' } }, cpuFrames(3));
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    const region = s.root.querySelector('foreignObject[data-dmap-chart="cpu"]')!;
    expect(region).toBeTruthy();
    expect(['x', 'y', 'width', 'height', 'transform'].map((a) => region.getAttribute(a))).toEqual([
      '0',
      '0',
      '180',
      '70',
      'matrix(1 0 0 1 12 5)',
    ]);
    expect(region.querySelector('[data-testid="dmap-chart"]')!.getAttribute('aria-label')).toBe('CPU');
    const calls = sparkline.mock.calls.map((c) => c[0] as any);
    expect(calls.map((p) => p.config.color.fixedColor)).toEqual([palette(0), palette(1), palette(2)]);
    // one Y range for all lines, from zero (yDomain)
    expect(calls.map((p) => [p.config.min, p.config.max])).toEqual([
      [0, 4],
      [0, 4],
      [0, 4],
    ]);
  });

  it('chart {kind: history} with 9 series draws 8 lines and tells "+1 more"', () => {
    sparkline.mockClear();
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, cpuFrames(9));
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    expect(sparkline).toHaveBeenCalledTimes(8);
    expect(screen.getByText('+1 more')).toBeTruthy();
  });

  it('chart {kind: value} draws a bar gauge from the reduced value and the field Min and Max', () => {
    const s = setup({ chart: { kind: 'value', query: 'cpu', label: 'CPU' } }, [
      frame('cpu', { job: 'ap-1' }, [10, 42], { min: 0, max: 100, unit: 'percent' }),
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    expect(screen.getByText('CPU')).toBeTruthy();
    expect(screen.getByTestId('bar-props').textContent).toBe('0..100: 42');
  });

  it('chart {kind: updown} takes the feeds of the link ends: up is tx and down is rx, also with at=target', () => {
    const frames = [
      frame('tx', { job: 'ap-1' }, [5, 10], { unit: 'bps' }),
      frame('rx', { job: 'ap-1' }, [15, 20], { unit: 'bps' }),
    ];
    const s = setup({ chart: { kind: 'updown', up: 'tx', down: 'rx', label: 'Traffic' } }, frames, {
      attrs: { at: 'target' },
    });
    // with at=target the a→b use reads the down refId (spec 3.8.2)
    expect(s.bound.uses.get('cpu')!.map((u) => [u.path, u.refId])).toEqual([
      ['classes.host.chart.a2b', 'rx'],
      ['classes.host.chart.b2a', 'tx'],
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    expect(screen.getByTestId('dmap-chart-value').textContent).toBe('↑ 10 b/s  ↓ 20 b/s');
    const lines = Array.from(document.querySelectorAll('polyline'));
    expect(lines.map((l) => [l.getAttribute('data-direction'), l.getAttribute('data-mirrored')])).toEqual([
      ['up', 'false'],
      ['down', 'true'],
    ]);
  });

  it('tells why a chart has no data: zero series, a first load, an unknown query', () => {
    const empty = setup({ chart: { kind: 'history', query: 'cpu', label: 'CPU' } }, [frame('cpu', { job: 'b' }, [1])]);
    const a = render(
      <ChartLayer
        root={empty.root}
        cells={empty.cells}
        viewport={empty.host}
        charts={empty.charts}
        bound={empty.bound}
        ctx={empty.ctx}
      />
    );
    expect(screen.getByRole('status').textContent).toBe('CPU: No data');
    a.unmount();
    const loading = setup({ chart: { kind: 'value', query: 'cpu', label: 'CPU' } }, [], {
      refIds: ['cpu'],
      state: LoadingState.Loading,
    });
    const b = render(
      <ChartLayer
        root={loading.root}
        cells={loading.cells}
        viewport={loading.host}
        charts={loading.charts}
        bound={loading.bound}
        ctx={loading.ctx}
      />
    );
    expect(screen.getByRole('status').textContent).toBe('CPU: Loading data');
    b.unmount();
    const unknown = setup({ chart: { kind: 'value', query: 'mem', label: 'Memory' } }, cpuFrames(1));
    render(
      <ChartLayer
        root={unknown.root}
        cells={unknown.cells}
        viewport={unknown.host}
        charts={unknown.charts}
        bound={unknown.bound}
        ctx={unknown.ctx}
      />
    );
    expect(screen.getByRole('status').textContent).toBe('Memory: Unknown query');
  });

  it('shows "Stale data" for a chart whose series are stale', () => {
    // the last sample is at 0 s, the absolute range ends at 120 s: older than 10 s
    const s = setup({ freshness: '10s', chart: { kind: 'value', query: 'cpu' } }, [
      frame('cpu', { job: 'ap-1' }, [1], { min: 0, max: 10 }, [0]),
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    expect(screen.getByText('Stale data')).toBeTruthy();
  });

  it('keeps the plot of a stale history chart inside its box, with one hint', () => {
    sparkline.mockClear();
    const s = setup({ freshness: '10s', chart: { kind: 'history', query: 'cpu' } }, [
      frame('cpu', { job: 'ap-1' }, [1, 2, 3], { min: 0, max: 100 }, [0, 1000, 2000]),
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    const hints = screen.getAllByText('Stale data');
    expect(hints).toHaveLength(1);
    const box = hints[0].parentElement as HTMLElement;
    const plotH = (sparkline.mock.calls.at(-1)![0] as any).height;
    expect(plotH + LINE_HEIGHT + parseFloat(hints[0].style.height)).toBeLessThanOrEqual(parseFloat(box.style.height));
  });

  it('keeps the bar of a stale value chart inside its box', () => {
    const s = setup({ freshness: '10s', chart: { kind: 'value', query: 'cpu' } }, [
      frame('cpu', { job: 'ap-1' }, [1], { min: 0, max: 10 }, [0]),
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    const hints = screen.getAllByText('Stale data');
    expect(hints).toHaveLength(1);
    const barH = barBox.mock.calls.at(-1)![0].height;
    expect(barH + LINE_HEIGHT + parseFloat(hints[0].style.height)).toBeLessThanOrEqual(70);
  });

  it('keeps the plot of a stale updown chart inside its box', () => {
    const s = setup({ freshness: '10s', chart: { kind: 'updown', up: 'tx', down: 'rx' } }, [
      frame('tx', { job: 'ap-1' }, [1, 1], {}, [0, 1000]),
      frame('rx', { job: 'ap-1' }, [1, 1], {}, [0, 1000]),
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    const hints = screen.getAllByText('Stale data');
    expect(hints).toHaveLength(1);
    const svg = screen.getByTestId('dmap-mirror-spark');
    expect(
      parseFloat(svg.getAttribute('height')!) + LINE_HEIGHT + parseFloat(hints[0].style.height)
    ).toBeLessThanOrEqual(70);
  });
});

describe('the hover sample of a chart region', () => {
  it('lists each drawn line at the hovered time, "No data" for a line with no value, then "+N more"', () => {
    const frames = [...cpuFrames(8), frame('cpu', { job: 'ap-1', core: 'c8' }, [7, 8, 9])];
    frames[1] = frame('cpu', { job: 'ap-1', core: 'c1' }, [null, null, null]);
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, frames);
    const row = chartRowV4(s.charts[0], s.bound, s.ctx) as HistoryRowV4;
    const tip = tooltipRows(
      row.lines.map((l) => ({ ...l, format: row.format })),
      61_000,
      row.more
    )!;
    expect(tip.time).toBe(60_000);
    expect(tip.list).toHaveLength(8);
    expect(tip.list.map((r) => r.value)).toEqual(['1', 'No data', '3', '4', '5', '6', '7', '8']);
    expect(tip.list.map((r) => r.color)).toEqual(row.lines.map((l) => l.color));
    expect(tip.more).toBe(1);
  });
});

describe('review regressions', () => {
  it('opens the rendered region tooltip with eight rows, no data and more', () => {
    const frames = cpuFrames(9);
    frames[1] = frame('cpu', { job: 'ap-1', core: 'c1' }, [null, null, null]);
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, frames);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    const hover = screen.getByTestId('dmap-chart-hover');
    expect((hover.closest('[data-testid="dmap-chart"]') as HTMLElement).style.pointerEvents).toBe('auto');
    fireEvent.keyDown(hover, { key: 'ArrowRight' });
    const tip = within(screen.getByTestId('dmap-chart-tooltip'));
    expect(tip.getAllByTestId('hover-row').map((e) => e.textContent)).toEqual([
      'c0=2',
      'c1=No data',
      'c2=4',
      'c3=5',
      'c4=6',
      'c5=7',
      'c6=8',
      'c7=9',
    ]);
    expect(tip.getByText('+1 more')).toBeTruthy();
  });

  it('normalizes updown directions before plotting and opens their tooltip', () => {
    const s = setup({ chart: { kind: 'updown', up: 'tx', down: 'rx' } }, [
      frame('tx', { job: 'ap-1' }, [1, 1], { unit: 'Mbits' }),
      frame('rx', { job: 'ap-1' }, [1000, 1000], { unit: 'Kbits' }),
    ]);
    const row = chartRowV4(s.charts[0], s.bound, s.ctx)!;
    expect(row.directions!.map((d) => d.history.state === 'ready' && d.history.values)).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(row.domain).toEqual([-1.1, 1.1]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    fireEvent.keyDown(screen.getByTestId('dmap-chart-hover'), { key: 'ArrowRight' });
    expect(
      within(screen.getByTestId('dmap-chart-tooltip'))
        .getAllByTestId('hover-row')
        .map((e) => e.textContent)
    ).toEqual(['↑=1 Mb/s', '↓=1 Mb/s']);
  });

  it('shows and reports mixed units across updown directions', () => {
    const s = setup({ chart: { kind: 'updown', up: 'tx', down: 'rx' } }, [
      frame('tx', { job: 'ap-1' }, [1, 1], { unit: 'percent' }),
      frame('rx', { job: 'ap-1' }, [2, 2], { unit: 'bps' }),
    ]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    expect(screen.getByRole('status').textContent).toContain('Mixed units');
    expect(s.bound.report.some((e) => e.kind === 'unit-mismatch')).toBe(true);
  });

  it('shows all-null history value and status in the secondary text colour', () => {
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, [frame('cpu', { job: 'ap-1' }, [null, null])]);
    render(
      <ChartLayer root={s.root} cells={s.cells} viewport={s.host} charts={s.charts} bound={s.bound} ctx={s.ctx} />
    );
    const expected = document.createElement('span');
    expected.style.color = theme.colors.text.secondary;
    for (const el of screen.getAllByText('No data')) {
      expect(el.style.color).toBe(expected.style.color);
    }
  });

  it('falls back to the display name when no label differs', () => {
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, [
      frame('cpu', { job: 'ap-1' }, [1, 2], { displayName: 'CPU usage' }),
    ]);
    expect((chartRowV4(s.charts[0], s.bound, s.ctx) as HistoryRowV4).lines[0].label).toBe('CPU usage');
  });

  it('uses eight distinct palette hue slots', () => {
    const s = setup({ chart: { kind: 'history', query: 'cpu' } }, cpuFrames(9));
    const row = chartRowV4(s.charts[0], s.bound, s.ctx) as HistoryRowV4;
    expect(row.lines.map((l) => l.color)).toEqual(Array.from({ length: 8 }, (_, i) => palette(i)));
  });
});
