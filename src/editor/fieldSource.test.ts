import { describe, expect, it } from 'vitest';
import { displayProvenance } from '../binding/patterns';
import type { DiagramConfig, HoverRow, QueryBinding } from '../model/config';
import type { CellMeta } from '../types';
import { fieldSourceOf, resetLabel, resetPathOf, sourceText, valueAtPath } from './fieldSource';

const cell: CellMeta = { id: 'device-1', kind: 'node', key: 'device-1', attrs: {}, labelText: '', isEdge: false };
const binding: QueryBinding = { queryId: 'q', match: {}, reducer: 'last' };
const rows: HoverRow[] = [
  { kind: 'metadata', label: 'Device', path: 'cell.key' },
  { kind: 'value', label: 'CPU', binding },
];

const config = (over: Partial<DiagramConfig['overrides'][number]['display']> = {}): DiagramConfig => ({
  version: 3,
  queries: [],
  widgets: [],
  patterns: [
    {
      id: 'core',
      name: 'Core routers',
      select: { kind: 'node' },
      display: {
        label: 'From pattern',
        url: '/d/pattern',
        shape: { binding, target: 'shape' },
        link: { a2b: { binding: binding } },
        hover: { rows },
      },
    },
  ],
  overrides: [{ cellId: 'device-1', display: { label: 'Mine', ...over } }],
});

const element = { kind: 'override', cellId: 'device-1' } as const;
const pattern = { kind: 'pattern', index: 0 } as const;
const source = (c: DiagramConfig, path: string, editing: typeof element | typeof pattern = element) =>
  fieldSourceOf(displayProvenance(c, cell), path, editing, c);

describe('fieldSourceOf', () => {
  it('names the pattern, the override and the default', () => {
    const c = config();
    expect(source(c, 'label')).toMatchObject({ owner: 'override', resettable: true, resetPath: 'label' });
    expect(source(c, 'url')).toMatchObject({ owner: 'pattern', name: 'Core routers', resettable: false });
    expect(source(c, 'urlTitle')).toMatchObject({ owner: 'default', resettable: false });
    expect(sourceText(source(c, 'label'))).toBe('Override');
    expect(sourceText(source(c, 'url'))).toBe('Pattern Core routers');
    expect(sourceText(source(c, 'urlTitle'))).toBe('Default');
  });

  it('reports every path of DisplayFields against one pattern and one override', () => {
    const c = config({
      enabled: false,
      shape: { text: true },
      link: { enabled: false, capacity: 100, a2b: { binding: { ...binding, queryId: 'other' } } },
    });
    const owners = (path: string) => source(c, path).owner;
    expect(owners('enabled')).toBe('override');
    expect(owners('label')).toBe('override');
    expect(owners('shape.text')).toBe('override');
    expect(owners('url')).toBe('pattern');
    expect(owners('shape.enabled')).toBe('default');
    expect(owners('shape.binding')).toBe('pattern');
    expect(owners('shape.target')).toBe('pattern');
    expect(owners('link.enabled')).toBe('override');
    expect(owners('link.a2b.binding')).toBe('override');
    expect(owners('link.b2a.binding')).toBe('default');
    expect(owners('link.capacityBinding')).toBe('default');
    expect(owners('link.capacity')).toBe('override');
    expect(owners('status.enabled')).toBe('default');
    expect(owners('status.binding')).toBe('default');
    expect(owners('status.kind')).toBe('default');
    expect(owners('hover.enabled')).toBe('default');
    expect(owners('hover.rows[0]')).toBe('pattern');
    expect(owners('hover.rows[1].label')).toBe('pattern');
    expect(owners('hover.rows[1].binding')).toBe('pattern');
  });

  it('lets a later pattern win over an earlier one', () => {
    const c = config();
    c.patterns.push({ id: 'edge', name: 'Edge', select: { kind: 'node' }, display: { url: '/d/edge' } });
    expect(source(c, 'url')).toMatchObject({ owner: 'pattern', name: 'Edge' });
    expect(source(c, 'url', { kind: 'pattern', index: 0 }).resettable).toBe(true);
  });

  it('computes the reset eligibility from the edited owner, apart from the source', () => {
    const c = config();
    // The pattern sets the URL; the cell is the edited owner: nothing to reset in element scope.
    expect(source(c, 'url', element)).toMatchObject({ owner: 'pattern', resettable: false });
    // In pattern scope the pattern is the edited owner and it sets the URL.
    expect(source(c, 'url', pattern)).toMatchObject({ owner: 'pattern', resettable: true });
    // The override wins at the label, the pattern also sets it: both owners can reset their own value.
    expect(source(c, 'label', element)).toMatchObject({ owner: 'override', resettable: true });
    expect(source(c, 'label', pattern)).toMatchObject({ owner: 'override', resettable: true });
    // A path that no owner sets.
    expect(source(c, 'urlTitle', pattern)).toMatchObject({ owner: 'default', resettable: false });
  });

  it('resets the whole array for a path inside hover rows', () => {
    const own = [rows[0], { ...rows[1], label: 'Own CPU' } as HoverRow];
    const c = config({ hover: { rows: own } });
    for (const path of ['hover.rows[0]', 'hover.rows[1].label', 'hover.rows[1].binding']) {
      expect(source(c, path)).toMatchObject({ owner: 'override', resettable: true, resetPath: 'hover.rows' });
    }
    // Without an override of the rows the pattern's rows are not resettable in element scope, and the path stays the array.
    expect(source(config(), 'hover.rows[0].label')).toMatchObject({
      owner: 'pattern',
      resettable: false,
      resetPath: 'hover.rows',
    });
    expect(source(config(), 'hover.rows[0].label', pattern)).toMatchObject({ resettable: true });
  });

  it('resets the whole health rule for a path inside status', () => {
    expect(resetPathOf('status')).toBe('status');
    expect(resetPathOf('status.binding')).toBe('status');
    expect(resetPathOf('status.mappings[1].value')).toBe('status.mappings');
    expect(resetPathOf('link.a2b.binding')).toBe('link.a2b.binding');
    const c = config({
      status: {
        kind: 'mapping',
        binding,
        default: { state: 'normal', reason: 'ok' },
        mappings: [{ value: 0, state: 'down', reason: 'down' }],
      },
    });
    expect(source(c, 'status.kind')).toMatchObject({ owner: 'override', resettable: true, resetPath: 'status' });
  });

  it('builds the label of the reset button', () => {
    const c = config({ hover: { rows } });
    expect(resetLabel('Label template', source(c, 'label'), 'element')).toBe('Reset Label template to pattern');
    expect(resetLabel('Hover row 1 label', source(c, 'hover.rows[0].label'), 'element')).toBe(
      'Reset hover rows to pattern'
    );
    expect(resetLabel('Hover row 1 label', source(c, 'hover.rows[0].label'), 'pattern')).toBe(
      'Reset hover rows to default'
    );
    expect(resetLabel('Health rule type', source(c, 'status.kind'), 'element')).toBe('Reset health rule to pattern');
  });

  it('reads values by dotted and indexed paths', () => {
    expect(valueAtPath({ a: { b: [{ c: 1 }] } }, 'a.b[0].c')).toBe(1);
    expect(valueAtPath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(valueAtPath(undefined, 'a')).toBeUndefined();
  });
});
