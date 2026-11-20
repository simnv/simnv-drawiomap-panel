import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  type DataFrame,
  type DataQueryRequest,
  type PanelData,
} from '@grafana/data';
import { ChartLayer, chartUsesV4 } from './ChartLayer';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { bindContextFor } from '../binding/context';
import { bindV4 } from '../binding/bindV4';
import { validateConfig } from '../model/validate';
import { FOCUS_ACTIVE } from '../render/linkFocus';
import { LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../legend/highlight';
import type { CardContextV4 } from '../interact/cardModel';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: any) => fn(createTheme()),
  Portal: ({ children }: any) => <div>{children}</div>,
  SeriesTable: () => <div />,
  Sparkline: () => <canvas data-testid="sparkline" />,
  BarGauge: () => <div />,
}));

/**
 * The cost of the chart regions on the hot paths, on a synthetic map with 10 chart regions in nested groups:
 * the layout reads of one pan or zoom frame (a viewBox write), and the region passes (the `getBBox` of a chart cell)
 * of a root class write (hover focus, legend highlight) and of a hover switch.
 */
const CHARTS = 10;
const BOX = { left: 30, top: 40, width: 400, height: 200 };
const T = [0, 60_000, 120_000];
const theme = createTheme();
const bindCtx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });

/** A padding of the svg in px: the viewBox maps into the content box, smaller than the box of the svg. */
let pad = 0;

/**
 * The screen CTM of a root svg per SVG 2 for `xMidYMid meet` or `xMidYMin meet` in BOX (less the padding): the
 * browser's answer. With no valid viewBox the browser applies none.
 */
