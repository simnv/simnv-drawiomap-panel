import { describe, expect, it } from 'vitest';
import { validateConfig, type DiagramConfigV2 } from '../model/config';
import type { CellMeta } from '../types';
import { buildBindingsList, cellRows, filterBindings, problemsOf, rowMatches } from './bindingsModel';

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
    expect(list.patterns[0].problems.map((p) => p.message)).toContain('Query q9 does not exist.');
    expect(list.widgets[0].problems.map((p) => p.code)).toContain('invalid-widget-bounds');
  });

  it('groups a per-cell metric diagnostic under the pattern that sets the section', () => {
    const list = buildBindingsList(config, cells, [
      { code: 'unmatched-metric', path: 'cells.edge-1.hover.rows[0].binding', message: 'No metric matches query q2.' },
    ]);
    expect(list.patterns[0].problems).toEqual([
      {
        code: 'unmatched-metric',
        message: 'No metric matches query q2.',
        path: 'cells.edge-1.hover.rows[0].binding',
        cellId: 'edge-1',
      },
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

describe('query-level diagnostics', () => {
  const missing = {
    code: 'missing-datasource',
    path: 'queries[0].source.datasource',
    message: 'Choose a datasource for this query or set defaultDatasource.',
  };
  it('attach to the query row and to every row that references the query', () => {
    const list = buildBindingsList(config, cells, [missing]);
    expect(list.queries[0].problems.map((p) => p.code)).toEqual(['missing-datasource']);
    expect(list.queries[1].problems).toEqual([]);
    // q1 is used by the Nodes pattern and by the Load widget
    expect(list.patterns[0].problems.map((p) => p.code)).toEqual(['missing-datasource']);
    expect(list.widgets[0].problems.map((p) => p.code)).toEqual(['missing-datasource']);
    expect(list.widgets[1].problems.map((p) => p.code)).not.toContain('missing-datasource');
    expect(list.general).toEqual([]);
  });
  it('stay with the query row when no row uses the query, and survive Problems only', () => {
    const list = buildBindingsList({ ...config, patterns: [], widgets: [] }, cells, [missing]);
    expect(list.queries[0].problems.map((p) => p.code)).toEqual(['missing-datasource']);
    expect(list.queries[0].uses).toBe(0);
    expect(list.general).toEqual([]);
    expect(filterBindings(list, { text: '', problemsOnly: true }).queries.map((r) => r.queryId)).toEqual(['q1']);
  });
  it('send a diagnostic without an owner to the general problems', () => {
    const list = buildBindingsList(config, cells, [
      { code: 'invalid-config', path: '(root)', message: 'bad' },
      { code: 'duplicate-cell-id', path: 'cells.nowhere', message: 'dup' },
    ]);
    expect(list.general.map((p) => p.code)).toEqual(['invalid-config', 'duplicate-cell-id']);
  });
});

describe('owner of a merged setting', () => {
  const a2b = (queryId: string) => ({ a2bBinding: binding(queryId) });
  const merged: DiagramConfigV2 = {
    ...config,
    patterns: [
      { id: 'p1', name: 'P1', select: { ids: ['core'] }, display: { label: 'one', link: a2b('q1') } },
      { id: 'p2', name: 'P2', select: { ids: ['core'] }, display: { link: { b2aBinding: binding('q2') } } },
    ],
    overrides: [{ cellId: 'core', display: { label: 'over' } }],
    widgets: [],
  };
  const owners = (path: string) => {
    const list = buildBindingsList(merged, cells, [{ code: 'unresolved-metadata', path, message: 'x' }]);
    return [...list.patterns, ...list.overrides].filter((r) => r.problems.length).map((r) => r.key);
  };
  it('gives a replaced scalar to the override only', () => {
    expect(owners('cells.core.label')).toEqual(['override:0:core']);
  });
  it('tracks nested fields separately', () => {
    expect(owners('cells.core.link.a2bBinding')).toEqual(['pattern:0:p1']);
    expect(owners('cells.core.link.b2aBinding')).toEqual(['pattern:1:p2']);
  });
  it('replaces an array as a whole', () => {
    const rows = (queryId: string) => [{ kind: 'value' as const, label: 'V', binding: binding(queryId) }];
    const cfg: DiagramConfigV2 = {
      ...merged,
      patterns: [
        { id: 'p1', name: 'P1', select: { ids: ['core'] }, display: { hover: { rows: rows('q1') } } },
        { id: 'p2', name: 'P2', select: { ids: ['core'] }, display: { hover: { rows: rows('q2') } } },
      ],
      overrides: [],
    };
    const list = buildBindingsList(cfg, cells, [
      { code: 'unmatched-metric', path: 'cells.core.hover.rows[0].binding', message: 'x' },
    ]);
    expect(list.patterns.map((r) => r.problems.length)).toEqual([0, 1]);
  });
  it('drops an earlier status of another kind', () => {
    const status = (kind: 'mapping' | 'predicates') =>
      ({
        kind,
        binding: binding('q1'),
        default: { state: 'normal', reason: 'ok' },
        ...(kind === 'mapping'
          ? { mappings: [{ value: 1, state: 'down', reason: 'x' }] }
          : { predicates: [{ op: 'gt', value: 1, state: 'down', reason: 'x' }] }),
      }) as never;
    const cfg: DiagramConfigV2 = {
      ...merged,
      patterns: [
        { id: 'p1', name: 'P1', select: { ids: ['core'] }, display: { status: status('mapping') } },
        { id: 'p2', name: 'P2', select: { ids: ['core'] }, display: { status: status('predicates') } },
      ],
      overrides: [],
    };
    const list = buildBindingsList(cfg, cells, [
      { code: 'unmatched-metric', path: 'cells.core.status.binding', message: 'x' },
    ]);
    expect(list.patterns.map((r) => r.problems.length)).toEqual([0, 1]);
  });
  it('blames every pattern that contributed a matcher key of the same binding', () => {
    const shape = (match: Record<string, string>) => ({ binding: { queryId: 'q1', match, reducer: 'last' as const } });
    const cfg: DiagramConfigV2 = {
      ...merged,
      patterns: [
        { id: 'p1', name: 'P1', select: { ids: ['core'] }, display: { shape: shape({ job: 'absent' }) } },
        { id: 'p2', name: 'P2', select: { ids: ['core'] }, display: { shape: shape({ device: 'router-a' }) } },
      ],
      overrides: [],
    };
    const at = (path: string) =>
      buildBindingsList(cfg, cells, [{ code: 'ambiguous-metric', path, message: 'x' }]).patterns.map(
        (r) => r.problems.length
      );
    expect(at('cells.core.shape.binding')).toEqual([1, 1]);
    // a diagnostic on one matcher key names only the pattern that set it
    expect(at('cells.core.shape.binding.match.job')).toEqual([1, 0]);
    expect(at('cells.core.shape.binding.match.device')).toEqual([0, 1]);
  });
  it('sends a parameter diagnostic below a binding to the pattern that has the binding only', () => {
    const cfg: DiagramConfigV2 = {
      ...merged,
      patterns: [
        { id: 'labels', name: 'Labels', select: { ids: ['core'] }, display: { label: 'x' } },
        {
          id: 'bound',
          name: 'Bound',
          select: { ids: ['core'] },
          display: { shape: { binding: binding('q1') } },
        },
      ],
      overrides: [],
    };
    const list = buildBindingsList(cfg, cells, [
      { code: 'missing-parameter-path', path: 'cells.core.shape.binding.parameters.dm_port', message: 'x' },
    ]);
    expect(list.patterns.map((r) => r.problems.length)).toEqual([0, 1]);
  });
  it('blames all candidates when no owner sets the path', () => {
    expect(owners('cells.core.url')).toEqual(['pattern:0:p1', 'pattern:1:p2', 'override:0:core']);
  });
});

describe('duplicate pattern IDs', () => {
  const dup: DiagramConfigV2 = {
    ...config,
    patterns: [
      { id: 'same', name: 'First', select: { ids: ['core'] }, display: {} },
      { id: 'same', name: 'Second', select: { ids: ['edge-1'] }, display: {} },
    ],
    overrides: [],
    widgets: [],
  };
  it('flags every colliding pattern, with unique keys and exact indexes', () => {
    const list = buildBindingsList(dup, cells, validateConfig(dup).diagnostics);
    expect(list.patterns.map((r) => r.key)).toEqual(['pattern:0:same', 'pattern:1:same']);
    expect(list.patterns.map((r) => r.index)).toEqual([0, 1]);
    expect(list.patterns.map((r) => r.problems.map((p) => p.code))).toEqual([
      ['duplicate-pattern-id'],
      ['duplicate-pattern-id'],
    ]);
  });
});

describe('problem identity', () => {
  it('keeps distinct failing paths of the same message and shows the path', () => {
    const message = 'No metric matches query q2.';
    const list = buildBindingsList(config, cells, [
      { code: 'unmatched-metric', path: 'cells.core.hover.rows[0].binding', message },
      { code: 'unmatched-metric', path: 'cells.core.hover.rows[1].binding', message },
      { code: 'unmatched-metric', path: 'cells.core.hover.rows[1].binding', message },
    ]);
    expect(list.patterns[0].problems.map((p) => p.path)).toEqual([
      'cells.core.hover.rows[0].binding',
      'cells.core.hover.rows[1].binding',
    ]);
  });
});

describe('filter text', () => {
  const list = buildBindingsList(config, cells, []);
  it('finds an override by the query ids it uses', () => {
    const cfg = {
      ...config,
      overrides: [
        {
          cellId: 'core',
          display: { hover: { rows: [{ kind: 'value' as const, label: 'V', binding: binding('q2') }] } },
        },
      ],
    };
    const own = buildBindingsList(cfg, cells, []);
    expect(filterBindings(own, { text: 'q2', problemsOnly: false }).overrides).toHaveLength(1);
    expect(filterBindings(list, { text: 'q2', problemsOnly: false }).overrides).toHaveLength(0);
  });
  it('finds a pattern by the label of a matched cell', () => {
    expect(filterBindings(list, { text: 'core router', problemsOnly: false }).patterns.map((r) => r.name)).toEqual([
      'Nodes',
    ]);
  });
});

describe('query rows', () => {
  const list = buildBindingsList(config, cells, []);
  it('have the name, the id, the source kind and the use count', () => {
    expect(list.queries.map((r) => [r.queryId, r.name, r.sourceKind, r.uses])).toEqual([
      ['q1', 'One', 'panel', 2],
      ['q2', 'Two', 'panel', 2],
    ]);
    expect(list.queries[0].key).toBe('query:0:q1');
  });
  it('match the filter by name, id and source kind', () => {
    const rows = (text: string) => filterBindings(list, { text, problemsOnly: false }).queries.map((r) => r.queryId);
    expect(rows('one')).toEqual(['q1']);
    expect(rows('Q2')).toEqual(['q2']);
    expect(rows('panel')).toEqual(['q1', 'q2']);
    expect(rowMatches(list.queries[0], { text: 'datasource', problemsOnly: false })).toBe(false);
  });
});

describe('problemsOf', () => {
  it('lists every problem once, with the row that owns it', () => {
    const missing = {
      code: 'missing-datasource',
      path: 'queries[0].source.datasource',
      message: 'Choose a datasource for this query or set defaultDatasource.',
    };
    const list = buildBindingsList(config, cells, [
      missing,
      { code: 'invalid-config', path: '(root)', message: 'bad' },
    ]);
    const entries = problemsOf(list);
    const codes = entries.map((e) => [e.problem.code, e.row?.key]);
    expect(codes).toContainEqual(['missing-datasource', 'query:0:q1']);
    expect(codes.filter(([code]) => code === 'missing-datasource')).toHaveLength(1);
    expect(codes).toContainEqual(['invalid-config', undefined]);
    // the diagram-only problems of the ghost pattern, the gone override and the lost widget
    expect(entries.map((e) => e.row?.key)).toEqual(expect.arrayContaining(['pattern:1:ghost', 'override:1:gone']));
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });
  it('is empty without problems', () => {
    expect(problemsOf(buildBindingsList({ ...config, patterns: [], overrides: [], widgets: [] }, cells, []))).toEqual(
      []
    );
  });
});

describe('cellRows', () => {
  const many = [
    cell('core', 'node', 'Core router'),
    cell('core-2', 'node', 'Second'),
    cell('edge-core', 'node', ''),
    cell('lan', 'node', 'The core LAN'),
    cell('other', 'node', ''),
    cell('Core', 'node', ''),
  ];
  it('puts the exact id first, then the prefix, then the contains match in the id or the label', () => {
    expect(cellRows('core', many).map((c) => c.id)).toEqual(['core', 'Core', 'core-2', 'edge-core', 'lan']);
  });
  it('is case-insensitive and ignores spaces around the text', () => {
    expect(cellRows('  LAN ', many).map((c) => c.id)).toEqual(['lan']);
  });
  it('finds nothing for an empty text or an unknown text and returns all matches without a limit', () => {
    expect(cellRows('', many)).toEqual([]);
    expect(cellRows('zzz', many)).toEqual([]);
    const lots = Array.from({ length: 50 }, (_, i) => cell(`n${i}`));
    expect(cellRows('n', lots)).toHaveLength(50);
  });
});

describe('search keeps the label next to the title', () => {
  const linked = (): CellMeta => ({ ...cell('l9', 'link', 'WAN 100M'), title: 'Switch-A p9 ↔ AP-1' });
  const cfg: DiagramConfigV2 = {
    ...config,
    patterns: [{ id: 'links', name: 'Links', select: { kind: 'link' }, display: {} }],
    overrides: [{ cellId: 'l9', display: { label: 'x' } }],
  };
  it('finds a pattern and an override by label, title and id', () => {
    const list = buildBindingsList(cfg, [linked()], []);
    for (const text of ['WAN 100M', 'AP-1', 'l9']) {
      expect(filterBindings(list, { text, problemsOnly: false }).patterns).toHaveLength(1);
      expect(filterBindings(list, { text, problemsOnly: false }).overrides).toHaveLength(1);
    }
  });
});
