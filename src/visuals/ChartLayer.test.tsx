import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTheme, FieldType, getDefaultTimeRange } from '@grafana/data';
import { ChartLayer } from './ChartLayer';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { readChartAnchor } from '../render/geometry';
import { createQueryController } from '../query/controller';
import type { BindingPlan } from '../binding/patterns';
import type { QueryController, QueryContext, QueryExecutor } from '../query/types';
import type { NamedQuery, Widget } from '../model/config';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  Sparkline: () => <canvas />,
  BarGauge: () => <div />,
}));
const query: NamedQuery = { id: 'q', name: 'CPU', source: { kind: 'panel', refId: 'A' } };
const widget: Widget = {
  id: 'w',
  anchorCellId: 'chart',
  kind: 'sparkline',
  label: 'CPU',
  binding: { queryId: 'q', match: {}, reducer: 'last' },
};
const context: QueryContext = {
  timeRange: getDefaultTimeRange(),
  timeZone: 'utc',
  scopedVars: {},
  refreshMs: 0,
  intervalMs: 1000,
  generation: 1,
};
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = mountSvg(
    host,
    '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="chart"><rect width="180" height="70"/><text>Label outside bounds</text></g><g data-cell-id="ordinary"><rect width="50" height="30"/></g></svg>'
  );
  const cells = buildCellIndex(root);
  const rect = cells.get('chart')!.shape!;
  const parent = rect.parentElement!;
  Object.assign(parent, { getCTM: () => identity });
  Object.assign(rect, {
    getCTM: () => ({ ...identity, e: 12, f: 5 }),
    getBBox: () => ({ x: 0, y: 0, width: 180, height: 70 }),
  });
  Object.assign(host, {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
  });
  let left = 20;
  Object.assign(rect, {
    getBoundingClientRect: () => ({ left, top: 20, right: left + 180, bottom: 90, width: 180, height: 70 }),
  });
  const release = vi.fn();
  const watch = vi.fn<QueryController['watch']>(() => release);
  const controller: QueryController = { watch, setPanelData: vi.fn(), dispose: vi.fn() };
  const plan: BindingPlan = {
    cells: {},
    widgets: [{ widget, anchorCellId: 'chart', scope: { cell: {} } }],
    diagnostics: [],
  };
  return {
    host,
    root,
    cells,
    rect,
    plan,
    controller,
    watch,
    release,
    move: (x: number) => {
      left = x;
    },
  };
}
describe('ChartLayer', () => {
  it('updates query resolution on zoom while preserving rectangle-local dimensions', async () => {
    const s = setup();
    const { unmount } = render(
      <ChartLayer
        root={s.root}
        cells={s.cells}
        plan={s.plan}
        queries={[query]}
        controller={s.controller}
        context={context}
        viewport={s.host}
      />
    );
    expect(s.watch.mock.calls[0][0].maxDataPoints).toBe(180);
    Object.assign(s.rect, {
      getBoundingClientRect: () => ({ left: 20, top: 20, right: 380, bottom: 160, width: 360, height: 140 }),
    });
    await act(async () => {
      s.root.setAttribute('viewBox', '0 0 200 100');
    });
    expect(s.watch.mock.calls[1][0].maxDataPoints).toBe(360);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.root.querySelector('foreignObject')?.getAttribute('width')).toBe('180');
    expect(s.root.querySelector('foreignObject')?.getAttribute('height')).toBe('70');
    unmount();
    s.host.remove();
  });
  it('preserves the portal and active demand through a viewport revision with unchanged resolution', () => {
    const s = setup();
    const props = {
      root: s.root,
      cells: s.cells,
      plan: s.plan,
      queries: [query],
      controller: s.controller,
      context,
      viewport: s.host,
    };
    const { rerender, unmount } = render(<ChartLayer {...props} />);
    const portal = s.root.querySelector('foreignObject');
    rerender(<ChartLayer {...props} revision={2} />);
    expect(s.root.querySelector('foreignObject') === portal).toBe(true);
    expect(s.watch).toHaveBeenCalledTimes(1);
    unmount();
    s.host.remove();
  });
  it('waits for the browser visibility result before demanding a clipped chart', () => {
    const s = setup();
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
      const { unmount } = render(
        <ChartLayer
          root={s.root}
          cells={s.cells}
          plan={s.plan}
          queries={[query]}
          controller={s.controller}
          context={context}
          viewport={s.host}
        />
      );
      expect(s.watch).not.toHaveBeenCalled();
      act(() => intersect([{ isIntersecting: true }]));
      expect(s.watch).toHaveBeenCalledTimes(1);
      act(() => intersect([{ isIntersecting: false }]));
      expect(s.release).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.unstubAllGlobals();
      s.host.remove();
    }
  });
  it('retains the shared controller cache when a region leaves the panel and reappears', async () => {
    const s = setup();
    const execute = vi.fn<QueryExecutor>((_request, emit) => {
      emit({ state: 'empty', fetchedAt: 1000, fromCache: false });
      return () => {};
    });
    const controller = createQueryController(execute, undefined, () => 1000);
    const native: NamedQuery = {
      ...query,
      source: { kind: 'datasource', datasource: { uid: 'prom' }, target: { refId: 'D' }, parameters: {} },
    };
    const { unmount } = render(
      <ChartLayer
        root={s.root}
        cells={s.cells}
        plan={s.plan}
        queries={[native]}
        controller={controller}
        context={context}
        viewport={s.host}
      />
    );
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => {
      s.move(500);
      s.root.setAttribute('viewBox', '0 0 100 100');
    });
    await act(async () => {
      s.move(20);
      s.root.setAttribute('viewBox', '0 0 200 200');
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(s.host.textContent).toContain('No data');
    unmount();
    controller.dispose();
    s.host.remove();
  });
  it('limits interaction to the configured drilldown and leaves the underlying cell selectable', () => {
    const s = setup();
    const click = vi.fn();
    s.host.addEventListener('click', click);
    const plan = { ...s.plan, widgets: [{ ...s.plan.widgets[0], widget: { ...widget, url: '/d/detail' } }] };
    const { unmount } = render(
      <ChartLayer
        root={s.root}
        cells={s.cells}
        plan={plan}
        queries={[query]}
        controller={s.controller}
        context={context}
        viewport={s.host}
      />
    );
    const region = s.root.querySelector('foreignObject')!;
    expect(region.style.pointerEvents).toBe('none');
    const link = region.querySelector('a')!;
    expect(link.style.pointerEvents).toBe('auto');
    const preventNavigation = (event: Event) => event.preventDefault();
    link.addEventListener('click', preventNavigation);
    fireEvent.click(link);
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(s.rect);
    expect(click).toHaveBeenCalledTimes(1);
    expect(region.style.overflow).toBe('hidden');
    unmount();
    s.host.remove();
  });
  it('resets displayed values on context changes and rejects late old results', () => {
    const s = setup();
    const listeners: Array<Parameters<QueryController['watch']>[1]> = [];
    s.watch.mockImplementation((_demand, listener) => {
      listeners.push(listener);
      return s.release;
    });
    const props = {
      root: s.root,
      cells: s.cells,
      plan: s.plan,
      queries: [query],
      controller: s.controller,
      context,
      viewport: s.host,
    };
    const { rerender, unmount } = render(<ChartLayer {...props} />);
    const result = {
      state: 'ready',
      fetchedAt: Date.now(),
      fromCache: false,
      frames: [
        {
          length: 2,
          fields: [
            { name: 'Time', type: FieldType.time, config: {}, values: [1000, 2000] },
            { name: 'Value', type: FieldType.number, config: {}, values: [10, 20] },
          ],
        },
      ],
    } as const;
    act(() => listeners[0](result as any));
    expect(s.host.textContent).toContain('20');
    rerender(<ChartLayer {...props} context={{ ...context, generation: 2 }} />);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.host.textContent).not.toContain('20');
    act(() => listeners[0](result as any));
    expect(s.host.textContent).not.toContain('20');
    act(() => listeners[1]({ state: 'error', message: 'This widget query failed' }));
    expect(s.host.textContent).toContain('This widget query failed');
    unmount();
    s.host.remove();
  });
  it('keeps null and singular CTMs invalid and preserves rotation/skew relative to a nested parent', () => {
    const s = setup();
    const parent = s.rect.parentElement as unknown as SVGGraphicsElement;
    Object.assign(parent, { getCTM: () => ({ ...identity, a: 2, d: 2, e: 100, f: 40 }) });
    Object.assign(s.rect, { getCTM: () => ({ a: 0, b: 2, c: -2, d: 1, e: 120, f: 50 }) });
    expect(readChartAnchor(s.cells.get('chart')!, parent)).toMatchObject({
      width: 180,
      height: 70,
      matrix: { a: 0, b: 1, c: -1, d: 0.5, e: 10, f: 5 },
    });
    Object.assign(s.rect, { getCTM: () => null });
    expect(readChartAnchor(s.cells.get('chart')!, parent)).toBeUndefined();
    Object.assign(s.rect, { getCTM: () => ({ ...identity, a: 0 }) });
    expect(readChartAnchor(s.cells.get('chart')!, parent)).toBeUndefined();
    s.host.remove();
  });
  it('does not demand a hidden region and reacts when its ancestor becomes visible', async () => {
    const s = setup();
    s.host.style.display = 'none';
    const { unmount } = render(
      <ChartLayer
        root={s.root}
        cells={s.cells}
        plan={s.plan}
        queries={[query]}
        controller={s.controller}
        context={context}
        viewport={s.host}
      />
    );
    expect(s.watch).not.toHaveBeenCalled();
    await act(async () => {
      s.host.style.display = 'block';
    });
    expect(s.watch).toHaveBeenCalledTimes(1);
    unmount();
    s.host.remove();
  });
  it('explains an invalid anchor without starting its query', () => {
    const s = setup();
    Object.assign(s.rect, { getCTM: () => null });
    const { getByRole, unmount } = render(
      <ChartLayer
        root={s.root}
        cells={s.cells}
        plan={s.plan}
        queries={[query]}
        controller={s.controller}
        context={context}
        viewport={s.host}
      />
    );
    expect(getByRole('status').textContent).toMatch(/CPU.*rectangle.*transform/);
    expect(s.watch).not.toHaveBeenCalled();
    unmount();
    s.host.remove();
  });
  it('creates only explicit regions after the primitive, follows its relative matrix and releases clipped demand', async () => {
    const s = setup();
    const props = {
      root: s.root,
      cells: s.cells,
      plan: s.plan,
      queries: [query],
      controller: s.controller,
      context,
      viewport: s.host,
    };
    const { rerender, unmount } = render(<ChartLayer {...props} />);
    expect(s.root.querySelectorAll('foreignObject')).toHaveLength(1);
    const region = s.root.querySelector('foreignObject')!;
    expect(s.rect.nextElementSibling).toBe(region);
    expect(region.getAttribute('transform')).toBe('matrix(1 0 0 1 12 5)');
    expect(region.getAttribute('width')).toBe('180');
    expect(region.style.pointerEvents).toBe('none');
    expect(s.watch).toHaveBeenCalledTimes(1);
    s.move(500);
    await act(async () => {
      s.root.setAttribute('viewBox', '0 0 100 100');
    });
    expect(s.release).toHaveBeenCalledTimes(1);
    s.move(20);
    rerender(<ChartLayer {...props} revision={2} />);
    expect(s.watch).toHaveBeenCalledTimes(2);
    unmount();
    expect(s.release).toHaveBeenCalledTimes(2);
    s.host.remove();
  });
});
