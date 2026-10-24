import { describe, expect, it, vi } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { displayProvenance, mergeCell, mergeDisplay, ownersOfPath, resolvePatterns } from './patterns';
import type { DiagramConfigV2 } from '../model/config';
import { demoL3Config } from '../fixtures/demo-config';

const empty = (): DiagramConfigV2 => ({ version: 2, queries: [], patterns: [], overrides: [], widgets: [] });

describe('resolvePatterns', () => {
  it('applies element overrides after matching patterns', () => {
    const cells = [cellMetaFromAttrs('device-1', { 'pg-kind': 'node', 'pg-id': 'router-1' }, false)];
    const config = {
      version: 2 as const,
      queries: [],
      widgets: [],
      patterns: [{ id: 'devices', name: 'Devices', select: {}, display: { shape: { target: 'icon' as const } } }],
      overrides: [{ cellId: 'device-1', display: { shape: { target: 'stroke' as const } } }],
    };
    expect(resolvePatterns(cells, config).cells['device-1'].display).toMatchObject({ shape: { target: 'stroke' } });
  });

  it('diagnoses a widget whose anchor was removed', () => {
    const config = {
      version: 2 as const,
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
    const config: DiagramConfigV2 = {
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

  it('merges the directional capacity bindings and templates of later patterns', () => {
    const cells = [cellMetaFromAttrs('l1', { 'pg-kind': 'link', 'pg-id': 'a:1->b:2' }, true)];
    const b = (match: Record<string, string>) => ({ queryId: 'q', match, reducer: 'last' as const });
    const config: DiagramConfigV2 = {
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          id: 'first',
          name: 'First',
          select: {},
          display: { link: { capacityA2b: 100, capacityA2bBinding: b({ job: 'a' }), capacityB2aBinding: b({}) } },
        },
        {
          id: 'second',
          name: 'Second',
          select: {},
          display: { link: { capacityA2b: '${cell.capacity_a2b_bps}', capacityA2bBinding: b({ device: 'p1' }) } },
        },
      ],
      overrides: [],
      widgets: [],
    };
    const plan = resolvePatterns(cells, config);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.cells.l1.display.link).toMatchObject({
      capacityA2b: '${cell.capacity_a2b_bps}',
      capacityA2bBinding: b({ job: 'a', device: 'p1' }),
      capacityB2aBinding: b({}),
    });
    expect(plan.cells.l1.bindings.map((x) => x.match)).toEqual(
      expect.arrayContaining([{ job: 'a', device: 'p1' }, {}])
    );
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

  it('rejects ambiguous semantic and physical IDs instead of choosing the first cell', () => {
    const a = cellMetaFromAttrs('a', { 'pg-kind': 'node', 'pg-id': 'same' }, false);
    const b = cellMetaFromAttrs('b', { 'pg-kind': 'node', 'pg-id': 'same' }, false);
    const result = resolvePatterns([a, b, { ...a }], empty());
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-semantic-id' }),
        expect.objectContaining({ code: 'duplicate-cell-id' }),
      ])
    );
    expect(Object.keys(result.cells)).toEqual([]);
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
    const config: DiagramConfigV2 = {
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
    const config: DiagramConfigV2 = {
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
            link: { enabled: false, a2bBinding: binding },
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
    const config: DiagramConfigV2 = {
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
    const config: DiagramConfigV2 = {
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
    expect(result.widgets).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-parameter-path', path: 'widgets[0].binding.parameters.dm_device' })
    );
  });
});

describe('display provenance', () => {
  const sel = (match: Record<string, string>) => ({ queryId: 'q', match, reducer: 'last' as const });
  const config: DiagramConfigV2 = {
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
  const config: DiagramConfigV2 = {
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
    const other: DiagramConfigV2 = {
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

describe('a config saved before the schema dropped the fields of version 1', () => {
  it('gives the same plan as the clean demo config', () => {
    const cells = [
      cellMetaFromAttrs('pg-node~rtr-a', { 'pg-kind': 'node', 'pg-id': 'rtr-a' }, false, 'rtr-a'),
      cellMetaFromAttrs(
        'pg-link~isp-a:pppoe->rtr-a:wan1',
        { 'pg-kind': 'link', 'pg-id': 'isp-a:pppoe->rtr-a:wan1', 'pg-from': 'isp-a:pppoe', 'pg-to': 'rtr-a:wan1' },
        true
      ),
      cellMetaFromAttrs(
        'pg-link~rtr-a:lan1->sw-a:br-lan',
        { 'pg-kind': 'link', 'pg-id': 'rtr-a:lan1->sw-a:br-lan', 'pg-from': 'rtr-a:lan1', 'pg-to': 'sw-a:br-lan' },
        true
      ),
    ];
    const clean = demoL3Config();
    const saved = demoL3Config() as unknown as { patterns: Array<{ id: string; display: Record<string, unknown> }> };
    for (const pattern of saved.patterns) {
      const display = pattern.display;
      const link = display.link as Record<string, unknown> | undefined;
      const hover = display.hover as { title?: string } | undefined;
      if (link?.a2bBinding) {
        const a2b = link.a2bBinding as { queryId: string; match: Record<string, string> };
        display.link = {
          ...link,
          a2b: { refId: a2b.queryId, match: a2b.match },
          b2a: { refId: a2b.queryId, match: a2b.match },
          card: hover?.title ? { title: hover.title, url: '/d/old' } : { url: '/d/old' },
        };
      }
      if (pattern.id === 'lan-speed') {
        const { capacityBinding, ...rest } = link!;
        const cap = capacityBinding as { queryId: string; match: Record<string, string>; reducer: string };
        display.link = { ...rest, capacity: { refId: cap.queryId, match: cap.match, reducer: cap.reducer } };
      }
      if (display.shape) {
        display.shape = {
          ...(display.shape as object),
          fill: false,
          stroke: false,
          card: [{ title: 'CPU', refId: 'C', unit: 'percent' }],
          sparkline: { refId: 'C', position: 'bottom' },
        };
      }
    }
    expect(saved).not.toEqual(clean);
    const expected = resolvePatterns(cells, clean);
    expect(Object.keys(expected.cells)).toHaveLength(3);
    expect(expected.diagnostics).toEqual([]);
    expect(resolvePatterns(cells, saved as unknown as DiagramConfigV2)).toEqual(expected);
  });
});
