import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import {
  createTheme,
  FieldConfig,
  FieldType,
  getDefaultTimeRange,
  LoadingState,
  MappingType,
  PanelProps,
  ThemeContext,
  ThresholdsMode,
  toDataFrame,
} from '@grafana/data';
import { DrawioMapPanel } from './DrawioMapPanel';
import { fnv1a } from '../util/hash';
import type { Options } from '../types';
import type { ConfigV4 } from '../model/v4';
import { demoConfigV4 } from '../fixtures/demo-config';

/** Count the binds, patch applications and view renders of the panel. */
const work = vi.hoisted(() => ({ applied: [] as unknown[], binds: 0, viewRenders: 0, panelStage: 'dmap-stage' }));
vi.mock('../render/applier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render/applier')>();
  return {
    ...actual,
    applyPatches: (...args: Parameters<typeof actual.applyPatches>) => {
      work.applied.push(args[0]);
      return actual.applyPatches(...args);
    },
  };
});
vi.mock('../binding/bindV4', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../binding/bindV4')>();
  return {
    ...actual,
    bindV4: (...args: Parameters<typeof actual.bindV4>) => {
      work.binds++;
      return actual.bindV4(...args);
    },
  };
});
vi.mock('../stage/useStage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stage/useStage')>();
  return {
    ...actual,
    useStage: (...args: Parameters<typeof actual.useStage>) => {
      // The ref of the panel stage points to the element with the panel test id.
      if ((args[0].current as HTMLElement | null)?.dataset?.testid === work.panelStage) {
        work.viewRenders++;
      }
      return actual.useStage(...args);
    },
  };
});
vi.mock('@grafana/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/ui')>()),
  Sparkline: (props: { width: number; height: number }) => (
    <canvas data-testid="grafana-sparkline" width={props.width} height={props.height} />
  ),
  BarGauge: () => <div data-testid="grafana-bar" />,
}));

// @grafana/ui reads matchMedia (uPlot) and localStorage (logger) when it loads. Set them before the imports run.
vi.hoisted(() => {
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

/** The demo L3 diagram: its cells carry `bind`, `key`, `port`, `at` and `cap` (fixtures/demo/demo-l3.yaml). */
const svg = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8');

/**
 * A frame with one sample every 5 s, the last one now: the demo freshness (3x the cadence) keeps it fresh.
 * `config`: the field config after the overrides, as Grafana gives it to the panel.
 */
const frame = (refId: string, labels: Record<string, string>, values: number[], config: FieldConfig = {}) => {
  const now = Date.now();
  return toDataFrame({
    refId,
    fields: [
      { name: 'Time', type: FieldType.time, values: values.map((_, i) => now - (values.length - 1 - i) * 5000) },
      { name: 'Value', type: FieldType.number, values, labels, config },
    ],
  });
};

// the `up` override of the demo dashboard
const upThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'red' },
    { value: 1, color: 'green' },
  ],
};

const options: Options = {
  diagram: { xml: '<mxfile/>', svg, hash: fnv1a(svg), updatedAt: '2026-10-17T00:00:00Z' },
  zoom: { mode: 'fit', percent: 100, wheel: false, pan: false },
  linkWidth: { min: 2, max: 10 },
  config: demoConfigV4,
};

/** The demo config with a change to one class. */
const withClass = (name: string, over: Partial<ConfigV4['classes'][string]>): ConfigV4 => ({
  ...demoConfigV4,
  classes: { ...demoConfigV4.classes, [name]: { ...demoConfigV4.classes[name], ...over } },
});

/**
 * The demo series: two WAN links (41 % and 90 % of cap=100M a→b), rtr-a up, LTE down, and the CPU of rtr-b. The
 * other cells have no series: rtr-b has no `up` series, so its status is missing.
 */
function demoSeries() {
  return [
    frame('wan_tx', { job: 'node-isp-a', device: 'pppoe' }, [41e6]),
    frame('wan_rx', { job: 'node-isp-a', device: 'pppoe' }, [10e6]),
    frame('wan_tx', { job: 'node-radio', device: 'dhcp' }, [90e6]),
    frame('wan_rx', { job: 'node-radio', device: 'dhcp' }, [16e6]),
    frame('up', { job: 'node-rtr-a' }, [1], { thresholds: upThresholds }),
    frame('up', { job: 'node-lte' }, [0], { thresholds: upThresholds }),
    frame('cpu', { job: 'node-rtr-b' }, [12, 30, 42]),
  ];
}

function props(over: Partial<PanelProps<Options>> = {}): PanelProps<Options> {
  return {
    id: 1,
    title: 't',
    transparent: false,
    width: 800,
    height: 600,
    options,
    data: { series: demoSeries(), state: LoadingState.Done, timeRange: getDefaultTimeRange() },
    timeRange: getDefaultTimeRange(),
    timeZone: 'browser',
    fieldConfig: {
      defaults: {
        unit: 'bps',
        thresholds: {
          mode: ThresholdsMode.Absolute,
          steps: [
            { value: -Infinity, color: 'green' },
            { value: 60, color: 'yellow' },
            { value: 85, color: 'red' },
          ],
        },
      },
      overrides: [],
    },
    replaceVariables: (s: string) => s,
    renderCounter: 0,
    onOptionsChange: () => {},
    onFieldConfigChange: () => {},
    onChangeTimeRange: () => {},
    eventBus: {
      publish() {},
      subscribe() {
        return { unsubscribe() {} };
      },
      getStream() {
        return {
          subscribe() {
            return { unsubscribe() {} };
          },
        };
      },
      removeAllListeners() {},
      newScopedBus() {
        return this;
      },
    } as never,
    ...over,
  } as PanelProps<Options>;
}

/** Stub the SVG geometry of a chart region: a 180 x 70 box at the origin in a 400 x 200 viewport. */
function stubRegionGeometry(): () => void {
  const ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getCTM');
  const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
  Object.defineProperties(SVGElement.prototype, {
    getCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    getBBox: { configurable: true, value: () => ({ x: 0, y: 0, width: 180, height: 70 }) },
  });
  const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 200,
    width: 400,
    height: 200,
    toJSON: () => ({}),
  });
  return () => {
    bounds.mockRestore();
    for (const [name, saved] of [
      ['getCTM', ctm],
      ['getBBox', bbox],
    ] as const) {
      if (saved) {
        Object.defineProperty(SVGElement.prototype, name, saved);
      } else {
        Reflect.deleteProperty(SVGElement.prototype, name);
      }
    }
  };
}

