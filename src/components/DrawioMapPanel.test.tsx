import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createTheme,
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

const svg = readFileSync(resolve(__dirname, '../../fixtures/svg/l3-routing.svg'), 'utf8');
const frame = (refId: string, labels: Record<string, string>, values: number[]) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'Time', type: FieldType.time, values: values.map((_, i) => i) },
      { name: 'Value', type: FieldType.number, values, labels },
    ],
  });

const options: Options = {
  diagram: { xml: '<mxfile/>', svg, hash: fnv1a(svg), updatedAt: '2026-10-17T00:00:00Z' },
  editorUrl: 'http://localhost:8080',
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
      thresholds: {
        mode: 'percent',
        steps: [
          [0, 'green'],
          [60, 'yellow'],
          [85, 'red'],
        ],
      },
      url: '/d/x?job=${from.node}',
    },
    {
      name: 'node up',
      select: { kind: 'node' },
      shape: { series: { refId: 'C', match: { job: 'node-${cell.pg-id}' } }, target: 'shape' },
      thresholds: {
        mode: 'absolute',
        steps: [
          [0, 'red'],
          [1, 'green'],
        ],
      },
    },
  ],
};

function props(over: Partial<PanelProps<Options>> = {}): PanelProps<Options> {
  const series = [
    frame('A', { job: 'node-wan1', device: 'pppoe' }, [41e6]),
    frame('A', { job: 'node-rtr-a', device: 'wan1' }, [10e6]),
    frame('A', { job: 'node-wan2', device: 'dhcp' }, [90e6]),
    frame('C', { job: 'node-rtr-a' }, [1]),
    frame('C', { job: 'node-lte' }, [0]),
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
        thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
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
  it('mounts the svg, binds and draws overlay halves', async () => {
    const { container, findByTestId } = render(<DrawioMapPanel {...props()} />);
    const wrapper = await findByTestId('dmap-panel');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(container.querySelectorAll('svg g[data-cell-id]').length).toBe(100);
    expect(wrapper.getAttribute('data-dmap-cells')).toBe('100');
    const a2b = container.querySelector(
      'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~wan1:pppoe->rtr-a:wan1"]'
    )!;
    expect(a2b.getAttribute('data-dmap-step')).toBe('0');
    const red = container.querySelector(
      'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~wan2:dhcp->rtr-a:wan2"]'
    )!;
    expect(red.getAttribute('data-dmap-step')).toBe('2');
    const lte = container.querySelector(
      'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~lte:static->rtr-a:lte"]'
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
  const linkId = 'pg-link~wan1:pppoe->rtr-a:wan1';
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
    expect(c.textContent).toContain('wan1 → rtr-a');
    // the test frames have no unit; the title is the link label text
    expect(c.textContent).toContain('41000000 · 41%');
    expect(c.getAttribute('aria-label')).toBe('metric 10');
    expect(c.textContent).toContain('rtr-a → wan1');
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
    expect(rows[0].getAttribute('href')).toBe('/d/x?job=wan1');
    expect(rows[0].getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'links' }).getAttribute('href')).toBe('/d/x?job=wan1');
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
    fireEvent.pointerMove(half('pg-link~wan2:dhcp->rtr-a:wan2'), { pointerType: 'mouse' });
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
    fireEvent.click(half('pg-link~wan2:dhcp->rtr-a:wan2'));
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
