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
import { Observable } from 'rxjs';
import { exportPatternDocument } from '../editor/draft';
const nativeQuery = vi.hoisted(() => vi.fn());
vi.mock('@grafana/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({
    get: async () => ({ uid: 'native', components: {}, query: nativeQuery }),
    getInstanceSettings: () => undefined,
  }),
}));
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

it('keeps saved monitoring active in edit mode and executes a changed draft only after Preview or Apply', async () => {
  const receivers: Array<(value: number) => void> = [];
  nativeQuery.mockReset().mockImplementation(
    (request) =>
      new Observable((observer) => {
        const receive = (value: number) => observer.next({ data: [frame('D', {}, [value])] });
        receivers.push(receive);
        receive(request.targets[0].expr === 'changed' ? 84 : 42);
        return () => {};
      })
  );
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
  function SavedPanel() {
    const [saved, setSaved] = React.useState<Options>({
      ...options,
      rules: [],
      config,
      diagram: { xml: '<mxfile/>', svg: small, hash: 'native-paint', updatedAt: '' },
    });
    return <DrawioMapPanel {...p} options={saved} onOptionsChange={setSaved} />;
  }
  render(<SavedPanel />);
  await screen.findByText(/No supported native query editor/);
  await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(1));
  expect(nativeQuery.mock.calls[0][0].targets[0]).toEqual(expect.objectContaining({ refId: 'D' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
  await waitFor(() =>
    expect(document.querySelector('[data-cell-id="device-1"] text')?.textContent).toContain('Preview 42')
  );
  expect(nativeQuery).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Native target JSON'), {
    target: { value: JSON.stringify({ refId: 'D', expr: 'changed' }) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import native target' }));
  expect(nativeQuery).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
  await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(document.querySelector('[data-cell-id="device-1"] text')?.textContent).toContain('Preview 84')
  );
  expect(nativeQuery.mock.calls[1][0].targets[0].expr).toBe('changed');
  fireEvent.change(screen.getByLabelText('Native target JSON'), {
    target: { value: JSON.stringify({ refId: 'D', expr: 'applied' }) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import native target' }));
  expect(nativeQuery).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
  await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(3));
  expect(nativeQuery.mock.calls[2][0].targets[0].expr).toBe('applied');
  expect(screen.getByLabelText('Diagram binding inspector')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
  await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(4));
  act(() => receivers[2](96));
  await waitFor(() =>
    expect(document.querySelector('[data-cell-id="device-1"] text')?.textContent).toContain('Preview 96')
  );

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
  it('previews geometry before Apply, cancels it, and accepts a replacement diagram over an older geometry draft', () => {
    locationService.partial({ editPanel: 718 });
    const save = vi.fn();
    const small =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="region"><rect width="180" height="70"/></g></svg>';
    const saved = {
      ...options,
      rules: [],
      diagram: { xml: '<mxfile/>', svg: small, hash: 'geometry-start', updatedAt: '' },
    };
    const p = props({ id: 718, options: saved, onOptionsChange: save });
    const view = render(<DrawioMapPanel {...p} />);
    const resize = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit geometry in draw.io' }));
      const frame = screen.getByTitle('draw.io') as HTMLIFrameElement;
      const token = new DOMParser()
        .parseFromString(frame.srcdoc, 'text/html')
        .querySelector('meta[name="dmap-channel"]')!
        .getAttribute('content');
      const port = {
        onmessage: undefined as ((event: { data: string }) => void) | undefined,
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      act(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'null',
            source: frame.contentWindow,
            data: JSON.stringify({ dmapHello: token }),
            ports: [port as unknown as MessagePort],
          })
        )
      );
      act(() => port.onmessage?.({ data: JSON.stringify({ event: 'save', xml: '<mxfile/>', exit: true }) }));
      act(() =>
        port.onmessage?.({
          data: JSON.stringify({
            event: 'export',
            data: `data:image/svg+xml,${encodeURIComponent(small.replace('width="180"', 'width="260"'))}`,
          }),
        })
      );
    };
    resize();
    expect(document.querySelector('[data-cell-id="region"] rect')?.getAttribute('width')).toBe('260');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    expect(document.querySelector('[data-cell-id="region"] rect')?.getAttribute('width')).toBe('180');
    resize();
    view.rerender(
      <DrawioMapPanel
        {...p}
        options={{
          ...saved,
          diagram: { ...saved.diagram, hash: 'replacement', svg: small.replaceAll('region', 'replacement-cell') },
        }}
      />
    );
    expect(document.querySelector('[data-cell-id="replacement-cell"]')).toBeTruthy();
    expect(document.querySelector('[data-cell-id="region"]')).toBeNull();
    view.unmount();
    act(() => locationService.partial({ editPanel: null }));
  });
  it('shows imported or assigned draft charts without execution until explicit Preview or Apply', async () => {
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
      nativeQuery.mockReset().mockImplementation(
        () =>
          new Observable((observer) => {
            observer.next({ data: [frame('D', {}, [42])] });
          })
      );
      locationService.partial({ editPanel: 717 });
      const config: DiagramConfigV2 = {
        version: 2,
        patterns: [],
        overrides: [],
        widgets: [],
        queries: [
          {
            id: 'native',
            name: 'CPU',
            source: { kind: 'datasource', datasource: { uid: 'native' }, target: { refId: 'D' }, parameters: {} },
          },
        ],
      };
      const save = vi.fn();
      function SavedPanel() {
        const [saved, setSaved] = React.useState<Options>({
          ...options,
          rules: [],
          config,
          diagram: {
            xml: '<mxfile/>',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="region"><rect width="180" height="70"/></g></svg>',
            hash: 'draft-region',
            updatedAt: '',
          },
        });
        return (
          <DrawioMapPanel
            {...props({ id: 717 })}
            options={saved}
            onOptionsChange={(next) => {
              save(next);
              setSaved(next);
            }}
          />
        );
      }
      const view = render(<SavedPanel />);
      await screen.findByText(/No supported native query editor/);
      const imported = exportPatternDocument({
        ...config,
        queries: [{ ...config.queries[0], id: 'import-query' }],
        widgets: [
          {
            id: 'import-widget',
            anchorCellId: 'region',
            kind: 'sparkline',
            label: 'Imported chart',
            binding: { queryId: 'import-query', match: {}, reducer: 'last' },
          },
        ],
      });
      fireEvent.change(screen.getByLabelText('Pattern document'), { target: { value: JSON.stringify(imported) } });
      fireEvent.click(screen.getByRole('button', { name: 'Preview pattern import' }));
      fireEvent.click(screen.getByRole('button', { name: 'Import into draft' }));
      await waitFor(() => expect(screen.getByTestId('dmap-widget').getAttribute('aria-label')).toBe('Imported chart'));
      expect(screen.getByTestId('dmap-widget').textContent).toContain('Preview query or Apply');
      expect(nativeQuery).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
      await waitFor(() => expect(screen.queryByTestId('dmap-widget')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: 'Select region' }));
      fireEvent.click(screen.getByRole('button', { name: 'Assign chart region' }));
      fireEvent.change(screen.getByLabelText('Chart label'), { target: { value: 'Draft CPU' } });
      await waitFor(() => expect(screen.getByTestId('dmap-widget').getAttribute('aria-label')).toBe('Draft CPU'));
      expect(nativeQuery).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
      await waitFor(() => expect(screen.getByTestId('dmap-widget').textContent).toContain('42'));
      expect(nativeQuery).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
      await waitFor(() => expect(nativeQuery).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[0][0].config.widgets[0]).toMatchObject({ anchorCellId: 'region', label: 'Draft CPU' });
      expect(screen.getByTestId('dmap-widget').textContent).toContain('42');
      view.unmount();
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
      act(() => locationService.partial({ editPanel: null }));
    }
  });
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
