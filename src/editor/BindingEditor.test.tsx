import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { buildCellIndex } from '../render/svgStage';
import { BindingEditor } from './BindingEditor';
import type { DiagramConfigV2 } from '../model/config';
import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame } from '@grafana/data';
import { createQueryController } from '../query/controller';
import { PanelQueryContext } from '../query/panel';
vi.hoisted(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});
vi.mock('@grafana/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({ get: async () => ({ components: {} }), getInstanceSettings: () => undefined }),
}));
const config: DiagramConfigV2 = {
  version: 2,
  queries: [],
  overrides: [],
  widgets: [],
  patterns: [
    { id: 'devices', name: 'Devices', select: { ids: ['device-1', 'device-2'] }, display: { label: 'Shared' } },
  ],
};
function setup() {
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="device-2"><rect/></g></svg>';
  const cells = buildCellIndex(host.querySelector('svg')!);
  const save = vi.fn();
  render(<BindingEditor config={config} cells={cells} onSave={save} />);
  return { cells, save };
}
describe('binding inspector', () => {
  it('focuses the selected identity and defaults to this-element scope', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'device-1 bindings' }));
    expect((screen.getByLabelText('Edit scope') as HTMLSelectElement).value).toBe('element');
    expect(screen.getByText('Patterns: Devices')).toBeTruthy();
  });
  it('isolates cloned editors and reopens the saved binding after remount', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    const cells = buildCellIndex(host.querySelector('svg')!);
    const saveOne = vi.fn();
    const saveTwo = vi.fn();
    const secondHost = host.cloneNode(true) as HTMLDivElement;
    const secondCells = buildCellIndex(secondHost.querySelector('svg')!);
    const view = render(
      <>
        <div aria-label="Panel one">
          <BindingEditor config={config} cells={cells} onSave={saveOne} />
        </div>
        <div aria-label="Panel two">
          <BindingEditor config={config} cells={secondCells} onSave={saveTwo} />
        </div>
      </>
    );
    const one = within(screen.getByLabelText('Panel one'));
    const two = within(screen.getByLabelText('Panel two'));
    fireEvent.click(one.getByRole('button', { name: 'Select device-1' }));
    expect(two.queryByRole('heading', { name: 'device-1 bindings' })).toBeNull();
    fireEvent.change(one.getByLabelText('Label template'), { target: { value: 'Only panel one' } });
    fireEvent.click(one.getByRole('button', { name: 'Apply bindings' }));
    expect(saveTwo).not.toHaveBeenCalled();
    view.unmount();
    render(<BindingEditor config={saveOne.mock.calls[0][0]} cells={cells} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Only panel one');
  });
  it('keeps unedited shape settings inherited when creating an element override', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    const save = vi.fn();
    const inherited: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          ...config.patterns[0],
          display: { shape: { target: 'icon', binding: { queryId: 'health', match: {}, reducer: 'last' } } },
        },
      ],
    };
    render(<BindingEditor config={inherited} cells={buildCellIndex(host.querySelector('svg')!)} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    fireEvent.change(screen.getByLabelText('Shape colour target'), { target: { value: 'stroke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides[0].display).toEqual({ shape: { target: 'stroke' } });
  });
  it('previews every pattern match, saves only on Apply, and cancels back to saved', () => {
    const { save, cells } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    fireEvent.change(screen.getByLabelText('Edit scope'), { target: { value: 'pattern' } });
    fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Changed' } });
    expect(screen.getByLabelText('Affected binding preview').textContent).toContain('device-2');
    expect(cells.get('device-2')?.group.getAttribute('data-dmap-affected')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Shared');
    fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Applied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].patterns[0].display.label).toBe('Applied');
    fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Lost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo to saved' }));
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Applied');
  });
  it('selects unbound cells by pointer or keyboard while hover leaves focus alone', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="unbound"><rect/></g></svg>';
    const cells = buildCellIndex(host.querySelector('svg')!);
    render(
      <BindingEditor config={config} cells={cells} onSave={vi.fn()}>
        <div
          ref={(el) => {
            if (el) {
              el.append(host);
            }
          }}
        />
      </BindingEditor>
    );
    const cell = cells.get('unbound')!;
    fireEvent.click(cell.group.querySelector('rect')!);
    const heading = screen.getByRole('heading', { name: 'unbound bindings' });
    expect(document.activeElement).toBe(heading);
    const label = screen.getByLabelText('Label template');
    label.focus();
    fireEvent.pointerMove(cell.group);
    expect(document.activeElement).toBe(label);
    fireEvent.keyDown(cell.group, { key: 'Enter' });
    expect(document.activeElement).toBe(heading);
    expect(cell.group.getAttribute('data-dmap-selected')).toBe('true');
  });
  it('blocks Apply for unresolved query references', () => {
    const invalid = {
      ...config,
      overrides: [
        {
          cellId: 'device-1',
          display: { shape: { binding: { queryId: 'missing', match: {}, reducer: 'last' as const } } },
        },
      ],
    };
    const save = vi.fn();
    render(<BindingEditor config={invalid} cells={new Map()} onSave={save} />);
    const apply = screen.getByRole('button', { name: 'Apply bindings' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(apply);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('missing');
  });
  it('authors hover rows, shape/link bindings and explicit health rules through forms', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    const save = vi.fn();
    const withQuery: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }],
    };
    render(<BindingEditor config={withQuery} cells={buildCellIndex(host.querySelector('svg')!)} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    fireEvent.change(screen.getByLabelText('Shape query'), { target: { value: 'health' } });
    fireEvent.change(screen.getByLabelText('A to B query'), { target: { value: 'health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add hover row' }));
    fireEvent.change(screen.getByLabelText('Hover row 1 kind'), { target: { value: 'history' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add health rule' }));
    fireEvent.change(screen.getByLabelText('Health condition 1 reason'), { target: { value: 'Health check failed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    const display = save.mock.calls[0][0].overrides[0].display;
    expect(display.shape.binding.queryId).toBe('health');
    expect(display.link.a2bBinding.queryId).toBe('health');
    expect(display.hover.rows[0]).toMatchObject({ kind: 'history', binding: { queryId: 'health' } });
    expect(display.status.mappings[0]).toEqual({ value: 0, state: 'down', reason: 'Health check failed' });
  });
  it('keeps invalid draft fields editable so their diagnostics can be corrected', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    render(
      <BindingEditor
        config={{ ...config, queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }] }}
        cells={buildCellIndex(host.querySelector('svg')!)}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add health rule' }));
    fireEvent.change(screen.getByLabelText('Health condition 1 reason'), { target: { value: '' } });
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Health condition 1 reason'), { target: { value: 'Corrected' } });
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('uses the shared query controller only for explicit preview and releases it on edit or unmount', async () => {
    const cancel = vi.fn();
    const execute = vi.fn((_request, emit) => {
      emit({
        state: 'ready',
        fetchedAt: 1,
        fromCache: false,
        frames: [
          toDataFrame({
            fields: [
              { name: 'Time', type: FieldType.time, values: [1, 2] },
              { name: 'CPU', type: FieldType.number, values: [7, 8] },
            ],
          }),
        ],
      });
      return cancel;
    });
    const controller = createQueryController(execute);
    const timeRange = getDefaultTimeRange();
    const context = { timeRange, timeZone: 'utc', scopedVars: {}, refreshMs: 0, intervalMs: 1000, generation: 1 };
    const queryConfig: DiagramConfigV2 = {
      ...config,
      queries: [
        {
          id: 'cpu',
          name: 'CPU',
          source: { kind: 'datasource', datasource: { uid: 'test' }, target: { refId: 'D' }, parameters: {} },
        },
      ],
    };
    const view = render(
      <PanelQueryContext.Provider value={{ controller, context }}>
        <BindingEditor
          config={queryConfig}
          cells={new Map()}
          data={{ state: LoadingState.Done, series: [], timeRange }}
          onSave={vi.fn()}
        />
      </PanelQueryContext.Provider>
    );
    await screen.findByText(/No supported native query editor/);
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Query preview result').textContent).toContain('CPU');
    fireEvent.change(screen.getByLabelText('Query name'), { target: { value: 'CPU changed' } });
    expect(screen.getByLabelText('Query preview result').textContent).toBe('idle');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
    view.unmount();
    controller.dispose();
  });
  it('reports ambiguous and unmatched eager metrics and lets the user choose the result field', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    const timeRange = getDefaultTimeRange();
    const withBinding: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'q', name: 'Metrics', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        { ...config.patterns[0], display: { shape: { binding: { queryId: 'q', match: {}, reducer: 'last' } } } },
      ],
    };
    render(
      <BindingEditor
        config={withBinding}
        cells={buildCellIndex(host.querySelector('svg')!)}
        onSave={vi.fn()}
        data={{
          state: LoadingState.Done,
          timeRange,
          series: [
            toDataFrame({
              refId: 'A',
              fields: [
                { name: 'Time', type: FieldType.time, values: [1] },
                { name: 'CPU', type: FieldType.number, values: [7] },
                { name: 'Memory', type: FieldType.number, values: [8] },
              ],
            }),
          ],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select device-1' }));
    expect(screen.getByLabelText('Metric resolution preview').textContent).toContain('ambiguous');
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Shape result field'), { target: { value: 'CPU' } });
    expect(screen.getByLabelText('Metric resolution preview').textContent).not.toContain('ambiguous');
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Shape result field'), { target: { value: 'Absent' } });
    expect(screen.getByLabelText('Metric resolution preview').textContent).toContain('No metric matches query q');
  });
});
