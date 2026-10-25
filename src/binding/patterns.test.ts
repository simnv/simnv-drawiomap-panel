import { describe, expect, it, vi } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { displayProvenance, mergeCell, mergeDisplay, ownersOfPath, resolvePatterns } from './patterns';
import type { DiagramConfig } from '../model/config';

const empty = (): DiagramConfig => ({ version: 3, queries: [], patterns: [], overrides: [], widgets: [] });

describe('resolvePatterns', () => {
  it('applies element overrides after matching patterns', () => {
    const cells = [cellMetaFromAttrs('device-1', { 'pg-kind': 'node', 'pg-id': 'router-1' }, false)];
    const config = {
      version: 3 as const,
      queries: [],
      widgets: [],
      patterns: [{ id: 'devices', name: 'Devices', select: {}, display: { shape: { target: 'icon' as const } } }],
      overrides: [{ cellId: 'device-1', display: { shape: { target: 'stroke' as const } } }],
    };
    expect(resolvePatterns(cells, config).cells['device-1'].display).toMatchObject({ shape: { target: 'stroke' } });
  });

  it('diagnoses a widget whose anchor was removed', () => {
    const config = {
      version: 3 as const,
      queries: [{ id: 'load', name: 'Load', source: { kind: 'panel' as const, refId: 'A' } }],
      patterns: [],
      overrides: [],
      widgets: [
        {
          id: 'chart',
          anchorCellId: 'removed',
          kind: 'sparkline' as const,
          label: 'Load',
          binding: { queryId: 'load', match: {}, reducer: 'last' as const },
        },
      ],
    };
    expect(resolvePatterns([], config).diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-anchor' }));
  });

  it('merges supplied nested properties in order, replaces arrays and preserves explicit disable', () => {
    const cells = ['device-1', 'device-2'].map((id) =>
      cellMetaFromAttrs(id, { 'pg-kind': 'node', 'pg-id': id }, false, 'Router')
    );
    const config: DiagramConfig = {
      ...empty(),
      patterns: [
        {
          id: 'all',
          name: 'All',
          select: { label: 'Router' },
          display: {
            shape: { target: 'icon', text: true },
            hover: { rows: [{ kind: 'metadata', label: 'Name', path: 'cell.label' }] },
          },
        },
        {
          id: 'later',
          name: 'Later',
          select: { kind: 'node' },
          display: { shape: { target: 'shape' }, hover: { rows: [] } },
        },
      ],
      overrides: [{ cellId: 'device-1', display: { shape: { enabled: false } } }],
    };
    const before = JSON.stringify({ cells, config });
    const result = resolvePatterns(cells, config);
    expect(result.cells['device-1']).toMatchObject({
      patternIds: ['all', 'later'],
      overridden: true,
      display: { shape: { target: 'shape', text: true, enabled: false }, hover: { rows: [] } },
      bindings: [],
    });
    expect(result.cells['device-2']).toMatchObject({
      overridden: false,
      display: { shape: { target: 'shape', text: true } },
    });
    result.cells['device-2'].display.shape!.target = 'stroke';
    expect(JSON.stringify({ cells, config })).toBe(before);
  });

  it('merges a link direction as an object: the binding from the patterns, the capacity from the override', () => {
    const cells = [cellMetaFromAttrs('l1', { 'pg-kind': 'link', 'pg-id': 'a:1->b:2' }, true)];
    const b = (match: Record<string, string>) => ({ queryId: 'q', match, reducer: 'last' as const });
    const config: DiagramConfig = {
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          id: 'first',
          name: 'First',
          select: {},
          display: { link: { a2b: { binding: b({ job: 'a' }), capacity: 100 }, b2a: { capacityBinding: b({}) } } },
        },
        {
          id: 'second',
          name: 'Second',
          select: {},
          display: { link: { a2b: { binding: b({ device: 'p1' }), capacity: '${cell.capacity_a2b_bps}' } } },
        },
      ],
      overrides: [
        { cellId: 'l1', display: { link: { a2b: { capacityBinding: b({ job: 'cap' }) }, b2a: { capacity: 50 } } } },
      ],
      widgets: [],
    };
    const plan = resolvePatterns(cells, config);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.cells.l1.display.link).toEqual({
      a2b: {
        binding: b({ job: 'a', device: 'p1' }),
        capacity: '${cell.capacity_a2b_bps}',
        capacityBinding: b({ job: 'cap' }),
      },
      b2a: { capacityBinding: b({}), capacity: 50 },
    });
    expect(plan.cells.l1.bindings.map((x) => x.match)).toEqual(
      expect.arrayContaining([{ job: 'a', device: 'p1' }, { job: 'cap' }, {}])
    );
    // the provenance follows the same merge, leaf by leaf
    const provenance = displayProvenance(config, cells[0]);
    expect(provenance.get('link.a2b.binding.match.job')).toEqual([{ kind: 'pattern', index: 0 }]);
    expect(provenance.get('link.a2b.binding.match.device')).toEqual([{ kind: 'pattern', index: 1 }]);
    expect(provenance.get('link.a2b.capacity')).toEqual([{ kind: 'pattern', index: 1 }]);
    expect(provenance.get('link.a2b.capacityBinding.queryId')).toEqual([{ kind: 'override', cellId: 'l1' }]);
    expect(provenance.get('link.b2a.capacity')).toEqual([{ kind: 'override', cellId: 'l1' }]);
    expect(provenance.get('link.b2a.capacityBinding.queryId')).toEqual([{ kind: 'pattern', index: 0 }]);
  });

  it('uses physical cell IDs for overrides, even when devices share a display label', () => {
    const cells = [
      cellMetaFromAttrs('a', { 'pg-kind': 'node', 'pg-id': 'router-a' }, false, 'Router'),
      cellMetaFromAttrs('b', { 'pg-kind': 'node', 'pg-id': 'router-b' }, false, 'Router'),
    ];
    const result = resolvePatterns(cells, {
      ...empty(),
      patterns: [{ id: 'selected', name: 'Selected', select: { ids: ['router-a'] }, display: { label: 'Bound A' } }],
      overrides: [{ cellId: 'b', display: { label: 'Bound B' } }],
    });
    expect(result.cells.a.display.label).toBe('Bound A');
    expect(result.cells.b.display.label).toBe('Bound B');
    expect(result.diagnostics).toEqual([]);
  });

  it('marks the cells of an ambiguous semantic or physical ID unavailable instead of choosing the first cell', () => {
    const a = cellMetaFromAttrs('a', { 'pg-kind': 'node', 'pg-id': 'same' }, false);
    const b = cellMetaFromAttrs('b', { 'pg-kind': 'node', 'pg-id': 'same' }, false);
    const result = resolvePatterns([a, b, { ...a }], empty());
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-semantic-id' }),
        expect.objectContaining({ code: 'duplicate-cell-id' }),
      ])
    );
    expect(Object.keys(result.cells)).toEqual(['a', 'b']);
    expect(result.cells.a.unavailable).toMatch(/ambiguous/);
    expect(result.cells.b.unavailable).toMatch(/ambiguous/);
  });

  it('validates the schema at resolution time and diagnoses overrides for removed cells', () => {
    const invalid = {
      ...empty(),
      queries: [
        { id: 'q', name: 'Q', source: { kind: 'panel' as const, refId: 'A' } },
        { id: 'q', name: 'Q', source: { kind: 'panel' as const, refId: 'B' } },
      ],
    };
    expect(resolvePatterns([], invalid).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate-query-id' })
    );
    expect(
      resolvePatterns([], { ...empty(), overrides: [{ cellId: 'gone', display: {} }] }).diagnostics
    ).toContainEqual(expect.objectContaining({ code: 'missing-cell', path: 'overrides[0].cellId' }));
  });

  it('resolves native parameter paths for each active binding and reports missing metadata', () => {
    const cells = [
      cellMetaFromAttrs('a', { 'pg-kind': 'node', device: 'router-a' }, false),
      cellMetaFromAttrs('b', { 'pg-kind': 'node' }, false),
    ];
    const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
    const config: DiagramConfig = {
      ...empty(),
      defaultDatasource: { uid: 'ds' },
      queries: [
        {
          id: 'q',
          name: 'Q',
          source: { kind: 'datasource', target: { refId: 'A' }, parameters: { dm_device: 'cell.device' } },
        },
      ],
      patterns: [{ id: 'all', name: 'All', select: {}, display: { shape: { binding } } }],
    };
    const result = resolvePatterns(cells, config);
    expect(result.cells.a.bindings).toEqual([binding]);
    expect(result.cells.a.scope.cell.device).toBe('router-a');
    expect(result.cells.b.bindings).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'missing-parameter-path',
        path: 'cells.b.shape.binding.parameters.dm_device',
        message: expect.stringContaining('cell.device'),
      }),
    ]);
    const disabled = resolvePatterns(cells, { ...config, overrides: [{ cellId: 'b', display: { enabled: false } }] });
    expect(disabled.cells.b.bindings).toEqual([]);
    expect(disabled.diagnostics).toEqual([]);
  });

  it('replaces status alternatives and keeps disabled sections out of active query bindings', () => {
    const cells = [cellMetaFromAttrs('a', {}, false)];
    const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
    const config: DiagramConfig = {
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          id: 'first',
          name: 'First',
          select: {},
          display: {
            status: {
              kind: 'mapping',
              binding,
              default: { state: 'normal', reason: 'Up' },
              mappings: [{ value: 0, state: 'down', reason: 'Down' }],
            },
          },
        },
        {
          id: 'second',
          name: 'Second',
          select: {},
          display: {
            status: {
              kind: 'predicates',
              binding,
              default: { state: 'normal', reason: 'Healthy' },
              predicates: [{ op: 'gt', value: 10, state: 'warning', reason: 'Warning' }],
            },
            shape: { enabled: false, binding },
            link: { enabled: false, a2b: { binding: binding } },
            hover: { enabled: false, rows: [{ kind: 'history', label: 'History', binding }] },
          },
        },
      ],
    };
    const result = resolvePatterns(cells, config);
    expect(result.cells.a.display.status).toEqual({
      kind: 'predicates',
      binding,
      default: { state: 'normal', reason: 'Healthy' },
      predicates: [{ op: 'gt', value: 10, state: 'warning', reason: 'Warning' }],
    });
    expect(result.cells.a.bindings).toEqual([binding]);
  });

  it('resolves widget anchors and directional parameters without DOM objects', () => {
    const cell = cellMetaFromAttrs('link', { 'pg-kind': 'link', 'pg-from': 'a:p1', 'pg-to': 'b:p2' }, true);
    const binding = { queryId: 'q', match: { host: '${from.node}' }, reducer: 'last' as const };
    const config: DiagramConfig = {
      ...empty(),
      defaultDatasource: { uid: 'ds' },
      queries: [
        {
          id: 'q',
          name: 'Q',
          source: {
            kind: 'datasource',
            target: { refId: 'A' },
            parameters: { dm_from: 'from.node', dm_to: 'to.port' },
          },
        },
      ],
      widgets: [{ id: 'w', label: 'Traffic', anchorCellId: 'link', kind: 'sparkline', binding }],
    };
    const result = resolvePatterns([cell], config);
    expect(result.widgets).toEqual([
      {
        widget: config.widgets[0],
        anchorCellId: 'link',
        index: 0,
        scope: {
          cell: { ...cell.attrs, id: 'link', key: 'link', label: '' },
          cellTitle: 'link',
          from: { node: 'a', port: 'p1', ordinal: '1', raw: 'a:p1' },
          to: { node: 'b', port: 'p2', ordinal: '1', raw: 'b:p2' },
        },
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects inherited object properties as missing semantic parameters', () => {
    const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
    const config: DiagramConfig = {
      ...empty(),
      defaultDatasource: { uid: 'ds' },
      queries: [
        {
          id: 'q',
          name: 'Q',
          source: { kind: 'datasource', target: { refId: 'A' }, parameters: { dm_device: 'cell.toString' } },
        },
      ],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'Load', binding }],
    };
    const result = resolvePatterns([cellMetaFromAttrs('a', {}, false)], config);
    // the widget is admitted with the reason: the chart layer shows the text instead of the chart
    expect(result.widgets).toEqual([expect.objectContaining({ unavailable: 'Binding metadata is unavailable' })]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-parameter-path', path: 'widgets[0].binding.parameters.dm_device' })
    );
  });
});