describe('DrawioMapPanel', () => {
  it.each([null, 1])('has no bindings editor when editPanel is %s', async (editPanel) => {
    locationService.partial({ editPanel });
    onTestFinished(() => act(() => locationService.partial({ editPanel: null })));
    render(<DrawioMapPanel {...props({ options: { ...options, rules: [{ name: 'old' }] } })} />);
    const badge = await screen.findByTestId('dmap-warning-badge');
    expect(screen.queryByRole('button', { name: 'Edit bindings' })).toBeNull();
    expect(screen.queryByTestId('dmap-edit-bindings')).toBeNull();
    const count = badge.textContent;
    fireEvent.click(badge);
    expect(badge.textContent).toBe(count);
    expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the warning count and opens nothing when the badge is clicked in edit mode', async () => {
    locationService.partial({ editPanel: 1 });
    onTestFinished(() => act(() => locationService.partial({ editPanel: null })));
    render(<DrawioMapPanel {...props({ options: { ...options, rules: [{ name: 'old' }] } })} />);
    const badge = await screen.findByTestId('dmap-warning-badge');
    const count = badge.textContent;
    expect(count).toMatch(/\d+ warnings?/);
    fireEvent.click(badge);
    expect(badge.textContent).toBe(count);
    expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the v4 demo config: a link half takes its colour, a node with no series is grey', async () => {
    const { container } = render(<DrawioMapPanel {...props()} />);
    const half = await waitFor(() => {
      const found = container.querySelector(
        'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~isp-a:pppoe->rtr-a:wan1"]'
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(half.getAttribute('data-dmap-status')).toBe('ok');
    expect(half.getAttribute('stroke')).toBe(createTheme().visualization.getColorByName('green'));
    // proxy-b: its override selects no series of `up`, so the cell is missing (grey), never a good state
    const proxy = container.querySelector('[data-cell-id="pg-node~proxy-b"]')!;
    expect(proxy.getAttribute('data-dmap-status')).toBe('missing');
    // up = 0 is on the red step of the thresholds: critical
    expect(container.querySelector('[data-cell-id="pg-node~lte"]')!.getAttribute('data-dmap-status')).toBe('critical');
  });

  it('shows one notice for a version 3 config and binds nothing', async () => {
    const old = { version: 3, queries: [], patterns: [] } as unknown as Options['config'];
    const { container, findByTestId } = render(<DrawioMapPanel {...props({ options: { ...options, config: old } })} />);
    const wrapper = await findByTestId('dmap-panel');
    await waitFor(() => expect(wrapper.getAttribute('data-dmap-warnings')).toBe('1'));
    expect(wrapper.getAttribute('data-dmap-patched')).toBe('0');
    expect(container.querySelector('polyline.dmap-half')).toBeNull();
    expect(screen.getByTestId('dmap-warning-badge').getAttribute('title')).toMatch(/version 3/);
  });

  it('attaches only the chart regions of the classes and keeps a query error inside its region', async () => {
    const restore = stubRegionGeometry();
    try {
      const config: ConfigV4 = {
        version: 4,
        freshness: '3x',
        classes: { trend: { match: { key: 'device' }, chart: { kind: 'history', label: 'CPU chart', query: 'cpu' } } },
        overrides: {},
      };
      const small =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="chart" data-meta-bind="trend" data-meta-key="c1"><rect width="180" height="70"/></g><g data-cell-id="ordinary"><rect x="200" width="40" height="30"/><text>Ordinary device</text></g></svg>';
      const p = props();
      const { container, unmount } = render(
        <DrawioMapPanel
          {...p}
          options={{ ...options, config, diagram: { xml: '', svg: small, hash: 'explicit-chart', updatedAt: '' } }}
          data={{
            ...p.data,
            series: [],
            state: LoadingState.Error,
            errors: [{ refId: 'cpu', message: 'private datasource failure' }],
          }}
        />
      );
      await waitFor(() => expect(screen.getByTestId('dmap-chart').textContent).toContain('Query failed'));
      expect(container.querySelectorAll('foreignObject[data-dmap-chart]')).toHaveLength(1);
      expect(container.querySelector('[data-cell-id="ordinary"] foreignObject')).toBeNull();
      expect(container.querySelector('[data-cell-id="ordinary"] text')?.textContent).toBe('Ordinary device');
      expect(container.textContent).not.toContain('private datasource failure');
      unmount();
    } finally {
      restore();
    }
  });

  it('shows an empty state without a diagram', () => {
    const { getByTestId } = render(<DrawioMapPanel {...props({ options: { ...options, diagram: undefined } })} />);
    expect(getByTestId('dmap-empty')).toBeTruthy();
  });

  it('ignores an editorUrl value that an older version saved', async () => {
    const legacy = { ...options, editorUrl: 'http://localhost:8080' } as Options;
    const { findByTestId } = render(<DrawioMapPanel {...props({ options: legacy })} />);
    expect(await findByTestId('dmap-panel')).toBeTruthy();
  });

  it('ignores the saved rules of version 1, binds the v4 config and adds one warning for them', async () => {
    const p = props();
    const { container, rerender, findByTestId } = render(<DrawioMapPanel {...p} />);
    const wrapper = await findByTestId('dmap-panel');
    await waitFor(() => expect(container.querySelector('polyline.dmap-half')).not.toBeNull());
    const before = Number(wrapper.getAttribute('data-dmap-warnings'));
    const saved = { ...options, rules: [{ name: 'links', select: { kind: 'link' } }, { name: 'old' }] };
    rerender(<DrawioMapPanel {...p} options={saved} />);
    await waitFor(() => expect(Number(wrapper.getAttribute('data-dmap-warnings'))).toBe(before + 1));
    // the config still binds the links
    expect(container.querySelector('polyline.dmap-half')).not.toBeNull();
    const badge = screen.getByTestId('dmap-warning-badge');
    expect(badge.getAttribute('title')!.split('\n')[0]).toBe(
      'The panel ignores 2 rules of version 1. Write the bindings again as a version 4 config.'
    );
  });

  it('mounts the svg, binds and draws overlay halves', async () => {
    const { container, findByTestId } = render(<DrawioMapPanel {...props()} />);
    const wrapper = await findByTestId('dmap-panel');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(container.querySelectorAll('svg g[data-cell-id]').length).toBe(108);
    expect(wrapper.getAttribute('data-dmap-cells')).toBe('108');
    const a2b = container.querySelector(
      'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~isp-a:pppoe->rtr-a:wan1"]'
    )!;
    expect(a2b.getAttribute('data-dmap-step')).toBe('0');
    const red = container.querySelector(
      'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~radio:dhcp->rtr-a:wan2"]'
    )!;
    expect(red.getAttribute('data-dmap-step')).toBe('2');
    const lte = container.querySelector(
      'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~lte:static->rtr-a:wan3"]'
    )!;
    expect(lte.getAttribute('data-dmap-status')).toBe('nodata');
    expect(container.querySelector('[data-cell-id="pg-node~lte"]')!.getAttribute('data-dmap-status')).toBe('critical');
    expect(container.querySelector('[data-cell-id="pg-node~rtr-a"]')!.getAttribute('data-dmap-status')).toBe('normal');
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('100%');
  });

  it('sets the svg root color-scheme from the Grafana theme, not from the OS preference', () => {
    // draw.io writes color-scheme: light dark on the root, so light-dark() colours follow the OS.
    const themed = (mode: 'dark' | 'light') => (
      <ThemeContext.Provider value={createTheme({ colors: { mode } })}>
        <DrawioMapPanel {...props()} />
      </ThemeContext.Provider>
    );
    const { container, rerender } = render(themed('dark'));
    const root = container.querySelector('svg') as SVGSVGElement;
    expect(root.style.colorScheme).toBe('dark');
    rerender(themed('light'));
    expect(root.style.colorScheme).toBe('light');
  });

  it('zooms on the wheel with a non-passive listener when wheel zoom is on', async () => {
    const { findByTestId, container } = render(
      <DrawioMapPanel {...props({ options: { ...options, zoom: { ...options.zoom, wheel: true } } })} />
    );
    const wrapper = await findByTestId('dmap-panel');
    const svgEl = container.querySelector('svg')!;
    await waitFor(() => expect(svgEl.getAttribute('width')).toBe('100%'));
    const before = svgEl.getAttribute('viewBox');
    const ev = new WheelEvent('wheel', { deltaY: -100, clientX: 0, clientY: 0, bubbles: true, cancelable: true });
    wrapper.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() => expect(svgEl.getAttribute('viewBox')).not.toBe(before));
  });

  it('contains no draw.io runtime', () => {
    const { container } = render(<DrawioMapPanel {...props()} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('DrawioMapPanel hover card', () => {
  const linkId = 'pg-link~isp-a:pppoe->rtr-a:wan1';
  async function setup(p = props()) {
    const r = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(r.container.querySelector('polyline.dmap-half')).not.toBeNull());
    const half = (cell: string) =>
      r.container.querySelector(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`)!;
    const cell = (id: string) => r.container.querySelector(`[data-cell-id="${id}"]`)!;
    return { ...r, half, cell, wrapper: screen.getByTestId('dmap-panel') };
  }
  const card = () => screen.queryByTestId('dmap-card');

  describe('hover cost', () => {
    it('a hover over two cells in turn does not bind or patch the diagram again', async () => {
      const { half, cell, unmount } = await setup();
      fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 10, clientY: 10 });
      await screen.findByRole('tooltip');
      await act(async () => {
        await new Promise((done) => setTimeout(done, 50));
      });
      const binds = work.binds;
      const applied = work.applied.length;
      fireEvent.pointerMove(cell('pg-node~rtr-b'), { pointerType: 'mouse', clientX: 60, clientY: 10 });
      await waitFor(() => expect(screen.getByRole('tooltip').getAttribute('aria-label')).toContain('rtr-b'));
      fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 10, clientY: 10 });
      await waitFor(() => expect(screen.getByRole('tooltip').getAttribute('aria-label')).toContain('ISP A'));
      expect(work.binds).toBe(binds);
      expect(work.applied.length).toBe(applied);
      unmount();
    });

    it('pointer moves inside one cell render the panel at most once', async () => {
      const { half, unmount } = await setup();
      fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 10, clientY: 10 });
      await screen.findByRole('tooltip');
      const renders = work.viewRenders;
      const shown = screen.getByTestId('dmap-card');
      for (let i = 0; i < 20; i++) {
        fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 10 + i, clientY: 10 + i });
      }
      expect(work.viewRenders - renders).toBeLessThanOrEqual(1);
      expect(screen.getByTestId('dmap-card')).toBe(shown);
      unmount();
    });
  });

  it('renders no card and no canvas value labels or sparklines until the pointer is on a cell', async () => {
    const { container } = await setup();
    expect(card()).toBeNull();
    expect(container.querySelector('.dmap-label, .dmap-spark')).toBeNull();
  });

  it('hover shows a card with both directions; leaving the panel hides it', async () => {
    const { half, wrapper } = await setup();
    fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 50, clientY: 40 });
    const c = await screen.findByRole('tooltip');
    expect(c.textContent).toContain('Traffic');
    // the updown row: the up and down values; the test frames have no unit
    expect(c.textContent).toContain('↑ 41000000');
    expect(c.textContent).toContain('↓ 10000000');
    expect(c.getAttribute('aria-label')).toBe('ISP A pppoe ↔ rtr-a wan1');
    expect(c.getAttribute('data-pinned')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(card()).toBeNull();
  });

  it('leaving the panel hides the hover card also without a pointerout (the cell under the pointer was redrawn)', async () => {
    const { half, wrapper } = await setup();
    fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 50, clientY: 40 });
    await screen.findByRole('tooltip');
    // Chrome sends no pointerout from a removed element; only the native pointerleave of the panel comes
    act(() => {
      wrapper.dispatchEvent(new Event('pointerleave'));
    });
    expect(card()).toBeNull();
  });

  it('click pins the card as a dialog with a close button and the footer link of the class URL', async () => {
    const { half } = await setup();
    fireEvent.click(half(linkId), { clientX: 50, clientY: 40 });
    const dialog = await screen.findByRole('dialog', { name: 'ISP A pppoe ↔ rtr-a wan1' });
    expect(document.activeElement).toBe(dialog);
    const rows = screen.getAllByTestId('dmap-card-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Traffic');
    // the urlTitle of the class names the footer link; a small link button with an external icon
    const footer = screen.getByRole('link', { name: 'Traffic of node-isp-a:pppoe' });
    expect(footer.getAttribute('href')).toBe('/d/drawiomap-demo?var-job=node-isp-a&var-device=pppoe');
    expect(footer.getAttribute('target')).toBe('_blank');
    expect(footer.getAttribute('data-testid')).toBe('dmap-card-link');
    // the external-link icon: Icon renders no svg in jsdom, the e2e test checks it
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(card()).toBeNull();
  });

  it('a pinned card ignores hover, Esc closes it', async () => {
    const { half } = await setup();
    fireEvent.click(half(linkId), { clientX: 50, clientY: 40 });
    await screen.findByRole('dialog');
    fireEvent.pointerMove(half('pg-link~radio:dhcp->rtr-a:wan2'), { pointerType: 'mouse' });
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('ISP A pppoe ↔ rtr-a wan1');
    const grafana = vi.fn();
    document.addEventListener('keydown', grafana);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    document.removeEventListener('keydown', grafana);
    expect(card()).toBeNull();
    // Grafana does not see this Esc (it would leave the panel view)
    expect(grafana).not.toHaveBeenCalled();
  });

  it('a click on another cell moves the pin; a click on empty space or outside the panel closes it', async () => {
    const { half, wrapper } = await setup();
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    fireEvent.click(half('pg-link~radio:dhcp->rtr-a:wan2'));
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Radio bridge dhcp ↔ rtr-a wan2');
    // a click inside the card keeps it
    fireEvent.click(screen.getAllByTestId('dmap-card-row')[0]);
    expect(card()).not.toBeNull();
    fireEvent.click(wrapper.querySelector('svg')!);
    expect(card()).toBeNull();
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    fireEvent.pointerDown(document.body);
    expect(card()).toBeNull();
  });

  it('touch: a moving finger opens nothing, a tap pins the card', async () => {
    const { half } = await setup();
    fireEvent.pointerMove(half(linkId), { pointerType: 'touch' });
    expect(card()).toBeNull();
    fireEvent.pointerDown(half(linkId), { pointerType: 'touch' });
    fireEvent.click(half(linkId));
    expect((await screen.findByRole('dialog')).getAttribute('data-pinned')).toBe('true');
  });

  it('a device without hover opens the card only on a tap', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q === '(hover: none)',
      addEventListener() {},
      removeEventListener() {},
    })) as never;
    try {
      const { half } = await setup();
      fireEvent.pointerMove(half(linkId), { pointerType: 'mouse' });
      expect(card()).toBeNull();
      fireEvent.click(half(linkId));
      await screen.findByRole('dialog');
    } finally {
      window.matchMedia = mm;
    }
  });

  it('with wheel zoom on, the wheel scrolls the card and does not zoom', async () => {
    const { half, wrapper } = await setup(props({ options: { ...options, zoom: { ...options.zoom, wheel: true } } }));
    fireEvent.click(half(linkId));
    const dialog = await screen.findByRole('dialog');
    const ev = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    dialog.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    const outside = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    wrapper.querySelector('svg')!.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
  });

  it('keyboard: Enter on a focused cell pins its card, Esc closes it and gives the focus back', async () => {
    const { cell } = await setup();
    const node = cell('pg-node~rtr-b') as SVGGElement;
    expect(node.getAttribute('tabindex')).toBe('0');
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(node);
  });

  it('closes a pinned card when its cell loses the patch, and hover works again', async () => {
    const p = props();
    const { cell, half, rerender } = await setup(p);
    fireEvent.click(cell('pg-node~rtr-b'));
    await screen.findByRole('dialog');
    // a version 3 config binds nothing: no cell has a patch now
    const old = { version: 3 } as unknown as Options['config'];
    rerender(<DrawioMapPanel {...p} options={{ ...options, config: old }} />);
    expect(card()).toBeNull();
    rerender(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(half(linkId)).not.toBeNull());
    fireEvent.pointerMove(half(linkId), { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });

  it('leaving the panel keeps a pinned card', async () => {
    const { half, wrapper } = await setup();
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    act(() => {
      wrapper.dispatchEvent(new Event('pointerleave'));
    });
    expect(card()!.getAttribute('data-pinned')).toBe('true');
  });

  it('a new diagram closes a pinned card, also when the cell is still there', async () => {
    const p = props();
    const { half, rerender } = await setup(p);
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    const diagram = { ...options.diagram!, hash: 'another-diagram' };
    rerender(<DrawioMapPanel {...p} options={{ ...options, diagram }} />);
    expect(card()).toBeNull();
  });

  it('a pinned card stays open through a data refresh and shows the new value', async () => {
    const p = props();
    const { cell, rerender } = await setup(p);
    fireEvent.click(cell('pg-node~rtr-b'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('42%');
    const series = p.data.series.map((f) =>
      f.refId === 'cpu' ? frame('cpu', { job: 'node-rtr-b' }, [12, 30, 55]) : f
    );
    rerender(
      <DrawioMapPanel {...p} renderCounter={1} data={{ ...p.data, series, timeRange: getDefaultTimeRange() }} />
    );
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('55%'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(card()!.getAttribute('data-pinned')).toBe('true');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(dialog.getAttribute('aria-label'));
  });

  it('a pinned card shows the Grafana data links of the field after the class URL', async () => {
    const p = props();
    const series = p.data.series.map((f) => {
      if (f.refId === 'wan_tx' && f.fields[1].labels?.device === 'pppoe') {
        const field = f.fields[1];
        field.getLinks = () => [
          { title: 'Interface details', href: '/d/iface?var-device=pppoe', target: '_blank', origin: field },
        ];
      }
      return f;
    });
    const { half } = await setup(props({ data: { ...p.data, series } }));
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    const links = screen.getAllByTestId('dmap-card-link');
    expect(links.map((l) => l.textContent)).toEqual(['Traffic of node-isp-a:pppoe', 'Interface details']);
    expect(links[1].getAttribute('href')).toBe('/d/iface?var-device=pppoe');
  });

  it('a link with no url, rows or status opens a card when its field has data links', async () => {
    const { url: _url, urlTitle: _title, ...wan } = demoConfigV4.classes.wan;
    const config: ConfigV4 = { ...demoConfigV4, classes: { ...demoConfigV4.classes, wan: { ...wan, rows: [] } } };
    const p = props({ options: { ...options, config } });
    const interactive = (container: HTMLElement) =>
      container.querySelector(`[data-cell-id="${linkId}"]`)!.hasAttribute('data-dmap-interactive');
    const plain = await setup(p);
    await waitFor(() => expect(interactive(plain.container)).toBe(false));
    plain.unmount();
    const links = [{ title: 'Interface details', url: '/d/iface?var-device=pppoe' }];
    const series = demoSeries().map((f) => {
      if (f.refId === 'wan_tx' && f.fields[1].labels?.device === 'pppoe') {
        const field = f.fields[1];
        field.config = { ...field.config, links };
        field.getLinks = () => [{ title: links[0].title, href: links[0].url, target: '_blank', origin: field }];
      }
      return f;
    });
    const { container, half } = await setup(props({ ...p, data: { ...p.data, series } }));
    await waitFor(() => expect(interactive(container)).toBe(true));
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    expect(screen.getByRole('link', { name: 'Interface details' }).getAttribute('href')).toBe(
      '/d/iface?var-device=pppoe'
    );
  });

  it('the urlTitle of the class names the footer link', async () => {
    const config = withClass('wan', { urlTitle: 'Port ${port}' });
    const { half } = await setup(props({ options: { ...options, config } }));
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    expect(screen.getByRole('link', { name: 'Port pppoe' }).getAttribute('href')).toBe(
      '/d/drawiomap-demo?var-job=node-isp-a&var-device=pppoe'
    );
  });

  it('each row has its head line and below it a sparkline at the full row width', async () => {
    const { cell } = await setup();
    fireEvent.click(cell('pg-node~rtr-b'));
    await screen.findByRole('dialog');
    // the status row (the node has a missing status) comes first; the CPU row follows
    const rows = screen.getAllByTestId('dmap-card-row');
    expect(rows[0].textContent).toContain('missing');
    const row = rows.find((r) => r.textContent?.includes('CPU'))!;
    const [head, spark] = Array.from(row.children);
    expect(head.textContent).toContain('CPU');
    expect(head.textContent).toContain('42%');
    expect(spark.getAttribute('data-testid')).toBe('dmap-card-spark');
    expect(getComputedStyle(spark).width).toBe('100%');
    expect(getComputedStyle(spark).display).toBe('block');
    const plot = spark.querySelector('[data-testid="grafana-sparkline"]')!;
    expect(plot.getAttribute('width')).toBe('264');
    expect(plot.getAttribute('height')).toBe('40');
    expect(spark.querySelector('polyline')).toBeNull();
  });

  it('a narrow panel shows the card as a sheet fixed to the bottom of the viewport, outside the panel', async () => {
    const { half, wrapper } = await setup(props({ width: 400, height: 2000 }));
    fireEvent.click(half(linkId));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('data-sheet')).toBe('true');
    // a portal: a CSS transform of the Grafana grid item does not move a fixed element in document.body
    expect(wrapper.contains(dialog)).toBe(false);
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    const style = getComputedStyle(dialog);
    expect(style.position).toBe('fixed');
    expect(style.bottom).toBe('0px');
    expect(style.maxHeight).toBe('60vh');
    expect(style.overflowY).toBe('auto');
    expect(Number(style.zIndex)).toBeGreaterThanOrEqual(createTheme().zIndex.modal);
    // a tap inside the sheet keeps it; a click on its row does not close it
    fireEvent.pointerDown(dialog);
    fireEvent.click(screen.getAllByTestId('dmap-card-row')[0]);
    expect(card()).not.toBeNull();
    // a tap outside the panel and the sheet closes it
    fireEvent.pointerDown(document.body);
    expect(card()).toBeNull();
  });

  it('Esc and the close button close the sheet', async () => {
    const { half } = await setup(props({ width: 400 }));
    fireEvent.click(half(linkId));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    expect(card()).toBeNull();
    fireEvent.click(half(linkId));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(card()).toBeNull();
  });

  it('a node card shows the rows of its class with their unit and sparkline, and the drilldown as a link', async () => {
    const { cell } = await setup();
    fireEvent.click(cell('pg-node~rtr-b'));
    const dialog = await screen.findByRole('dialog');
    const rows = screen.getAllByTestId('dmap-card-row');
    // the status row first (the node has no `up` series), then the rows of router-cpu; the drilldown is a link
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('missing'),
      expect.stringContaining('CPU'),
      expect.stringContaining('state'),
      expect.stringContaining('load 1m'),
      expect.stringContaining('Three lines'),
      expect.stringContaining('Nine lines'),
    ]);
    expect(rows[1].textContent).toContain('42%');
    expect(dialog.querySelectorAll('[data-testid="grafana-sparkline"]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'CPU details' }).getAttribute('href')).toBe(
      '/d/drawiomap-demo?var-job=node-rtr-b&var-metric=cpu'
    );
    expect(screen.getByRole('link', { name: 'Host node-rtr-b' }).getAttribute('href')).toBe(
      '/d/drawiomap-demo?var-job=node-rtr-b'
    );
  });

  it('a click on the node icon opens the card of the node', async () => {
    const { cell } = await setup();
    fireEvent.click(cell('pg-icon~rtr-b').querySelector('ellipse, path')!);
    expect((await screen.findByRole('dialog')).textContent).toContain('CPU');
  });
});

describe('DrawioMapPanel live zoom', () => {
  const linkId = 'pg-link~isp-a:pppoe->rtr-a:wan1';
  async function setup(p = props()) {
    const r = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(r.container.querySelector('polyline.dmap-half')).not.toBeNull());
    const svgEl = r.container.querySelector('svg')!;
    await waitFor(() => expect(svgEl.getAttribute('width')).toBe('100%'));
    const half = (cell: string) =>
      r.container.querySelector(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`)!;
    return { ...r, svgEl, half, base: svgEl.getAttribute('viewBox'), wrapper: screen.getByTestId('dmap-panel') };
  }
  const reset = () => screen.queryByRole('button', { name: 'Reset zoom' });
  const wheel = (el: Element, init: WheelEventInit) => {
    const ev = new WheelEvent('wheel', { clientX: 0, clientY: 0, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };

  it('a fitted diagram goes to the top by default, to the centre with Align: center', async () => {
    const { svgEl, rerender } = await setup();
    expect(svgEl.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
    const p = props({ options: { ...options, zoom: { ...options.zoom, align: 'center' } } });
    rerender(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(svgEl.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet'));
  });

  describe('Minimum scale', () => {
    // the sheet is 1115 x 640; the 800 x 600 panel fits it at about 0.72
    const minScale = (mode: 'fit' | 'fit-width', scale = 1.3) =>
      props({ options: { ...options, zoom: { ...options.zoom, mode, minScale: scale } } });
    async function mount(p: PanelProps<Options>) {
      const r = render(<DrawioMapPanel {...p} />);
      await waitFor(() => expect(r.container.querySelector('polyline.dmap-half')).not.toBeNull());
      const svgEl = r.container.querySelector('svg')!;
      const stage = screen.getByTestId('dmap-stage');
      return { ...r, svgEl, stage, wrapper: screen.getByTestId('dmap-panel') };
    }

    it('fit: the diagram does not shrink below the minimum scale; the stage scrolls', async () => {
      const { svgEl, stage } = await mount(minScale('fit'));
      await waitFor(() => expect(svgEl.getAttribute('width')).toBe('1449.5px'));
      expect(svgEl.getAttribute('height')).toBe('832px');
      expect(svgEl.getAttribute('viewBox')).toBe('0 0 1115 640');
      expect(stage.style.overflow).toBe('auto');
      // the status band is not in the scroll container
      expect(stage.contains(screen.queryByTestId('dmap-status-band'))).toBe(false);
    });

    it('fit-width: the height is the sheet height times the minimum scale', async () => {
      const { svgEl, stage } = await mount(minScale('fit-width'));
      await waitFor(() => expect(svgEl.getAttribute('width')).toBe('1449.5px'));
      expect(svgEl.getAttribute('height')).toBe('832px');
      expect(stage.style.overflow).toBe('auto');
    });

    it('a minimum scale below the fit scale keeps the fit layout', async () => {
      const { svgEl, stage } = await mount(minScale('fit', 0.5));
      await waitFor(() => expect(svgEl.getAttribute('width')).toBe('100%'));
      expect(stage.style.overflow).toBe('hidden');
    });

    it('at the configured view the plain wheel scrolls the stage; a live zoom keeps the svg size', async () => {
      const { svgEl, wrapper } = await mount(minScale('fit'));
      await waitFor(() => expect(svgEl.getAttribute('width')).toBe('1449.5px'));
      expect(wheel(wrapper, { deltaY: 100 }).defaultPrevented).toBe(false);
      expect(reset()).toBeNull();
      wheel(wrapper, { deltaY: -10, ctrlKey: true });
      await screen.findByRole('button', { name: 'Reset zoom' });
      expect(svgEl.getAttribute('viewBox')).not.toBe('0 0 1115 640');
      expect(svgEl.getAttribute('width')).toBe('1449.5px');
      expect(svgEl.getAttribute('height')).toBe('832px');
    });

    it('the reset button restores the configured view and scrolls the stage to the top left', async () => {
      const { svgEl, stage, wrapper } = await mount(minScale('fit'));
      await waitFor(() => expect(svgEl.getAttribute('width')).toBe('1449.5px'));
      stage.scrollTop = 120;
      stage.scrollLeft = 80;
      wheel(wrapper, { deltaY: -10, ctrlKey: true });
      fireEvent.click(await screen.findByRole('button', { name: 'Reset zoom' }));
      await waitFor(() => expect(svgEl.getAttribute('viewBox')).toBe('0 0 1115 640'));
      expect(reset()).toBeNull();
      expect(stage.scrollTop).toBe(0);
      expect(stage.scrollLeft).toBe(0);
    });
  });

  it('Ctrl+wheel (a trackpad pinch) zooms with Wheel zoom off; the plain wheel does not', async () => {
    const { wrapper, svgEl, base } = await setup();
    expect(wheel(wrapper, { deltaY: -100 }).defaultPrevented).toBe(false);
    expect(svgEl.getAttribute('viewBox')).toBe(base);
    expect(wheel(wrapper, { deltaY: -10, ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(svgEl.getAttribute('viewBox')).not.toBe(base));
  });

  it('the reset button shows only when the view differs from the configured zoom; a click restores it', async () => {
    const { wrapper, svgEl, base } = await setup();
    expect(reset()).toBeNull();
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    const btn = await screen.findByRole('button', { name: 'Reset zoom' });
    fireEvent.click(btn);
    await waitFor(() => expect(svgEl.getAttribute('viewBox')).toBe(base));
    expect(reset()).toBeNull();
    // the click on the button does not pin a card
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // a saved rule of version 1 gives the warning badge
  const withWarning = (legend?: Options['legend']) =>
    props({ options: { ...options, ...(legend ? { legend } : {}), rules: [{ name: 'old' }] } });

  // Grafana puts its panel menu button in the top-right corner of a panel without a title.
  it('the reset button and the warning badge stack in the top-left corner: the button first, then the badge', async () => {
    const { wrapper } = await setup(withWarning());
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    const btn = await screen.findByRole('button', { name: 'Reset zoom' });
    const corner = screen.getByTestId('dmap-corner');
    const badge = screen.getByTestId('dmap-warning-badge');
    expect(corner.contains(btn)).toBe(true);
    expect(corner.contains(badge)).toBe(true);
    expect(btn.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(corner.style.left).toBe('4px');
    expect(corner.style.right).toBe('');
  });

  it.each([null, 1])('keeps reset before the warning badge when editPanel is %s', async (editPanel) => {
    locationService.partial({ editPanel });
    onTestFinished(() => act(() => locationService.partial({ editPanel: null })));
    const view = await setup(withWarning());
    wheel(view.wrapper, { deltaY: -10, ctrlKey: true });
    const resetButton = await screen.findByRole('button', { name: 'Reset zoom' });
    const badge = screen.getByTestId('dmap-warning-badge');
    expect(badge.tagName).toBe('DIV');
    expect(resetButton.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('on a narrow panel the top-right legend goes below the reset button and the badge', async () => {
    const { wrapper } = await setup({
      ...withWarning({ show: true, corner: 'top-right', maxBlocks: 4 }),
      width: 400,
    });
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    await screen.findByRole('button', { name: 'Reset zoom' });
    // 4 px edge + 32 px button + 4 px gap
    expect(parseFloat(screen.getByTestId('dmap-legend').style.top)).toBeGreaterThanOrEqual(40);
  });

  it('keeps the tooltip of the reset button and its label', async () => {
    const { wrapper } = await setup();
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    const btn = await screen.findByRole('button', { name: 'Reset zoom' });
    expect(btn.getAttribute('aria-label')).toBe('Reset zoom');
  });

  describe.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('legend in the %s corner', (c) => {
    it('does not cover the reset button, the warning badge or the right-hand menu area', async () => {
      const { wrapper } = await setup(withWarning({ show: true, corner: c, maxBlocks: 4 }));
      wheel(wrapper, { deltaY: -10, ctrlKey: true });
      const btn = await screen.findByRole('button', { name: 'Reset zoom' });
      const corner = screen.getByTestId('dmap-corner');
      const legend = screen.getByTestId('dmap-legend');
      expect(legend.getAttribute('data-dmap-corner')).toBe(c);
      // its own corner: not in the top-left stack. The top-left legend starts below the button and the badge.
      expect(corner.contains(legend)).toBe(false);
      if (c === 'top-left') {
        expect(legend.style.left).toBe('4px');
        // 4 px edge + 32 px button + 4 px gap
        expect(parseFloat(legend.style.top)).toBeGreaterThanOrEqual(40);
        expect(btn.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      if (c === 'top-right') {
        // below the area of the panel menu button (28 px: the button and a gap), so the hover menu does not cover it
        expect(parseFloat(legend.style.top)).toBeGreaterThanOrEqual(32);
        expect(legend.style.right).toBe('4px');
      }
    });
  });

  it('a new panel size or a new zoom option resets the view', async () => {
    const p = props();
    const { wrapper, svgEl, base, rerender } = await setup(p);
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    await screen.findByRole('button', { name: 'Reset zoom' });
    rerender(<DrawioMapPanel {...p} width={700} />);
    await waitFor(() => expect(svgEl.getAttribute('viewBox')).toBe(base));
    expect(reset()).toBeNull();
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    await screen.findByRole('button', { name: 'Reset zoom' });
    rerender(
      <DrawioMapPanel {...p} width={700} options={{ ...options, zoom: { ...options.zoom, mode: 'fit-width' } }} />
    );
    await waitFor(() => expect(reset()).toBeNull());
  });

  it('touch: one finger at the configured view does not pan; two fingers pinch; then one finger pans', async () => {
    const { wrapper, svgEl, base, half } = await setup();
    expect(wrapper.style.touchAction).toBe('pan-x pan-y');
    const t = (type: string, id: number, x: number, y: number) =>
      fireEvent[type as 'pointerDown'](wrapper, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
    t('pointerDown', 1, 100, 100);
    t('pointerMove', 1, 100, 200);
    t('pointerUp', 1, 100, 200);
    expect(svgEl.getAttribute('viewBox')).toBe(base);
    expect(reset()).toBeNull();

    t('pointerDown', 1, 100, 100);
    t('pointerDown', 2, 200, 100);
    t('pointerMove', 1, 50, 100);
    t('pointerMove', 2, 250, 100);
    t('pointerUp', 1, 50, 100);
    t('pointerUp', 2, 250, 100);
    await screen.findByRole('button', { name: 'Reset zoom' });
    const zoomed = svgEl.getAttribute('viewBox')!;
    expect(Number(zoomed.split(' ')[2])).toBeLessThan(Number(base!.split(' ')[2]));
    expect(wrapper.style.touchAction).toBe('none');

    t('pointerDown', 1, 100, 100);
    t('pointerMove', 1, 150, 100);
    t('pointerUp', 1, 150, 100);
    await waitFor(() => expect(svgEl.getAttribute('viewBox')).not.toBe(zoomed));

    // a tap on a zoomed view still pins the card
    fireEvent.pointerDown(half(linkId), { pointerType: 'touch', pointerId: 3 });
    fireEvent.pointerUp(half(linkId), { pointerType: 'touch', pointerId: 3 });
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
  });

  it('a mouse drag pans a zoomed view; the click after the drag pins no card', async () => {
    const { wrapper, svgEl, half } = await setup();
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    await screen.findByRole('button', { name: 'Reset zoom' });
    const zoomed = svgEl.getAttribute('viewBox');
    fireEvent.pointerDown(half(linkId), { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 60, clientY: 10 });
    fireEvent.pointerUp(half(linkId), { pointerType: 'mouse', clientX: 60, clientY: 10 });
    fireEvent.click(half(linkId));
    await waitFor(() => expect(svgEl.getAttribute('viewBox')).not.toBe(zoomed));
    expect(screen.queryByRole('dialog')).toBeNull();
    // the next click without a drag pins the card
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
  });

  it('without Drag pan, a mouse drag at the configured view does not pan', async () => {
    const { wrapper, svgEl, base } = await setup();
    fireEvent.pointerDown(wrapper, { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(wrapper, { pointerType: 'mouse', clientX: 60, clientY: 10 });
    fireEvent.pointerUp(wrapper, { pointerType: 'mouse', clientX: 60, clientY: 10 });
    expect(svgEl.getAttribute('viewBox')).toBe(base);
  });
});

describe('DrawioMapPanel status band', () => {
  /**
   * `count` cells of the class `dev`, each with its own key. reasons[i] gives cell i a series of `q` with the value 0,
   * which a value mapping shows as the reason in red (down). The other cells have no series: missing.
   */
  function statusPanel(count: number, reasons: Record<number, string> = {}, over: Partial<Options> = {}) {
    const cells = Array.from(
      { length: count },
      (_, i) =>
        `<g data-cell-id="c${i}" data-meta-bind="dev" data-meta-key="k${i}" transform="translate(${(i % 6) * 60} ${Math.floor(i / 6) * 50})"><rect width="40" height="30"/><text>C${i}</text></g>`
    ).join('');
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 250">${cells}</svg>`;
    const config: ConfigV4 = {
      version: 4,
      freshness: '3x',
      classes: { dev: { match: { key: 'key' }, status: 'q' } },
      overrides: {},
    };
    const series = Object.entries(reasons).map(([i, reason]) =>
      frame('q', { key: `k${i}` }, [0], {
        mappings: [{ type: MappingType.ValueToText, options: { '0': { text: reason, color: 'red' } } }],
      })
    );
    const p = props();
    return props({
      options: {
        ...options,
        config,
        diagram: { xml: '', svg: svgText, hash: `band-${count}`, updatedAt: '' },
        ...over,
      },
      data: { ...p.data, series },
    });
  }
  const band = () => screen.queryByTestId('dmap-status-band');
  const rows = () => Array.from(band()?.querySelectorAll('.dmap-status-summary') ?? []);

  it('merges 26 cells without data into one row above the diagram, and the diagram gets the rest of the height', async () => {
    render(<DrawioMapPanel {...statusPanel(26)} />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toBe('?No data · q: 26 cells');
    expect(rows()[0].getAttribute('title')).toBe('No data · q: 26 cells');
    const stage = screen.getByTestId('dmap-stage');
    // the band is before the stage, not on top of it
    expect(band()!.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(parseFloat(band()!.style.height) + parseFloat(stage.style.height)).toBe(600);
    // the warning badge and the reset button do not cover the band
    expect(parseFloat(screen.getByTestId('dmap-corner').style.top)).toBe(parseFloat(band()!.style.height) + 4);
    expect(screen.getByTestId('dmap-panel').querySelector('svg .dmap-status-summary')).toBeNull();
  });

  it('shows the most severe causes first, caps the band at 3 rows with "+k more", and expands on a click', async () => {
    const reasons = { 0: 'Power lost', 1: 'Power lost', 2: 'Link down', 3: 'Fan failed', 4: 'Disk failed' };
    render(<DrawioMapPanel {...statusPanel(8, reasons)} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((r) => r.getAttribute('title'))).toEqual(['Power lost · q: 2 cells', 'Link down · q: 1 cell']);
    const more = screen.getByRole('button', { name: '+3 more (5 cells)' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    const collapsed = parseFloat(band()!.style.height);
    fireEvent.click(more);
    expect(rows()).toHaveLength(5);
    expect(rows()[4].getAttribute('title')).toBe('No data · q: 3 cells');
    expect(parseFloat(band()!.style.height)).toBeGreaterThan(collapsed);
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(rows()).toHaveLength(2);
  });

  it('Status summary rows sets the cap, 0 hides the band', async () => {
    const reasons = { 0: 'A', 1: 'B', 2: 'C' };
    const { rerender } = render(<DrawioMapPanel {...statusPanel(3, reasons, { summary: { maxRows: 5 } })} />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
    rerender(<DrawioMapPanel {...statusPanel(3, reasons, { summary: { maxRows: 1 } })} />);
    expect(rows()).toHaveLength(0);
    expect(screen.getByRole('button', { name: '3 causes (3 cells)' })).toBeTruthy();
    rerender(<DrawioMapPanel {...statusPanel(3, reasons, { summary: { maxRows: 0 } })} />);
    expect(band()).toBeNull();
    expect(screen.getByTestId('dmap-stage').style.height).toBe('600px');
  });
});

describe('DrawioMapPanel cards only for cells with content', () => {
  /** The structure cells of a portograph sheet; the cells in `bound` carry bind=cards. */
  const structureSvg = (bound: string[]) => {
    const bind = (id: string) => (bound.includes(id) ? ` data-meta-bind="cards" data-meta-key="${id}"` : '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-layer~canvas"><g data-cell-id="pg-canvas"${bind('pg-canvas')}><rect id="bg" width="300" height="200"/></g></g>
    <g data-cell-id="pg-layer~diagram">
      <g data-cell-id="pg-group~core"${bind('pg-group~core')}><rect id="grp" x="5" y="5" width="200" height="120"/></g>
      <g data-cell-id="pg-groupTitle~core"${bind('pg-groupTitle~core')}><text id="grp-title">CORE</text></g>
      <g data-cell-id="pg-node~a" data-meta-pg-kind="node" data-meta-pg-id="a" data-meta-role="router"${bind('pg-node~a')}><rect id="na" x="10" y="10" width="40" height="30"/><text>A</text></g>
      <g data-cell-id="pg-node~b" data-meta-pg-kind="node" data-meta-pg-id="b"${bind('pg-node~b')}><rect id="nb" x="100" y="10" width="40" height="30"/><text>B</text></g>
      <g data-cell-id="pg-link~a-b" data-meta-pg-kind="link" data-meta-pg-id="a-b" data-meta-pg-from="a" data-meta-pg-to="b"${bind('pg-link~a-b')}><path id="lab" d="M50 25 L100 25" fill="none" stroke="#888"/></g>
      <g data-cell-id="pg-legend"${bind('pg-legend')}><rect id="leg" x="10" y="150" width="60" height="30"/></g>
      <g data-cell-id="chart-1" data-meta-pg-kind="other"${bind('chart-1')}><rect id="chart" x="220" y="150" width="60" height="30"/></g>
      <g data-cell-id="pg-icon~a" data-meta-pg-kind="node-icon" data-meta-pg-of="a"><ellipse id="icon-a" cx="20" cy="20" rx="5" ry="5"/></g>
      <g data-cell-id="pg-linkLabel~a-b" data-meta-pg-kind="link-label" data-meta-pg-of="a-b"><rect id="lbl-bg" x="60" y="15" width="20" height="10"/><text id="lbl">uplink</text></g>
    </g>
  </g></svg>`;
  };
  const ALL = ['pg-canvas', 'pg-group~core', 'pg-groupTitle~core', 'pg-node~a', 'pg-node~b', 'pg-link~a-b'].concat([
    'pg-legend',
    'chart-1',
  ]);
  /** A class with one metadata row: the card of each bound cell has that row and nothing else. */
  const config: ConfigV4 = {
    version: 4,
    freshness: '3x',
    classes: { cards: { match: { key: 'key' }, rows: [{ kind: 'metadata', label: 'Role', text: '${key}' }] } },
    overrides: {},
  };
  function structurePanel(bound: string[], over: Partial<Options> = {}) {
    return props({
      options: {
        ...options,
        config,
        diagram: {
          xml: '',
          svg: structureSvg(bound),
          hash: `structure-${JSON.stringify([bound, over])}`,
          updatedAt: '',
        },
        ...over,
      },
    });
  }
  const at = async (id: string) => {
    const el = await waitFor(() => {
      const found = document.getElementById(id);
      expect(found).not.toBeNull();
      return found!;
    });
    return el;
  };
  const hover = async (id: string) =>
    fireEvent.pointerMove(await at(id), { pointerType: 'mouse', clientX: 20, clientY: 20 });

  it('opens no card for a cell without rows and links, and none for the empty background', async () => {
    render(<DrawioMapPanel {...structurePanel(['pg-node~a'])} />);
    await hover('na');
    expect((await screen.findByRole('tooltip')).textContent).toContain('Role');
    await hover('nb');
    expect(screen.queryByTestId('dmap-card')).toBeNull();
    fireEvent.click(await at('nb'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await hover('bg');
    expect(screen.queryByTestId('dmap-card')).toBeNull();
  });

  it('by default opens cards for nodes, links, ports and other cells, not for the canvas, groups and the legend', async () => {
    render(<DrawioMapPanel {...structurePanel(ALL)} />);
    await hover('chart');
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('chart-1');
    await hover('na');
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('A');
    await hover('lab');
    // the link is named by its two ends, not by its label
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('A ↔ B');
    for (const id of ['bg', 'grp', 'grp-title', 'leg']) {
      await hover(id);
      expect(screen.queryByTestId('dmap-card')).toBeNull();
      fireEvent.click(await at(id));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('the icon and the link label open the card of their node and link, not a card of their own', async () => {
    render(<DrawioMapPanel {...structurePanel(ALL)} />);
    await hover('na');
    const node = (await screen.findByRole('tooltip')).textContent;
    await hover('icon-a');
    const icon = await screen.findByRole('tooltip');
    expect(icon.getAttribute('aria-label')).toBe('A');
    expect(icon.textContent).toBe(node);
    await hover('lbl-bg');
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('A ↔ B');
    fireEvent.click(await at('icon-a'));
    expect((await screen.findByRole('dialog')).getAttribute('aria-label')).toBe('A');
  });

  it('marks only the cells that open a card, and their parts, as interactive buttons', async () => {
    const { container } = render(<DrawioMapPanel {...structurePanel(ALL.filter((id) => id !== 'pg-node~b'))} />);
    const marked = () =>
      Array.from(container.querySelectorAll('[data-dmap-interactive]'), (el) => el.getAttribute('data-cell-id')).sort();
    await waitFor(() =>
      expect(marked()).toEqual(['chart-1', 'pg-icon~a', 'pg-linkLabel~a-b', 'pg-link~a-b', 'pg-node~a'])
    );
    const group = (id: string) => container.querySelector(`[data-cell-id="${id}"]`)!;
    expect(group('pg-node~a').getAttribute('role')).toBe('button');
    for (const id of ['0', 'pg-canvas', 'pg-group~core', 'pg-legend', 'pg-node~b']) {
      expect(group(id).hasAttribute('role')).toBe(false);
      expect(group(id).hasAttribute('tabindex')).toBe(false);
    }
  });

  it('Hover kinds selects the cells that open a card', async () => {
    render(<DrawioMapPanel {...structurePanel(ALL, { hover: { kinds: ['node', 'group'] } })} />);
    await hover('lab');
    expect(screen.queryByTestId('dmap-card')).toBeNull();
    await hover('grp');
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('CORE');
    await hover('na');
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('A');
  });
});

describe('DrawioMapPanel legend rows of the diagram', () => {
  const svgWith = (
    symbol: boolean
  ) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-node~a" data-meta-pg-kind="node" data-meta-pg-id="a"${symbol ? ' data-meta-pg-symbol="router"' : ''}><rect id="na" width="40" height="30"/></g>
    <g data-cell-id="pg-node~b" data-meta-pg-kind="node" data-meta-pg-id="b"${symbol ? ' data-meta-pg-symbol="modem"' : ''}><rect id="nb" x="100" width="40" height="30"/></g>
    <g data-cell-id="pg-legendRow~symbol:router"><rect id="row" x="10" y="150" width="60" height="30"/></g>
  </g></svg>`;
  const panel = (symbol: boolean) =>
    props({
      options: {
        ...options,
        diagram: { xml: '', svg: svgWith(symbol), hash: `rows-${symbol}`, updatedAt: '' },
      },
    });
  const row = async () =>
    waitFor(() => {
      const el = document.getElementById('row');
      expect(el).not.toBeNull();
      return el!;
    });

  it('a row with a symbol marks the nodes of that symbol and dims the others; leaving restores', async () => {
    const { container } = render(<DrawioMapPanel {...panel(true)} />);
    const el = await row();
    const root = container.querySelector('[data-testid="dmap-stage"] > svg')!;
    fireEvent(el, Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'mouse' }));
    await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
    expect(Array.from(container.querySelectorAll('.dmap-legend-hit'), (e) => e.getAttribute('data-cell-id'))).toEqual([
      'pg-node~a',
    ]);
    expect(container.querySelector('[data-cell-id="pg-node~b"]')!.classList.contains('dmap-legend-member')).toBe(true);
    fireEvent(root, Object.assign(new Event('pointerleave'), { pointerType: 'mouse' }));
    await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(false));
    expect(container.querySelector('.dmap-legend-hit, .dmap-legend-member')).toBeNull();
  });

  it('a row hover does not render the panel view', async () => {
    const { container } = render(<DrawioMapPanel {...panel(true)} />);
    const el = await row();
    const root = container.querySelector('[data-testid="dmap-stage"] > svg')!;
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const renders = work.viewRenders;
    fireEvent(el, Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'mouse' }));
    await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
    fireEvent(root, Object.assign(new Event('pointerleave'), { pointerType: 'mouse' }));
    await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(false));
    expect(work.viewRenders).toBe(renders);
  });

  it('a diagram without pg-symbol does nothing', async () => {
    const { container } = render(<DrawioMapPanel {...panel(false)} />);
    const el = await row();
    fireEvent(el, Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'mouse' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('svg.dmap-legend-active')).toBeNull();
  });
});

describe('DrawioMapPanel colour legend', () => {
  const legend = () => screen.queryByTestId('dmap-legend');
  const openLegend = () =>
    props({ options: { ...options, legend: { show: true, corner: 'bottom-right', maxBlocks: 4, collapsed: false } } });
  async function setup(p = props()) {
    const r = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(r.container.querySelector('polyline.dmap-half')).not.toBeNull());
    return r;
  }

  it('legend.show false hides it; another corner moves it; the chip opens it outside the stage and opens no card', async () => {
    const { rerender } = await setup(
      props({ options: { ...options, legend: { show: false, corner: 'bottom-right', maxBlocks: 4 } } })
    );
    expect(legend()).toBeNull();
    rerender(
      <DrawioMapPanel
        {...props({ options: { ...options, legend: { show: true, corner: 'top-left', maxBlocks: 4 } } })}
      />
    );
    expect(legend()!.getAttribute('data-dmap-corner')).toBe('top-left');
    const chip = within(legend()!).getByRole('button', { name: 'Legend' });
    fireEvent.click(chip);
    expect(within(legend()!).getAllByTestId('dmap-legend-block').length).toBeGreaterThan(0);
    // outside the stage, so zoom, pan and the stage scroll do not move it
    expect(screen.getByTestId('dmap-stage').contains(legend()!)).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has a block for the status refId and a State block for the cells with no value', async () => {
    await setup(openLegend());
    const titles = within(legend()!)
      .getAllByTestId('dmap-legend-block')
      .map((b) => b.getAttribute('aria-label'));
    expect(titles).toEqual(expect.arrayContaining(['up', 'State', 'Link load %']));
  });

  it('hovering an entry highlights the cells in that band and dims the others; leaving clears it', async () => {
    const { container } = await setup(openLegend());
    expect(legend()!.getAttribute('data-dmap-corner')).toBe('bottom-right');
    const block = within(legend()!)
      .getAllByTestId('dmap-legend-block')
      .find((b) => b.getAttribute('aria-label') === 'Link load %')!;
    const entry = within(block)
      .getAllByTestId('dmap-legend-entry')
      .find((e) => !e.getAttribute('aria-label')!.endsWith(': 0 elements'))!;
    fireEvent.pointerEnter(entry);
    const root = container.querySelector('[data-testid="dmap-stage"] > svg')!;
    await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
    const hits = Array.from(container.querySelectorAll('.dmap-legend-hit'), (el) => el.getAttribute('data-cell-id'));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((id) => id!.startsWith('pg-link'))).toBe(true);
    fireEvent.pointerLeave(entry);
    await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(false));
    expect(container.querySelector('.dmap-legend-hit, .dmap-legend-member')).toBeNull();
  });

  describe('highlight cost', () => {
    const nextFrame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    /** A settled panel with an open legend: an entry that has cells, and the stage root. */
    async function settled() {
      const r = await setup(openLegend());
      await nextFrame();
      await nextFrame();
      const block = within(legend()!)
        .getAllByTestId('dmap-legend-block')
        .find((b) => b.getAttribute('aria-label') === 'Link load %')!;
      const entry = within(block)
        .getAllByTestId('dmap-legend-entry')
        .find((e) => !e.getAttribute('aria-label')!.endsWith(': 0 elements'))!;
      const root = r.container.querySelector('[data-testid="dmap-stage"] > svg')!;
      return { ...r, entry, root };
    }
    const hits = (container: Element) =>
      Array.from(container.querySelectorAll('.dmap-legend-hit'), (el) => el.getAttribute('data-cell-id'));

    it('a pointer and a focus on an entry mark the cells and do not render the panel view or apply the patches', async () => {
      const { container, entry, root } = await settled();
      const renders = work.viewRenders;
      const applied = work.applied.length;
      fireEvent.pointerEnter(entry, { pointerType: 'mouse' });
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
      const byPointer = hits(container);
      expect(byPointer.length).toBeGreaterThan(0);
      fireEvent.pointerLeave(entry, { pointerType: 'mouse' });
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(false));
      act(() => entry.focus());
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
      expect(hits(container)).toEqual(byPointer);
      act(() => entry.blur());
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(false));
      expect(container.querySelector('.dmap-legend-hit, .dmap-legend-member')).toBeNull();
      expect(work.viewRenders).toBe(renders);
      expect(work.applied.length).toBe(applied);
    });

    it('a pinned card stays open and pinned during a legend hover', async () => {
      const { container, entry, root } = await settled();
      fireEvent.click(container.querySelector('polyline.dmap-half')!, { clientX: 50, clientY: 40 });
      const dialog = await screen.findByRole('dialog');
      await nextFrame();
      const renders = work.viewRenders;
      fireEvent.pointerEnter(entry, { pointerType: 'mouse' });
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
      fireEvent.pointerLeave(entry, { pointerType: 'mouse' });
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(false));
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(dialog.getAttribute('data-pinned')).toBe('true');
      expect(work.viewRenders).toBe(renders);
    });

    it('a data refresh during a hover keeps the marks on the cells of the entry now', async () => {
      const { container, entry, root, rerender } = await settled();
      fireEvent.pointerEnter(entry, { pointerType: 'mouse' });
      await waitFor(() => expect(root.classList.contains('dmap-legend-active')).toBe(true));
      const before = hits(container);
      rerender(<DrawioMapPanel {...openLegend()} />);
      await nextFrame();
      await nextFrame();
      expect(root.classList.contains('dmap-legend-active')).toBe(true);
      expect(hits(container)).toEqual(before);
    });
  });
});

describe('DrawioMapPanel refresh and freshness', () => {
  const small =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g data-cell-id="a" data-meta-bind="dev" data-meta-key="k"><rect width="40" height="30"/><text>A</text></g><g data-cell-id="b"><rect x="50" width="40" height="30"/><text>B</text></g></svg>';
  const diagram = { xml: '<mxfile/>', svg: small, hash: 'popup-panel', updatedAt: '' };
  /** Count the applier calls on the panel stage. */
  const panelApplies = () =>
    work.applied.filter((index) =>
      (index as Map<string, { group: Element }>).values().next().value?.group.closest('[data-testid="dmap-stage"]')
    ).length;
  const halves = (root: Element) =>
    Array.from(root.querySelectorAll('polyline.dmap-half'))
      .map((el) => el.outerHTML)
      .join('\n');
  const seriesWith = (value: number) => {
    const base = props({ id: 61 });
    return {
      ...base.data,
      series: [frame('wan_tx', { job: 'node-isp-a', device: 'pppoe' }, [value]), ...base.data.series.slice(1)],
    };
  };

  it('an OS colour scheme change runs the applier once more with the same picture; the listener goes on unmount', async () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
    vi.stubGlobal('matchMedia', () => media);
    try {
      const base = props({ id: 61 });
      const view = render(<DrawioMapPanel {...base} data={seriesWith(10e6)} />);
      await waitFor(() => expect(view.container.querySelectorAll('polyline.dmap-half').length).toBeGreaterThan(0));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const panel = screen.getByTestId('dmap-panel');
      const picture = halves(panel);
      const applies = panelApplies();
      expect(listeners.size).toBeGreaterThan(0);
      media.matches = true;
      act(() => listeners.forEach((cb) => cb()));
      await waitFor(() => expect(panelApplies()).toBe(applies + 1));
      expect(halves(panel)).toBe(picture);
      view.unmount();
      expect(listeners.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a data refresh with equal values keeps the overlay elements; a changed value updates them in place', async () => {
    const base = props({ id: 61 });
    const view = render(<DrawioMapPanel {...base} data={seriesWith(10e6)} />);
    await waitFor(() => expect(view.container.querySelectorAll('polyline.dmap-half').length).toBeGreaterThan(0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const panel = screen.getByTestId('dmap-panel');
    const elements = () => Array.from(panel.querySelectorAll('polyline.dmap-half, polygon.dmap-arrow'));
    const before = elements();
    const picture = halves(panel);
    // the same values in a new data object: the same elements, the same picture
    view.rerender(<DrawioMapPanel {...base} data={seriesWith(10e6)} />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(elements().every((el, i) => el.isSameNode(before[i]))).toBe(true);
    expect(halves(panel)).toBe(picture);
    // a new value: the same elements with a new stroke
    view.rerender(<DrawioMapPanel {...base} data={seriesWith(95e6)} />);
    await waitFor(() => expect(halves(panel)).not.toBe(picture));
    expect(elements().every((el, i) => el.isSameNode(before[i]))).toBe(true);
  });

  it('makes a fixed number of DOM mutations in the stage over four refreshes of the demo diagram', async () => {
    const base = props({ id: 61 });
    const view = render(<DrawioMapPanel {...base} data={seriesWith(10e6)} />);
    await waitFor(() => expect(view.container.querySelectorAll('polyline.dmap-half').length).toBeGreaterThan(0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    let count = 0;
    const observer = new MutationObserver((records) => (count += records.length));
    observer.observe(screen.getByTestId('dmap-stage'), {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    for (const value of [95e6, 5e6, 5e6, 99e6]) {
      view.rerender(<DrawioMapPanel {...base} data={seriesWith(value)} />);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    count += observer.takeRecords().length;
    observer.disconnect();
    // three width changes: each also rewrites the points of the half and of its head (the head grows with the width)
    expect(count).toBe(57);
  });

  /** One status cell of the class `dev`: the series of the panel target `q`, fresh for 400 ms after its sample. */
  const freshnessConfig: ConfigV4 = {
    version: 4,
    freshness: '400ms',
    classes: { dev: { match: { key: 'key' }, status: 'q' } },
    overrides: {},
  };
  const sampleAt = (at: number, value = 1) =>
    toDataFrame({
      refId: 'q',
      fields: [
        { name: 'Time', type: FieldType.time, values: [at] },
        { name: 'Value', type: FieldType.number, values: [value], labels: { key: 'k' } },
      ],
    });
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  it('a data update with a fresh status sample binds once: the clock causes no bind', async () => {
    const base = props({ id: 62 });
    const saved = { ...options, config: freshnessConfig, diagram };
    const view = render(
      <DrawioMapPanel {...base} options={saved} data={{ ...base.data, series: [sampleAt(Date.now())] }} />
    );
    await waitFor(() => expect(view.container.querySelector('[data-cell-id="a"]')).toBeTruthy());
    await nextFrame();
    const binds = work.binds;
    view.rerender(
      <DrawioMapPanel {...base} options={saved} data={{ ...base.data, series: [sampleAt(Date.now(), 2)] }} />
    );
    await nextFrame();
    await new Promise((r) => setTimeout(r, 30));
    expect(work.binds - binds).toBe(1);
  });

  it('a status sample that is already stale on arrival shows stale in the first applier call', async () => {
    const base = props({ id: 63 });
    const saved = { ...options, config: freshnessConfig, diagram };
    // the first sample is far in the future: the clock of the panel is read at mount and no deadline moves it
    const view = render(
      <DrawioMapPanel {...base} options={saved} data={{ ...base.data, series: [sampleAt(Date.now() + 1e6)] }} />
    );
    const status = () => screen.queryByTestId('dmap-status-band')?.textContent ?? '';
    const cell = () => view.container.querySelector('[data-cell-id="a"]');
    await waitFor(() => expect(cell()).toBeTruthy());
    await nextFrame();
    expect(status()).toBe('');
    const applies = panelApplies();
    // 450 ms later a sample arrives whose deadline lies between the clock read at mount and now: the pass with
    // the stored clock would call it fresh, the correction runs before the applier's animation frame
    await new Promise((r) => setTimeout(r, 450));
    view.rerender(
      <DrawioMapPanel {...base} options={saved} data={{ ...base.data, series: [sampleAt(Date.now() - 401)] }} />
    );
    await nextFrame();
    // the band shows the stale cell with its last value
    expect(status()).toContain('q: 1 cell');
    expect(cell()?.getAttribute('data-dmap-status')).toBe('stale');
    expect(panelApplies()).toBe(applies + 1);
  });
});
