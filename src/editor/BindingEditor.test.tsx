import { editorField, chooseOption, openSection, selectElement } from './testUtils';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { buildCellIndex } from '../render/svgStage';
import { BindingEditor } from './BindingEditor';
import type { DiagramConfigV2 } from '../model/config';
import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame } from '@grafana/data';
import { createQueryController } from '../query/controller';
import { PanelQueryContext } from '../query/panel';
import { exportPatternDocument } from './draft';
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
  it.each([false, true])(
    'preserves native JSON text and validation across collapse with invalid=%s',
    async (invalid) => {
      const timeRange = getDefaultTimeRange();
      const execute = vi.fn();
      const controller = createQueryController(execute);
      const context = { timeRange, timeZone: 'utc', scopedVars: {}, refreshMs: 0, intervalMs: 1000, generation: 1 };
      render(
        <PanelQueryContext.Provider value={{ controller, context }}>
          <BindingEditor
            config={{
              ...config,
              defaultDatasource: { uid: 'test' },
              queries: [
                { id: 'q', name: 'Native', source: { kind: 'datasource', target: { refId: 'D' }, parameters: {} } },
              ],
            }}
            cells={new Map()}
            data={{ state: LoadingState.Done, series: [], timeRange }}
            onSave={vi.fn()}
          />
        </PanelQueryContext.Provider>
      );
      expect(screen.queryByRole('textbox', { name: 'Query name' })).toBeNull();
      openSection('Named queries');
      await screen.findByText(/No supported native query editor/);
      const text = invalid ? '{invalid' : '{"refId":"D","expr":"typed draft"}';
      fireEvent.change(editorField('Native target JSON'), { target: { value: text } });
      if (invalid) {
        fireEvent.click(screen.getByRole('button', { name: 'Import native target' }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Named queries' }));
      expect(screen.queryByRole('textbox', { name: 'Query name' })).toBeNull();
      openSection('Named queries');
      expect((editorField('Native target JSON') as HTMLTextAreaElement).value).toBe(text);
      expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(invalid);
      if (invalid) {
        expect(screen.getByRole('region', { name: 'Query Native' }).textContent).toContain(
          'Invalid native target JSON'
        );
        fireEvent.change(editorField('Native target JSON'), { target: { value: '{"refId":"D"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Import native target' }));
        expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(false);
      }
      expect(execute).not.toHaveBeenCalled();
      controller.dispose();
    }
  );
  it('searches elements in a compact selector and focuses the chosen identity', () => {
    setup();
    const selector = screen.getByRole('combobox', { name: 'Diagram element' });
    expect(screen.queryByRole('button', { name: 'Select device-1' })).toBeNull();
    fireEvent.change(selector, { target: { value: 'device-2' } });
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    expect(screen.queryByRole('option', { name: 'device-1' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'device-2' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'device-2 bindings' }));
    expect(screen.getByRole('combobox', { name: 'Edit scope' })).toBeTruthy();
  });
  it('previews portable conflicts and stages an import without query execution, then cancels or applies', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="region"><rect width="180" height="70"/></g></svg>';
    const cells = buildCellIndex(host.querySelector('svg')!);
    const execute = vi.fn();
    const controller = createQueryController(execute);
    const context = {
      timeRange: getDefaultTimeRange(),
      timeZone: 'utc',
      scopedVars: {},
      refreshMs: 0,
      intervalMs: 1000,
      generation: 1,
    };
    const source: DiagramConfigV2 = {
      ...config,
      patterns: [],
      defaultDatasource: { uid: 'source' },
      queries: [
        {
          id: 'q',
          name: 'Duplicated name',
          source: { kind: 'datasource', target: { refId: 'D', ...{ expr: 'cpu' } }, parameters: {} },
        },
      ],
      widgets: [
        {
          id: 'w',
          anchorCellId: 'region',
          kind: 'sparkline',
          label: 'График α',
          binding: { queryId: 'q', match: {}, reducer: 'last' },
        },
      ],
      overrides: [{ cellId: 'region', display: { label: 'Imported' } }],
    };
    const destination: DiagramConfigV2 = {
      ...config,
      patterns: [],
      defaultDatasource: { uid: 'destination' },
      queries: [{ id: 'q', name: 'Duplicated name', source: { kind: 'panel', refId: 'Z' } }],
    };
    const save = vi.fn();
    render(
      <PanelQueryContext.Provider value={{ controller, context }}>
        <BindingEditor config={destination} cells={cells} onSave={save} />
      </PanelQueryContext.Provider>
    );
    fireEvent.change(editorField('Pattern document'), {
      target: { value: JSON.stringify(exportPatternDocument(source)) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview pattern import' }));
    expect(editorField('Pattern import preview').textContent).toContain('source');
    expect(editorField('Pattern import preview').textContent).toContain('region: applies');
    expect((screen.getByRole('button', { name: 'Import into draft' }) as HTMLButtonElement).disabled).toBe(true);
    chooseOption('queries q conflict', 'New identity');
    fireEvent.change(editorField('queries q new identity'), { target: { value: 'q-copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Portable patterns' }));
    openSection('Portable patterns');
    expect((editorField('queries q new identity') as HTMLInputElement).value).toBe('q-copy');
    fireEvent.click(screen.getByRole('button', { name: 'Import into draft' }));
    expect(execute).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].widgets).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Preview pattern import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import into draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[1][0].widgets[0]).toMatchObject({ anchorCellId: 'region', binding: { queryId: 'q-copy' } });
    expect(save.mock.calls[1][0].queries[1].source.datasource).toEqual({ uid: 'source' });
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export patterns' }));
    const exported = JSON.parse((editorField('Exported pattern document') as HTMLTextAreaElement).value);
    expect(exported.config.widgets[0].anchorCellId).toBe('region');
    controller.dispose();
  });
  it('opts chart and value/history hover rows into sample freshness and blocks invalid cadence', () => {
    const { cells } = (() => {
      const host = document.createElement('div');
      host.innerHTML = '<svg><g data-cell-id="region"><rect width="180" height="70"/></g></svg>';
      return { cells: buildCellIndex(host.querySelector('svg')!) };
    })();
    const save = vi.fn();
    render(
      <BindingEditor
        config={{ ...config, patterns: [], queries: [{ id: 'q', name: 'CPU', source: { kind: 'panel', refId: 'A' } }] }}
        cells={cells}
        onSave={save}
      />
    );
    selectElement('region');
    fireEvent.click(screen.getByRole('button', { name: 'Assign chart region' }));
    expect((editorField('Chart check sample freshness') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(editorField('Chart check sample freshness'));
    fireEvent.change(editorField('Chart expected sample interval ms'), { target: { value: '2000' } });
    fireEvent.change(editorField('Chart stale after ms'), { target: { value: '1000' } });
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(editorField('Chart stale after ms'), { target: { value: '6000' } });
    for (const [index, kind] of ['value', 'history'].entries()) {
      openSection('Hover rows');
      fireEvent.click(screen.getByRole('button', { name: 'Add hover row' }));
      chooseOption(`Hover row ${index + 1} kind`, kind);
      fireEvent.click(editorField(`Hover row ${index + 1} check sample freshness`));
      fireEvent.change(editorField(`Hover row ${index + 1} expected sample interval ms`), {
        target: { value: '1000' },
      });
      fireEvent.change(editorField(`Hover row ${index + 1} stale after ms`), { target: { value: '3000' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].widgets[0].freshness).toEqual({ expectedIntervalMs: 2000, staleAfterMs: 6000 });
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows.map((row: any) => row.freshness)).toEqual([
      { expectedIntervalMs: 1000, staleAfterMs: 3000 },
      { expectedIntervalMs: 1000, staleAfterMs: 3000 },
    ]);
    fireEvent.click(editorField('Chart check sample freshness'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[1][0].widgets[0]).not.toHaveProperty('freshness');
  });
  it('assigns an ordinary rectangle to a named chart query, persists its identity and removes it explicitly', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="plain-rectangle"><rect width="180" height="70"/></g></svg>';
    const cells = buildCellIndex(host.querySelector('svg')!);
    const save = vi.fn();
    const chartConfig: DiagramConfigV2 = {
      ...config,
      patterns: [],
      queries: [
        { id: 'other', name: 'Other', source: { kind: 'panel', refId: 'B' } },
        { id: 'cpu-id', name: 'Загрузка α', source: { kind: 'panel', refId: 'A' } },
      ],
    };
    const view = render(<BindingEditor config={chartConfig} cells={cells} onSave={save} />);
    selectElement('plain-rectangle');
    fireEvent.click(screen.getByRole('button', { name: 'Assign chart region' }));
    chooseOption('Chart query', 'Загрузка α');
    chooseOption('Chart kind', 'Bar gauge');
    fireEvent.change(editorField('Chart label'), { target: { value: 'Процессор 🚀' } });
    fireEvent.change(editorField('Chart unit'), { target: { value: 'percent' } });
    fireEvent.change(editorField('Chart minimum'), { target: { value: '0' } });
    fireEvent.change(editorField('Chart maximum'), { target: { value: '100' } });
    fireEvent.change(editorField('Chart drilldown URL'), { target: { value: '/d/cpu' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    const persisted = JSON.parse(JSON.stringify(save.mock.calls[0][0])) as DiagramConfigV2;
    expect(persisted.widgets).toEqual([
      expect.objectContaining({
        anchorCellId: 'plain-rectangle',
        kind: 'bar',
        label: 'Процессор 🚀',
        unit: 'percent',
        min: 0,
        max: 100,
        url: '/d/cpu',
        binding: { queryId: 'cpu-id', match: {}, reducer: 'last' },
      }),
    ]);
    view.unmount();
    render(<BindingEditor config={persisted} cells={new Map()} onSave={save} />);
    expect(screen.getByRole('alert').textContent).toContain('plain-rectangle');
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove chart Процессор 🚀' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[1][0].widgets).toEqual([]);
  });
  it('focuses the selected identity and defaults to this-element scope', () => {
    setup();
    selectElement('device-1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'device-1 bindings' }));
    expect(screen.getByText('This element')).toBeTruthy();
    openSection('Element details');
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
    const one = within(editorField('Panel one'));
    const two = within(editorField('Panel two'));
    selectElement('device-1', one);
    expect(two.queryByRole('heading', { name: 'device-1 bindings' })).toBeNull();
    fireEvent.change(editorField('Label template', one), { target: { value: 'Only panel one' } });
    fireEvent.click(one.getByRole('button', { name: 'Apply bindings' }));
    expect(saveTwo).not.toHaveBeenCalled();
    view.unmount();
    render(<BindingEditor config={saveOne.mock.calls[0][0]} cells={cells} onSave={vi.fn()} />);
    selectElement('device-1');
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Only panel one');
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
    selectElement('device-1');
    chooseOption('Shape colour target', 'stroke');
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides[0].display).toEqual({ shape: { target: 'stroke' } });
  });
  it('previews every pattern match, saves only on Apply, and cancels back to saved', () => {
    const { save, cells } = setup();
    selectElement('device-1');
    chooseOption('Edit scope', 'All elements matching this pattern');
    fireEvent.change(editorField('Label template'), { target: { value: 'Changed' } });
    expect(editorField('Affected binding preview').textContent).toContain('device-2');
    expect(cells.get('device-2')?.group.getAttribute('data-dmap-affected')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Shared');
    fireEvent.change(editorField('Label template'), { target: { value: 'Applied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].patterns[0].display.label).toBe('Applied');
    fireEvent.change(editorField('Label template'), { target: { value: 'Lost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo to saved' }));
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Applied');
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
    const label = editorField('Label template');
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
    selectElement('device-1');
    chooseOption('Shape query', 'Health');
    chooseOption('A to B query', 'Health');
    openSection('Hover rows');
    fireEvent.click(screen.getByRole('button', { name: 'Add hover row' }));
    chooseOption('Hover row 1 kind', 'history');
    openSection('Explicit health status');
    fireEvent.click(screen.getByRole('button', { name: 'Add health rule' }));
    fireEvent.change(editorField('Health condition 1 reason'), { target: { value: 'Health check failed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    const display = save.mock.calls[0][0].overrides[0].display;
    expect(display.shape.binding.queryId).toBe('health');
    expect(display.link.a2bBinding.queryId).toBe('health');
    expect(display.hover.rows[0]).toMatchObject({ kind: 'history', binding: { queryId: 'health' } });
    expect(display.status.mappings[0]).toEqual({ value: 0, state: 'down', reason: 'Health check failed' });
  });
  it('edits the bindings of a combined up/down row and the auto Y range of rows and charts', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="plain-rectangle"><rect/></g></svg>';
    const save = vi.fn();
    const tx = { queryId: 'tx', match: {}, reducer: 'last' as const };
    const withRow: DiagramConfigV2 = {
      ...config,
      queries: [
        { id: 'tx', name: 'TX', source: { kind: 'panel', refId: 'A' } },
        { id: 'rx', name: 'RX', source: { kind: 'panel', refId: 'B' } },
      ],
      overrides: [
        {
          cellId: 'device-1',
          display: {
            hover: {
              rows: [
                {
                  kind: 'history',
                  label: 'Traffic',
                  series: [
                    { binding: tx, direction: 'up', label: '↑' },
                    { binding: tx, direction: 'down', label: '↓' },
                  ],
                },
              ],
            },
          },
        },
      ],
    };
    render(<BindingEditor config={withRow} cells={buildCellIndex(host.querySelector('svg')!)} onSave={save} />);
    selectElement('device-1');
    openSection('Hover rows');
    chooseOption('Hover row 1 down query', 'RX');
    fireEvent.change(editorField('Hover row 1 minimum'), { target: { value: 'auto' } });
    fireEvent.change(editorField('Hover row 1 maximum'), { target: { value: '100000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows[0]).toEqual({
      kind: 'history',
      label: 'Traffic',
      min: 'auto',
      max: 100000000,
      series: [
        { binding: tx, direction: 'up', label: '↑' },
        { binding: { ...tx, queryId: 'rx' }, direction: 'down', label: '↓' },
      ],
    });
  });
  it('accepts the maximum "capacity" on a combined row', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    const save = vi.fn();
    const tx = { queryId: 'tx', match: {}, reducer: 'last' as const };
    const withRow: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'tx', name: 'TX', source: { kind: 'panel', refId: 'A' } }],
      overrides: [
        {
          cellId: 'device-1',
          display: {
            hover: { rows: [{ kind: 'history', label: 'Traffic', series: [{ binding: tx, direction: 'up' }] }] },
          },
        },
      ],
    };
    render(<BindingEditor config={withRow} cells={buildCellIndex(host.querySelector('svg')!)} onSave={save} />);
    selectElement('device-1');
    openSection('Hover rows');
    fireEvent.change(editorField('Hover row 1 maximum'), { target: { value: 'capacity' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows[0]).toMatchObject({ max: 'capacity' });
  });
  it.each([false, true])('validates, clears and removes history height with series=%s', (combined) => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g></svg>';
    const save = vi.fn();
    const tx = { queryId: 'tx', match: {}, reducer: 'last' as const };
    const withRows: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'tx', name: 'TX', source: { kind: 'panel', refId: 'A' } }],
      overrides: [
        {
          cellId: 'device-1',
          display: {
            hover: {
              rows: [
                combined
                  ? { kind: 'history', label: 'Traffic', series: [{ binding: tx, direction: 'up' }] }
                  : { kind: 'history', label: 'Traffic', binding: tx },
                { kind: 'value', label: 'Now', binding: tx },
              ],
            },
          },
        },
      ],
    };
    render(<BindingEditor config={withRows} cells={buildCellIndex(host.querySelector('svg')!)} onSave={save} />);
    selectElement('device-1');
    openSection('Hover rows');
    expect(screen.queryByLabelText('Hover row 2 height')).toBeNull();
    for (const height of ['15', '401']) {
      fireEvent.change(editorField('Hover row 1 height'), { target: { value: height } });
      const apply = screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement;
      expect(apply.disabled).toBe(true);
      fireEvent.click(apply);
      expect(save).not.toHaveBeenCalled();
    }
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '96' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows[0]).toMatchObject({ height: 96 });
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[1][0].overrides[0].display.hover.rows[0].height).toBeUndefined();
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '120' } });
    chooseOption('Hover row 1 kind', 'value');
    expect(screen.queryByLabelText('Hover row 1 height')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[2][0].overrides[0].display.hover.rows[0]).toEqual({
      kind: 'value',
      label: 'Traffic',
      binding: tx,
    });
  });
  it('keeps a chart minimum "auto"', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="plain-rectangle"><rect/></g></svg>';
    const save = vi.fn();
    const withQuery: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'cpu', name: 'CPU', source: { kind: 'panel', refId: 'A' } }],
    };
    render(<BindingEditor config={withQuery} cells={buildCellIndex(host.querySelector('svg')!)} onSave={save} />);
    selectElement('plain-rectangle');
    fireEvent.click(screen.getByRole('button', { name: 'Assign chart region' }));
    chooseOption('Chart query', 'CPU');
    fireEvent.change(editorField('Chart minimum'), { target: { value: 'auto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].widgets[0]).toMatchObject({ min: 'auto' });
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
    selectElement('device-1');
    openSection('Explicit health status');
    fireEvent.click(screen.getByRole('button', { name: 'Add health rule' }));
    fireEvent.change(editorField('Health condition 1 reason'), { target: { value: '' } });
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(editorField('Health condition 1 reason'), { target: { value: 'Corrected' } });
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('marks every affected native match resolved or unvalidated after representative Preview', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="device-2"><rect/></g></svg>';
    const execute = vi.fn((_request, emit) => {
      emit({
        state: 'ready',
        frames: [
          toDataFrame({
            fields: [
              { name: 'Time', type: FieldType.time, values: [1] },
              { name: 'Value', type: FieldType.number, values: [7] },
            ],
          }),
        ],
        fetchedAt: 1,
        fromCache: false,
      });
      return () => {};
    });
    const controller = createQueryController(execute);
    const timeRange = getDefaultTimeRange();
    const context = { timeRange, timeZone: 'utc', scopedVars: {}, refreshMs: 0, intervalMs: 1000, generation: 1 };
    const nativeConfig: DiagramConfigV2 = {
      ...config,
      queries: [
        {
          id: 'q',
          name: 'Q',
          source: {
            kind: 'datasource',
            datasource: { uid: 'ds' },
            target: { refId: 'D', ...{ expr: '$dm_device' } },
            parameters: { dm_device: 'cell.key' },
          },
        },
      ],
      patterns: [
        { ...config.patterns[0], display: { shape: { binding: { queryId: 'q', match: {}, reducer: 'last' } } } },
      ],
    };
    render(
      <PanelQueryContext.Provider value={{ controller, context }}>
        <BindingEditor
          config={nativeConfig}
          cells={buildCellIndex(host.querySelector('svg')!)}
          data={{ state: LoadingState.Done, series: [], timeRange }}
          onSave={vi.fn()}
        />
      </PanelQueryContext.Provider>
    );
    selectElement('device-1');
    chooseOption('Edit scope', 'All elements matching this pattern');
    openSection('Named queries');
    await screen.findByText(/No supported native query editor/);
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].request.scopedVars.dm_device.value).toBe('device-1');
    const preview = editorField('Metric resolution preview');
    expect(preview.textContent).toContain('device-1: resolved');
    expect(preview.textContent).toContain('device-2: unvalidated');
    expect(preview.textContent).not.toContain('No resolution failures');
    selectElement('device-2');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(preview.textContent).toContain('device-2: unvalidated');
    controller.dispose();
  });
  it('shows a failed nonrepresentative eager match before Apply', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="device-2"><rect/></g></svg>';
    const timeRange = getDefaultTimeRange();
    const eagerConfig: DiagramConfigV2 = {
      ...config,
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          ...config.patterns[0],
          display: {
            hover: {
              rows: [
                {
                  kind: 'value',
                  label: 'Metric',
                  binding: { queryId: 'q', match: { device: '${cell.key}' }, reducer: 'last' },
                },
              ],
            },
          },
        },
      ],
    };
    render(
      <BindingEditor
        config={eagerConfig}
        cells={buildCellIndex(host.querySelector('svg')!)}
        data={{
          state: LoadingState.Done,
          timeRange,
          series: [
            toDataFrame({
              refId: 'A',
              fields: [
                { name: 'Time', type: FieldType.time, values: [1] },
                { name: 'Value', type: FieldType.number, values: [7], labels: { device: 'device-1' } },
              ],
            }),
          ],
        }}
        onSave={vi.fn()}
      />
    );
    selectElement('device-1');
    chooseOption('Edit scope', 'All elements matching this pattern');
    const preview = editorField('Metric resolution preview');
    expect(preview.textContent).toContain('device-1: resolved');
    expect(preview.textContent).toContain('device-2: failed');
    expect(preview.textContent).toContain('No metric matches query q');
    expect(preview.textContent).not.toContain('No resolution failures');
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
    openSection('Named queries');
    await screen.findByText(/No supported native query editor/);
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(editorField('Query preview result').textContent).toContain('CPU');
    fireEvent.change(editorField('Query name'), { target: { value: 'CPU changed' } });
    expect(editorField('Query preview result').textContent).toBe('idle');
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
    selectElement('device-1');
    expect(editorField('Metric resolution preview').textContent).toContain('ambiguous');
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(editorField('Shape result field'), { target: { value: 'CPU' } });
    expect(editorField('Metric resolution preview').textContent).not.toContain('ambiguous');
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(editorField('Shape result field'), { target: { value: 'Absent' } });
    expect(editorField('Metric resolution preview').textContent).toContain('No metric matches query q');
  });
});
