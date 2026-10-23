import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { DiagramConfigV2, HoverRow } from '../model/config';
import { renderEditor, svgOf } from './editorHarness';
import { chooseOption, editorField, openSection, selectStageCell } from './testUtils';

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

const patternRows: HoverRow[] = [
  { kind: 'metadata', label: 'Device', path: 'cell.key' },
  { kind: 'metadata', label: 'Kind', path: 'cell.kind' },
];
const config = (): DiagramConfigV2 => ({
  version: 2,
  queries: [],
  widgets: [],
  patterns: [
    {
      id: 'core',
      name: 'Core routers',
      select: { ids: ['device-1', 'device-2'] },
      display: { label: 'Shared', hover: { rows: patternRows } },
    },
  ],
  overrides: [
    {
      cellId: 'device-1',
      display: { label: 'Mine', hover: { rows: [{ kind: 'metadata', label: 'Own row', path: 'cell.key' }] } },
    },
  ],
});

/** The source chip that belongs to a control: the nearest ancestor of the control that holds one. */
function sourceOfControl(control: HTMLElement) {
  for (let el = control.parentElement; el; el = el.parentElement) {
    const chip = el.querySelector<HTMLElement>('[data-testid="dmap-field-source"]');
    if (chip) {
      return within(chip.parentElement!).getByTestId('dmap-field-source');
    }
  }
  throw new Error('The control has no source chip.');
}

function setup(initial = config()) {
  const view = renderEditor({ config: initial, svg: svgOf('device-1', 'device-2', 'device-3') });
  return view;
}

describe('field sources in the inspector', () => {
  it('shows "Override" with a reset button for a field that the override sets', () => {
    setup();
    selectStageCell('device-1');
    const chip = sourceOfControl(editorField('Label template'));
    expect(chip.textContent).toContain('Override');
    expect(within(chip).getByRole('button', { name: 'Reset Label template to pattern' })).toBeTruthy();
  });

  it('shows the pattern name and no reset button for a field that only the pattern sets', () => {
    setup();
    selectStageCell('device-2');
    const chip = sourceOfControl(editorField('Label template'));
    expect(chip.textContent).toBe('Pattern Core routers');
    expect(within(chip).queryByRole('button')).toBeNull();
    // Nobody sets the drilldown URL.
    expect(sourceOfControl(editorField('Drilldown URL')).textContent).toBe('Default');
  });

  it('resets a field to the pattern value and keeps the other override fields', () => {
    const { save } = setup();
    selectStageCell('device-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Label template to pattern' }));
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Shared');
    expect(sourceOfControl(editorField('Label template')).textContent).toBe('Pattern Core routers');
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides).toEqual([
      { cellId: 'device-1', display: { hover: { rows: [{ kind: 'metadata', label: 'Own row', path: 'cell.key' }] } } },
    ]);
  });

  it('resets the whole rows array from a field inside a hover row; the pattern rows show again', () => {
    const { save } = setup();
    selectStageCell('device-1');
    openSection('Hover rows');
    expect((editorField('Hover row 1 label') as HTMLInputElement).value).toBe('Own row');
    expect(screen.queryByLabelText('Hover row 2 label')).toBeNull();
    expect(sourceOfControl(editorField('Hover row 1 label')).textContent).toContain('Override');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset hover rows to pattern' })[0]);
    expect((editorField('Hover row 1 label') as HTMLInputElement).value).toBe('Device');
    expect((editorField('Hover row 2 label') as HTMLInputElement).value).toBe('Kind');
    expect(sourceOfControl(editorField('Hover row 2 label')).textContent).toBe('Pattern Core routers');
    expect(screen.queryByRole('button', { name: 'Reset hover rows to pattern' })).toBeNull();
    // The effective binding preview agrees with the fields.
    openSection('Effective binding preview');
    const preview = screen.getByText(/"rows"/, { selector: 'pre' });
    expect(preview.textContent).toContain('"label": "Kind"');
    expect(preview.textContent).not.toContain('Own row');
    // The override keeps its other field.
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides).toEqual([{ cellId: 'device-1', display: { label: 'Mine' } }]);
  });

  it('removes the override when the last field is reset', () => {
    const { save } = setup();
    selectStageCell('device-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Label template to pattern' }));
    openSection('Hover rows');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset hover rows to pattern' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].overrides).toEqual([]);
  });

  it('says "to default" in the pattern scope and resets the pattern value', () => {
    const { save } = setup();
    selectStageCell('device-2');
    chooseOption('Edit scope', 'All elements matching this pattern');
    const chip = sourceOfControl(editorField('Label template'));
    fireEvent.click(within(chip).getByRole('button', { name: 'Reset Label template to default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][0].patterns[0].display).toEqual({ hover: { rows: patternRows } });
  });

  it('shows Default and no reset button for an element that no pattern or override reaches', () => {
    setup();
    selectStageCell('device-3');
    expect(sourceOfControl(editorField('Label template')).textContent).toBe('Default');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
  });
});
