import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
} from '@grafana/data';
import { ChartLayer, chartUsesV4 } from './ChartLayer';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { readChartAnchor } from '../render/geometry';
import { bindContextFor } from '../binding/context';
import { bindV4 } from '../binding/bindV4';
import { validateConfig } from '../model/validate';
import type { CardContextV4 } from '../interact/cardModel';

const { sparkline } = vi.hoisted(() => ({ sparkline: vi.fn((_props: any) => <canvas data-testid="sparkline" />) }));
vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: any) => fn(createTheme()),
  Portal: ({ children }: any) => <div>{children}</div>,
  SeriesTable: () => <div />,
  Sparkline: sparkline,
  BarGauge: (props: { field: { min?: number; max?: number }; value: { numeric: number } }) => (
    <div data-testid="bar-props">
      {props.field.min}..{props.field.max}: {props.value.numeric}
    </div>
  ),
}));

const theme = createTheme();
const bindCtx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
const T = [0, 60_000, 120_000];
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function frame(refId: string, labels: Labels, values: Array<number | null>, config: FieldConfig = {}): DataFrame {
  return {
    refId,
    length: values.length,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: T.slice(T.length - values.length) },
      { name: 'Value', type: FieldType.number, config, labels, values },
    ],
  };
}

function panelData(series: DataFrame[]): PanelData {
  const timeRange = { from: dateTime(0), to: dateTime(120_000), raw: { from: dateTime(0), to: dateTime(120_000) } };
  const request: DataQueryRequest = {
    requestId: 'demo',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range: timeRange,
    timezone: 'browser',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: [...new Set(series.map((f) => f.refId!))].map((refId) => ({ refId })),
  };
  return { state: LoadingState.Done, series, timeRange, request };
}

/** The diagram: one rectangle `cpu` of 180 × 70 px at (12, 5). The left edge of the rectangle on the screen moves. */
function stage() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = mountSvg(
    host,
    '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="cpu" data-meta-bind="host" data-meta-key="node-rtr-a"><rect width="180" height="70"/><text>Label outside bounds</text></g></svg>'
  );
  const cells = buildCellIndex(root);
  const rect = cells.get('cpu')!.shape!;
  Object.assign(rect.parentElement!, { getCTM: () => identity });
  let left = 20;
  Object.assign(rect, {
    getCTM: () => ({ ...identity, e: 12, f: 5 }),
    getBBox: () => ({ x: 0, y: 0, width: 180, height: 70 }),
    getBoundingClientRect: () => ({ left, top: 20, right: left + 180, bottom: 90, width: 180, height: 70 }),
  });
  Object.assign(host, {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
  });
  // The UA stylesheet of jsdom 31 clips a nested svg (overflow: hidden), as browsers do: give the root svg the box of its host.
  Object.assign(root, { getBoundingClientRect: host.getBoundingClientRect });
  return {
    host,
    root,
    cells,
    rect,
    move: (x: number) => {
      left = x;
    },
  };
}

/** Bind the class `host` for the cell `cpu` and give the props of the chart layer. */
function setup(cls: Record<string, unknown>, frames: DataFrame[]) {
  const s = stage();
  const validated = validateConfig({ version: 4, classes: { host: { match: { key: 'job' }, ...cls } } });
  const bind = (series: DataFrame[]) => {
    const data = panelData(series);
    const bound = bindV4({ index: s.cells, validated, data, ctx: bindCtx });
    const ctx: CardContextV4 = { theme, replaceVariables: (v) => v, index: s.cells, validated, data };
    return { bound, ctx, charts: chartUsesV4(bound) };
  };
  return { ...s, ...bind(frames), rebind: bind };
}
type Setup = ReturnType<typeof setup>;

const layer = (s: Setup, extra: { revision?: unknown } = {}) => (
  <ChartLayer
    root={s.root}
    cells={s.cells}
    viewport={s.host}
    charts={s.charts}
    bound={s.bound}
    ctx={s.ctx}
    {...extra}
  />
);
const historyClass = { chart: { kind: 'history', query: 'cpu', label: 'CPU' } };
const cpu = () => [frame('cpu', { job: 'node-rtr-a' }, [1, 2, 3])];
const drawn = (s: Setup) => s.root.querySelector('[data-testid="dmap-chart"]');

