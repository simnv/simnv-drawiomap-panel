import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const nativeQuery = vi.hoisted(() => vi.fn());
vi.mock('@grafana/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({
    get: async () => ({ uid: 'native', components: {}, query: nativeQuery }),
    getInstanceSettings: () => undefined,
  }),
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

const svg = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8');

it('mounts the focused inspector for the public editPanel route and persists through onOptionsChange', async () => {
  const save = vi.fn();
  locationService.partial({ editPanel: 1 });
  const p = props({ id: 1, onOptionsChange: save });
  render(<DrawioMapPanel {...p} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Select pg-node~rtr-b' }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'pg-node~rtr-b bindings' }));
  fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Draft label' } });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
  expect(save.mock.calls[0][0].config.overrides).toContainEqual({
    cellId: 'pg-node~rtr-b',
    display: { label: 'Draft label' },
  });
  act(() => locationService.partial({ editPanel: null }));
  expect(screen.queryByLabelText('Diagram binding inspector')).toBeNull();
});

it('paints draft bindings before Apply and restores saved paint on Cancel', async () => {
  locationService.partial({ editPanel: 99 });
  const config: DiagramConfigV2 = {
    version: 2,
    queries: [{ id: 'q', name: 'Metric', source: { kind: 'panel', refId: 'Q' } }],
    overrides: [],
    widgets: [],
    patterns: [
      {
        id: 'devices',
        name: 'Devices',
        select: { ids: ['device-1'] },
        display: {
          label: 'Saved',
          shape: { text: true, target: 'stroke', binding: { queryId: 'q', match: {}, reducer: 'last' } },
        },
      },
    ],
  };
  const small =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-cell-id="device-1"><rect width="40" height="30"/><text>Device</text></g></svg>';
  const save = vi.fn();
  const p = props({ id: 99, onOptionsChange: save });
  render(
    <DrawioMapPanel
      {...p}
      options={{
        ...options,
        rules: [],
        config,
        diagram: { xml: '<mxfile/>', svg: small, hash: 'draft-paint', updatedAt: '' },
      }}
      data={{ ...p.data, series: [frame('Q', {}, [42])] }}
    />
  );
  const label = () => document.querySelector('[data-cell-id="device-1"] text')?.textContent;
  await waitFor(() => expect(label()).toBe('Saved'));
  fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
  fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Preview draft' } });
  await waitFor(() => expect(label()).toBe('Preview draft'));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
  await waitFor(() => expect(label()).toBe('Saved'));
  act(() => locationService.partial({ editPanel: null }));
});

it('paints explicitly previewed native data without executing on mount or query edits', async () => {
  nativeQuery.mockReset().mockResolvedValue({ data: [frame('D', {}, [42])] });
  locationService.partial({ editPanel: 98 });
  const config: DiagramConfigV2 = {
    version: 2,
    queries: [
      {
        id: 'native',
        name: 'Native',
        source: { kind: 'datasource', datasource: { uid: 'native' }, target: { refId: 'D' }, parameters: {} },
      },
    ],
    overrides: [],
    widgets: [],
    patterns: [
      {
        id: 'device',
        name: 'Device',
        select: { ids: ['device-1'] },
        display: {
          shape: { text: true, binding: { queryId: 'native', match: {}, reducer: 'last' } },
          label: 'Preview ${value}',
        },
      },
    ],
  };
  const small =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-cell-id="device-1"><rect width="40" height="30"/><text>Device</text></g></svg>';
  const p = props({ id: 98 });
  render(
    <DrawioMapPanel
      {...p}
      options={{
        ...options,
        rules: [],
        config,
        diagram: { xml: '<mxfile/>', svg: small, hash: 'native-paint', updatedAt: '' },
      }}
    />
  );
  await screen.findByText(/No supported native query editor/);
  expect(nativeQuery).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
  await waitFor(() =>
    expect(document.querySelector('[data-cell-id="device-1"] text')?.textContent).toContain('Preview 42')
  );
  expect(nativeQuery).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Query name'), { target: { value: 'Changed' } });
  expect(nativeQuery).toHaveBeenCalledTimes(1);
  act(() => locationService.partial({ editPanel: null }));
});
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
    // the test frames have no unit; the title is the link label text
    expect(c.textContent).toContain('41000000 · 41%');
    expect(c.getAttribute('aria-label')).toBe('metric 10');
    expect(c.textContent).toContain('rtr-a → isp-a');
    expect(c.getAttribute('data-pinned')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(card()).toBeNull();
  });
  it('click pins the card as a dialog with a close button, row links and footer links', async () => {
    const { half } = await setup();
    fireEvent.click(half(linkId), { clientX: 50, clientY: 40 });
    const dialog = await screen.findByRole('dialog', { name: 'metric 10' });
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
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('metric 10');
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
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('metric 20');
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
    // the sparkline is a block below the head line: a stretched viewBox at 100 % of the row width
    expect(spark.getAttribute('data-testid')).toBe('dmap-card-spark');
    expect(spark.getAttribute('preserveAspectRatio')).toBe('none');
    expect(spark.getAttribute('viewBox')).toBe('0 0 200 40');
    expect(getComputedStyle(spark).width).toBe('100%');
    expect(getComputedStyle(spark).display).toBe('block');
    // the line goes from the left edge to the right edge of the viewBox
    const pts = spark.querySelector('polyline')!.getAttribute('points')!.split(' ');
    expect(pts[0].split(',')[0]).toBe('0');
    expect(pts[pts.length - 1].split(',')[0]).toBe('200');
    expect(spark.querySelector('line')).not.toBeNull();
    expect(minMax.getAttribute('data-testid')).toBe('dmap-card-range');
    expect(minMax.textContent).toBe('min 12%max 42%');
  });
  it('a narrow panel shows the card as a bottom sheet', async () => {
    const { half } = await setup(props({ width: 400 }));
    fireEvent.click(half(linkId));
    expect((await screen.findByRole('dialog')).getAttribute('data-sheet')).toBe('true');
  });
  it('a node card shows the configured rows with their unit, sparkline and url', async () => {
    const { cell } = await setup(withCpu());
    fireEvent.click(cell('pg-node~rtr-b'));
    const dialog = await screen.findByRole('dialog');
    const row = screen.getByTestId('dmap-card-row');
    expect(row.textContent).toContain('CPU');
    expect(row.textContent).toContain('42%');
    expect(row.getAttribute('href')).toBe('/d/cpu?h=rtr-b');
    expect(dialog.querySelectorAll('[data-testid="dmap-card-spark"] polyline')).toHaveLength(1);
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

  it('the reset button and the warning badge stack in the top-right corner', async () => {
    const { wrapper } = await setup(
      props({
        options: {
          ...options,
          rules: [...options.rules, { name: 'old', select: { ids: ['rtr-b'] }, shape: { sparkline: {} } } as never],
        },
      })
    );
    wheel(wrapper, { deltaY: -10, ctrlKey: true });
    const btn = await screen.findByRole('button', { name: 'Reset zoom' });
    const corner = screen.getByTestId('dmap-corner');
    expect(corner.contains(btn)).toBe(true);
    expect(corner.contains(screen.getByTestId('dmap-warning-badge'))).toBe(true);
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
