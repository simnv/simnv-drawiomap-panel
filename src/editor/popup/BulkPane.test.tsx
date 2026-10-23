import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolvePatterns } from '../../binding/patterns';
import type { DiagramConfigV2, DisplayConfig, HoverRow } from '../../model/config';
import type { CellMeta } from '../../types';
import { renderEditor, svgOf } from '../editorHarness';
import { editorField, openSection } from '../testUtils';
import { commonLeaves } from './BulkPane';

const row = (label: string): HoverRow => ({ kind: 'metadata', label, path: 'cell.key' });
const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
const meta = (id: string): CellMeta => ({ id, key: id, kind: 'node', attrs: {}, labelText: '', isEdge: false });
const config = (over: Partial<DiagramConfigV2> = {}): DiagramConfigV2 => ({
  version: 2,
  queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
  widgets: [],
  patterns: [
    {
      id: 'p',
      name: 'Devices',
      select: { ids: ['a', 'b', 'c'] },
      display: { label: 'Shared', hover: { rows: [row('Identity')] }, link: { a2bBinding: binding } },
    },
  ],
  overrides: [
    { cellId: 'a', display: { url: '/d/a' } },
    { cellId: 'b', display: { hover: { rows: [row('B rows')] } } },
  ],
  ...over,
});

describe('commonLeaves', () => {
  const plan = (cfg: DiagramConfigV2) => resolvePatterns(['a', 'b', 'c'].map(meta), cfg);

  it('lists the leaves that every cell has with one value, and the leaves where the cells differ', () => {
    const { common, mixedPaths } = commonLeaves(['a', 'b', 'c'], plan(config()));
    expect(common.label).toBe('Shared');
    expect(common.link?.a2bBinding).toEqual(binding);
    // a has a url, the others do not; b has other rows.
    expect(mixedPaths.sort()).toEqual(['hover.rows', 'url']);
    expect(common.hover?.rows).toBeUndefined();
    expect(common.url).toBeUndefined();
  });

  it('counts an array as one leaf: equal arrays are common, different arrays are mixed', () => {
    const same = config({ overrides: [{ cellId: 'a', display: { url: '/d/a' } }] });
    const { common, mixedPaths } = commonLeaves(['a', 'b', 'c'], plan(same));
    expect(common.hover?.rows).toEqual([row('Identity')]);
    expect(mixedPaths).toEqual(['url']);
  });

  it('counts the health rule as one leaf', () => {
    const rule = (reason: string): Partial<DisplayConfig> => ({
      status: {
        kind: 'mapping',
        binding,
        default: { state: 'normal', reason },
        mappings: [{ value: 0, state: 'down', reason: 'Down' }],
      },
    });
    const cfg = config({
      patterns: [],
      overrides: [
        { cellId: 'a', display: rule('Healthy') },
        { cellId: 'b', display: rule('Healthy') },
        { cellId: 'c', display: rule('Fine') },
      ],
    });
    const { common, mixedPaths } = commonLeaves(['a', 'b', 'c'], plan(cfg));
    expect(mixedPaths).toEqual(['status']);
    expect(common.status).toBeUndefined();
    expect(commonLeaves(['a', 'b'], plan(cfg)).common.status).toBeDefined();
  });

  it('treats an empty rows list as no rows', () => {
    const cfg = config({
      patterns: [],
      overrides: [
        { cellId: 'a', display: { hover: { enabled: true, rows: [] } } },
        { cellId: 'b', display: { label: 'x' } },
      ],
    });
    expect(commonLeaves(['a', 'b'], plan(cfg)).mixedPaths).not.toContain('hover.rows');
  });
});

describe('BulkPane in the editor', () => {
  const stageCell = (id: string, shiftKey = false) =>
    fireEvent.click(screen.getByTestId('dmap-popup-stage').querySelector(`[data-cell-id="${id}"] rect`) as Element, {
      shiftKey,
    });
  const open = (cfg = config()) => {
    const view = renderEditor({ config: cfg, svg: svgOf('a', 'b', 'c') });
    stageCell('a');
    stageCell('b', true);
    stageCell('c', true);
    return view;
  };
  const apply = (view: ReturnType<typeof open>) => {
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    return view.save.mock.calls.at(-1)![0] as DiagramConfigV2;
  };

  it('shows the common value and writes one label leaf to three overrides, keeping the other fields', () => {
    const view = open();
    expect((editorField('Label template') as HTMLInputElement).value).toBe('Shared');
    fireEvent.change(editorField('Label template'), { target: { value: 'New ${value}' } });
    const saved = apply(view);
    expect(saved.overrides.map((o) => o.cellId).sort()).toEqual(['a', 'b', 'c']);
    const by = Object.fromEntries(saved.overrides.map((o) => [o.cellId, o.display]));
    expect(by.a).toEqual({ url: '/d/a', label: 'New ${value}' });
    expect(by.b).toEqual({ hover: { rows: [row('B rows')] }, label: 'New ${value}' });
    // c had no override: it gets the set leaf only and keeps its inherited rows and link binding.
    expect(by.c).toEqual({ label: 'New ${value}' });
    expect(saved.patterns[0].display.hover?.rows).toEqual([row('Identity')]);
  });

  it('one undo removes the three label leaves, one redo brings them back', () => {
    const view = open();
    fireEvent.change(editorField('Label template'), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    const restored = apply(view);
    expect(restored.overrides.map((o) => o.cellId)).toEqual(['a', 'b']);
    expect(restored.overrides.every((o) => o.display.label === undefined)).toBe(true);
  });

  it('shows the chip Mixed on a field with different values and an empty field', () => {
    open(
      config({
        overrides: [
          { cellId: 'a', display: { label: 'A' } },
          { cellId: 'b', display: { label: 'B' } },
        ],
      })
    );
    expect((editorField('Label template') as HTMLInputElement).value).toBe('');
    const chips = screen.getAllByTestId('dmap-field-source');
    expect(chips.map((chip) => chip.textContent)).toContain('Mixed');
    expect(chips.every((chip) => chip.getAttribute('data-source') === 'mixed')).toBe(true);
  });

  it('shows "Mixed, edit per element" for different hover rows, renders no row and writes none', () => {
    const view = open();
    openSection('Hover rows');
    expect(screen.getAllByText('Mixed, edit per element').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Hover row 1 label')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add hover row' })).toBeNull();
    fireEvent.change(editorField('Label template'), { target: { value: 'New' } });
    const saved = apply(view);
    const rows = Object.fromEntries(saved.overrides.map((o) => [o.cellId, o.display.hover?.rows]));
    expect(rows).toEqual({ a: undefined, b: [row('B rows')], c: undefined });
  });

  it('edits identical rows in bulk and replaces the array whole in every override', () => {
    const view = open(config({ overrides: [] }));
    openSection('Hover rows');
    expect(screen.queryByText('Mixed, edit per element')).toBeNull();
    fireEvent.change(editorField('Hover row 1 label'), { target: { value: 'Renamed' } });
    const saved = apply(view);
    expect(saved.overrides.map((o) => o.display)).toEqual([
      { hover: { rows: [{ ...row('Identity'), label: 'Renamed' }] } },
      { hover: { rows: [{ ...row('Identity'), label: 'Renamed' }] } },
      { hover: { rows: [{ ...row('Identity'), label: 'Renamed' }] } },
    ]);
  });

  it('removes the overrides of the selection in one step', () => {
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove overrides of the selection' }));
    expect(
      (screen.getByRole('button', { name: 'Remove overrides of the selection' }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(apply(view).overrides.map((o) => o.cellId)).toEqual(['a', 'b']);
  });
});