function screenOf(root: SVGSVGElement) {
  const [x, y, w, h] = (root.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const [left, top, width, height] = [BOX.left + pad, BOX.top + pad, BOX.width - 2 * pad, BOX.height - 2 * pad];
  if (!(w > 0 && h > 0)) {
    return { a: 1, b: 0, c: 0, d: 1, e: left, f: top };
  }
  const k = Math.min(width / w, height / h);
  const yMin = (root.getAttribute('preserveAspectRatio') ?? '').includes('YMin');
  return {
    a: k,
    b: 0,
    c: 0,
    d: k,
    e: left + (width - w * k) / 2 - x * k,
    f: top + (yMin ? 0 : (height - h * k) / 2) - y * k,
  };
}

function mapStage() {
  const host = document.createElement('div');
  document.body.append(host);
  let body = '';
  for (let i = 0; i < CHARTS; i++) {
    body +=
      `<g data-layer="l${i % 2}" transform="translate(${i * 3} 0)"><g data-cell-id="c${i}" data-meta-bind="host" ` +
      `data-meta-key="node-${i}"><rect width="40" height="20"/></g></g>`;
  }
  body +=
    '<g data-cell-id="link"><path d="M 0 0 L 10 10"/></g><g data-cell-id="plain"><rect width="5" height="5"/></g>';
  const root = mountSvg(host, `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  root.setAttribute('viewBox', '0 0 800 400');
  root.setAttribute('width', `${BOX.width}`);
  root.setAttribute('height', `${BOX.height}`);
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const cells = buildCellIndex(root);
  const reads = { layout: 0, bbox: 0 };
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  for (let i = 0; i < CHARTS; i++) {
    const shape = cells.get(`c${i}`)!.shape!;
    Object.assign(shape.parentElement!, { getCTM: () => identity });
    Object.assign(shape, {
      getCTM: () => identity,
      getBBox: () => {
        reads.bbox++;
        return { x: 0, y: 0, width: 40, height: 20 };
      },
      getBoundingClientRect: () => ({ left: 40, top: 50, right: 80, bottom: 70, width: 40, height: 20 }),
    });
  }
  const rect = () => ({ ...BOX, right: BOX.left + BOX.width, bottom: BOX.top + BOX.height });
  Object.assign(host, {
    getBoundingClientRect: () => {
      reads.layout++;
      return { left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300 };
    },
  });
  Object.assign(root, {
    getBoundingClientRect: () => {
      reads.layout++;
      return rect();
    },
    getScreenCTM: () => {
      reads.layout++;
      return screenOf(root);
    },
  });
  const validated = validateConfig({
    version: 4,
    classes: { host: { match: { key: 'job' }, chart: { kind: 'history', query: 'cpu', label: 'CPU' } } },
  });
  const series: DataFrame[] = Array.from({ length: CHARTS }, (_, i) => ({
    refId: 'cpu',
    length: 3,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: T },
      { name: 'Value', type: FieldType.number, config: {}, labels: { job: `node-${i}` }, values: [1, 2, 3] },
    ],
  }));
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
    targets: [{ refId: 'cpu' }],
  };
  const data: PanelData = { state: LoadingState.Done, series, timeRange, request };
  const bound = bindV4({ index: cells, validated, data, ctx: bindCtx });
  const ctx: CardContextV4 = { theme, replaceVariables: (v) => v, index: cells, validated, data };
  const view = render(
    <ChartLayer root={root} cells={cells} viewport={host} charts={chartUsesV4(bound)} bound={bound} ctx={ctx} />
  );
  const plane = () => host.querySelector<HTMLElement>('[data-dmap-chart-layer] > div')!;
  return { host, root, cells, reads, view, plane };
}

type Stage = ReturnType<typeof mapStage>;
let open: Stage | undefined;
afterEach(() => {
  pad = 0;
  open?.view.unmount();
  open?.host.remove();
  open = undefined;
});

/** The plane transform that a read of the screen CTM gives: the screen CTM minus the box of the svg. */
function expectedPlane(root: SVGSVGElement) {
  const m = screenOf(root);
  return [m.a, m.b, m.c, m.d, m.e - BOX.left, m.f - BOX.top];
}
const planeOf = (s: Stage) =>
  s
    .plane()
    .style.transform.replace(/^matrix\(|\)$/g, '')
    .split(',')
    .map(Number);

describe('ChartLayer cost on the hot paths (10 chart regions)', () => {
  it('a pan or zoom frame reads no layout, and the plane stays where a read of the screen CTM puts it', async () => {
    const s = (open = mapStage());
    expect(s.host.querySelectorAll('[data-testid="dmap-chart"]')).toHaveLength(CHARTS);
    const frames: Array<[number, number, number, number]> = [];
    for (let i = 1; i <= 10; i++) {
      // a drag, then a wheel zoom around a point, as usePanZoom writes them
      frames.push(
        i <= 5 ? [-i * 7.5, i * 3.25, 800, 400] : [100 + i, 50 - i, 800 / (1 + i * 0.13), 400 / (1 + i * 0.13)]
      );
    }
    s.reads.layout = 0;
    s.reads.bbox = 0;
    for (const [x, y, w, h] of frames) {
      await act(async () => {
        s.root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      });
      const got = planeOf(s);
      expectedPlane(s.root).forEach((v, k) => expect(got[k]).toBeCloseTo(v, 9));
    }
    console.info(`pan/zoom: ${s.reads.layout} layout reads in ${frames.length} frames, ${s.reads.bbox} region reads`);
    expect(s.reads.layout).toBe(0);
    expect(s.reads.bbox).toBe(0);
    // a new alignment (a layout of the panel) reads the screen CTM again, and the frames after it follow it
    await act(async () => {
      s.root.setAttribute('preserveAspectRatio', 'xMidYMin meet');
    });
    expect(s.reads.layout).toBeGreaterThan(0);
    s.reads.layout = 0;
    await act(async () => {
      s.root.setAttribute('viewBox', '10 20 300 400');
    });
    expect(s.reads.layout).toBe(0);
    const got = planeOf(s);
    expectedPlane(s.root).forEach((v, k) => expect(got[k]).toBeCloseTo(v, 9));
  });

  it('a root class write and a hover switch run no region pass', async () => {
    const s = (open = mapStage());
    const groups = (id: string) => s.cells.get(id)!.group;
    s.reads.bbox = 0;
    // focusCells adds the root class on each hover switch, also when the root has it
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        s.root.classList.add(FOCUS_ACTIVE);
      });
    }
    const focus = s.reads.bbox;
    // ten hover switches: the focus class, a focus layer under the root with copies, a near mark on a link
    s.reads.bbox = 0;
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        s.root.classList.toggle(FOCUS_ACTIVE, i % 2 === 0);
        const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        s.root.append(layer);
        layer.setAttribute('transform', `translate(${i} 0)`);
        groups('link').setAttribute('class', i % 2 ? '' : 'dmap-near');
        groups('plain').setAttribute('style', `opacity: ${i % 2 ? 1 : 0.5}`);
        layer.remove();
      });
    }
    const hover = s.reads.bbox;
    // a legend highlight: the root and the groups of its cells get the legend classes
    s.reads.bbox = 0;
    await act(async () => {
      s.root.classList.add(LEGEND_ACTIVE);
      groups('c1').classList.add(LEGEND_MEMBER, LEGEND_HIT);
      groups('c2').classList.add(LEGEND_MEMBER);
    });
    await act(async () => {
      s.root.classList.remove(LEGEND_ACTIVE);
      groups('c1').classList.remove(LEGEND_MEMBER, LEGEND_HIT);
      groups('c2').classList.remove(LEGEND_MEMBER);
    });
    const legend = s.reads.bbox;
    console.info(`root class x10: ${focus} region passes; hover switch x10: ${hover}; legend on/off: ${legend}`);
    expect(focus).toBe(0);
    expect(hover).toBe(0);
    expect(legend).toBe(0);
  });

  it('still re-reads the regions under a change that can move, resize or hide them', async () => {
    const s = (open = mapStage());
    const layer0 = s.cells.get('c0')!.group.parentElement!;
    s.reads.bbox = 0;
    // an ancestor transform: the regions under it (c0 only)
    await act(async () => {
      layer0.setAttribute('transform', 'translate(5 5)');
    });
    expect(s.reads.bbox).toBe(1);
    // the shape itself
    s.reads.bbox = 0;
    await act(async () => {
      s.cells.get('c3')!.shape!.setAttribute('width', '50');
    });
    expect(s.reads.bbox).toBe(1);
    // a class that is not a mark of the panel, on the cell group
    s.reads.bbox = 0;
    await act(async () => {
      s.cells.get('c4')!.group.setAttribute('class', 'hidden-by-author');
    });
    expect(s.reads.bbox).toBe(1);
    // the root style (display) and a root class that is not a mark: every region
    s.reads.bbox = 0;
    await act(async () => {
      s.root.setAttribute('style', 'display: none');
    });
    expect(s.reads.bbox).toBe(CHARTS);
    expect(s.host.querySelectorAll('[data-testid="dmap-chart"]')).toHaveLength(0);
    s.reads.bbox = 0;
    await act(async () => {
      s.root.removeAttribute('style');
      s.root.classList.add('author-theme');
    });
    expect(s.reads.bbox).toBe(CHARTS);
    expect(s.host.querySelectorAll('[data-testid="dmap-chart"]')).toHaveLength(CHARTS);
  });

  it('reads the screen CTM on each frame where the viewBox model does not hold: a padding, no valid viewBox', async () => {
    pad = 6;
    const s = (open = mapStage());
    for (const vb of ['-20 10 800 400', '5 5 400 200']) {
      s.reads.layout = 0;
      await act(async () => {
        s.root.setAttribute('viewBox', vb);
      });
      expect(s.reads.layout).toBeGreaterThan(0);
      const got = planeOf(s);
      expectedPlane(s.root).forEach((v, k) => expect(got[k]).toBeCloseTo(v, 9));
    }
    pad = 0;
    await act(async () => {
      s.root.setAttribute('width', `${BOX.width}`);
    });
    await act(async () => {
      s.root.setAttribute('viewBox', '0 0 0 0');
    });
    s.reads.layout = 0;
    await act(async () => {
      s.root.setAttribute('viewBox', '0 0 800 400');
    });
    expect(s.reads.layout).toBeGreaterThan(0);
    const got = planeOf(s);
    expectedPlane(s.root).forEach((v, k) => expect(got[k]).toBeCloseTo(v, 9));
  });

  it('a class change on an ancestor of the panel re-reads every region, also to an empty class', async () => {
    const s = (open = mapStage());
    s.host.setAttribute('class', 'collapsed');
    await act(async () => undefined);
    s.reads.bbox = 0;
    await act(async () => {
      s.host.setAttribute('class', '');
    });
    expect(s.reads.bbox).toBe(CHARTS);
  });
});
