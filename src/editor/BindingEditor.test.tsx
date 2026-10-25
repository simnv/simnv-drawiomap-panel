import {
  buttonNamed,
  editorField,
  chooseOption,
  filterBindings,
  openQueryRow,
  openSection,
  selectStageCell,
} from './testUtils';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DiagramConfig, NamedQuery } from '../model/config';
import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame, type PanelData } from '@grafana/data';
import { createQueryController } from '../query/controller';
import { testQueryService } from '../query/testService';
import { exportPatternDocument } from './draft';
import { renderEditor, svgOf } from './editorHarness';
import 'intersection-observer';
import type { QuerySnapshot } from '../query/types';
import { QueryPane, PREVIEW_ROWS, type QueryPaneProps } from './popup/QueryPane';
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
const config: DiagramConfig = {
  version: 3,
  queries: [],
  overrides: [],
  widgets: [],
  patterns: [
    { id: 'devices', name: 'Devices', select: { ids: ['device-1', 'device-2'] }, display: { label: 'Shared' } },
  ],
};
const applyButton = () => buttonNamed('Apply bindings') as HTMLButtonElement;
const stageCell = (id: string) => screen.getByTestId('dmap-popup-stage').querySelector(`g[data-cell-id="${id}"]`)!;
const queryContext = {
  timeRange: getDefaultTimeRange(),
  timeZone: 'utc',
  scopedVars: {},
  refreshMs: 0,
  intervalMs: 1000,
  generation: 1,
};
function setup() {
  return renderEditor({ config, svg: svgOf('device-1', 'device-2') });
}
describe('binding inspector', () => {
  it('renders the inspector of a cell when the saved config holds items that do not parse', () => {
    const withNulls = {
      ...config,
      queries: [null],
      patterns: [...config.patterns, null],
      widgets: [null],
      overrides: [null],
    } as unknown as DiagramConfig;
    renderEditor({ config: withNulls, svg: svgOf('device-1', 'device-2') });
    selectStageCell('device-2');
    expect(screen.getByRole('heading', { name: 'device-2 bindings' })).toBeTruthy();
    // the binding fields list the queries: the null entry is gone, the note says so
    expect(screen.getByText(/^4 empty entries removed/)).toBeTruthy();
  });
  it('assigns a chart region from the first query when the saved queries start with a null entry', () => {
    const withNull = {
      ...config,
      patterns: [],
      queries: [null, { id: 'q', name: 'CPU', source: { kind: 'panel', refId: 'A' } }],
    } as unknown as DiagramConfig;
    renderEditor({ config: withNull, svg: svgOf('region') });
    selectStageCell('region');
    fireEvent.click(buttonNamed('Assign chart region'));
    expect(editorField('Chart check sample freshness')).toBeTruthy();
  });
  it.each([false, true])(
    'keeps native JSON validation in the query pane and drops the typed text when the pane closes with invalid=%s',
    async (invalid) => {
      const execute = vi.fn();
      const controller = createQueryController(execute);
      renderEditor({
        config: {
          ...config,
          defaultDatasource: { uid: 'test' },
          queries: [
            { id: 'q', name: 'Native', source: { kind: 'datasource', target: { refId: 'D' }, parameters: {} } },
          ],
        },
        svg: svgOf('device-1', 'device-2'),
        service: testQueryService(controller, queryContext),
      });
      expect(screen.queryByRole('textbox', { name: 'Query name' })).toBeNull();
      openQueryRow('Native');
      await screen.findByText(/No supported native query editor/);
      const text = invalid ? '{invalid' : '{"refId":"D","expr":"typed draft"}';
      fireEvent.change(editorField('Native target JSON'), { target: { value: text } });
      if (invalid) {
        fireEvent.click(buttonNamed('Import native target'));
        expect(applyButton().disabled).toBe(true);
        expect(screen.getByRole('region', { name: 'Query Native' }).textContent).toContain(
          'Invalid native target JSON'
        );
        fireEvent.change(editorField('Native target JSON'), { target: { value: '{"refId":"D"}' } });
        fireEvent.click(buttonNamed('Import native target'));
        expect(applyButton().disabled).toBe(false);
        fireEvent.change(editorField('Native target JSON'), { target: { value: '{invalid' } });
        fireEvent.click(buttonNamed('Import native target'));
        expect(applyButton().disabled).toBe(true);
      }
      // Leaving the pane drops the typed text. It never reached the draft, so it does not block Apply.
      selectStageCell('device-1');
      expect(screen.queryByRole('region', { name: 'Query Native' })).toBeNull();
      expect(applyButton().disabled).toBe(false);
      openQueryRow('Native');
      expect((editorField('Native target JSON') as HTMLTextAreaElement).value).toBe(
        JSON.stringify({ refId: 'D' }, null, 2)
      );
      expect(execute).not.toHaveBeenCalled();
      controller.dispose();
    }
  );
  it('finds an element with the list filter and focuses the chosen identity', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Select cell device-1' })).toBeNull();
    filterBindings('device-2');
    expect(screen.queryByRole('button', { name: 'Select cell device-1' })).toBeNull();
    fireEvent.click(buttonNamed('Select cell device-2'));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'device-2 bindings' }));
    expect(screen.getByRole('combobox', { name: 'Edit scope' })).toBeTruthy();
    expect(buttonNamed('Select cell device-2').getAttribute('aria-current')).toBe('true');
  });
  it('previews portable conflicts and stages an import without query execution, then cancels or applies', () => {
    const execute = vi.fn();
    const controller = createQueryController(execute);
    const source: DiagramConfig = {
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
    const destination: DiagramConfig = {
      ...config,
      patterns: [],
      defaultDatasource: { uid: 'destination' },
      queries: [{ id: 'q', name: 'Duplicated name', source: { kind: 'panel', refId: 'Z' } }],
    };
    const { save } = renderEditor({
      config: destination,
      svg: svgOf('region'),
      service: testQueryService(controller, queryContext),
    });
    fireEvent.change(editorField('Pattern document'), {
      target: { value: JSON.stringify(exportPatternDocument(source)) },
    });
    fireEvent.click(buttonNamed('Preview pattern import'));
    expect(editorField('Pattern import preview').textContent).toContain('source');
    expect(editorField('Pattern import preview').textContent).toContain('region: applies');
    expect((buttonNamed('Import into draft') as HTMLButtonElement).disabled).toBe(true);
    chooseOption('queries q conflict', 'New identity');
    fireEvent.change(editorField('queries q new identity'), { target: { value: 'q-copy' } });
    fireEvent.click(buttonNamed('Portable patterns'));
    openSection('Portable patterns');
    expect((editorField('queries q new identity') as HTMLInputElement).value).toBe('q-copy');
    fireEvent.click(buttonNamed('Import into draft'));
    expect(execute).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Discard'));
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].widgets).toEqual([]);
    fireEvent.click(buttonNamed('Preview pattern import'));
    fireEvent.click(buttonNamed('Import into draft'));
    fireEvent.click(applyButton());
    expect(save.mock.calls[1][0].widgets[0]).toMatchObject({ anchorCellId: 'region', binding: { queryId: 'q-copy' } });
    expect(save.mock.calls[1][0].queries[1].source.datasource).toEqual({ uid: 'source' });
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Export patterns'));
    const exported = JSON.parse((editorField('Exported pattern document') as HTMLTextAreaElement).value);
    expect(exported.config.widgets[0].anchorCellId).toBe('region');
    controller.dispose();
  });
  it('opts chart and value/history hover rows into sample freshness and blocks invalid cadence', () => {
    const { save } = renderEditor({
      config: { ...config, patterns: [], queries: [{ id: 'q', name: 'CPU', source: { kind: 'panel', refId: 'A' } }] },
      svg: svgOf('region'),
    });
    selectStageCell('region');
    fireEvent.click(buttonNamed('Assign chart region'));
    expect((editorField('Chart check sample freshness') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(editorField('Chart check sample freshness'));
    fireEvent.change(editorField('Chart expected sample interval ms'), { target: { value: '2000' } });
    fireEvent.change(editorField('Chart stale after ms'), { target: { value: '1000' } });
    expect(applyButton().disabled).toBe(true);
    fireEvent.change(editorField('Chart stale after ms'), { target: { value: '6000' } });
    for (const [index, kind] of ['value', 'history'].entries()) {
      openSection('Hover rows');
      fireEvent.click(buttonNamed('Add hover row'));
      chooseOption(`Hover row ${index + 1} kind`, kind);
      fireEvent.click(editorField(`Hover row ${index + 1} check sample freshness`));
      fireEvent.change(editorField(`Hover row ${index + 1} expected sample interval ms`), {
        target: { value: '1000' },
      });
      fireEvent.change(editorField(`Hover row ${index + 1} stale after ms`), { target: { value: '3000' } });
    }
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].widgets[0].freshness).toEqual({ expectedIntervalMs: 2000, staleAfterMs: 6000 });
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows.map((row: any) => row.freshness)).toEqual([
      { expectedIntervalMs: 1000, staleAfterMs: 3000 },
      { expectedIntervalMs: 1000, staleAfterMs: 3000 },
    ]);
    fireEvent.click(editorField('Chart check sample freshness'));
    fireEvent.click(applyButton());
    expect(save.mock.calls[1][0].widgets[0]).not.toHaveProperty('freshness');
    // This case makes about forty edits and re-renders the whole popup for each; allow the time.
  }, 20000);
  it('assigns an ordinary rectangle to a named chart query, persists its identity and removes it explicitly', () => {
    const chartConfig: DiagramConfig = {
      ...config,
      patterns: [],
      queries: [
        { id: 'other', name: 'Other', source: { kind: 'panel', refId: 'B' } },
        { id: 'cpu-id', name: 'Загрузка α', source: { kind: 'panel', refId: 'A' } },
      ],
    };
    const first = renderEditor({ config: chartConfig, svg: svgOf('plain-rectangle') });
    selectStageCell('plain-rectangle');
    fireEvent.click(buttonNamed('Assign chart region'));
    chooseOption('Chart query', 'Загрузка α');
    chooseOption('Chart kind', 'Bar gauge');
    fireEvent.change(editorField('Chart label'), { target: { value: 'Процессор 🚀' } });
    fireEvent.change(editorField('Chart unit'), { target: { value: 'percent' } });
    fireEvent.change(editorField('Chart minimum'), { target: { value: '0' } });
    fireEvent.change(editorField('Chart maximum'), { target: { value: '100' } });
    fireEvent.change(editorField('Chart drilldown URL'), { target: { value: '/d/cpu' } });
    expect(first.save).not.toHaveBeenCalled();
    fireEvent.click(applyButton());
    const persisted = JSON.parse(JSON.stringify(first.save.mock.calls[0][0])) as DiagramConfig;
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
    first.unmount();
    const second = renderEditor({ config: persisted, svg: svgOf() });
    expect(screen.getByRole('alert').textContent).toContain('plain-rectangle');
    expect(applyButton().disabled).toBe(true);
    fireEvent.click(buttonNamed('Remove chart Процессор 🚀'));
    fireEvent.click(applyButton());
    expect(second.save.mock.calls[0][0].widgets).toEqual([]);
  });
  it('focuses the selected identity and defaults to this-element scope', () => {
    setup();
    selectStageCell('device-1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'device-1 bindings' }));
    expect(screen.getByText('This element')).toBeTruthy();
    openSection('Element details');
    expect(screen.getByText('Patterns: Devices')).toBeTruthy();
  });
  it('Cancel asks the owner to close; Discard restores the draft and keeps the editor open', () => {
    const { close, save } = setup();
    fireEvent.click(buttonNamed('Cancel'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(stageCell('device-1').querySelector('rect')!);
    fireEvent.change(editorField('Label template'), { target: { value: 'Draft' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(buttonNamed('Discard'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByTestId('dmap-bindings-editor')).toBeTruthy();
    fireEvent.click(buttonNamed('Cancel'));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('isolates cloned editors and reopens the saved binding after remount', () => {
    const svg = svgOf('device-1');
    const one = renderEditor({ config, svg });
    const first = within(screen.getByTestId('dmap-bindings-editor'));
    const two = renderEditor({ config, svg });
    const editors = screen.getAllByTestId('dmap-bindings-editor');
    const second = within(editors[1]);
    selectStageCell('device-1', first);
    expect(second.queryByRole('heading', { name: 'device-1 bindings' })).toBeNull();
    fireEvent.change(editorField('Label template', first), { target: { value: 'Only panel one' } });
    fireEvent.click(first.getByRole('button', { name: 'Apply bindings' }));
    expect(two.save).not.toHaveBeenCalled();
    const saved = one.save.mock.calls[0][0];
    one.unmount();
    two.unmount();
    renderEditor({ config: saved, svg });
    selectStageCell('device-1');
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Only panel one');
  });
  it('keeps unedited shape settings inherited when creating an element override', () => {
    const inherited: DiagramConfig = {
      ...config,
      queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          ...config.patterns[0],
          display: { shape: { target: 'icon', binding: { queryId: 'health', match: {}, reducer: 'last' } } },
        },
      ],
    };
    const { save } = renderEditor({ config: inherited, svg: svgOf('device-1') });
    selectStageCell('device-1');
    chooseOption('Shape colour target', 'stroke');
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].overrides[0].display).toEqual({ shape: { target: 'stroke' } });
  });
  it('writes the link label mode as the leaf link.label.mode of an override', () => {
    const { save } = setup();
    selectStageCell('device-1');
    chooseOption('Link label', 'Percent of capacity');
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].overrides[0].display).toEqual({ link: { label: { mode: 'percent' } } });
  });
  it('previews every pattern match, saves only on Apply, and cancels back to saved', () => {
    const { save } = setup();
    selectStageCell('device-1');
    chooseOption('Edit scope', 'All elements matching this pattern');
    fireEvent.change(editorField('Label template'), { target: { value: 'Changed' } });
    expect(editorField('Affected binding preview').textContent).toContain('device-2');
    expect(stageCell('device-2').getAttribute('data-dmap-affected')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Discard'));
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Shared');
    fireEvent.change(editorField('Label template'), { target: { value: 'Applied' } });
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].patterns[0].display.label).toBe('Applied');
    fireEvent.change(editorField('Label template'), { target: { value: 'Lost' } });
    fireEvent.click(buttonNamed('Discard'));
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Applied');
  });
  it('selects unbound cells by pointer or keyboard while hover leaves focus alone', () => {
    renderEditor({ config, svg: svgOf('unbound') });
    const group = stageCell('unbound');
    fireEvent.click(group.querySelector('rect')!);
    const heading = screen.getByRole('heading', { name: 'unbound bindings' });
    expect(document.activeElement).toBe(heading);
    const label = editorField('Label template');
    label.focus();
    fireEvent.pointerMove(group);
    expect(document.activeElement).toBe(label);
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(document.activeElement).toBe(heading);
    expect(group.getAttribute('data-dmap-selected')).toBe('true');
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
    const { save } = renderEditor({ config: invalid, svg: svgOf() });
    expect(applyButton().disabled).toBe(true);
    fireEvent.click(applyButton());
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('missing');
  });
  it('authors hover rows, shape/link bindings and explicit health rules through forms', () => {
    const withQuery: DiagramConfig = {
      ...config,
      queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }],
    };
    const { save } = renderEditor({ config: withQuery, svg: svgOf('device-1') });
    selectStageCell('device-1');
    chooseOption('Shape query', 'Health');
    chooseOption('A to B query', 'Health');
    openSection('Hover rows');
    fireEvent.click(buttonNamed('Add hover row'));
    chooseOption('Hover row 1 kind', 'history');
    openSection('Explicit health status');
    fireEvent.click(buttonNamed('Add health rule'));
    fireEvent.change(editorField('Health condition 1 reason'), { target: { value: 'Health check failed' } });
    fireEvent.click(applyButton());
    const display = save.mock.calls[0][0].overrides[0].display;
    expect(display.shape.binding.queryId).toBe('health');
    expect(display.link.a2b.binding.queryId).toBe('health');
    expect(display.hover.rows[0]).toMatchObject({ kind: 'history', binding: { queryId: 'health' } });
    expect(display.status.mappings[0]).toEqual({ value: 0, state: 'down', reason: 'Health check failed' });
  });
  it('edits the bindings of a combined up/down row and the auto Y range of rows and charts', () => {
    const tx = { queryId: 'tx', match: {}, reducer: 'last' as const };
    const withRow: DiagramConfig = {
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
                  kind: 'combined',
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
    const { save } = renderEditor({ config: withRow, svg: svgOf('device-1', 'plain-rectangle') });
    selectStageCell('device-1');
    openSection('Hover rows');
    chooseOption('Hover row 1 down query', 'RX');
    fireEvent.change(editorField('Hover row 1 minimum'), { target: { value: 'auto' } });
    fireEvent.change(editorField('Hover row 1 maximum'), { target: { value: '100000000' } });
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows[0]).toEqual({
      kind: 'combined',
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
    const tx = { queryId: 'tx', match: {}, reducer: 'last' as const };
    const withRow: DiagramConfig = {
      ...config,
      queries: [{ id: 'tx', name: 'TX', source: { kind: 'panel', refId: 'A' } }],
      overrides: [
        {
          cellId: 'device-1',
          display: {
            hover: { rows: [{ kind: 'combined', label: 'Traffic', series: [{ binding: tx, direction: 'up' }] }] },
          },
        },
      ],
    };
    const { save } = renderEditor({ config: withRow, svg: svgOf('device-1') });
    selectStageCell('device-1');
    openSection('Hover rows');
    fireEvent.change(editorField('Hover row 1 maximum'), { target: { value: 'capacity' } });
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows[0]).toMatchObject({ max: 'capacity' });
  });
  it('validates, clears and removes history height; a combined series row converts to a single binding', () => {
    const tx = { queryId: 'tx', match: {}, reducer: 'last' as const };
    const mount = (combined: boolean) => {
      const withRows: DiagramConfig = {
        ...config,
        queries: [{ id: 'tx', name: 'TX', source: { kind: 'panel', refId: 'A' } }],
        overrides: [
          {
            cellId: 'device-1',
            display: {
              hover: {
                rows: [
                  combined
                    ? { kind: 'combined', label: 'Traffic', series: [{ binding: tx, direction: 'up' }] }
                    : { kind: 'history', label: 'Traffic', binding: tx },
                  { kind: 'value', label: 'Now', binding: tx },
                ],
              },
            },
          },
        ],
      };
      const { save } = renderEditor({ config: withRows, svg: svgOf('device-1') });
      selectStageCell('device-1');
      openSection('Hover rows');
      return save;
    };
    const toValueRow = () => {
      chooseOption('Hover row 1 kind', 'value');
      expect(screen.queryByLabelText('Hover row 1 height')).toBeNull();
      fireEvent.click(applyButton());
    };
    // series=false: the full cycle
    const save = mount(false);
    expect(screen.queryByLabelText('Hover row 2 height')).toBeNull();
    for (const height of ['15', '401']) {
      fireEvent.change(editorField('Hover row 1 height'), { target: { value: height } });
      expect(applyButton().disabled).toBe(true);
      fireEvent.click(applyButton());
      expect(save).not.toHaveBeenCalled();
    }
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '96' } });
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].overrides[0].display.hover.rows[0]).toMatchObject({ height: 96 });
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '' } });
    fireEvent.click(applyButton());
    expect(save.mock.calls[1][0].overrides[0].display.hover.rows[0].height).toBeUndefined();
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '120' } });
    toValueRow();
    expect(save.mock.calls[2][0].overrides[0].display.hover.rows[0]).toEqual({
      kind: 'value',
      label: 'Traffic',
      binding: tx,
    });
    cleanup();
    // series=true: the combined row validates the same way and converts to its first binding
    const saveCombined = mount(true);
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '401' } });
    expect(applyButton().disabled).toBe(true);
    fireEvent.change(editorField('Hover row 1 height'), { target: { value: '96' } });
    fireEvent.click(applyButton());
    expect(saveCombined.mock.calls[0][0].overrides[0].display.hover.rows[0]).toMatchObject({ height: 96 });
    toValueRow();
    expect(saveCombined.mock.calls[1][0].overrides[0].display.hover.rows[0]).toEqual({
      kind: 'value',
      label: 'Traffic',
      binding: tx,
    });
  });
  it('keeps a chart minimum "auto"', () => {
    const withQuery: DiagramConfig = {
      ...config,
      queries: [{ id: 'cpu', name: 'CPU', source: { kind: 'panel', refId: 'A' } }],
    };
    const { save } = renderEditor({ config: withQuery, svg: svgOf('plain-rectangle') });
    selectStageCell('plain-rectangle');
    fireEvent.click(buttonNamed('Assign chart region'));
    chooseOption('Chart query', 'CPU');
    fireEvent.change(editorField('Chart minimum'), { target: { value: 'auto' } });
    fireEvent.click(applyButton());
    expect(save.mock.calls[0][0].widgets[0]).toMatchObject({ min: 'auto' });
  });
  it('keeps invalid draft fields editable so their diagnostics can be corrected', () => {
    renderEditor({
      config: { ...config, queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }] },
      svg: svgOf('device-1'),
    });
    selectStageCell('device-1');
    openSection('Explicit health status');
    fireEvent.click(buttonNamed('Add health rule'));
    fireEvent.change(editorField('Health condition 1 reason'), { target: { value: '' } });
    expect(applyButton().disabled).toBe(true);
    fireEvent.change(editorField('Health condition 1 reason'), { target: { value: 'Corrected' } });
    expect(applyButton().disabled).toBe(false);
  });
  it('resolves a bound native hover metric at once for the open element and leaves the others unvalidated', async () => {
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
    const nativeConfig: DiagramConfig = {
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
        {
          ...config.patterns[0],
          display: {
            hover: { rows: [{ kind: 'value', label: 'V', binding: { queryId: 'q', match: {}, reducer: 'last' } }] },
          },
        },
      ],
    };
    renderEditor({
      config: nativeConfig,
      svg: svgOf('device-1', 'device-2'),
      data: { state: LoadingState.Done, series: [], timeRange: queryContext.timeRange },
      service: testQueryService(controller, queryContext),
    });
    // Nothing runs before an element opens: a hover row asks for data only for the open element.
    expect(execute).not.toHaveBeenCalled();
    selectStageCell('device-1');
    chooseOption('Edit scope', 'All elements matching this pattern');
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0][0].request.scopedVars.dm_device.value).toBe('device-1');
    const preview = editorField('Metric resolution preview');
    await waitFor(() => expect(preview.textContent).toContain('device-1: resolved'));
    expect(preview.textContent).toContain('device-2: unvalidated');
    expect(preview.textContent).not.toContain('No resolution failures');
    selectStageCell('device-2');
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][0].request.scopedVars.dm_device.value).toBe('device-2');
    controller.dispose();
  });
  it('shows a failed nonrepresentative eager match before Apply', () => {
    const timeRange = getDefaultTimeRange();
    const eagerConfig: DiagramConfig = {
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
    renderEditor({
      config: eagerConfig,
      svg: svgOf('device-1', 'device-2'),
      data: {
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
      },
    });
    selectStageCell('device-1');
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
    const queryConfig: DiagramConfig = {
      ...config,
      queries: [
        {
          id: 'cpu',
          name: 'CPU',
          source: { kind: 'datasource', datasource: { uid: 'test' }, target: { refId: 'D' }, parameters: {} },
        },
      ],
    };
    const view = renderEditor({
      config: queryConfig,
      svg: svgOf(),
      data: { state: LoadingState.Done, series: [], timeRange: queryContext.timeRange },
      service: testQueryService(controller, queryContext),
    });
    openQueryRow('CPU');
    await screen.findByText(/No supported native query editor/);
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Preview query'));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(editorField('Query preview result').textContent).toContain('CPU');
    fireEvent.change(editorField('Query name'), { target: { value: 'CPU changed' } });
    expect(editorField('Query preview result').textContent).toBe('idle');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    fireEvent.click(buttonNamed('Preview query'));
    view.unmount();
    controller.dispose();
  });
  it('reports ambiguous and unmatched eager metrics and lets the user choose the result field', () => {
    const timeRange = getDefaultTimeRange();
    const withBinding: DiagramConfig = {
      ...config,
      queries: [{ id: 'q', name: 'Metrics', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        { ...config.patterns[0], display: { shape: { binding: { queryId: 'q', match: {}, reducer: 'last' } } } },
      ],
    };
    renderEditor({
      config: withBinding,
      svg: svgOf('device-1'),
      data: {
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
      },
    });
    selectStageCell('device-1');
    expect(editorField('Metric resolution preview').textContent).toContain('ambiguous');
    expect(applyButton().disabled).toBe(true);
    fireEvent.change(editorField('Shape result field'), { target: { value: 'CPU' } });
    expect(editorField('Metric resolution preview').textContent).not.toContain('ambiguous');
    expect(applyButton().disabled).toBe(false);
    fireEvent.change(editorField('Shape result field'), { target: { value: 'Absent' } });
    expect(editorField('Metric resolution preview').textContent).toContain('No metric matches query q');
  });

  it('deletes a query from its pane, lists the users first, and brings the query back with Undo', async () => {
    const { save } = renderEditor({
      config: {
        ...config,
        queries: [
          { id: 'cpu', name: 'CPU', source: { kind: 'panel', refId: 'A' } },
          { id: 'mem', name: 'Memory', source: { kind: 'panel', refId: 'B' } },
        ],
        overrides: [
          {
            cellId: 'device-1',
            display: { shape: { binding: { queryId: 'cpu', match: {}, reducer: 'last' } } },
          },
        ],
      },
      svg: svgOf('device-1', 'device-2'),
    });
    openQueryRow('CPU');
    const users = screen.getByRole('list', { name: 'Used by' });
    expect(
      within(users)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Override device-1']);
    fireEvent.click(buttonNamed('Delete query'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Query bindings' })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit query CPU' })).toBeNull());
    expect(buttonNamed('Edit query Memory')).toBeTruthy();
    fireEvent.click(buttonNamed('Undo'));
    expect(buttonNamed('Edit query CPU')).toBeTruthy();
    fireEvent.click(buttonNamed('Redo'));
    expect(screen.queryByRole('button', { name: 'Edit query CPU' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('switches to the Inspector tab after a stage click in tab mode and keeps the selection across tabs', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    setup();
    expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('tabs');
    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
    expect(screen.getByTestId('dmap-pane-stage').hasAttribute('hidden')).toBe(false);
    selectStageCell('device-1');
    expect(screen.getByRole('tab', { name: 'Inspector' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('dmap-pane-inspector').hasAttribute('hidden')).toBe(false);
    expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
    expect(stageCell('device-1').getAttribute('data-dmap-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
    expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toBeTruthy();
    width.mockRestore();
  });

  describe('undo and the local state of the query pane', () => {
    const nativeConfig: DiagramConfig = {
      ...config,
      defaultDatasource: { uid: 'test' },
      queries: [{ id: 'q', name: 'Native', source: { kind: 'datasource', target: { refId: 'D' }, parameters: {} } }],
    };
    function setupNative() {
      let controls: { undo: () => void; redo: () => void } | null = null;
      const controller = createQueryController(vi.fn());
      renderEditor({
        config: nativeConfig,
        svg: svgOf('device-1'),
        service: testQueryService(controller, queryContext),
        onControls: (value) => {
          controls = value;
        },
      });
      return { controls: () => controls!, controller };
    }
    const json = () => editorField('Native target JSON') as HTMLTextAreaElement;
    const importText = (text: string) => {
      fireEvent.change(json(), { target: { value: text } });
      fireEvent.click(buttonNamed('Import native target'));
    };

    it('keeps typed JSON that is not imported when there is nothing to undo or redo', async () => {
      const { controls, controller } = setupNative();
      openQueryRow('Native');
      await screen.findByText(/No supported native query editor/);
      fireEvent.change(json(), { target: { value: '{"refId":"D","expr":"typed"}' } });
      const editor = json();
      act(() => controls().undo());
      act(() => controls().redo());
      // The same element with the same text: the editor was not remounted.
      expect(json()).toBe(editor);
      expect(json().value).toBe('{"refId":"D","expr":"typed"}');
      // After a real step the editor shows the restored draft.
      importText('{"refId":"D","expr":"one"}');
      fireEvent.change(json(), { target: { value: '{"typed":"again"}' } });
      act(() => controls().undo());
      expect(JSON.parse(json().value)).toEqual({ refId: 'D' });
      controller.dispose();
    });

    it('clears the validity message of the old draft when undo changes the draft, so Apply works again', async () => {
      const { controls, controller } = setupNative();
      openQueryRow('Native');
      await screen.findByText(/No supported native query editor/);
      importText('{"refId":"D","expr":"one"}');
      importText('{invalid');
      expect(applyButton().disabled).toBe(true);
      act(() => controls().undo());
      expect(applyButton().disabled).toBe(false);
      expect(screen.getByRole('region', { name: 'Query Native' }).textContent).not.toContain(
        'Invalid native target JSON'
      );
      controller.dispose();
    });
  });
});

describe('QueryPane component', () => {
  const query: NamedQuery = { id: 'cpu', name: 'CPU', source: { kind: 'panel', refId: 'A' } };
  const context = {
    timeRange: getDefaultTimeRange(),
    timeZone: 'utc',
    scopedVars: {},
    refreshMs: 0,
    intervalMs: 1000,
    generation: 1,
  };
  const data: PanelData = { state: LoadingState.Done, series: [], timeRange: context.timeRange };

  const props = (over: Partial<QueryPaneProps> = {}): QueryPaneProps => ({
    query,
    epoch: 0,
    context,
    data,
    timeZone: 'utc',
    uses: 0,
    usedBy: [],
    snapshot: { state: 'idle' },
    fields: [],
    queryError: '',
    onValidity: vi.fn(),
    onChange: vi.fn(),
    onPreview: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  });

  const ready = (rows: number): QuerySnapshot => ({
    state: 'ready',
    fetchedAt: 1,
    fromCache: false,
    frames: [
      toDataFrame({
        name: 'cpu',
        fields: [
          { name: 'host', type: FieldType.string, values: Array.from({ length: rows }, (_, i) => `host-${i}`) },
          {
            name: 'usage',
            type: FieldType.number,
            config: { unit: 'percent', decimals: 1 },
            values: Array.from({ length: rows }, (_, i) => i + 0.25),
          },
        ],
      }),
      toDataFrame({ fields: [{ name: 'other', type: FieldType.number, values: [1] }] }),
    ],
  });

  describe('QueryPane', () => {
    it('shows the first frame as a table: one column per field, values as the field display formats them', () => {
      render(<QueryPane {...props({ snapshot: ready(3), fields: ['host', 'usage', 'other'] })} />);
      const table = screen.getByRole('table', { name: 'Query preview table' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((th) => th.textContent)
      ).toEqual(['host', 'usage']);
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent))).toEqual([
        ['host-0', '0.3%'],
        ['host-1', '1.3%'],
        ['host-2', '2.3%'],
      ]);
      expect(screen.getByLabelText('Query preview result').textContent).toBe(
        'ready: 2 frames, 4 rows, fields: host, usage, other'
      );
    });

    it('limits the table to 20 rows and says so', () => {
      render(<QueryPane {...props({ snapshot: ready(PREVIEW_ROWS + 5) })} />);
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(PREVIEW_ROWS + 1);
      expect(screen.getByText('Showing the first 20 of 25 rows.')).toBeTruthy();
    });

    it('shows no table before a ready preview', () => {
      for (const snapshot of [
        { state: 'idle' },
        { state: 'loading' },
        { state: 'empty', fetchedAt: 1, fromCache: false },
      ]) {
        const view = render(<QueryPane {...props({ snapshot: snapshot as QuerySnapshot })} />);
        expect(screen.queryByRole('table')).toBeNull();
        view.unmount();
      }
    });

    it.each([
      ['error', 'Query failed'],
      ['unsupported', 'Query not supported'],
    ] as const)('marks a %s result with an error alert', (state, title) => {
      render(<QueryPane {...props({ snapshot: { state, message: 'boom' } })} />);
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain(title);
      expect(alert.textContent).toContain('boom');
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('lists the users of the query as buttons that select them', () => {
      const open = vi.fn();
      render(
        <QueryPane
          {...props({
            uses: 2,
            usedBy: [
              { key: 'p', label: 'Pattern Core routers', open },
              { key: 'o', label: 'Override device-1', open: vi.fn() },
            ],
          })}
        />
      );
      const list = screen.getByRole('list', { name: 'Used by' });
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((li) => li.textContent)
      ).toEqual(['Pattern Core routers', 'Override device-1']);
      fireEvent.click(within(list).getByRole('button', { name: 'Pattern Core routers' }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Query use count').textContent).toBe('Used by 2 bindings.');
    });

    it('deletes an unused query at once', () => {
      const onDelete = vi.fn();
      render(<QueryPane {...props({ onDelete })} />);
      expect(screen.queryByRole('list', { name: 'Used by' })).toBeNull();
      fireEvent.click(buttonNamed('Delete query'));
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Delete query?')).toBeNull();
    });

    it('asks before it deletes a query that bindings use; Keep query leaves it', async () => {
      const onDelete = vi.fn();
      render(<QueryPane {...props({ uses: 1, onDelete })} />);
      fireEvent.click(buttonNamed('Delete query'));
      expect(await screen.findByText('Delete query?')).toBeTruthy();
      expect(onDelete).not.toHaveBeenCalled();
      fireEvent.click(buttonNamed('Keep query'));
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('deletes a used query after the confirmation', async () => {
      const onDelete = vi.fn();
      render(<QueryPane {...props({ uses: 1, onDelete })} />);
      fireEvent.click(buttonNamed('Delete query'));
      const button = await screen.findByRole('button', { name: 'Delete' });
      fireEvent.click(button);
      await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });
  });
});

describe('sample freshness in the popup stage', () => {
  it('a status with a policy turns stale at its deadline on the stage, with no new data', async () => {
    const timed: DiagramConfig = {
      version: 3,
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'Q' } }],
      patterns: [],
      widgets: [],
      overrides: [
        {
          cellId: 'device-1',
          display: {
            status: {
              kind: 'mapping',
              binding: { queryId: 'q', match: {}, reducer: 'last' },
              default: { state: 'normal', reason: 'Healthy' },
              mappings: [{ value: 0, state: 'down', reason: 'Down' }],
              freshness: { expectedIntervalMs: 100, staleAfterMs: 400 },
            },
          },
        },
      ],
    };
    const series = [
      toDataFrame({
        refId: 'Q',
        fields: [
          { name: 'Time', type: FieldType.time, values: [Date.now()] },
          { name: 'Value', type: FieldType.number, values: [1] },
        ],
      }),
    ];
    renderEditor({
      config: timed,
      svg: svgOf('device-1'),
      data: { state: LoadingState.Done, series, timeRange: getDefaultTimeRange() },
    });
    await waitFor(() => expect(stageCell('device-1').getAttribute('data-dmap-status')).toBe('normal'));
    await waitFor(() => expect(stageCell('device-1').getAttribute('data-dmap-status')).toBe('stale'), {
      timeout: 2000,
    });
    expect(stageCell('device-1').getAttribute('data-dmap-reason')).toBe('Sample is stale (expected every 100 ms)');
  });
});