describe('display provenance', () => {
  const sel = (match: Record<string, string>) => ({ queryId: 'q', match, reducer: 'last' as const });
  const config: DiagramConfig = {
    ...empty(),
    queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
    patterns: [
      {
        id: 'p1',
        name: 'P1',
        select: { ids: ['a'] },
        display: { label: 'one', shape: { binding: sel({ job: 'absent' }) } },
      },
      { id: 'p2', name: 'P2', select: { ids: ['a'] }, display: { shape: { binding: sel({ device: 'router-a' }) } } },
      { id: 'other', name: 'Other', select: { ids: ['b'] }, display: { label: 'b' } },
    ],
    overrides: [{ cellId: 'a', display: { label: 'over' } }],
  };
  const cell = cellMetaFromAttrs('a', {}, false);
  const owners = (path: string) => ownersOfPath(displayProvenance(config, cell), path);

  it('keeps each matcher key with the pattern that set it, and the binding with all contributors', () => {
    expect(owners('shape.binding.match.job')).toEqual([{ kind: 'pattern', index: 0 }]);
    expect(owners('shape.binding.match.device')).toEqual([{ kind: 'pattern', index: 1 }]);
    expect(owners('shape.binding')).toEqual([
      { kind: 'pattern', index: 0 },
      { kind: 'pattern', index: 1 },
    ]);
  });
  it('gives a replaced scalar to the override only', () => {
    expect(owners('label')).toEqual([{ kind: 'override', cellId: 'a' }]);
  });
  it('does not change the merged display of the view-mode callers', () => {
    const plan = resolvePatterns([cell], config);
    expect(plan.cells.a.display).toEqual({
      label: 'over',
      shape: { binding: { queryId: 'q', match: { job: 'absent', device: 'router-a' }, reducer: 'last' } },
    });
    const before = JSON.stringify(plan.cells.a);
    displayProvenance(config, cell);
    expect(JSON.stringify(resolvePatterns([cell], config).cells.a)).toBe(before);
    expect(plan.cells.a.patternIds).toEqual(['p1', 'p2']);
  });
});

