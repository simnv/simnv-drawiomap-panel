import { chooseOption, editorField, openQueryRow, selectStageCell } from '../editor/testUtils';
import { currentAddress, requestOpen } from '../editor/popup/popupBus';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import {
  createTheme,
  dateTime,
  FieldConfig,
  FieldType,
  getDefaultTimeRange,
  LoadingState,
  PanelProps,
  ThemeContext,
  ThresholdsMode,
  toDataFrame,
} from '@grafana/data';
import { DrawioMapPanel } from './DrawioMapPanel';
import { fnv1a } from '../util/hash';
import type { Options } from '../types';
import type { DiagramConfigV2 } from '../model/config';
import { Observable } from 'rxjs';
const nativeQuery = vi.hoisted(() => vi.fn());
/** Calls of the panel work that a refresh must not repeat while the popup is open: the applier and the view renders. */
const work = vi.hoisted(() => ({ applied: [] as unknown[], viewRenders: 0, panelStage: 'dmap-stage' }));
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
vi.mock('./useStage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useStage')>();
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
const sourceLookups = vi.hoisted(() => vi.fn());
vi.mock('@grafana/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({
    get: async (ref?: { uid?: string }) => {
      sourceLookups(ref);
      return { uid: 'native', components: {}, query: nativeQuery };
    },
    getInstanceSettings: () => undefined,
  }),
}));
// The popup loads in a lazy chunk in production. Tests use it at once, so a click opens it in the same act.
vi.mock('./LazyBindingsPopup', async () => {
  const popup = await import('../editor/popup');
  return { LazyBindingsPopup: (p: React.ComponentProps<typeof popup.default>) => <popup.default {...p} /> };
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

/** Open the bindings popup with its corner button, as a user does. Do nothing when it is open. */
function openPopup() {
  if (!screen.queryByTestId('dmap-bindings-popup')) {
    fireEvent.click(screen.getByTestId('dmap-edit-bindings'));
  }
}

/** Select a cell in the stage of the popup. */
function selectElement(id: string) {
  openPopup();
  selectStageCell(id);
}

const svg = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8');

/** `config`: the field config after the overrides, as Grafana gives it to the panel. */
const frame = (refId: string, labels: Record<string, string>, values: number[], config: FieldConfig = {}) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'Time', type: FieldType.time, values: values.map((_, i) => i) },
      { name: 'Value', type: FieldType.number, values, labels, config },
    ],
  });

const options: Options = {
  diagram: { xml: '<mxfile/>', svg, hash: fnv1a(svg), updatedAt: '2026-10-17T00:00:00Z' },
  zoom: { mode: 'fit', percent: 100, wheel: false, pan: false },
  linkWidth: { min: 2, max: 10 },
  rules: [
    {
      name: 'links',
      select: { kind: 'link' },
      link: {
        a2b: { refId: 'A', match: { job: 'node-${from.node}', device: '${from.port}' } },
        b2a: { refId: 'A', match: { job: 'node-${to.node}', device: '${to.port}' } },
        capacity: 100000000,
      },
      url: '/d/x?job=${from.node}',
    },
    {
      name: 'node up',
      select: { kind: 'node' },
      shape: { series: { refId: 'C', match: { job: 'node-${cell.pg-id}' } }, target: 'shape' },
    },
  ],
};

// an override for query C in Grafana
const upThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'red' },
    { value: 1, color: 'green' },
  ],
};

