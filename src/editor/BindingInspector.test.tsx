import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { DiagramConfig, DisplayConfig, HoverRow, QueryBinding } from '../model/config';
import { renderEditor, svgOf } from './editorHarness';
import { buttonNamed, chooseOption, editorField, openSection, selectStageCell } from './testUtils';
import { DisplayFields } from './BindingFields';

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
const config = (): DiagramConfig => ({
  version: 3,
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
  it('shows the chip and the reset button of an override, a pattern and a default field', () => {
    setup();
    // The rules of the source are in fieldSource.test.ts. This test proves that the inspector draws them.
    selectStageCell('device-1');
    const override = sourceOfControl(editorField('Label template'));
    expect(override.textContent).toContain('Override');
    expect(within(override).getByRole('button', { name: 'Reset Label template to pattern' })).toBeTruthy();
    selectStageCell('device-2');
    const chip = sourceOfControl(editorField('Label template'));
    expect(chip.textContent).toBe('Pattern Core routers');
    expect(within(chip).queryByRole('button')).toBeNull();
    selectStageCell('device-3');
    expect(sourceOfControl(editorField('Label template')).textContent).toBe('Default');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
  });

  it('resets a field to the pattern value, keeps the other override fields, and removes the override when the last field is reset', () => {
    const { save } = setup();
    selectStageCell('device-1');
    fireEvent.click(buttonNamed('Reset Label template to pattern'));
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Shared');
    expect(sourceOfControl(editorField('Label template')).textContent).toBe('Pattern Core routers');
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(save.mock.calls[0][0].overrides).toEqual([
      { cellId: 'device-1', display: { hover: { rows: [{ kind: 'metadata', label: 'Own row', path: 'cell.key' }] } } },
    ]);
    openSection('Hover rows');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset hover rows to pattern' })[0]);
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(save.mock.calls[1][0].overrides).toEqual([]);
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
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(save.mock.calls[0][0].overrides).toEqual([{ cellId: 'device-1', display: { label: 'Mine' } }]);
  });

  it('says "to default" in the pattern scope and resets the pattern value', () => {
    const { save } = setup();
    selectStageCell('device-2');
    chooseOption('Edit scope', 'All elements matching this pattern');
    const chip = sourceOfControl(editorField('Label template'));
    fireEvent.click(within(chip).getByRole('button', { name: 'Reset Label template to default' }));
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(save.mock.calls[0][0].patterns[0].display).toEqual({ hover: { rows: patternRows } });
  });

  it('shows Default and no reset button for an element that no pattern or override reaches', () => {
    setup();
    selectStageCell('device-3');
    expect(sourceOfControl(editorField('Label template')).textContent).toBe('Default');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
  });
});

describe('DisplayFields component', () => {
  const binding: QueryBinding = { queryId: 'q', match: {}, reducer: 'last' };
  const fresh = { expectedIntervalMs: 1000, staleAfterMs: 5000 };
  const value: DisplayConfig = {
    label: 'L',
    url: '/d/x',
    shape: { binding, text: true },
    link: { a2b: { binding: binding }, b2a: { binding: binding }, capacityBinding: binding, capacity: 10 },
    status: {
      kind: 'predicates',
      binding,
      default: { state: 'normal', reason: 'ok' },
      predicates: [{ op: 'gt', value: 1, state: 'warning', reason: 'hot' }],
      freshness: fresh,
    },
    hover: {
      rows: [
        { kind: 'metadata', label: 'M', path: 'cell.key' },
        { kind: 'drilldown', label: 'D', url: '/d/y' },
        { kind: 'value', label: 'V', binding, unit: 'bps', min: 0, max: 5, url: '/d/v', freshness: fresh },
        { kind: 'history', label: 'H', binding, height: 40 },
      ],
    },
  };

  describe('DisplayFields sources', () => {
    it('asks for the source of every value field and shows one chip for each', () => {
      const sourceOf = vi.fn((path: string) => ({
        owner: 'default' as const,
        resettable: false,
        resetPath: path,
        scope: 'element' as const,
      }));
      render(<DisplayFields value={value} queries={[]} onChange={() => {}} sourceOf={sourceOf} onReset={() => {}} />);
      // Open every section, including the ones that open later.
      for (let round = 0; round < 3; round++) {
        for (const toggle of screen.queryAllByRole('button', { expanded: false })) {
          fireEvent.click(toggle);
        }
      }
      const paths = new Set(sourceOf.mock.calls.map(([path]) => path));
      const expected = [
        'enabled',
        'label',
        'shape.text',
        'url',
        'shape.enabled',
        'shape.binding',
        'shape.target',
        'link.enabled',
        'link.a2b.binding',
        'link.b2a.binding',
        'link.capacityBinding',
        'link.capacity',
        'status.enabled',
        'status.binding',
        'status.kind',
        'status.default.state',
        'status.default.reason',
        'status.predicates[0].value',
        'status.predicates[0].op',
        'status.predicates[0].state',
        'status.predicates[0].reason',
        'status.freshness',
        'status.freshness.expectedIntervalMs',
        'status.freshness.staleAfterMs',
        'hover.enabled',
        'hover.rows[0]',
        'hover.rows[0].label',
        'hover.rows[0].path',
        'hover.rows[1].label',
        'hover.rows[1].url',
        'hover.rows[2].binding',
        'hover.rows[2].freshness',
        'hover.rows[2].freshness.expectedIntervalMs',
        'hover.rows[2].freshness.staleAfterMs',
        'hover.rows[2].unit',
        'hover.rows[2].min',
        'hover.rows[2].max',
        'hover.rows[2].url',
        'hover.rows[3].height',
      ];
      for (const path of expected) {
        expect(paths, path).toContain(path);
      }
      // Every request became a chip.
      expect(screen.getAllByTestId('dmap-field-source')).toHaveLength(sourceOf.mock.calls.length);
    });
  });
});

describe('inspector of a skipped pattern', () => {
  it('shows the problems with their paths and a delete button, and no form; delete removes the pattern', () => {
    const broken = {
      ...config(),
      patterns: [...config().patterns, { id: 'broken', name: 'Broken', select: { kind: 'host' }, display: {} }],
    } as unknown as DiagramConfig;
    setup(broken);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pattern Broken' }));
    const problems = screen.getByRole('list', { name: 'Pattern problems' });
    const items = within(problems)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^patterns\[1\]\.select\.kind: /),
        'patterns[1]: Pattern Broken is not applied until its errors are fixed.',
        expect.stringMatching(/^patterns\[1\]\.select: Every cell is unavailable/),
      ])
    );
    expect(screen.queryByLabelText('Edit scope')).toBeNull();
    expect(screen.queryByLabelText('Label template')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete pattern' }));
    expect(screen.queryByRole('button', { name: 'Edit pattern Broken' })).toBeNull();
    expect(screen.getByLabelText('Edit scope')).toBeTruthy();
  });
});