describe('display provenance of a status and of the fast path', () => {
  const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
  const mapping = (reason: string) =>
    ({
      kind: 'mapping',
      binding,
      default: { state: 'normal', reason },
      mappings: [{ value: 1, state: 'down', reason }],
    }) as never;
  const config: DiagramConfig = {
    ...empty(),
    queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
    patterns: [
      { id: 'p1', name: 'P1', select: { ids: ['a'] }, display: { status: mapping('one') } },
      { id: 'p2', name: 'P2', select: { ids: ['a'] }, display: { status: mapping('two') } },
    ],
  };
  const cell = cellMetaFromAttrs('a', {}, false);

  it('gives a fully rewritten same-kind status binding to the later pattern only', () => {
    const provenance = displayProvenance(config, cell);
    expect(ownersOfPath(provenance, 'status.binding')).toEqual([{ kind: 'pattern', index: 1 }]);
    expect(ownersOfPath(provenance, 'status')).toEqual([{ kind: 'pattern', index: 1 }]);
  });
  it('gives a status of another kind to the later pattern only', () => {
    const predicates = {
      kind: 'predicates',
      binding,
      default: { state: 'normal', reason: 'x' },
      predicates: [{ op: 'gt', value: 1, state: 'down', reason: 'x' }],
    } as never;
    const other: DiagramConfig = {
      ...config,
      patterns: [config.patterns[0], { ...config.patterns[1], display: { status: predicates } }],
    };
    expect(ownersOfPath(displayProvenance(other, cell), 'status')).toEqual([{ kind: 'pattern', index: 1 }]);
  });
  it('sends a path below a binding that has no owner to the owners of the closest ancestor', () => {
    const owners = (path: string) => ownersOfPath(displayProvenance(config, cell), path);
    expect(owners('status.binding.parameters.dm_port')).toEqual([{ kind: 'pattern', index: 1 }]);
    expect(owners('url')).toEqual([]);
  });

  it('tracks nothing and builds no owners without a track', () => {
    const entries = vi.spyOn(Object, 'entries');
    const flat = vi.spyOn(Array.prototype, 'flatMap');
    try {
      const plain = mergeCell(config, cell);
      expect(plain.patternIds).toEqual(['p1', 'p2']);
      mergeDisplay({}, config.patterns[0].display);
      expect(entries).not.toHaveBeenCalled();
      expect(flat).not.toHaveBeenCalled();
      const track = vi.fn();
      mergeDisplay({}, config.patterns[0].display, track);
      expect(track).toHaveBeenCalledWith('status.binding.queryId');
      expect(entries).toHaveBeenCalled();
    } finally {
      entries.mockRestore();
      flat.mockRestore();
    }
  });
});