function props(over: Partial<PanelProps<Options>> = {}): PanelProps<Options> {
  const series = [
    frame('A', { job: 'node-isp-a', device: 'pppoe' }, [41e6]),
    frame('A', { job: 'node-rtr-a', device: 'wan1' }, [10e6]),
    frame('A', { job: 'node-radio', device: 'dhcp' }, [90e6]),
    frame('C', { job: 'node-rtr-a' }, [1], { thresholds: upThresholds }),
    frame('C', { job: 'node-lte' }, [0], { thresholds: upThresholds }),
    frame('E', { job: 'node-rtr-b' }, [12, 30, 42]),
  ];
  return {
    id: 1,
    title: 't',
    transparent: false,
    width: 800,
    height: 600,
    options,
    data: { series, state: LoadingState.Done, timeRange: getDefaultTimeRange() },
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

describe('DrawioMapPanel', () => {
  it('attaches only configured chart portals after the stage mounts and keeps query errors inside that widget', async () => {
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
    try {
      nativeQuery.mockReset().mockRejectedValue(new Error('private datasource failure'));
      const config: DiagramConfigV2 = {
        version: 2,
        patterns: [],
        overrides: [],
        queries: [
          {
            id: 'q',
            name: 'CPU',
            source: { kind: 'datasource', datasource: { uid: 'native' }, target: { refId: 'D' }, parameters: {} },
          },
        ],
        widgets: [
          {
            id: 'w',
            anchorCellId: 'chart',
            kind: 'sparkline',
            label: 'CPU chart',
            binding: { queryId: 'q', match: {}, reducer: 'last' },
          },
        ],
      };
      const small =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="chart"><rect width="180" height="70"/></g><g data-cell-id="ordinary"><rect x="200" width="40" height="30"/><text>Ordinary device</text></g></svg>';
      const { container, unmount } = render(
        <DrawioMapPanel
          {...props({
            options: {
              ...options,
              rules: [],
              config,
              diagram: { xml: '', svg: small, hash: 'explicit-chart', updatedAt: '' },
            },
          })}
        />
      );
      await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('Datasource query failed.'));
      expect(container.querySelectorAll('foreignObject[data-dmap-widget]')).toHaveLength(1);
      expect(container.querySelector('[data-cell-id="ordinary"] foreignObject')).toBeNull();
      expect(container.querySelector('[data-cell-id="ordinary"] text')?.textContent).toBe('Ordinary device');
      expect(screen.getByTestId('dmap-panel')).toBeTruthy();
      expect(container.textContent).not.toContain('private datasource failure');
      unmount();
    } finally {
      bounds.mockRestore();
      if (ctm) {
        Object.defineProperty(SVGElement.prototype, 'getCTM', ctm);
      } else {
        Reflect.deleteProperty(SVGElement.prototype, 'getCTM');
      }
      if (bbox) {
        Object.defineProperty(SVGElement.prototype, 'getBBox', bbox);
      } else {
        Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
      }
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
    expect(container.querySelector('[data-cell-id="pg-node~lte"]')!.getAttribute('data-dmap-step')).toBe('0');
    expect(container.querySelector('[data-cell-id="pg-node~rtr-a"]')!.getAttribute('data-dmap-step')).toBe('1');
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
  it('shares saved visible data with hover rows and keeps monitoring after the card closes', async () => {
    const cancel = vi.fn();
    nativeQuery.mockReset().mockImplementation(
      () =>
        new Observable((observer) => {
          observer.next({ data: [frame('D', {}, [10, 42])] });
          return cancel;
        })
    );
    const binding = { queryId: 'q', reducer: 'last', match: {} } as const;
    const config: DiagramConfigV2 = {
      version: 2,
      queries: [
        {
          id: 'q',
          name: 'Detail',
          source: {
            kind: 'datasource',
            datasource: { uid: 'native' },
            target: { refId: 'D' },
            parameters: {},
          },
        },
      ],
      widgets: [],
      overrides: [],
      patterns: [
        {
          id: 'p',
          name: 'Device',
          select: {},
          display: {
            shape: { text: true, binding },
            label: 'Value ${value}',
            hover: { rows: [{ kind: 'value', label: 'Value', binding }] },
          },
        },
      ],
    };
    const small =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-cell-id="a"><rect width="40" height="30"/><text>A</text></g></svg>';
    const p = props({
      options: {
        ...options,
        rules: [],
        config,
        diagram: { xml: '', svg: small, hash: 'shared-demand', updatedAt: '' },
      },
    });
    const { container, rerender, unmount } = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(container.querySelector('text')?.textContent).toBe('Value 42'));
    expect(nativeQuery).toHaveBeenCalledTimes(1);
    expect(nativeQuery.mock.calls[0][0].range).toBe(p.timeRange);
    fireEvent.click(container.querySelector('[data-cell-id="a"] rect')!);
    expect((await screen.findByRole('dialog')).textContent).toContain('42');
    expect(nativeQuery).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(cancel).not.toHaveBeenCalled();
    const range = { from: dateTime(1000), to: dateTime(9000), raw: { from: dateTime(1000), to: dateTime(9000) } };
    rerender(<DrawioMapPanel {...p} timeRange={range} />);
    await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
    expect(nativeQuery.mock.calls[1][0].range).toBe(range);
    expect(cancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('keeps all hover-only native requests at zero until open, releases on switch/close, rejects late values and reuses fresh cache', async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const receivers: Array<(value: { data: Array<ReturnType<typeof frame>> }) => void> = [];
    nativeQuery.mockReset().mockImplementation(
      () =>
        new Observable((observer) => {
          const release = vi.fn();
          releases.push(release);
          receivers.push((value) => observer.next(value));
          return release;
        })
    );
    const config: DiagramConfigV2 = {
      version: 2,
      queries: [
        {
          id: 'detail',
          name: 'Details',
          source: {
            kind: 'datasource',
            datasource: { uid: 'native' },
            target: { refId: 'D' },
            parameters: { dm_device: 'cell.key' },
          },
        },
      ],
      overrides: [],
      widgets: [],
      patterns: [
        {
          id: 'p',
          name: 'Devices',
          select: {},
          display: {
            hover: {
              rows: [
                { kind: 'value', label: 'Temperature', binding: { queryId: 'detail', reducer: 'last', match: {} } },
                { kind: 'history', label: 'Trend', binding: { queryId: 'detail', reducer: 'last', match: {} } },
              ],
            },
          },
        },
      ],
    };
    const small =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g data-cell-id="a"><rect width="40" height="30"/></g><g data-cell-id="b"><rect x="50" width="40" height="30"/></g></svg>';
    const p = props({
      options: { ...options, rules: [], config, diagram: { xml: '', svg: small, hash: 'hover-demand', updatedAt: '' } },
    });
    const { container, unmount } = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('dmap-panel').getAttribute('data-dmap-patched')).toBe('2'));
    expect(nativeQuery).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-cell-id="a"] rect')!);
    await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(1));
    expect(nativeQuery.mock.calls[0][0].scopedVars.dm_device.value).toBe('a');
    fireEvent.click(container.querySelector('[data-cell-id="b"] rect')!);
    await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
    expect(releases[0]).toHaveBeenCalledTimes(1);
    act(() => receivers[0]({ data: [frame('D', {}, [999])] }));
    expect(screen.getByRole('dialog').textContent).not.toContain('999');
    act(() => receivers[1]({ data: [frame('D', {}, [10, 42])] }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('42'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(releases[1]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(container.querySelector('[data-cell-id="b"] rect')!);
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog').textContent).toContain('42');
    expect(nativeQuery).toHaveBeenCalledTimes(2);
    unmount();
  });
  const linkId = 'pg-link~isp-a:pppoe->rtr-a:wan1';
  const cpuRule = {
    name: 'router cpu',
    select: { ids: ['rtr-b'] },
    shape: {
      card: [
        {
          title: 'CPU',
          refId: 'E',
          match: { job: 'node-${cell.pg-id}' },
          unit: 'percent',
          decimals: 0,
          url: '/d/cpu?h=${cell.pg-id}',
        },
      ],
    },
  };
  const withCpu = (over: Partial<PanelProps<Options>> = {}) =>
    props({ options: { ...options, rules: [...options.rules, cpuRule] }, ...over });
  async function setup(p = props()) {
    const r = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(r.container.querySelector('polyline.dmap-half')).not.toBeNull());
    const half = (cell: string) =>
      r.container.querySelector(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`)!;
    const cell = (id: string) => r.container.querySelector(`[data-cell-id="${id}"]`)!;
    return { ...r, half, cell, wrapper: screen.getByTestId('dmap-panel') };
  }
  const card = () => screen.queryByTestId('dmap-card');

  it('renders no card and no canvas value labels or sparklines until the pointer is on a cell', async () => {
    const { container } = await setup();
    expect(card()).toBeNull();
    expect(container.querySelector('.dmap-label, .dmap-spark')).toBeNull();
  });
  it('hover shows a card with both directions; leaving the panel hides it', async () => {
    const { half, wrapper } = await setup();
    fireEvent.pointerMove(half(linkId), { pointerType: 'mouse', clientX: 50, clientY: 40 });
    const c = await screen.findByRole('tooltip');
    expect(c.textContent).toContain('isp-a → rtr-a');
    // the test frames have no unit; the title names the two ends
    expect(c.textContent).toContain('41000000 · 41%');
    expect(c.getAttribute('aria-label')).toBe('ISP A pppoe ↔ rtr-a wan1');
    expect(c.textContent).toContain('rtr-a → isp-a');
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
  it('click pins the card as a dialog with a close button, row links and footer links', async () => {
    const { half } = await setup();
    fireEvent.click(half(linkId), { clientX: 50, clientY: 40 });
    const dialog = await screen.findByRole('dialog', { name: 'ISP A pppoe ↔ rtr-a wan1' });
    expect(document.activeElement).toBe(dialog);
    const rows = screen.getAllByTestId('dmap-card-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].tagName).toBe('A');
    expect(rows[0].getAttribute('href')).toBe('/d/x?job=isp-a');
    expect(rows[0].getAttribute('target')).toBe('_blank');
    // a rule url without urlTitle to a dashboard path: "Open dashboard", a small link button with an external icon
    const footer = screen.getByRole('link', { name: 'Open dashboard' });
    expect(footer.getAttribute('href')).toBe('/d/x?job=isp-a');
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
    const { cell } = await setup(withCpu());
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
    const p = withCpu();
    const { cell, half, rerender } = await setup(p);
    fireEvent.click(cell('pg-node~rtr-b'));
    await screen.findByRole('dialog');
    rerender(<DrawioMapPanel {...p} options={{ ...options, rules: [options.rules[0]] }} />);
    expect(card()).toBeNull();
    fireEvent.pointerMove(half(linkId), { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });
  it('a rule urlTitle names the footer link', async () => {
    const rules = options.rules.map((r) => (r.name === 'links' ? { ...r, urlTitle: 'Port ${from.port}' } : r));
    const { half } = await setup(props({ options: { ...options, rules } }));
    fireEvent.click(half(linkId));
    await screen.findByRole('dialog');
    expect(screen.getByRole('link', { name: 'Port pppoe' }).getAttribute('href')).toBe('/d/x?job=isp-a');
  });
  it('each row has its head line and below it a sparkline at the full row width', async () => {
    // the data covers 0..2 ms of the 0..100 ms range: the line still fills the width
    const range = { from: dateTime(0), to: dateTime(100), raw: { from: 'now-1h', to: 'now' } };
    const { cell } = await setup(withCpu({ timeRange: range }));
    fireEvent.click(cell('pg-node~rtr-b'));
    await screen.findByRole('dialog');
    const row = screen.getAllByTestId('dmap-card-row')[0];
    const [head, spark, minMax] = Array.from(row.children);
    expect(head.textContent).toContain('CPU');
    expect(head.textContent).toContain('42%');
    expect(spark.getAttribute('data-testid')).toBe('dmap-card-spark');
    expect(getComputedStyle(spark).width).toBe('100%');
    expect(getComputedStyle(spark).display).toBe('block');
    const plot = spark.querySelector('[data-testid="grafana-sparkline"]')!;
    expect(plot.getAttribute('width')).toBe('264');
    expect(plot.getAttribute('height')).toBe('40');
    expect(spark.querySelector('polyline')).toBeNull();
    expect(minMax.getAttribute('data-testid')).toBe('dmap-card-range');
    expect(minMax.textContent).toBe('min 12%max 42%');
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
  it('a node card shows the configured rows with their unit, sparkline and url', async () => {
    const { cell } = await setup(withCpu());
    fireEvent.click(cell('pg-node~rtr-b'));
    const dialog = await screen.findByRole('dialog');
    const row = screen.getByTestId('dmap-card-row');
    expect(row.textContent).toContain('CPU');
    expect(row.textContent).toContain('42%');
    expect(row.getAttribute('href')).toBe('/d/cpu?h=rtr-b');
    expect(dialog.querySelectorAll('[data-testid="grafana-sparkline"]')).toHaveLength(1);
  });
  it('a click on the node icon opens the card of the node', async () => {
    const { cell } = await setup(withCpu());
    fireEvent.click(cell('pg-icon~rtr-b').querySelector('ellipse, path')!);
    expect((await screen.findByRole('dialog')).textContent).toContain('CPU');
  });
  it('a click on a sparkline opens its url', async () => {
    const { cell } = await setup(withCpu());
    fireEvent.click(cell('pg-node~rtr-b'));
    await screen.findByRole('dialog');
    const spark = screen.getByTestId('dmap-card-spark');
    const link = spark.closest('a')!;
    const opened = vi.fn((e: MouseEvent) => e.preventDefault());
    link.addEventListener('click', opened);
    fireEvent.click(spark);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(link.getAttribute('href')).toBe('/d/cpu?h=rtr-b');
    expect(link.getAttribute('target')).toBe('_blank');
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

  const withWarning = (legend?: Options['legend']) =>
    props({
      options: {
        ...options,
        ...(legend ? { legend } : {}),
        rules: [...options.rules, { name: 'old', select: { ids: ['rtr-b'] }, shape: { sparkline: {} } } as never],
      },
    });

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

  it('in panel edit the corner holds the reset button, the badge button and the edit button in that order; in view the badge is no button', async () => {
    const view = await setup(withWarning());
    wheel(view.wrapper, { deltaY: -10, ctrlKey: true });
    await screen.findByRole('button', { name: 'Reset zoom' });
    expect(screen.getByTestId('dmap-warning-badge').tagName).toBe('DIV');
    expect(screen.queryByTestId('dmap-edit-bindings')).toBeNull();
    view.unmount();
    locationService.partial({ editPanel: 1 });
    onTestFinished(() => act(() => locationService.partial({ editPanel: null })));
    const edit = await setup(withWarning());
    wheel(edit.wrapper, { deltaY: -10, ctrlKey: true });
    const reset = await screen.findByRole('button', { name: 'Reset zoom' });
    const badge = screen.getByTestId('dmap-warning-badge');
    const open = screen.getByTestId('dmap-edit-bindings');
    expect(badge.tagName).toBe('BUTTON');
    expect(reset.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(badge.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe('saved chart results in authoring previews', () => {
  let restoreGeometry: () => void;
  const receivers: Array<(value: number) => void> = [];
  const release = vi.fn();
  beforeEach(() => {
    const ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getCTM');
    const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    Object.defineProperties(SVGElement.prototype, {
      getCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      getBBox: { configurable: true, value: () => ({ x: 0, y: 0, width: 180, height: 70 }) },
    });
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
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
    restoreGeometry = () => {
      rect.mockRestore();
      for (const [key, descriptor] of [
        ['getCTM', ctm],
        ['getBBox', bbox],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(SVGElement.prototype, key, descriptor);
        } else {
          Reflect.deleteProperty(SVGElement.prototype, key);
        }
      }
    };
    receivers.length = 0;
    release.mockClear();
    nativeQuery.mockReset().mockImplementation(
      (request) =>
        new Observable((observer) => {
          const receive = (value: number) => observer.next({ data: [frame('D', {}, [value - 1, value])] });
          receivers.push(receive);
          receive(request.targets[0].expr === 'changed' || request.scopedVars.dm_key?.value === 'other' ? 84 : 42);
          return release;
        })
    );
    locationService.partial({ editPanel: 818 });
  });
  afterEach(() => {
    act(() => locationService.partial({ editPanel: null }));
    restoreGeometry();
  });
  function fixture() {
    const config: DiagramConfigV2 = {
      version: 2,
      overrides: [],
      queries: [
        {
          id: 'q',
          name: 'Chart data',
          source: { kind: 'datasource', datasource: { uid: 'native' }, target: { refId: 'D' }, parameters: {} },
        },
      ],
      patterns: [{ id: 'p', name: 'Chart region', select: { ids: ['chart'] }, display: {} }],
      widgets: [
        {
          id: 'w',
          anchorCellId: 'chart',
          kind: 'sparkline',
          label: 'CPU chart',
          binding: { queryId: 'q', match: {}, reducer: 'last' },
        },
      ],
    };
    const small =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="chart"><rect width="180" height="70"/></g><g data-cell-id="other"><rect x="200" width="180" height="70"/></g></svg>';
    return {
      ...props({ id: 818 }),
      options: { ...options, rules: [], config, diagram: { xml: '', svg: small, hash: 'reuse-chart', updatedAt: '' } },
    };
  }
  function hoverFixture() {
    locationService.partial({ editPanel: null });
    const p = fixture();
    p.options.config.patterns[0].display.hover = {
      rows: [
        { kind: 'value', label: 'Same chart value', binding: { queryId: 'q', match: {}, reducer: 'last' } },
        { kind: 'history', label: 'Same chart history', binding: { queryId: 'q', match: {}, reducer: 'last' } },
      ],
    };
    return p;
  }
  const clickChart = () => fireEvent.click(document.querySelector('[data-cell-id="chart"] rect')!);
  function mixedFixture(state: 'error' | 'loading' | 'unsupported' | 'empty', readyFirst: boolean, hover = false) {
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      const width = this.getAttribute('x') === '200' ? 200 : 400;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 200, width, height: 200, toJSON: () => ({}) };
    });
    const p = hover ? hoverFixture() : fixture();
    p.options.config.widgets.push({ ...p.options.config.widgets[0], id: 'w2', anchorCellId: 'other' });
    nativeQuery.mockImplementation(
      (request) =>
        new Observable((observer) => {
          const successful = (request.maxDataPoints === 400) === readyFirst;
          observer.next(
            successful
              ? { data: [frame('D', {}, [41, 42])] }
              : {
                  state:
                    state === 'error'
                      ? LoadingState.Error
                      : state === 'loading'
                        ? LoadingState.Loading
                        : state === 'unsupported'
                          ? LoadingState.Streaming
                          : LoadingState.Done,
                  data: [],
                }
          );
          return release;
        })
    );
    return p;
  }
  it.each(['error', 'loading', 'unsupported'] as const)(
    'individual preview keeps ordinary demand fallback with only a saved %s result',
    async (state) => {
      const p = fixture();
      nativeQuery.mockImplementation(
        (request) =>
          new Observable((observer) => {
            observer.next(
              request.maxDataPoints === 160
                ? { data: [frame('D', {}, [84])] }
                : {
                    state:
                      state === 'error'
                        ? LoadingState.Error
                        : state === 'loading'
                          ? LoadingState.Loading
                          : state === 'unsupported'
                            ? LoadingState.Streaming
                            : LoadingState.Done,
                    data: [],
                  }
            );
            return release;
          })
      );
      render(<DrawioMapPanel {...p} />);
      const diagnostic =
        state === 'error'
          ? 'Datasource query failed'
          : state === 'loading'
            ? 'Loading'
            : state === 'unsupported'
              ? 'Streaming and partial'
              : 'No data';
      await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain(diagnostic));
      selectElement('chart');
      openQueryRow('Chart data');
      fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
      await waitFor(() => expect(editorField('Query preview result').textContent).toContain('ready'));
      expect(nativeQuery.mock.calls.map(([request]) => request.maxDataPoints)).toEqual([400, 160]);
    }
  );
  it.each([
    ['error', false],
    ['error', true],
    ['loading', false],
    ['loading', true],
    ['unsupported', false],
    ['unsupported', true],
    ['empty', false],
    ['empty', true],
  ] as const)('prefers ready over %s with ready first=%s for scalar and history hover', async (state, readyFirst) => {
    render(<DrawioMapPanel {...mixedFixture(state, readyFirst, true)} />);
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('dmap-widget')
          .map((el) => el.textContent)
          .join('|')
      ).toContain('42')
    );
    clickChart();
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('42'));
    expect(screen.getByRole('dialog').textContent).toContain('Same chart value');
    expect(screen.getByRole('dialog').textContent).toContain('Same chart history');
    expect(screen.getByRole('dialog').querySelector('canvas')).not.toBeNull();
    expect(nativeQuery.mock.calls.map(([request]) => request.maxDataPoints)).toEqual([400, 200]);
    expect(release).not.toHaveBeenCalled();
  });
  it('reuses a ready saved chart for configured scalar and history hover rows', async () => {
    const p = hoverFixture();
    render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('42'));
    expect(nativeQuery).toHaveBeenCalledTimes(1);
    clickChart();
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('42'));
    expect(screen.getByRole('dialog').textContent).toContain('Same chart history');
    expect(screen.getByRole('dialog').querySelector('canvas')).not.toBeNull();
    expect(nativeQuery.mock.calls.map(([request]) => request.maxDataPoints)).toEqual([400]);
    act(() => receivers[0](99));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('99'));
    expect(screen.getByTestId('dmap-widget').textContent).toContain('99');
    expect(nativeQuery).toHaveBeenCalledTimes(1);
  });
  it.each(['empty', 'loading', 'error', 'unsupported'] as const)(
    'reuses only successful saved results while its chart is %s',
    async (state) => {
      const p = hoverFixture();
      let savedNext!: (value: number) => void;
      let hoverNext!: (value: number) => void;
      nativeQuery.mockImplementation(
        (request) =>
          new Observable((observer) => {
            const next = (value: number) => observer.next({ data: [frame('D', {}, [value - 1, value])] });
            if (request.maxDataPoints === 400) {
              savedNext = next;
              observer.next({
                state:
                  state === 'loading'
                    ? LoadingState.Loading
                    : state === 'error'
                      ? LoadingState.Error
                      : state === 'unsupported'
                        ? LoadingState.Streaming
                        : LoadingState.Done,
                data: state === 'empty' ? [] : [frame('D', {}, [42])],
              });
            } else {
              hoverNext = next;
              next(84);
            }
            return release;
          })
      );
      const view = render(<DrawioMapPanel {...p} />);
      await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(1));
      const savedText =
        state === 'empty'
          ? 'No data'
          : state === 'loading'
            ? 'Loading'
            : state === 'error'
              ? 'Datasource query failed'
              : 'Streaming and partial';
      await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain(savedText));
      clickChart();
      await waitFor(() =>
        expect(screen.getByRole('dialog').textContent).toContain(state === 'empty' ? 'No data' : '84')
      );
      expect(nativeQuery).toHaveBeenCalledTimes(state === 'empty' ? 1 : 2);
      act(() => savedNext(99));
      await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('99'));
      expect(screen.getByRole('dialog').querySelector('canvas')).not.toBeNull();
      if (state !== 'empty') {
        expect(release).toHaveBeenCalledTimes(1);
        act(() => hoverNext(888));
        expect(screen.getByRole('dialog').textContent).not.toContain('888');
      }
      view.unmount();
    }
  );
  it('keeps saved monitoring independent across close, fresh props and reopen', async () => {
    const p = hoverFixture();
    const view = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('42'));
    clickChart();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(release).not.toHaveBeenCalled();
    view.rerender(<DrawioMapPanel {...p} timeRange={{ ...p.timeRange }} options={{ ...p.options }} />);
    act(() => receivers[0](99));
    await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('99'));
    clickChart();
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('99'));
    expect(nativeQuery).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    view.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each(['hidden', 'removed'] as const)('continues open hover monitoring when its chart is %s', async (change) => {
    const p = hoverFixture();
    const view = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('42'));
    clickChart();
    await screen.findByRole('dialog');
    expect(nativeQuery).toHaveBeenCalledTimes(1);
    if (change === 'hidden') {
      act(() => {
        document.querySelector<SVGElement>('[data-cell-id="chart"] rect')!.style.display = 'none';
      });
    } else {
      view.rerender(<DrawioMapPanel {...p} options={{ ...p.options, config: { ...p.options.config, widgets: [] } }} />);
    }
    await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
    expect(release).toHaveBeenCalledTimes(1);
    expect(nativeQuery.mock.calls[1][0].maxDataPoints).toBe(264);
    expect(screen.queryByTestId('dmap-widget')).toBeNull();
    act(() => {
      receivers[0](999);
      receivers[1](84);
    });
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('84'));
    expect(screen.getByRole('dialog').textContent).not.toContain('999');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(release).toHaveBeenCalledTimes(2);
    clickChart();
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('84'));
    expect(nativeQuery).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  it('rejects old saved results when the open card context changes and follows the new saved stream', async () => {
    const p = hoverFixture();
    const view = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('42'));
    clickChart();
    await screen.findByRole('dialog');
    const current: Array<(value: number) => void> = [];
    nativeQuery.mockImplementation(
      () =>
        new Observable((observer) => {
          current.push((value) => observer.next({ data: [frame('D', {}, [value - 1, value])] }));
          return release;
        })
    );
    view.rerender(<DrawioMapPanel {...p} timeRange={{ ...p.timeRange, from: dateTime(1000), to: dateTime(2000) }} />);
    await waitFor(() => expect(current).toHaveLength(2));
    act(() => receivers[0](999));
    // The card keeps the last result until the new context has a result.
    expect(screen.getByRole('dialog').textContent).toContain('42');
    expect(screen.getByRole('dialog').textContent).not.toContain('999');
    // Complete the saved stream first. Its ready data replaces the temporary hover demand.
    const chartIndex = nativeQuery.mock.calls.slice(1).findIndex(([request]) => request.maxDataPoints === 400);
    act(() => current[chartIndex](84));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('84'));
    expect(release).toHaveBeenCalledTimes(2);
    act(() => {
      current[1 - chartIndex](888);
      current[chartIndex](99);
    });
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('99'));
    expect(screen.getByRole('dialog').textContent).not.toContain('888');
    expect(nativeQuery).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(release).toHaveBeenCalledTimes(3);
  });
  it('loads another parameterized cell and a changed hover query instead of reusing the chart data', async () => {
    const p = hoverFixture();
    const source = p.options.config.queries[0].source;
    if (source.kind === 'datasource') {
      source.parameters = { dm_key: 'cell.key' };
    }
    p.options.config.patterns[0].select = { ids: ['chart', 'other'] };
    const view = render(<DrawioMapPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('42'));
    clickChart();
    await screen.findByRole('dialog');
    expect(nativeQuery).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('[data-cell-id="other"] rect')!);
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('84'));
    expect(nativeQuery).toHaveBeenCalledTimes(2);
    expect(nativeQuery.mock.calls[1][0].scopedVars.dm_key.value).toBe('other');
    clickChart();
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('42'));
    expect(release).toHaveBeenCalledTimes(1);
    const config = structuredClone(p.options.config);
    const q = structuredClone(config.queries[0]);
    q.id = 'different';
    if (q.source.kind === 'datasource') {
      q.source.target = { ...q.source.target, ...{ expr: 'changed' } };
    }
    config.queries.push(q);
    config.patterns[0].display.hover!.rows = [
      { kind: 'value', label: 'Different', binding: { queryId: q.id, match: {}, reducer: 'last' } },
    ];
    view.rerender(<DrawioMapPanel {...p} options={{ ...p.options, config }} />);
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('84'));
    expect(nativeQuery.mock.calls.filter(([request]) => request.targets[0].expr === 'changed')).toHaveLength(1);
    expect(screen.getByTestId('dmap-widget').textContent).toContain('42');
    view.unmount();
  });
});

describe('DrawioMapPanel status band', () => {
  const statusBinding = (queryId: string) => ({ queryId, match: {}, reducer: 'last' }) as const;
  /** count cells, each with its own panel query; reasons[i] gives the down reason of cell i (data value 0) */
  function statusPanel(count: number, reasons: Record<number, string> = {}, over: Partial<Options> = {}) {
    const cells = Array.from(
      { length: count },
      (_, i) =>
        `<g data-cell-id="c${i}" transform="translate(${(i % 6) * 60} ${Math.floor(i / 6) * 50})"><rect width="40" height="30"/><text>C${i}</text></g>`
    ).join('');
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 250">${cells}</svg>`;
    const config: DiagramConfigV2 = {
      version: 2,
      queries: Array.from({ length: count }, (_, i) => ({
        id: `q${i}`,
        name: `Q${i}`,
        source: { kind: 'panel', refId: `Q${i}` },
      })),
      patterns: [],
      widgets: [],
      overrides: Array.from({ length: count }, (_, i) => ({
        cellId: `c${i}`,
        display: {
          status: {
            kind: 'mapping',
            binding: statusBinding(`q${i}`),
            default: { state: 'normal', reason: 'Healthy' },
            mappings: [{ value: 0, state: 'down', reason: reasons[i] ?? 'Down' }],
          },
        },
      })),
    };
    const series = Object.keys(reasons).map((i) => frame(`Q${i}`, {}, [0]));
    const p = props();
    return props({
      options: {
        ...options,
        rules: [],
        config,
        diagram: { xml: '', svg: svgText, hash: `band-${count}`, updatedAt: '' },
        ...over,
      },
      data: { ...p.data, series },
    });
  }
  const band = () => screen.queryByTestId('dmap-status-band');
  const rows = () => Array.from(band()?.querySelectorAll('.dmap-status-summary') ?? []);

  it('merges 26 elements without data into one row above the diagram, and the diagram gets the rest of the height', async () => {
    render(<DrawioMapPanel {...statusPanel(26)} />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toBe('? missingNo data26 elements');
    expect(rows()[0].getAttribute('title')).toBe('missing: No data (26 elements)');
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
    expect(rows().map((r) => r.getAttribute('title'))).toEqual([
      'down: Power lost (2 elements)',
      'down: Link down (1 element)',
    ]);
    const more = screen.getByRole('button', { name: '+3 more (5 elements)' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    const collapsed = parseFloat(band()!.style.height);
    fireEvent.click(more);
    expect(rows()).toHaveLength(5);
    expect(rows()[4].getAttribute('title')).toBe('missing: No data (3 elements)');
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
    expect(screen.getByRole('button', { name: '3 causes (3 elements)' })).toBeTruthy();
    rerender(<DrawioMapPanel {...statusPanel(3, reasons, { summary: { maxRows: 0 } })} />);
    expect(band()).toBeNull();
    expect(screen.getByTestId('dmap-stage').style.height).toBe('600px');
  });
});

describe('DrawioMapPanel cards only for cells with content', () => {
  const structureSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-layer~canvas"><g data-cell-id="pg-canvas"><rect id="bg" width="300" height="200"/></g></g>
    <g data-cell-id="pg-layer~diagram">
      <g data-cell-id="pg-group~core"><rect id="grp" x="5" y="5" width="200" height="120"/></g>
      <g data-cell-id="pg-groupTitle~core"><text id="grp-title">CORE</text></g>
      <g data-cell-id="pg-node~a" data-meta-pg-kind="node" data-meta-pg-id="a" data-meta-role="router"><rect id="na" x="10" y="10" width="40" height="30"/><text>A</text></g>
      <g data-cell-id="pg-node~b" data-meta-pg-kind="node" data-meta-pg-id="b"><rect id="nb" x="100" y="10" width="40" height="30"/><text>B</text></g>
      <g data-cell-id="pg-link~a-b" data-meta-pg-kind="link" data-meta-pg-id="a-b" data-meta-pg-from="a" data-meta-pg-to="b"><path id="lab" d="M50 25 L100 25" fill="none" stroke="#888"/></g>
      <g data-cell-id="pg-legend"><rect id="leg" x="10" y="150" width="60" height="30"/></g>
      <g data-cell-id="chart-1" data-meta-pg-kind="other"><rect id="chart" x="220" y="150" width="60" height="30"/></g>
      <g data-cell-id="pg-icon~a" data-meta-pg-kind="node-icon" data-meta-pg-of="a"><ellipse id="icon-a" cx="20" cy="20" rx="5" ry="5"/></g>
      <g data-cell-id="pg-linkLabel~a-b" data-meta-pg-kind="link-label" data-meta-pg-of="a-b"><rect id="lbl-bg" x="60" y="15" width="20" height="10"/><text id="lbl">uplink</text></g>
    </g>
  </g></svg>`;
  const roleRow = { kind: 'metadata', label: 'Role', path: 'cell.key' } as const;
  function structurePanel(select: { ids?: string[] }, over: Partial<Options> = {}) {
    const config: DiagramConfigV2 = {
      version: 2,
      queries: [],
      widgets: [],
      overrides: [],
      patterns: [{ id: 'p', name: 'Cards', select, display: { hover: { rows: [roleRow] } } }],
    };
    return props({
      options: {
        ...options,
        rules: [],
        config,
        diagram: { xml: '', svg: structureSvg, hash: `structure-${JSON.stringify([select, over])}`, updatedAt: '' },
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
    render(<DrawioMapPanel {...structurePanel({ ids: ['a'] })} />);
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
    render(<DrawioMapPanel {...structurePanel({})} />);
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
  it('an element override with hover.enabled false removes the card of that element', async () => {
    const p = structurePanel({});
    p.options.config!.overrides.push({ cellId: 'pg-node~a', display: { hover: { enabled: false, rows: [] } } });
    render(<DrawioMapPanel {...p} />);
    await hover('na');
    expect(screen.queryByTestId('dmap-card')).toBeNull();
    await hover('lab');
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });
  it('the icon and the link label open the card of their node and link, not a card of their own', async () => {
    render(<DrawioMapPanel {...structurePanel({})} />);
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
    const p = structurePanel({});
    p.options.config!.overrides.push({ cellId: 'pg-node~b', display: { hover: { enabled: false, rows: [] } } });
    const { container } = render(<DrawioMapPanel {...p} />);
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
    render(<DrawioMapPanel {...structurePanel({}, { hover: { kinds: ['node', 'group'] } })} />);
    await hover('lab');
    expect(screen.queryByTestId('dmap-card')).toBeNull();
    await hover('grp');
    expect((await screen.findByRole('tooltip')).getAttribute('aria-label')).toBe('core');
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
        rules: [],
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
  it('starts as a collapsed chip in the bottom-right corner; a saved panel without the key is collapsed', async () => {
    await setup();
    const el = legend()!;
    expect(el.getAttribute('data-dmap-corner')).toBe('bottom-right');
    expect(within(el).getByRole('button', { name: 'Legend' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(el).queryAllByTestId('dmap-legend-block')).toHaveLength(0);
  });
  it('shows the scales of the bound cells when it starts open', async () => {
    await setup(openLegend());
    const el = legend()!;
    expect(el.getAttribute('data-dmap-corner')).toBe('bottom-right');
    expect(
      within(el)
        .getAllByTestId('dmap-legend-block')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(expect.arrayContaining(['Link load %']));
    // outside the stage, so zoom, pan and the stage scroll do not move it
    expect(screen.getByTestId('dmap-stage').contains(el)).toBe(false);
  });
  it('legend.show false hides it; another corner moves it', async () => {
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
  });
  it('a click on the chip opens the legend and opens or pins no card', async () => {
    await setup(props({ width: 400 }));
    const chip = within(legend()!).getByRole('button', { name: 'Legend' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    expect(within(legend()!).getAllByTestId('dmap-legend-block').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('hovering an entry highlights the cells in that band and dims the others; leaving clears it', async () => {
    const { container } = await setup(openLegend());
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
});

describe('DrawioMapPanel bindings popup', () => {
  const small =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g data-cell-id="a"><rect width="40" height="30"/><text>A</text></g><g data-cell-id="b"><rect x="50" width="40" height="30"/><text>B</text></g></svg>';
  const diagram = { xml: '<mxfile/>', svg: small, hash: 'popup-panel', updatedAt: '' };
  const metric = (id = 'q'): DiagramConfigV2['queries'][number] => ({
    id,
    name: 'Metric',
    source: { kind: 'datasource', target: { refId: 'D' }, parameters: { dm_key: 'cell.key' } },
  });
  const labelled = (): DiagramConfigV2 => ({
    version: 2,
    defaultDatasource: { uid: 'native' },
    widgets: [],
    overrides: [],
    queries: [metric()],
    patterns: [
      {
        id: 'p',
        name: 'Devices',
        select: { ids: ['a', 'b'] },
        display: {
          label: 'Saved ${value}',
          shape: { text: true, binding: { queryId: 'q', match: {}, reducer: 'last' } },
        },
      },
    ],
  });
  /** A panel that keeps the saved options, as the dashboard does. */
  function renderSaved(config: DiagramConfigV2, id = 61, shown = diagram) {
    const save = vi.fn();
    function SavedPanel() {
      const [saved, setSaved] = React.useState<Options>({ ...options, rules: [], config, diagram: shown });
      return (
        <DrawioMapPanel
          {...props({ id })}
          options={saved}
          onOptionsChange={(next) => {
            save(next);
            setSaved(next);
          }}
        />
      );
    }
    return { save, ...render(<SavedPanel />) };
  }
  const stageText = (cell: string) =>
    screen.getByTestId('dmap-popup-stage').querySelector(`[data-cell-id="${cell}"] text`)?.textContent;
  beforeEach(() => {
    nativeQuery.mockReset().mockImplementation(
      (request) =>
        new Observable((observer) => {
          observer.next({ data: [frame('D', {}, [request.scopedVars.dm_key?.value === 'a' ? 11 : 22])] });
          return () => {};
        })
    );
    sourceLookups.mockReset();
    locationService.partial({ editPanel: 61 });
  });
  afterEach(() => {
    act(() => locationService.partial({ editPanel: null }));
  });

  it('opens from the corner button, saves through Apply and closes when the panel editor closes', async () => {
    const { save } = renderSaved(labelled());
    expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull();
    selectElement('a');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'a bindings' }));
    fireEvent.change(editorField('Label template'), { target: { value: 'Draft ${value}' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].config.overrides).toContainEqual({
      cellId: 'a',
      display: { label: 'Draft ${value}' },
    });
    act(() => locationService.partial({ editPanel: null }));
    expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull();
  });

  it('keeps the panel at the saved paint while the draft changes, and restores the popup on Cancel', async () => {
    const view = renderSaved(labelled());
    const panelLabel = () => view.container.querySelector('[data-cell-id="a"] text')?.textContent;
    await waitFor(() => expect(panelLabel()).toBe('Saved 11'));
    selectElement('a');
    await waitFor(() => expect(stageText('a')).toBe('Saved 11'));
    fireEvent.change(editorField('Label template'), { target: { value: 'Draft ${value}' } });
    await waitFor(() => expect(stageText('a')).toBe('Draft 11'));
    expect(panelLabel()).toBe('Saved 11');
    expect(view.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(stageText('a')).toBe('Saved 11'));
    expect(panelLabel()).toBe('Saved 11');
  });

  it('holds the panel and the popup subscriptions at once, and a reopened popup fills from the cache', async () => {
    renderSaved(labelled());
    await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
    openPopup();
    await waitFor(() => expect(stageText('a')).toBe('Saved 11'));
    expect(stageText('b')).toBe('Saved 22');
    const calls = nativeQuery.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull();
    openPopup();
    await waitFor(() => expect(stageText('a')).toBe('Saved 11'));
    expect(nativeQuery.mock.calls.length).toBe(calls);
  });

  it('sends a draft default datasource to the popup demands and not to the panel', async () => {
    const config = labelled();
    renderSaved(config);
    await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
    expect(sourceLookups.mock.calls.every(([ref]) => ref?.uid === 'native')).toBe(true);
    openPopup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Default datasource UID' }), { target: { value: 'other' } });
    await waitFor(() => expect(sourceLookups.mock.calls.some(([ref]) => ref?.uid === 'other')).toBe(true));
    const other = sourceLookups.mock.calls.filter(([ref]) => ref?.uid === 'other').length;
    // The panel keeps its saved datasource: a cancel sends no further lookup for the draft one.
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(sourceLookups.mock.calls.filter(([ref]) => ref?.uid === 'other').length).toBe(other);
  });
  it('runs an edited native target for the popup only, keeps the panel watch alive, and the panel runs it after Apply', async () => {
    const release = vi.fn();
    nativeQuery.mockReset().mockImplementation(
      (request) =>
        new Observable((observer) => {
          observer.next({ data: [frame('D', {}, [request.targets[0].expr === 'changed' ? 84 : 42])] });
          return release;
        })
    );
    const view = renderSaved(labelled());
    const panelLabel = () => view.container.querySelector('[data-cell-id="a"] text')?.textContent;
    await waitFor(() => expect(panelLabel()).toBe('Saved 42'));
    openPopup();
    openQueryRow('Metric');
    fireEvent.change(editorField('Native target JSON'), {
      target: { value: JSON.stringify({ refId: 'D', expr: 'changed' }) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import native target' }));
    selectElement('a');
    await waitFor(() => expect(stageText('a')).toBe('Saved 84'));
    expect(panelLabel()).toBe('Saved 42');
    expect(view.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    // The panel behind stays paused until the popup closes.
    expect(view.save).toHaveBeenCalledTimes(1);
    expect(panelLabel()).toBe('Saved 42');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(panelLabel()).toBe('Saved 84'));
    expect(nativeQuery.mock.calls.filter(([request]) => request.targets[0].expr === 'changed').length).toBeGreaterThan(
      0
    );
  });

  it('ignores a late result of an obsolete context in the popup stage and follows the new context', async () => {
    const receivers: Array<{ range: number; receive: (value: number) => void }> = [];
    nativeQuery.mockReset().mockImplementation(
      (request) =>
        new Observable((observer) => {
          const receive = (value: number) => observer.next({ data: [frame('D', {}, [value])] });
          receivers.push({ range: Number(request.range.from.valueOf()), receive });
          receive(request.range.from.valueOf() === 1000 ? 84 : 42);
          return () => {};
        })
    );
    const config = labelled();
    const p = props({ id: 61 });
    const saved = { ...options, rules: [], config, diagram };
    const view = render(<DrawioMapPanel {...p} options={saved} />);
    openPopup();
    await waitFor(() => expect(stageText('a')).toBe('Saved 42'));
    const old = receivers.slice();
    view.rerender(
      <DrawioMapPanel {...p} options={saved} timeRange={{ ...p.timeRange, from: dateTime(1000), to: dateTime(2000) }} />
    );
    await waitFor(() => expect(stageText('a')).toBe('Saved 84'));
    act(() => old.forEach((entry) => entry.receive(999)));
    expect(stageText('a')).toBe('Saved 84');
  });

  it('releases every query demand of the panel and of the popup on unmount', async () => {
    const release = vi.fn();
    nativeQuery.mockReset().mockImplementation(
      () =>
        new Observable((observer) => {
          observer.next({ data: [frame('D', {}, [42])] });
          return release;
        })
    );
    const view = renderSaved(labelled());
    openPopup();
    await waitFor(() => expect(stageText('a')).toBe('Saved 42'));
    const started = nativeQuery.mock.calls.length;
    expect(started).toBeGreaterThan(0);
    view.unmount();
    expect(release).toHaveBeenCalledTimes(started);
  });
  it('closes the popup and drops its draft when the panel editor address changes, and listens at the new address', async () => {
    renderSaved(labelled());
    openPopup();
    selectElement('a');
    fireEvent.change(editorField('Label template'), { target: { value: 'Dirty ${value}' } });
    expect(screen.getByTestId('dmap-bindings-popup')).toBeTruthy();
    // the same panel id in the editor of another dashboard
    act(() => locationService.push('/d/another-dashboard/x?editPanel=61'));
    await waitFor(() => expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull());
    act(() => {
      expect(requestOpen(currentAddress(), { kind: 'none' })).toBe(true);
    });
    await screen.findByTestId('dmap-bindings-popup');
    // the draft of the old session is gone
    selectElement('a');
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Saved ${value}');
  });

  it('drops the prepared result of a removed chart before the next explicit preview', async () => {
    const ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getCTM');
    const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    Object.defineProperties(SVGElement.prototype, {
      getCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      getBBox: { configurable: true, value: () => ({ x: 0, y: 0, width: 180, height: 70 }) },
    });
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
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
    onTestFinished(() => {
      rect.mockRestore();
      for (const [key, descriptor] of [
        ['getCTM', ctm],
        ['getBBox', bbox],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(SVGElement.prototype, key, descriptor);
        } else {
          Reflect.deleteProperty(SVGElement.prototype, key);
        }
      }
    });
    nativeQuery.mockReset().mockImplementation(
      () =>
        new Observable((observer) => {
          observer.next({ data: [frame('D', {}, [42])] });
          return () => {};
        })
    );
    const config: DiagramConfigV2 = {
      version: 2,
      overrides: [],
      queries: [
        {
          id: 'q',
          name: 'Chart data',
          source: { kind: 'datasource', datasource: { uid: 'native' }, target: { refId: 'D' }, parameters: {} },
        },
      ],
      patterns: [
        {
          id: 'p',
          name: 'Chart region',
          select: { ids: ['chart'] },
          display: {
            hover: {
              rows: [{ kind: 'value', label: 'Metric', binding: { queryId: 'q', match: {}, reducer: 'last' } }],
            },
          },
        },
      ],
      widgets: [
        {
          id: 'w',
          anchorCellId: 'chart',
          kind: 'sparkline',
          label: 'CPU chart',
          binding: { queryId: 'q', match: {}, reducer: 'last' },
        },
      ],
    };
    const chartSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="chart"><rect width="180" height="70"/></g></svg>';
    renderSaved(config, 61, { xml: '', svg: chartSvg, hash: 'drop-chart', updatedAt: '' });
    openPopup();
    const stage = () => within(screen.getByTestId('dmap-popup-stage'));
    await waitFor(() => expect(stage().getByTestId('dmap-widget').textContent).toContain('42'));
    // delete the chart in the draft: its watch is released and its prepared result goes away
    fireEvent.click(screen.getByRole('button', { name: 'Delete widget CPU chart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(stage().queryByTestId('dmap-widget')).toBeNull());
    const before = nativeQuery.mock.calls.length;
    selectElement('chart');
    chooseOption('Edit scope', 'All elements matching this pattern');
    fireEvent.click(screen.getByRole('button', { name: 'Preview all pattern matches' }));
    await waitFor(() => expect(editorField('Pattern preview progress').textContent).toContain('1 / 1'));
    // the preview asks for its own result at its own resolution; nothing of the removed chart answers it
    const asked = nativeQuery.mock.calls.slice(before).map(([request]) => request.maxDataPoints);
    expect(asked).toContain(160);
    expect(editorField('Affected metric resolution').textContent).toContain('chart: resolved');
  });

  describe('pause behind', () => {
    /** The applier calls on the stage of the panel (the popup stage also applies patches). */
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
        series: [frame('A', { job: 'node-isp-a', device: 'pppoe' }, [value]), ...base.data.series.slice(1)],
      };
    };

    it('does no per-refresh work for the panel behind and renders the latest data once on close', async () => {
      const base = props({ id: 61 });
      const view = render(<DrawioMapPanel {...base} data={seriesWith(10e6)} />);
      await waitFor(() => expect(view.container.querySelectorAll('polyline.dmap-half').length).toBeGreaterThan(0));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      openPopup();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const panel = screen.getByTestId('dmap-panel');
      const before = {
        halves: halves(panel),
        patched: panel.getAttribute('data-dmap-patched'),
        applies: panelApplies(),
        renders: work.viewRenders,
      };
      for (const value of [95e6, 5e6, 99e6]) {
        view.rerender(<DrawioMapPanel {...base} data={seriesWith(value)} />);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      expect(halves(panel)).toBe(before.halves);
      expect(panel.getAttribute('data-dmap-patched')).toBe(before.patched);
      expect(panelApplies()).toBe(before.applies);
      // The view is not rendered at all while it is paused: no loop, no per-refresh render.
      expect(work.viewRenders).toBe(before.renders);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(halves(screen.getByTestId('dmap-panel'))).not.toBe(before.halves));
      expect(panelApplies()).toBe(before.applies + 1);
      expect(work.viewRenders - before.renders).toBeLessThanOrEqual(3);
    });

    it('a refresh that changes the request id and the time range renders nothing while paused, and the latest result shows once after close', async () => {
      nativeQuery.mockReset().mockImplementation(
        (request) =>
          new Observable((observer) => {
            observer.next({ data: [frame('D', {}, [request.range.from.valueOf() === 1000 ? 84 : 11])] });
            return () => {};
          })
      );
      const p = props({ id: 61 });
      const saved = { ...options, rules: [], config: labelled(), diagram };
      const view = render(<DrawioMapPanel {...p} options={saved} />);
      const panelLabel = () => view.container.querySelector('[data-cell-id="a"] text')?.textContent;
      await waitFor(() => expect(panelLabel()).toBe('Saved 11'));
      openPopup();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const renders = work.viewRenders;
      const applies = panelApplies();
      const panelRequests = () =>
        nativeQuery.mock.calls.filter(([request]) => request.range.from.valueOf() === 1000).length;
      for (const requestId of ['r2', 'r3']) {
        view.rerender(
          <DrawioMapPanel
            {...p}
            options={saved}
            data={{ ...p.data, request: { ...p.data.request, requestId } as never }}
            timeRange={{ ...p.timeRange, from: dateTime(1000), to: dateTime(2000) }}
          />
        );
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      // The popup runs its own requests for the new context. The panel view renders nothing and draws nothing.
      expect(work.viewRenders).toBe(renders);
      expect(panelApplies()).toBe(applies);
      expect(panelLabel()).toBe('Saved 11');
      const before = panelRequests();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(panelLabel()).toBe('Saved 84'));
      // The popup and the panel share the cached request: the panel needs no more than one request per query scope.
      expect(panelRequests() - before).toBeLessThanOrEqual(2);
      expect(work.viewRenders - renders).toBeLessThanOrEqual(6);
    });

    it('keeps the paint of a controller emission away from the panel until close, then shows the latest result', async () => {
      const receivers: Array<(value: number) => void> = [];
      nativeQuery.mockReset().mockImplementation(
        () =>
          new Observable((observer) => {
            const receive = (value: number) => observer.next({ data: [frame('D', {}, [value])] });
            receivers.push(receive);
            receive(11);
            return () => {};
          })
      );
      const view = renderSaved(labelled());
      const panelLabel = () => view.container.querySelector('[data-cell-id="a"] text')?.textContent;
      await waitFor(() => expect(panelLabel()).toBe('Saved 11'));
      openPopup();
      const applies = panelApplies();
      act(() => receivers.forEach((receive) => receive(77)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(panelLabel()).toBe('Saved 11');
      expect(panelApplies()).toBe(applies);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(panelLabel()).toBe('Saved 77'));
    });

    it('lets a freshness deadline mark the status stale while paused, with one applier call', async () => {
      const binding = { queryId: 'q', match: {}, reducer: 'last' } as const;
      const config: DiagramConfigV2 = {
        version: 2,
        queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'Q' } }],
        patterns: [],
        widgets: [],
        overrides: [
          {
            cellId: 'a',
            display: {
              status: {
                kind: 'mapping',
                binding,
                default: { state: 'normal', reason: 'Healthy' },
                mappings: [{ value: 0, state: 'down', reason: 'Down' }],
                freshness: { expectedIntervalMs: 100, staleAfterMs: 400 },
              },
            },
          },
        ],
      };
      const fresh = toDataFrame({
        refId: 'Q',
        fields: [
          { name: 'Time', type: FieldType.time, values: [Date.now()] },
          { name: 'Value', type: FieldType.number, values: [1] },
        ],
      });
      const base = props({ id: 61 });
      const saved = { ...options, rules: [], config, diagram };
      const view = render(<DrawioMapPanel {...base} options={saved} data={{ ...base.data, series: [fresh] }} />);
      const status = () => screen.queryByTestId('dmap-status-band')?.textContent ?? '';
      await waitFor(() => expect(view.container.querySelector('[data-cell-id="a"]')).toBeTruthy());
      expect(status()).not.toContain('stale');
      openPopup();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const applies = panelApplies();
      view.rerender(<DrawioMapPanel {...base} options={saved} data={{ ...base.data, series: [fresh] }} />);
      await waitFor(() => expect(status()).toContain('stale'), { timeout: 2000 });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(panelApplies()).toBe(applies + 1);
      expect(screen.getByTestId('dmap-bindings-popup')).toBeTruthy();
    });

    it('Apply while open changes the panel on close only', async () => {
      const view = renderSaved(labelled());
      const panelLabel = () => view.container.querySelector('[data-cell-id="a"] text')?.textContent;
      await waitFor(() => expect(panelLabel()).toBe('Saved 11'));
      selectElement('a');
      fireEvent.change(editorField('Label template'), { target: { value: 'Draft ${value}' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
      expect(view.save).toHaveBeenCalledTimes(1);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(panelLabel()).toBe('Saved 11');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(panelLabel()).toBe('Draft 11'));
    });

    it('closes a pinned card when the popup opens', async () => {
      const view = render(<DrawioMapPanel {...props({ id: 61 })} />);
      await waitFor(() => expect(view.container.querySelector('polyline.dmap-half')).not.toBeNull());
      const half = view.container.querySelector(
        'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~isp-a:pppoe->rtr-a:wan1"]'
      )!;
      fireEvent.click(half, { clientX: 50, clientY: 40 });
      await screen.findByTestId('dmap-card');
      openPopup();
      await waitFor(() => expect(screen.queryByTestId('dmap-card')).toBeNull());
    });

    it('leaves the panel consumers attached when the popup closes during a loading preview', async () => {
      const receivers: Array<(value: number) => void> = [];
      nativeQuery.mockReset().mockImplementation(
        () =>
          new Observable((observer) => {
            receivers.push((value) => observer.next({ data: [frame('D', {}, [value])] }));
            if (receivers.length <= 2) {
              observer.next({ data: [frame('D', {}, [11])] });
            }
            return () => {};
          })
      );
      const view = renderSaved(labelled());
      const panelLabel = () => view.container.querySelector('[data-cell-id="a"] text')?.textContent;
      await waitFor(() => expect(panelLabel()).toBe('Saved 11'));
      openPopup();
      openQueryRow('Metric');
      fireEvent.change(editorField('Native target JSON'), {
        target: { value: JSON.stringify({ refId: 'D', expr: 'slow' }) },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Import native target' }));
      selectElement('a');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Discard and close' }));
      await waitFor(() => expect(screen.queryByTestId('dmap-bindings-popup')).toBeNull());
      // The first two requests belong to the panel. A later value on them still reaches the panel.
      act(() => receivers.slice(0, 2).forEach((receive) => receive(55)));
      await waitFor(() => expect(panelLabel()).toBe('Saved 55'));
    });
  });
});
