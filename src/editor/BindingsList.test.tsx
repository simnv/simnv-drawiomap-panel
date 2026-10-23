import { openSection, selectElement } from './testUtils';
import { createQueryController } from '../query/controller';
import { PanelQueryContext } from '../query/panel';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { buildCellIndex } from '../render/svgStage';
import { BindingEditor } from './BindingEditor';
import * as cardModel from '../interact/cardModel';
import { LoadingState, getDefaultTimeRange } from '@grafana/data';
import type { DiagramConfigV2 } from '../model/config';

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

vi.mock('../interact/cardModel', async (importOriginal) => {
  const original = await importOriginal<typeof import('../interact/cardModel')>();
  return { ...original, buildConfiguredCard: vi.fn(original.buildConfiguredCard) };
});

const binding = (queryId: string) => ({ queryId, match: {}, reducer: 'last' as const });
const config: DiagramConfigV2 = {
  version: 2,
  queries: [{ id: 'q1', name: 'One', source: { kind: 'panel', refId: 'A' } }],
  patterns: [
    {
      id: 'devices',
      name: 'Devices',
      select: { ids: ['device-1', 'device-2'] },
      display: { hover: { rows: [{ kind: 'value', label: 'V', binding: binding('q1') }] } },
    },
    { id: 'ghost', name: 'Ghost', select: { ids: ['nothing'] }, display: { label: 'Ghost' } },
  ],
  overrides: [
    { cellId: 'device-2', display: { label: 'Second' } },
    { cellId: 'removed', display: { label: 'Old' } },
  ],
  widgets: [{ id: 'w1', anchorCellId: 'device-1', kind: 'sparkline', label: 'Load', binding: binding('q1') }],
};
function setup(input: DiagramConfigV2 = config, extra: Partial<React.ComponentProps<typeof BindingEditor>> = {}) {
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="device-2"><rect/></g></svg>';
  const cells = buildCellIndex(host.querySelector('svg')!);
  const save = vi.fn();
  render(<BindingEditor config={input} cells={cells} onSave={save} {...extra} />);
  return { cells, save };
}
const openAll = () => fireEvent.click(screen.getByRole('tab', { name: /All bindings/ }));

