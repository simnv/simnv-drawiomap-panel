import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { resolvePatterns } from './patterns';
import type { DiagramConfigV2 } from '../model/config';

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
        scope: {
          cell: { ...cell.attrs, id: 'link', key: 'link', label: '' },
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
