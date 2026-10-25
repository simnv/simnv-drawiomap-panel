import { buttonNamed, filterBindings, openQueryRow, openSection, selectStageCell } from './testUtils';
import { createQueryController } from '../query/controller';
import { testQueryService } from '../query/testService';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderEditor, svgOf, type EditorHarnessProps } from './editorHarness';
import { DELETE_CONFIRM_ID } from './BindingsList';
import { isTop } from './popup/overlayStack';
import * as cardModel from '../interact/cardModel';
import { FieldType, LoadingState, getDefaultTimeRange, toDataFrame } from '@grafana/data';
import type { DiagramConfig } from '../model/config';

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
const config: DiagramConfig = {
  version: 3,
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
// Panel data with a result for the eager query q1, so that the bindings of the config resolve.
const resolvedData = {
  state: LoadingState.Done,
  timeRange: getDefaultTimeRange(),
  series: [
    toDataFrame({
      refId: 'A',
      fields: [
        { name: 'Time', type: FieldType.time, values: [1] },
        { name: 'Value', type: FieldType.number, values: [7] },
      ],
    }),
  ],
};
function setup(input: DiagramConfig = config, extra: Partial<EditorHarnessProps> = {}) {
  return renderEditor({ config: input, svg: svgOf('device-1', 'device-2'), data: resolvedData, ...extra });
}
const stageCell = (id: string) => screen.getByTestId('dmap-popup-stage').querySelector(`g[data-cell-id="${id}"]`)!;

describe('bindings list', () => {
  it('shows the groups with counts and no tabs', () => {
    setup();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('region', { name: 'All bindings list' })).toBeTruthy();
    for (const title of ['Problems (2)', 'Patterns (2)', 'Overrides (2)', 'Widgets (1)', 'Queries (1)']) {
      expect(screen.getByRole('button', { name: title })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /^Cells/ })).toBeNull();
    expect(buttonNamed('Edit pattern Devices').textContent).toContain('any · queries q1 · 2 cells · 0 problems');
    expect(buttonNamed('Edit pattern Ghost').textContent).toContain('0 cells · 1 problem');
    expect(buttonNamed('Edit widget Load').textContent).toContain('anchor device-1');
    expect(buttonNamed('Edit query One').textContent).toContain('q1 · panel · used by 2 bindings');
  });

  it('shows the problems of a row when it is expanded', () => {
    setup();
    expect(screen.queryByRole('list', { name: 'Problems of Ghost' })).toBeNull();
    fireEvent.click(buttonNamed('Show problems of Ghost'));
    expect(
      within(screen.getByRole('list', { name: 'Problems of Ghost' })).getByText(/matches no element/)
    ).toBeTruthy();
    expect(buttonNamed('Hide problems of Ghost').getAttribute('aria-expanded')).toBe('true');
  });

  it('filters by text and by problems only', () => {
    setup();
    filterBindings('removed');
    expect(buttonNamed('Overrides (1 of 2)')).toBeTruthy();
    expect(buttonNamed('Patterns (0 of 2)')).toBeTruthy();
    expect(buttonNamed('Edit override removed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit override device-2' })).toBeNull();
    filterBindings('');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
    expect(screen.queryByRole('button', { name: 'Edit pattern Devices' })).toBeNull();
    expect(buttonNamed('Edit pattern Ghost')).toBeTruthy();
    expect(buttonNamed('Edit override removed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit widget Load' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit query One' })).toBeNull();
  });

  it('shows the Cells group only for a filter text, exact id first, and pages by 20', () => {
    const ids = Array.from({ length: 45 }, (_, i) => `node-${i}`);
    renderEditor({ config: { ...config, patterns: [], overrides: [], widgets: [] }, svg: svgOf('node', ...ids) });
    expect(screen.queryByRole('button', { name: /^Cells/ })).toBeNull();
    filterBindings('node');
    expect(buttonNamed('Cells (46)')).toBeTruthy();
    const rows = () => within(screen.getByRole('list', { name: 'Cells' })).getAllByRole('button');
    expect(rows()).toHaveLength(20);
    expect(rows()[0].getAttribute('aria-label')).toBe('Select cell node');
    fireEvent.click(buttonNamed('Show more'));
    expect(rows()).toHaveLength(40);
    fireEvent.click(buttonNamed('Show more'));
    expect(rows()).toHaveLength(46);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    // A new filter text starts at the first page.
    filterBindings('node-1');
    expect(buttonNamed('Cells (11)')).toBeTruthy();
  });

  it('marks the selected row with aria-current', () => {
    setup();
    fireEvent.click(buttonNamed('Edit override device-2'));
    expect(buttonNamed('Edit override device-2').getAttribute('aria-current')).toBe('true');
    expect(buttonNamed('Edit pattern Devices').getAttribute('aria-current')).toBeNull();
    fireEvent.click(buttonNamed('Edit pattern Devices'));
    expect(buttonNamed('Edit pattern Devices').getAttribute('aria-current')).toBe('true');
    expect(buttonNamed('Edit override device-2').getAttribute('aria-current')).toBeNull();
    fireEvent.click(buttonNamed('Edit query One'));
    expect(buttonNamed('Edit query One').getAttribute('aria-current')).toBe('true');
    expect(buttonNamed('Edit pattern Devices').getAttribute('aria-current')).toBeNull();
  });

  it('a click on an override row selects its cell', () => {
    setup();
    fireEvent.click(buttonNamed('Edit override device-2'));
    expect(screen.getByRole('heading', { name: 'device-2 bindings' })).toBeTruthy();
    expect(screen.getByText('Element override: Yes')).toBeTruthy();
    expect(stageCell('device-2').getAttribute('data-dmap-selected')).toBe('true');
  });

  it('a click on a widget row selects its anchor cell', () => {
    setup();
    fireEvent.click(buttonNamed('Edit widget Load'));
    expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toBeTruthy();
  });

  it('a click on a pattern row selects its first cell in the pattern scope', () => {
    setup();
    fireEvent.click(buttonNamed('Edit pattern Devices'));
    expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toBeTruthy();
    expect(screen.getByText('Affected elements: 2')).toBeTruthy();
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'device-1,device-2');
  });

  it('a click on a pattern that matches nothing still opens it for correction', () => {
    setup();
    fireEvent.click(buttonNamed('Edit pattern Ghost'));
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'nothing');
  });

  it('a click on a row of a missing cell only shows its problems', () => {
    setup();
    fireEvent.click(buttonNamed('Edit override removed'));
    expect(screen.getByRole('list', { name: 'Problems of removed' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /removed bindings/ })).toBeNull();
  });

  it('a click on a problem opens the row that owns it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Show problem of Ghost: The selector matches no element/ }));
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'nothing');
  });

  it('opens a query in the inspector with its use count', () => {
    setup();
    openQueryRow('One');
    expect(screen.getByRole('heading', { name: 'One query' })).toBeTruthy();
    expect(screen.getByLabelText('Query use count').textContent).toBe('Used by 2 bindings.');
    expect(screen.getByRole('complementary', { name: 'Diagram binding inspector' })).toBeTruthy();
  });

  it('deletes an override into the draft after a confirmation and applies it through the draft', async () => {
    const { save } = setup({ ...config, patterns: [] });
    fireEvent.click(buttonNamed('Delete override device-2'));
    expect(screen.getByText(/Delete the override of device-2/)).toBeTruthy();
    fireEvent.click(buttonNamed('Delete'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit override device-2' })).toBeNull());
    expect(buttonNamed('Overrides (1)')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Delete override removed'));
    fireEvent.click(buttonNamed('Delete'));
    await screen.findByRole('button', { name: 'Overrides (0)' });
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(save.mock.calls[0][0].overrides).toEqual([]);
  });

  it('puts the delete question on the overlay stack while it is open, so Esc reaches it first', async () => {
    setup();
    expect(isTop(DELETE_CONFIRM_ID)).toBe(false);
    fireEvent.click(buttonNamed('Delete override device-2'));
    expect(isTop(DELETE_CONFIRM_ID)).toBe(true);
    fireEvent.click(buttonNamed('Keep override'));
    await waitFor(() => expect(isTop(DELETE_CONFIRM_ID)).toBe(false));
  });

  it('keeps an override when the confirmation is dismissed', () => {
    setup();
    fireEvent.click(buttonNamed('Delete override device-2'));
    fireEvent.click(buttonNamed('Keep override'));
    expect(buttonNamed('Edit override device-2')).toBeTruthy();
  });

  it('deletes a widget', async () => {
    setup();
    fireEvent.click(buttonNamed('Delete widget Load'));
    fireEvent.click(buttonNamed('Delete'));
    await screen.findByRole('button', { name: 'Widgets (0)' });
  });

  it('marks the matched cells on the diagram while a pattern row is hovered', () => {
    setup();
    const row = buttonNamed('Edit pattern Devices');
    fireEvent.mouseEnter(row);
    expect(stageCell('device-1').getAttribute('data-dmap-highlight')).toBe('true');
    expect(stageCell('device-2').getAttribute('data-dmap-highlight')).toBe('true');
    fireEvent.mouseLeave(row);
    expect(stageCell('device-1').getAttribute('data-dmap-highlight')).toBe('false');
  });

  it('tells the author that the panel ignores its saved rules of version 1', () => {
    setup({ version: 3, queries: [], patterns: [], overrides: [], widgets: [] }, { legacyRules: 3 });
    expect(screen.getByText(/3 rules of version 1/)).toBeTruthy();
    expect(screen.getByText(/ignores them/)).toBeTruthy();
  });

  it('shows the problem of a widget whose query matches no metric', () => {
    const data = { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange() };
    setup({ ...config, patterns: [], overrides: [], widgets: [config.widgets[0]] }, { data });
    fireEvent.click(buttonNamed('Show problems of Load'));
    expect(
      within(screen.getByRole('list', { name: 'Problems of Load' })).getByText(/No metric matches query q1/)
    ).toBeTruthy();
    expect(screen.getAllByText(/widgets\[0\]\.binding/).length).toBeGreaterThan(0);
  });

  it('shows a query problem on the query row and in the Problems group, also with Problems only', () => {
    setup({
      ...config,
      patterns: [],
      overrides: [],
      widgets: [],
      queries: [
        { id: 'lonely', name: 'Lonely', source: { kind: 'datasource', target: { refId: 'A' }, parameters: {} } },
      ],
    });
    expect(buttonNamed('Problems (1)')).toBeTruthy();
    expect(buttonNamed('Edit query Lonely').textContent).toContain('unused · 1 problem');
    expect(screen.getByRole('button', { name: /Show problem of Lonely: Choose a datasource/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
    expect(buttonNamed('Edit query Lonely')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show problem of Lonely/ }));
    expect(screen.getByRole('heading', { name: 'Lonely query' })).toBeTruthy();
  });

  it('opens the exact pattern when pattern IDs collide', () => {
    const dup: DiagramConfig = {
      ...config,
      overrides: [],
      widgets: [],
      patterns: [
        { id: 'same', name: 'First', select: { ids: ['device-1'] }, display: {} },
        { id: 'same', name: 'Second', select: { ids: ['device-2'] }, display: {} },
      ],
    };
    setup(dup);
    expect(screen.getAllByText(/Pattern same|duplicate|must be unique/i).length).toBeGreaterThan(0);
    fireEvent.click(buttonNamed('Edit pattern Second'));
    expect(screen.getByRole('heading', { name: 'device-2 bindings' })).toBeTruthy();
    openSection('Pattern selector');
    expect(screen.getByLabelText('Pattern element IDs')).toHaveProperty('value', 'device-2');
    fireEvent.change(screen.getByLabelText('Pattern element IDs'), { target: { value: 'device-1,device-2' } });
    expect(buttonNamed('Edit pattern First').textContent).toContain('1 cell ');
    expect(buttonNamed('Edit pattern Second').textContent).toContain('2 cells');
  });

  describe('highlight', () => {
    const marked = () =>
      Array.from(screen.getByTestId('dmap-popup-stage').querySelectorAll('[data-dmap-highlight="true"]')).length;
    it('clears when the row opens', () => {
      setup();
      const row = buttonNamed('Edit pattern Devices');
      fireEvent.mouseEnter(row);
      expect(marked()).toBe(2);
      fireEvent.click(row);
      fireEvent.mouseLeave(row);
      expect(marked()).toBe(0);
    });
    it('clears when the highlighted row is filtered out', () => {
      setup();
      fireEvent.mouseEnter(buttonNamed('Edit pattern Devices'));
      expect(marked()).toBe(2);
      filterBindings('removed');
      expect(marked()).toBe(0);
    });
    it('clears when Problems only hides the row', () => {
      setup();
      fireEvent.focus(buttonNamed('Edit pattern Devices'));
      expect(marked()).toBe(2);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
      expect(marked()).toBe(0);
    });
  });

  it('does not recompute the diagnostics of the cards when only the highlight changes', () => {
    const data = { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange() };
    const calls = vi.mocked(cardModel.buildConfiguredCard);
    setup(config, { data });
    const before = calls.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const row = buttonNamed('Edit pattern Devices');
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
    const native: DiagramConfig = {
      ...config,
      overrides: [],
      widgets: [],
      defaultDatasource: { uid: 'ds' },
      queries: [{ id: 'q1', name: 'One', source: { kind: 'datasource', target: { refId: 'D' }, parameters: {} } }],
    };
    renderEditor({
      config: native,
      svg: svgOf('device-1', 'device-2'),
      data,
      service: testQueryService(controller, context),
    });
    selectStageCell('device-1');
    openQueryRow('One');
    await screen.findByText(/No supported native query editor/);
    fireEvent.click(buttonNamed('Preview query'));
    // the active preview builds the hover card of the selected cell
    expect(calls.mock.calls.some(([patch]) => patch.cellId === 'device-1')).toBe(true);
    const before = calls.mock.calls.length;
    const row = buttonNamed('Edit pattern Devices');
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.focus(row);
    expect(calls.mock.calls.length).toBe(before);
    controller.dispose();
  });
});