describe('resolvePatterns with items that do not parse or cannot run', () => {
  const cells = ['a', 'b', 'c'].map((id) => cellMetaFromAttrs(id, { 'pg-kind': 'node', 'pg-id': id }, false));
  const q = { id: 'q', name: 'Q', source: { kind: 'panel' as const, refId: 'A' } };
  const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
  const good = { id: 'all', name: 'All', select: {}, display: { shape: { binding } } };
  const widget = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    anchorCellId: 'a',
    kind: 'sparkline',
    label: id,
    binding,
    ...over,
  });

  it('one invalid override keeps the other cells and marks that cell unavailable', () => {
    const plan = resolvePatterns(cells, {
      ...empty(),
      queries: [q],
      patterns: [good],
      overrides: [{ cellId: 'b', display: { shape: { target: 'round' } } }],
    });
    expect(plan.cells.a).toMatchObject({ bindings: [binding] });
    expect(plan.cells.a.unavailable).toBeUndefined();
    expect(plan.cells.b).toMatchObject({ unavailable: 'Override of b is not applied', bindings: [] });
    expect(plan.cells.c.bindings).toEqual([binding]);
    expect(plan.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['invalid-config', 'overrides[0].display.shape.target'],
      ['skipped-item', 'overrides[0]'],
    ]);
  });
  it('a skipped pattern with a valid select marks its cells unavailable and reports skipped-cells', () => {
    const plan = resolvePatterns(cells, {
      ...empty(),
      queries: [q],
      patterns: [good, { id: 'bad', name: 'Bad', select: { ids: ['a', 'b'] }, display: { link: { capacity: 0 } } }],
    });
    expect(plan.cells.a.unavailable).toBe('Pattern Bad is not applied');
    expect(plan.cells.b.unavailable).toBe('Pattern Bad is not applied');
    expect(plan.cells.a.bindings).toEqual([]);
    expect(plan.cells.c.unavailable).toBeUndefined();
    expect(plan.cells.c.bindings).toEqual([binding]);
    expect(plan.diagnostics).toContainEqual({
      code: 'skipped-cells',
      path: 'patterns[1]',
      message: '2 cells unavailable: Pattern Bad is not applied.',
    });
    expect(plan.config.patterns.map((p) => p.id)).toEqual(['all']);
  });
  it('a skipped pattern with an invalid select marks every cell unavailable and keeps the widgets', () => {
    const plan = resolvePatterns(cells, {
      ...empty(),
      queries: [q],
      patterns: [good, { id: 'bad', name: 'Bad', select: { kind: 'host' }, display: {} }],
      widgets: [widget('w', { anchorCellId: 'c' })],
    });
    expect(Object.values(plan.cells).map((c) => c.unavailable)).toEqual(Array(3).fill('Pattern Bad is not applied'));
    expect(plan.widgets).toHaveLength(1);
    expect(plan.widgets[0].unavailable).toBeUndefined();
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'skipped-cells', path: 'patterns[1].select' })
    );
  });
  it('a binding to an unknown or unusable query is absent from cell.bindings, with the reason at the cell path', () => {
    const native = { id: 'native', name: 'N', source: { kind: 'datasource', target: { refId: 'N' }, parameters: {} } };
    const plan = resolvePatterns(cells.slice(0, 1), {
      ...empty(),
      queries: [native],
      patterns: [
        {
          id: 'p',
          name: 'P',
          select: {},
          display: {
            shape: { binding: { ...binding, queryId: 'native' } },
            link: { a2b: { binding: { ...binding, queryId: 'missing' } } },
          },
        },
      ],
      widgets: [
        widget('w', { binding: { ...binding, queryId: 'missing' } }),
        widget('w2', { binding: { ...binding, queryId: 'native' } }),
      ],
    });
    expect(plan.cells.a.bindings).toEqual([]);
    expect(plan.cells.a.unavailable).toBeUndefined();
    expect(plan.widgets.map((w) => [w.widget.id, w.unavailable])).toEqual([
      ['w', 'Query missing does not exist. Choose a named query or restore its definition.'],
      ['w2', 'Query native cannot run: choose a datasource.'],
    ]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'unknown-query',
          path: 'cells.a.link.a2b.binding.queryId',
          message: expect.stringMatching(/does not exist/),
        },
        {
          code: 'unknown-query',
          path: 'cells.a.shape.binding.queryId',
          message: 'Query native cannot run: choose a datasource.',
        },
        expect.objectContaining({ code: 'missing-datasource', path: 'queries[0].source.datasource' }),
      ])
    );
  });
  it('a widget with an invalid range or freshness is admitted with the reason', () => {
    const plan = resolvePatterns(cells, {
      ...empty(),
      queries: [q],
      widgets: [
        widget('w', { kind: 'bar', min: 10, max: 1 }),
        widget('f', { freshness: { expectedIntervalMs: 1000, staleAfterMs: 10 } }),
      ],
    });
    expect(plan.widgets.map((w) => w.unavailable)).toEqual(['Invalid range', 'Invalid freshness policy']);
  });
  it('uses the saved indices in missing-cell, missing-anchor and the widget index', () => {
    const plan = resolvePatterns(cells, {
      ...empty(),
      queries: [q],
      overrides: [
        { cellId: 'a', display: { unknown: 1 } },
        { cellId: 'gone', display: {} },
      ],
      widgets: [{ bad: true }, widget('w', { anchorCellId: 'nowhere' }), widget('w2')],
    });
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-cell', path: 'overrides[1].cellId' }),
        expect.objectContaining({ code: 'missing-anchor', path: 'widgets[1].anchorCellId' }),
      ])
    );
    expect(plan.widgets.map((w) => [w.widget.id, w.index])).toEqual([['w2', 2]]);
  });
  it('an ambiguous cell id is unavailable with the reason; the other cells bind', () => {
    const twice = [cells[0], cellMetaFromAttrs('a', { 'pg-kind': 'node', 'pg-id': 'a2' }, false), cells[2]];
    const plan = resolvePatterns(twice, { ...empty(), queries: [q], patterns: [good] });
    expect(plan.cells.a.unavailable).toMatch(/ambiguous/);
    expect(plan.cells.c.bindings).toEqual([binding]);
  });
  it('a version 2 document binds nothing and keeps its diagnostic; the plan config is empty', () => {
    const plan = resolvePatterns(cells, { ...empty(), version: 2, queries: [q], patterns: [good] });
    expect(plan.cells).toEqual({});
    expect(plan.config).toEqual({ version: 3, queries: [], patterns: [], overrides: [], widgets: [] });
    expect(plan.diagnostics.map((d) => d.code)).toEqual(['outdated-config']);
  });
});
