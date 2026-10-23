import { describe, expect, it } from 'vitest';
import type { DiagramConfigV2 } from '../model/config';
import type { CellMeta } from '../types';
import { buildBindingsList, filterBindings } from './bindingsModel';

const cell = (id: string, kind: CellMeta['kind'] = 'node', labelText = ''): CellMeta => ({
  id,
  kind,
  key: id,
  attrs: {},
  labelText,
  isEdge: kind === 'link',
});
const binding = (queryId: string) => ({ queryId, match: {}, reducer: 'last' as const });
const config: DiagramConfigV2 = {
  version: 2,
  queries: [
    { id: 'q1', name: 'One', source: { kind: 'panel', refId: 'A' } },
    { id: 'q2', name: 'Two', source: { kind: 'panel', refId: 'B' } },
  ],
  patterns: [
    {
      id: 'nodes',
      name: 'Nodes',
      select: { kind: 'node' },
      display: {
        status: {
          kind: 'mapping',
          binding: binding('q1'),
          default: { state: 'normal', reason: 'ok' },
          mappings: [{ value: 1, state: 'down', reason: 'x' }],
        },
        hover: { rows: [{ kind: 'value', label: 'V', binding: binding('q2') }] },
      },
    },
    { id: 'ghost', name: 'Ghost', select: { ids: ['nothing'] }, display: {} },
  ],
  overrides: [
    { cellId: 'core', display: { label: 'Core', url: 'x' } },
    { cellId: 'gone', display: { label: 'Gone' } },
  ],
  widgets: [
    { id: 'w1', anchorCellId: 'core', kind: 'sparkline', label: 'Load', binding: binding('q1') },
    { id: 'w2', anchorCellId: 'lost', kind: 'bar', label: 'Lost', binding: binding('q2') },
  ],
};
const cells = [cell('core', 'node', 'Core router'), cell('edge-1', 'node'), cell('l1', 'link')];

describe('buildBindingsList', () => {
  it('describes patterns with selector, queries and matched cells', () => {
    const { patterns } = buildBindingsList(config, cells, []);
    expect(patterns[0]).toMatchObject({
      name: 'Nodes',
      selector: 'node',
      queryIds: ['q1', 'q2'],
      matched: ['core', 'edge-1'],
      problems: [],
    });
  });

  it('reports a pattern that matches no cell', () => {
    const { patterns } = buildBindingsList(config, cells, []);
    expect(patterns[1].matched).toEqual([]);
    expect(patterns[1].problems.map((p) => p.code)).toEqual(['no-match']);
  });

  it('does not report a missing match while the diagram is empty', () => {
    expect(buildBindingsList(config, [], []).patterns[1].problems).toEqual([]);
  });

  it('describes overrides and widgets and flags a missing cell', () => {
    const { overrides, widgets } = buildBindingsList(config, cells, []);
    expect(overrides[0]).toMatchObject({ cellId: 'core', label: 'Core router', keys: ['label', 'url'], exists: true });
    expect(overrides[0].problems).toEqual([]);
    expect(overrides[1].problems.map((p) => p.code)).toEqual(['missing-cell']);
    expect(widgets[0]).toMatchObject({ label: 'Load', widgetKind: 'sparkline', anchorCellId: 'core', queryId: 'q1' });
    expect(widgets[1].problems.map((p) => p.code)).toEqual(['missing-anchor']);
  });

  it('does not repeat a diagnostic that the engine also reports', () => {
    const message = 'Override refers to missing cell gone. Select an existing cell or remove the override.';
    const same = buildBindingsList(config, cells, [{ code: 'missing-cell', path: 'overrides[1].cellId', message }]);
    expect(same.overrides[1].problems).toHaveLength(1);
  });

  it('puts an indexed config diagnostic on its row', () => {
    const list = buildBindingsList(config, cells, [
      {
        code: 'unknown-query',
        path: 'patterns[0].display.status.binding.queryId',
        message: 'Query q9 does not exist.',
      },
      { code: 'invalid-widget-bounds', path: 'widgets[0].max', message: 'Widget maximum must be greater.' },
      { code: 'duplicate-query-id', path: 'queries[1].id', message: 'global' },
    ]);
    expect(list.patterns[0].problems.map((p) => p.message)).toEqual(['Query q9 does not exist.']);
    expect(list.widgets[0].problems.map((p) => p.code)).toEqual(['invalid-widget-bounds']);
    expect(JSON.stringify(list)).not.toContain('global');
  });

  it('groups a per-cell metric diagnostic under the pattern that sets the section', () => {
    const list = buildBindingsList(config, cells, [
      { code: 'unmatched-metric', path: 'cells.edge-1.hover.rows[0].binding', message: 'No metric matches query q2.' },
    ]);
    expect(list.patterns[0].problems).toEqual([
      { code: 'unmatched-metric', message: 'No metric matches query q2.', cellId: 'edge-1' },
    ]);
    expect(list.overrides[0].problems).toEqual([]);
  });

  it('blames the override when only the override sets the section', () => {
    const list = buildBindingsList(config, cells, [
      { code: 'unresolved-metadata', path: 'cells.core.url', message: 'Unresolved ${cell.x}.' },
    ]);
    expect(list.overrides[0].problems.map((p) => p.cellId)).toEqual(['core']);
    expect(list.patterns[0].problems).toEqual([]);
  });
});

describe('filterBindings', () => {
  const list = buildBindingsList(config, cells, []);
  it('matches name, cell id, label and query id', () => {
    expect(filterBindings(list, { text: 'nodes', problemsOnly: false }).patterns).toHaveLength(1);
    expect(filterBindings(list, { text: 'ROUTER', problemsOnly: false }).overrides.map((r) => r.cellId)).toEqual([
      'core',
    ]);
    expect(filterBindings(list, { text: 'q2', problemsOnly: false })).toMatchObject({
      patterns: [{ name: 'Nodes' }],
      overrides: [],
      widgets: [{ label: 'Lost' }],
    });
  });
  it('keeps only rows with problems', () => {
    const only = filterBindings(list, { text: '', problemsOnly: true });
    expect(only.patterns.map((r) => r.name)).toEqual(['Ghost']);
    expect(only.overrides.map((r) => r.cellId)).toEqual(['gone']);
    expect(only.widgets.map((r) => r.label)).toEqual(['Lost']);
  });
});