describe('ChartLayer', () => {
  it('keeps the dimensions of the region in the units of the rectangle when the viewport zooms', async () => {
    const s = setup(historyClass, cpu());
    const { unmount } = render(layer(s));
    Object.assign(s.rect, {
      getBoundingClientRect: () => ({ left: 20, top: 20, right: 380, bottom: 160, width: 360, height: 140 }),
    });
    await act(async () => {
      s.root.setAttribute('viewBox', '0 0 200 100');
    });
    expect(s.root.querySelector('foreignObject')?.getAttribute('width')).toBe('180');
    expect(s.root.querySelector('foreignObject')?.getAttribute('height')).toBe('70');
    unmount();
    s.host.remove();
  });
  it('preserves the portal and the chart through a viewport revision', () => {
    const s = setup(historyClass, cpu());
    const { rerender, unmount } = render(layer(s));
    const portal = s.root.querySelector('foreignObject');
    expect(drawn(s)).toBeTruthy();
    rerender(layer(s, { revision: 2 }));
    expect(s.root.querySelector('foreignObject') === portal).toBe(true);
    expect(drawn(s)).toBeTruthy();
    unmount();
    s.host.remove();
  });
  it('draws a new bind in the same region', () => {
    const s = setup({ chart: { kind: 'value', query: 'cpu', label: 'CPU' } }, [
      frame('cpu', { job: 'node-rtr-a' }, [10, 42], { min: 0, max: 100 }),
    ]);
    const { rerender, unmount } = render(layer(s));
    expect(screen.getByTestId('bar-props').textContent).toBe('0..100: 42');
    const next = s.rebind([frame('cpu', { job: 'node-rtr-a' }, [10, 77], { min: 0, max: 100 })]);
    rerender(layer({ ...s, ...next }));
    expect(screen.getByTestId('bar-props').textContent).toBe('0..100: 77');
    expect(s.root.querySelectorAll('foreignObject')).toHaveLength(1);
    unmount();
    s.host.remove();
  });
  it('waits for the browser visibility result before it draws a clipped chart', () => {
    const s = setup(historyClass, cpu());
    let intersect: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof intersect) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    try {
      const { unmount } = render(layer(s));
      expect(drawn(s)).toBeNull();
      act(() => intersect([{ isIntersecting: true }]));
      expect(drawn(s)).toBeTruthy();
      act(() => intersect([{ isIntersecting: false }]));
      expect(drawn(s)).toBeNull();
      unmount();
    } finally {
      vi.unstubAllGlobals();
      s.host.remove();
    }
  });
  it('limits interaction to the chart and leaves the underlying cell selectable', () => {
    const s = setup(historyClass, cpu());
    const click = vi.fn();
    s.host.addEventListener('click', click);
    const { unmount } = render(layer(s));
    const region = s.root.querySelector('foreignObject') as SVGForeignObjectElement;
    expect(region.style.pointerEvents).toBe('none');
    expect((drawn(s) as HTMLElement).style.pointerEvents).toBe('auto');
    expect(region.style.overflow).toBe('hidden');
    fireEvent.click(s.rect);
    expect(click).toHaveBeenCalledTimes(1);
    unmount();
    s.host.remove();
  });
  it('keeps null and singular CTMs invalid and preserves rotation/skew relative to a nested parent', () => {
    const s = setup(historyClass, cpu());
    const parent = s.rect.parentElement as unknown as SVGGraphicsElement;
    Object.assign(parent, { getCTM: () => ({ ...identity, a: 2, d: 2, e: 100, f: 40 }) });
    Object.assign(s.rect, { getCTM: () => ({ a: 0, b: 2, c: -2, d: 1, e: 120, f: 50 }) });
    expect(readChartAnchor(s.cells.get('cpu')!, parent)).toMatchObject({
      width: 180,
      height: 70,
      matrix: { a: 0, b: 1, c: -1, d: 0.5, e: 10, f: 5 },
    });
    Object.assign(s.rect, { getCTM: () => null });
    expect(readChartAnchor(s.cells.get('cpu')!, parent)).toBeUndefined();
    Object.assign(s.rect, { getCTM: () => ({ ...identity, a: 0 }) });
    expect(readChartAnchor(s.cells.get('cpu')!, parent)).toBeUndefined();
    s.host.remove();
  });
  it('keeps the anchor when the rect and its parent share a small scale: the matrix between them is a translation', () => {
    const s = setup(historyClass, cpu());
    const parent = s.rect.parentElement as unknown as SVGGraphicsElement;
    Object.assign(parent, { getCTM: () => ({ ...identity, a: 1e-5, d: 1e-5, e: 3, f: 4 }) });
    Object.assign(s.rect, { getCTM: () => ({ ...identity, a: 1e-5, d: 1e-5, e: 3 + 12e-5, f: 4 + 5e-5 }) });
    const m = readChartAnchor(s.cells.get('cpu')!, parent)?.matrix;
    expect(m).toBeDefined();
    const want = { a: 1, b: 0, c: 0, d: 1, e: 12, f: 5 };
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      expect(m![k]).toBeCloseTo(want[k], 6);
    }
    s.host.remove();
  });
  it('does not draw a hidden region and reacts when its ancestor becomes visible', async () => {
    const s = setup(historyClass, cpu());
    s.host.style.display = 'none';
    const { unmount } = render(layer(s));
    expect(drawn(s)).toBeNull();
    await act(async () => {
      s.host.style.display = 'block';
    });
    expect(drawn(s)).toBeTruthy();
    unmount();
    s.host.remove();
  });
  it('one observer serves every region, a mutation runs only the regions under it, and a pass reads each ancestor once', async () => {
    // two chart cells and a plain cell; the nodes above a shape are shared, so a pass reads them once for both
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountSvg(
      host,
      '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="a" data-meta-bind="host" data-meta-key="node-rtr-a"><rect width="180" height="70"/></g>' +
        '<g data-cell-id="b" data-meta-bind="host" data-meta-key="node-rtr-b"><rect width="180" height="70"/></g>' +
        '<g data-cell-id="other"><rect width="10" height="10"/></g></svg>'
    );
    const cells = buildCellIndex(root);
    const shapes = ['a', 'b'].map((id) => cells.get(id)!.shape!);
    for (const shape of shapes) {
      Object.assign(shape.parentElement!, { getCTM: () => identity });
      Object.assign(shape, {
        getCTM: () => ({ ...identity, e: 12, f: 5 }),
        getBBox: () => ({ x: 0, y: 0, width: 180, height: 70 }),
        getBoundingClientRect: () => ({ left: 20, top: 20, right: 200, bottom: 90, width: 180, height: 70 }),
      });
    }
    Object.assign(host, {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
    });
    // The UA stylesheet of jsdom 31 clips a nested svg (overflow: hidden), as browsers do: give the root svg the box of its host.
    Object.assign(root, { getBoundingClientRect: host.getBoundingClientRect });
    const validated = validateConfig({ version: 4, classes: { host: { match: { key: 'job' }, ...historyClass } } });
    const data = panelData([frame('cpu', { job: 'node-rtr-a' }, [1, 2, 3]), frame('cpu', { job: 'node-rtr-b' }, [1, 2, 3])]);
    const bound = bindV4({ index: cells, validated, data, ctx: bindCtx });
    const ctx: CardContextV4 = { theme, replaceVariables: (v) => v, index: cells, validated, data };
    const Original = MutationObserver;
    let observers = 0;
    let callbacks = 0;
    vi.stubGlobal(
      'MutationObserver',
      class extends Original {
        constructor(cb: MutationCallback) {
          super((records, observer) => {
            callbacks++;
            cb(records, observer);
          });
          observers++;
        }
      }
    );
    const original = window.getComputedStyle;
    let styles = 0;
    vi.stubGlobal('getComputedStyle', (...args: Parameters<typeof original>) => {
      styles++;
      return original(...args);
    });
    try {
      const { unmount } = render(
        <ChartLayer root={root} cells={cells} viewport={host} charts={chartUsesV4(bound)} bound={bound} ctx={ctx} />
      );
      expect(root.querySelectorAll('[data-testid="dmap-chart"]')).toHaveLength(2);
      expect(observers).toBe(1);
      // the pass of the mount: each node on the paths from the shapes to the document, once
      const nodes = new Set<Element>();
      for (const shape of shapes) {
        for (let node: Element | null = shape; node; node = node.parentElement) {
          nodes.add(node);
        }
      }
      expect(styles).toBe(nodes.size);
      // a hover class on the plain cell reaches no region: nothing is read
      styles = 0;
      callbacks = 0;
      await act(async () => {
        cells.get('other')!.group.setAttribute('class', 'dmap-hover');
      });
      expect(callbacks).toBe(1);
      expect(styles).toBe(0);
      // a class on the cell of one chart runs that region only: its own nodes, once
      await act(async () => {
        cells.get('a')!.group.setAttribute('class', 'dmap-hover');
      });
      expect(styles).toBeGreaterThan(0);
      expect(styles).toBeLessThan(nodes.size);
      unmount();
    } finally {
      vi.unstubAllGlobals();
      host.remove();
    }
  });
  it('explains an invalid anchor without drawing the chart', () => {
    const s = setup(historyClass, cpu());
    Object.assign(s.rect, { getCTM: () => null });
    sparkline.mockClear();
    const { getByRole, unmount } = render(layer(s));
    expect(getByRole('status').textContent).toMatch(/CPU.*rectangle.*transform/);
    expect(drawn(s)).toBeNull();
    expect(sparkline).not.toHaveBeenCalled();
    unmount();
    s.host.remove();
  });
  it('creates only explicit regions after the primitive, follows its relative matrix and releases a clipped chart', async () => {
    const s = setup(historyClass, cpu());
    const { rerender, unmount } = render(layer(s));
    expect(s.root.querySelectorAll('foreignObject')).toHaveLength(1);
    const region = s.root.querySelector('foreignObject')!;
    expect(s.rect.nextElementSibling).toBe(region);
    expect(region.getAttribute('transform')).toBe('matrix(1 0 0 1 12 5)');
    expect(region.getAttribute('width')).toBe('180');
    expect(region.style.pointerEvents).toBe('none');
    expect(drawn(s)).toBeTruthy();
    // a pan or a zoom writes the viewBox and settles with a new revision of the layer: the clipped chart releases
    s.move(500);
    s.root.setAttribute('viewBox', '0 0 100 100');
    rerender(layer(s, { revision: 2 }));
    expect(drawn(s)).toBeNull();
    s.move(20);
    rerender(layer(s, { revision: 3 }));
    expect(drawn(s)).toBeTruthy();
    unmount();
    expect(s.root.querySelector('foreignObject')).toBeNull();
    s.host.remove();
  });
});