describe('all bindings tab', () => {
  it('starts on the Element tab and shows the groups with counts on the other tab', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'Element' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('region', { name: 'All bindings list' })).toBeNull();
    openAll();
    for (const title of ['Patterns (2)', 'Overrides (2)', 'Widgets (1)']) {
      expect(screen.getByRole('button', { name: title })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Edit pattern Devices' }).textContent).toContain(
      'any · queries q1 · 2 cells · 0 problems'
    );
    expect(screen.getByRole('button', { name: 'Edit pattern Ghost' }).textContent).toContain('0 cells · 1 problem');
    expect(screen.getByRole('button', { name: 'Edit widget Load' }).textContent).toContain('anchor device-1');
  });

  it('shows the problems of a row when it is expanded', () => {
    setup();
    openAll();
    expect(screen.queryByRole('list', { name: 'Problems of Ghost' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show problems of Ghost' }));
    expect(
      within(screen.getByRole('list', { name: 'Problems of Ghost' })).getByText(/matches no element/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide problems of Ghost' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('filters by text and by problems only', () => {
    setup();
    openAll();
    fireEvent.change(screen.getByLabelText('Filter bindings'), { target: { value: 'removed' } });
    expect(screen.getByRole('button', { name: 'Overrides (1 of 2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Patterns (0 of 2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit override removed' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit override device-2' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter bindings'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
    expect(screen.queryByRole('button', { name: 'Edit pattern Devices' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit pattern Ghost' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit override removed' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit widget Load' })).toBeNull();
  });

  it('a click on an override row selects its cell on the Element tab', () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Edit override device-2' }));
    expect(screen.getByRole('tab', { name: 'Element' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'device-2 bindings' })).toBeTruthy();
    expect(screen.getByText('Element override: Yes')).toBeTruthy();
  });

  it('a click on a widget row selects its anchor cell', () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Edit widget Load' }));
    expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toBeTruthy();
  });

  it('a click on a pattern row selects its first cell in the pattern scope', () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Edit pattern Devices' }));
    expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toBeTruthy();
    expect(screen.getByText('Affected elements: 2')).toBeTruthy();
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'device-1,device-2');
  });

  it('a click on a pattern that matches nothing still opens it for correction', () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Edit pattern Ghost' }));
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'nothing');
  });

  it('a click on a row of a missing cell only shows its problems', () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Edit override removed' }));
    expect(screen.getByRole('tab', { name: /All bindings/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('list', { name: 'Problems of removed' })).toBeTruthy();
  });

  it('deletes an override into the draft after a confirmation and applies it through the draft', async () => {
    const { save } = setup({ ...config, patterns: [] });
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Delete override device-2' }));
    expect(screen.getByText(/Delete the override of device-2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit override device-2' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Overrides (1)' })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete override removed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Overrides (0)' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides).toEqual([]);
  });

  it('keeps an override when the confirmation is dismissed', () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Delete override device-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit override device-2' })).toBeTruthy();
  });

  it('deletes a widget', async () => {
    setup();
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Delete widget Load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Widgets (0)' });
  });

  it('marks the matched cells on the diagram while a pattern row is hovered', () => {
    const { cells } = setup();
    openAll();
    const row = screen.getByRole('button', { name: 'Edit pattern Devices' });
    fireEvent.mouseEnter(row);
    expect(cells.get('device-1')!.group.getAttribute('data-dmap-highlight')).toBe('true');
    expect(cells.get('device-2')!.group.getAttribute('data-dmap-highlight')).toBe('true');
    fireEvent.mouseLeave(row);
    expect(cells.get('device-1')!.group.getAttribute('data-dmap-highlight')).toBe('false');
  });

  it('points a legacy-only panel to the Rules editor', () => {
    setup({ version: 2, queries: [], patterns: [], overrides: [], widgets: [] }, { legacyRules: 3 });
    openAll();
    expect(screen.getByText(/3 legacy rules/)).toBeTruthy();
    expect(screen.getByText(/Rules editor/)).toBeTruthy();
  });

  it('shows the problem of a widget whose query matches no metric', () => {
    const data = { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange() };
    setup({ ...config, patterns: [], overrides: [], widgets: [config.widgets[0]] }, { data });
    openAll();
    fireEvent.click(screen.getByRole('button', { name: 'Show problems of Load' }));
    expect(
      within(screen.getByRole('list', { name: 'Problems of Load' })).getByText(/No metric matches query q1/)
    ).toBeTruthy();
    expect(screen.getByText(/widgets\[0\]\.binding/)).toBeTruthy();
  });

  it('shows a query problem that no row owns as a general problem, also with Problems only', () => {
    setup({
      ...config,
      patterns: [],
      overrides: [],
      widgets: [],
      queries: [
        { id: 'lonely', name: 'Lonely', source: { kind: 'datasource', target: { refId: 'A' }, parameters: {} } },
      ],
    });
    openAll();
    const general = screen.getByRole('alert', { name: 'General problems' });
    expect(general.textContent).toMatch(/Choose a datasource/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
    expect(screen.getByRole('alert', { name: 'General problems' })).toBeTruthy();
  });

  it('opens the exact pattern when pattern IDs collide', () => {
    const dup: DiagramConfigV2 = {
      ...config,
      overrides: [],
      widgets: [],
      patterns: [
        { id: 'same', name: 'First', select: { ids: ['device-1'] }, display: {} },
        { id: 'same', name: 'Second', select: { ids: ['device-2'] }, display: {} },
      ],
    };
    setup(dup);
    openAll();
    expect(screen.getAllByText(/Pattern same|duplicate|must be unique/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pattern Second' }));
    expect(screen.getByRole('heading', { name: 'device-2 bindings' })).toBeTruthy();
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'device-2');
    fireEvent.change(screen.getByLabelText('Pattern element IDs'), { target: { value: 'device-1,device-2' } });
    openAll();
    expect(screen.getByRole('button', { name: 'Edit pattern First' }).textContent).toContain('1 cell ');
    expect(screen.getByRole('button', { name: 'Edit pattern Second' }).textContent).toContain('2 cells');
  });

  describe('highlight', () => {
    const marked = (cells: ReturnType<typeof setup>['cells']) =>
      Array.from(cells).filter(([, c]) => c.group.getAttribute('data-dmap-highlight') === 'true').length;
    it('clears when the tab changes', () => {
      const { cells } = setup();
      openAll();
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Edit pattern Devices' }));
      expect(marked(cells)).toBe(2);
      fireEvent.click(screen.getByRole('tab', { name: 'Element' }));
      expect(marked(cells)).toBe(0);
    });
    it('clears when the highlighted row is filtered out', () => {
      const { cells } = setup();
      openAll();
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Edit pattern Devices' }));
      expect(marked(cells)).toBe(2);
      fireEvent.change(screen.getByLabelText('Filter bindings'), { target: { value: 'removed' } });
      expect(marked(cells)).toBe(0);
    });
    it('clears when Problems only hides the row', () => {
      const { cells } = setup();
      openAll();
      fireEvent.focus(screen.getByRole('button', { name: 'Edit pattern Devices' }));
      expect(marked(cells)).toBe(2);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
      expect(marked(cells)).toBe(0);
    });
  });

  it('does not recompute the diagnostics of the cards when only the highlight changes', () => {
    const data = { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange() };
    const calls = vi.mocked(cardModel.buildConfiguredCard);
    setup(config, { data });
    openAll();
    const before = calls.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const row = screen.getByRole('button', { name: 'Edit pattern Devices' });
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.focus(row);
    expect(calls.mock.calls.length).toBe(before);
  });

  it('does not rebuild any card on a highlight change while a query preview is active', async () => {
    const calls = vi.mocked(cardModel.buildConfiguredCard);
    const controller = createQueryController(vi.fn(() => () => {}));
    const timeRange = getDefaultTimeRange();
    const context = { timeRange, timeZone: 'utc', scopedVars: {}, refreshMs: 0, intervalMs: 1000, generation: 1 };
    const data = { state: LoadingState.Done, series: [], timeRange };
    const native: DiagramConfigV2 = {
      ...config,
      overrides: [],
      widgets: [],
      defaultDatasource: { uid: 'ds' },
      queries: [{ id: 'q1', name: 'One', source: { kind: 'datasource', target: { refId: 'D' }, parameters: {} } }],
    };
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-cell-id="device-1"><rect/></g><g data-cell-id="device-2"><rect/></g></svg>';
    render(
      <PanelQueryContext.Provider value={{ controller, context }}>
        <BindingEditor
          config={native}
          cells={buildCellIndex(host.querySelector('svg')!)}
          data={data}
          onSave={vi.fn()}
        />
      </PanelQueryContext.Provider>
    );
    selectElement('device-1');
    openSection('Named queries');
    await screen.findByText(/No supported native query editor/);
    fireEvent.click(screen.getByRole('button', { name: 'Preview query' }));
    // the active preview builds the hover card of the selected cell
    expect(calls.mock.calls.some(([patch]) => patch.cellId === 'device-1')).toBe(true);
    openAll();
    const before = calls.mock.calls.length;
    const row = screen.getByRole('button', { name: 'Edit pattern Devices' });
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.focus(row);
    expect(calls.mock.calls.length).toBe(before);
    controller.dispose();
  });
});
