import { describe, expect, it } from 'vitest';
import type { DataQuery } from '@grafana/schema';
import { displayBindings, rowCapacityBindings, validateConfig, type DiagramConfig } from './config';

const empty = () => ({ version: 3, queries: [], patterns: [], overrides: [], widgets: [] });
const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
const panelQuery = (id: string, refId = 'A') => ({ id, name: id, source: { kind: 'panel' as const, refId } });
const clean = (input: unknown) => validateConfig(JSON.parse(JSON.stringify(input)));
/** Each parsed item is the saved item, byte for byte: the popup forms write the whole item back. */
const expectItemsEqual = (
  result: ReturnType<typeof validateConfig>,
  input: Record<'queries' | 'patterns' | 'overrides' | 'widgets', unknown[]>
) => {
  for (const section of ['queries', 'patterns', 'overrides', 'widgets'] as const) {
    const saved = input[section] as unknown[];
    expect(result.indices[section]).toEqual(saved.map((_, i) => i));
    result.config![section].forEach((item, j) => expect(JSON.stringify(item)).toBe(JSON.stringify(saved[j])));
  }
};

describe('validateConfig: round trip of the version 3 shape', () => {
  it('returns every item deep-equal to its saved JSON, with every hover kind, both link directions and a native target', () => {
    const tpl = { ...binding, match: { device: '${cell.device}' }, field: 'Value' };
    const config: DiagramConfig = {
      version: 3,
      defaultDatasource: { uid: 'prom', type: 'prometheus' },
      queries: [
        panelQuery('q'),
        {
          id: 'native',
          name: 'Native',
          source: {
            kind: 'datasource',
            target: { refId: 'N', expr: 'up', custom: { mode: ['instant', null, 0, false] }, hide: false } as DataQuery,
            parameters: { dm_device: 'cell.device' },
          },
        },
      ],
      patterns: [
        {
          id: 'devices',
          name: 'Devices',
          select: { kind: 'node', attrs: { device: '/^router-/' } },
          display: {
            link: {
              a2b: { binding: tpl, capacity: '${cell.capacity_a2b_bps}', capacityBinding: binding },
              b2a: { binding: tpl, capacity: 200000000 },
              capacity: 1000,
              capacityBinding: binding,
            },
            shape: { binding, target: 'icon', text: true },
            status: {
              kind: 'predicates',
              binding,
              default: { state: 'normal', reason: 'Up' },
              predicates: [{ op: 'eq', value: 0, state: 'down', reason: 'Health failed' }],
              freshness: { expectedIntervalMs: 10000, staleAfterMs: 30000 },
            },
            hover: {
              title: '${cellTitle}',
              rows: [
                { kind: 'value', label: 'Health', binding, min: 0, max: 1 },
                { kind: 'history', label: 'History', binding, unit: 'percent', height: 64 },
                {
                  kind: 'combined',
                  label: 'Traffic',
                  unit: 'bps',
                  capacity: 100000000,
                  capacityBinding: binding,
                  max: 'capacity',
                  series: [
                    { binding, direction: 'up', label: '↑', capacity: '${cell.capacity_a2b_bps}' },
                    { binding, direction: 'down', capacityBinding: binding },
                  ],
                },
                { kind: 'metadata', label: 'Device', path: 'cell.device' },
                { kind: 'drilldown', label: 'Details', url: '/d/health' },
              ],
            },
            reducer: 'max',
            label: '${value}',
            url: '/d/x?device=${cell.device}',
            urlTitle: 'Device',
          },
        },
      ],
      overrides: [{ cellId: 'a', display: { enabled: false, link: { a2b: { capacity: 5 } } } }],
      widgets: [
        { id: 'w', anchorCellId: 'chart', kind: 'bar', binding, label: 'Load', unit: 'percent', min: 0, max: 100 },
      ],
    };
    const result = clean(config);
    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual(config);
    expect(result.skipped).toEqual({ queries: [], patterns: [], overrides: [], widgets: [] });
    expectItemsEqual(result, config);
  });

  it('keeps a native target as it is, also when it cannot persist, and marks the query unusable', () => {
    const target = { refId: 'A', custom: () => 1 };
    const input = {
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'datasource', datasource: { uid: 'ds' }, target, parameters: {} } }],
    };
    const result = validateConfig(input);
    expect(result.config!.queries[0].source).toMatchObject({ target });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-native-target', path: 'queries[0].source.target' })
    );
    expect(result.unusableQueries.get('q')).toMatch(/persistable/);
  });

  it('rejects cycles in native targets without throwing', () => {
    const target: Record<string, unknown> = { refId: 'A' };
    target.self = target;
    expect(
      validateConfig({
        ...empty(),
        queries: [
          { id: 'q', name: 'Q', source: { kind: 'datasource', datasource: { uid: 'ds' }, target, parameters: {} } },
        ],
      }).diagnostics
    ).toContainEqual(expect.objectContaining({ code: 'invalid-native-target' }));
  });

  it('lists every binding of a display with its path, the capacity bindings included', () => {
    const display = {
      link: {
        a2b: { binding, capacityBinding: binding },
        b2a: { binding, capacityBinding: binding },
        capacityBinding: binding,
      },
      shape: { binding },
      status: {
        kind: 'mapping' as const,
        binding,
        default: { state: 'normal' as const, reason: 'Up' },
        mappings: [{ value: 0, state: 'down' as const, reason: 'Down' }],
      },
      hover: {
        rows: [
          { kind: 'value' as const, label: 'CPU', binding },
          {
            kind: 'combined' as const,
            label: 'Traffic',
            capacityBinding: binding,
            series: [
              { binding, direction: 'up' as const },
              { binding, direction: 'down' as const, capacityBinding: binding },
            ],
          },
        ],
      },
    };
    expect(displayBindings(display).map((b) => b.path)).toEqual([
      'link.a2b.binding',
      'link.a2b.capacityBinding',
      'link.b2a.binding',
      'link.b2a.capacityBinding',
      'link.capacityBinding',
      'shape.binding',
      'status.binding',
      'hover.rows[0].binding',
      'hover.rows[1].series[0].binding',
      'hover.rows[1].series[1].binding',
      'hover.rows[1].capacityBinding',
      'hover.rows[1].series[1].capacityBinding',
    ]);
    expect(rowCapacityBindings(display.hover.rows[1]).map((b) => b.path)).toEqual([
      'capacityBinding',
      'series[1].capacityBinding',
    ]);
    expect(rowCapacityBindings(display.hover.rows[0])).toEqual([]);
  });
});

describe('validateConfig: versions', () => {
  it('a version 2 document gives outdated-config alone and no config, also with valid version 3 items', () => {
    const result = validateConfig({
      ...empty(),
      version: 2,
      queries: [panelQuery('q')],
      patterns: [{ id: 'p', name: 'P', select: {}, display: { link: { a2b: { binding } } } }],
    });
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toEqual([
      { code: 'outdated-config', path: '(root)', message: expect.stringMatching(/version 2.*version 3/) },
    ]);
  });
  it('a panel options document (rules of version 1) gives legacy-config and is left as it is', () => {
    const legacy = {
      rules: [{ name: 'old', select: {} }],
      diagram: { xml: '<mxfile/>', svg: '<svg/>', hash: 'old' },
      zoom: { mode: 'fit' },
    };
    const before = JSON.stringify(legacy);
    const result = validateConfig(legacy);
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'legacy-config', path: '(root)', message: expect.stringMatching(/version 1/i) }),
    ]);
    expect(JSON.stringify(legacy)).toBe(before);
  });
  it.each([
    ['null', null],
    ['version 4', { ...empty(), version: 4 }],
    ['version 1', { ...empty(), version: 1 }],
    ['no version', { queries: [], patterns: [], overrides: [], widgets: [] }],
    ['an extra key', { ...empty(), extra: true }],
    ['a list that is not an array', { ...empty(), patterns: {} }],
    ['a bad default datasource', { ...empty(), defaultDatasource: { uid: '' } }],
  ])('a bad envelope (%s) gives invalid-config and no config', (_name, input) => {
    const result = validateConfig(input);
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-config', path: expect.any(String), message: expect.any(String) })
    );
    expect(result.indices).toEqual({ queries: [], patterns: [], overrides: [], widgets: [] });
  });
  it.each([
    ['a2bBinding', { link: { a2bBinding: binding } }],
    ['capacityA2b', { link: { capacityA2b: 1 } }],
    ['a history row with series', { hover: { rows: [{ kind: 'history', label: 'T', series: [{ binding, direction: 'up' }] }] } }],
    ['capacity 0', { link: { capacity: 0 } }],
    ['a numeric string capacity', { link: { capacity: '100' } }],
    ['capacity "auto"', { link: { capacity: 'auto' } }],
    ['a capacity object', { link: { capacity: { refId: 'A' } } }],
  ])('an old key inside a version 3 document (%s) skips that item only', (_name, display) => {
    const result = validateConfig({
      ...empty(),
      queries: [panelQuery('q')],
      patterns: [
        { id: 'ok', name: 'OK', select: { kind: 'node' }, display: { shape: { binding } } },
        { id: 'old', name: 'Old', select: {}, display },
      ],
    });
    expect(result.config!.patterns.map((p) => p.id)).toEqual(['ok']);
    expect(result.indices.patterns).toEqual([0]);
    expect(result.skipped.patterns).toEqual([1]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-config', path: expect.stringMatching(/^patterns\[1\]\.display\.(link|hover)/) })
    );
    expect(result.diagnostics).toContainEqual({
      code: 'skipped-item',
      path: 'patterns[1]',
      message: 'Pattern Old is not applied until its errors are fixed.',
    });
  });
});

describe('validateConfig: per-item', () => {
  it('one invalid pattern keeps the others; indices and skipped hold saved indices', () => {
    const good = (id: string) => ({ id, name: id, select: {}, display: { shape: { binding } } });
    const result = validateConfig({
      ...empty(),
      queries: [panelQuery('q')],
      patterns: [good('a'), { id: 'b', name: 'B', select: { kind: 'host' }, display: {} }, good('c')],
      overrides: [{ cellId: 'x', display: { unknown: true } }, { cellId: 'y', display: {} }],
      widgets: [{ id: 'w', anchorCellId: '', kind: 'round', label: 'W' }],
    });
    expect(result.config).toMatchObject({
      patterns: [{ id: 'a' }, { id: 'c' }],
      overrides: [{ cellId: 'y' }],
      widgets: [],
    });
    expect(result.indices).toEqual({ queries: [0], patterns: [0, 2], overrides: [1], widgets: [] });
    expect(result.skipped).toEqual({ queries: [], patterns: [1], overrides: [0], widgets: [0] });
    expect(result.skippedItems).toEqual([
      { section: 'patterns', index: 1, title: 'Pattern B', id: 'b' },
      { section: 'overrides', index: 0, title: 'Override of x', cellId: 'x' },
      { section: 'widgets', index: 0, title: 'Widget w', id: 'w' },
    ]);
    expect(result.diagnostics.filter((d) => d.code === 'skipped-item').map((d) => d.path)).toEqual([
      'patterns[1]',
      'overrides[0]',
      'widgets[0]',
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-config', path: 'patterns[1].select.kind' })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-config', path: 'overrides[0].display' })
    );
  });
  it('a skipped pattern keeps its select when that parses on its own; an item without a name takes its path', () => {
    const result = validateConfig({
      ...empty(),
      patterns: [
        { id: 'p', name: 'P', select: { kind: 'link' }, display: { link: { a2bBinding: binding } } },
        { select: { kind: 'host' }, display: {} },
      ],
    });
    expect(result.skippedItems).toEqual([
      { section: 'patterns', index: 0, title: 'Pattern P', id: 'p', select: { kind: 'link' } },
      { section: 'patterns', index: 1, title: 'Pattern patterns[1]' },
    ]);
  });
  it('a duplicate query id keeps the first and reports the later one; references find the first', () => {
    const result = validateConfig({
      ...empty(),
      queries: [panelQuery('q', 'A'), panelQuery('q', 'B')],
      patterns: [{ id: 'p', name: 'P', select: {}, display: { shape: { binding } } }],
    });
    expect(result.config!.queries).toHaveLength(2);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'duplicate-query-id', path: 'queries[1].id' }),
    ]);
  });
  it('an unknown query keeps the pattern and lists unknown-query at every reference', () => {
    const missing = { ...binding, queryId: 'removed' };
    const display = {
      link: { a2b: { binding: missing, capacityBinding: missing }, b2a: { binding: missing }, capacityBinding: missing },
      shape: { binding: missing },
      status: {
        kind: 'mapping',
        binding: missing,
        default: { state: 'normal', reason: 'Up' },
        mappings: [{ value: 0, state: 'down', reason: 'Down' }],
      },
      hover: {
        rows: [
          { kind: 'value', label: 'CPU', binding: missing },
          { kind: 'combined', label: 'T', series: [{ binding: missing, direction: 'up' }] },
        ],
      },
    };
    const result = validateConfig({
      ...empty(),
      patterns: [{ id: 'p', name: 'P', select: {}, display }],
      overrides: [{ cellId: 'a', display: { shape: { binding: missing } } }],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'W', binding: missing }],
    });
    expect(result.config!.patterns).toHaveLength(1);
    expect(result.diagnostics.filter((d) => d.code === 'unknown-query').map((d) => d.path)).toEqual([
      'patterns[0].display.link.a2b.binding.queryId',
      'patterns[0].display.link.a2b.capacityBinding.queryId',
      'patterns[0].display.link.b2a.binding.queryId',
      'patterns[0].display.link.capacityBinding.queryId',
      'patterns[0].display.shape.binding.queryId',
      'patterns[0].display.status.binding.queryId',
      'patterns[0].display.hover.rows[0].binding.queryId',
      'patterns[0].display.hover.rows[1].series[0].binding.queryId',
      'overrides[0].display.shape.binding.queryId',
      'widgets[0].binding.queryId',
    ]);
  });
  it('a reference to a skipped query says where its errors are', () => {
    const result = validateConfig({
      ...empty(),
      queries: [{ id: 'q', name: '', source: { kind: 'panel', refId: 'A' } }],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'W', binding }],
    });
    expect(result.skipped.queries).toEqual([0]);
    expect(result.diagnostics).toContainEqual({
      code: 'unknown-query',
      path: 'widgets[0].binding.queryId',
      message: 'Query q has errors (see queries[0]).',
    });
  });
  it('a query without a datasource or with a bad parameter name stays and is unusable with the reason', () => {
    const result = validateConfig({
      ...empty(),
      queries: [
        {
          id: 'q',
          name: 'Q',
          source: { kind: 'datasource', target: { refId: 'A' }, parameters: { device: 'cell.device' } },
        },
      ],
    });
    expect(result.config!.queries).toHaveLength(1);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-datasource', path: 'queries[0].source.datasource' }),
        expect.objectContaining({ code: 'invalid-parameter-name', path: 'queries[0].source.parameters.device' }),
      ])
    );
    expect(result.unusableQueries.get('q')).toBe('choose a datasource');
  });
  it.each(['device', '${cell.device}', 'labels.device', 'cell.', 'cell.device.extra'])(
    'a malformed semantic parameter path (%s) skips the query',
    (path) => {
      const result = validateConfig({
        ...empty(),
        defaultDatasource: { uid: 'ds' },
        queries: [
          { id: 'q', name: 'Q', source: { kind: 'datasource', target: { refId: 'A' }, parameters: { dm_device: path } } },
        ],
      });
      expect(result.skipped.queries).toEqual([0]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'invalid-config', path: 'queries[0].source.parameters.dm_device' })
      );
    }
  );
  it('reports duplicate patterns, widgets and overrides at their saved index and keeps them all', () => {
    const p = { id: 'p', name: 'P', select: {}, display: {} };
    const w = { id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'W', binding };
    const o = { cellId: 'a', display: {} };
    const result = validateConfig({
      ...empty(),
      queries: [panelQuery('q')],
      patterns: [p, { id: 'bad', name: 'B', select: null, display: {} }, p],
      widgets: [w, w],
      overrides: [o, o],
    });
    expect(result.config!.patterns).toHaveLength(2);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-pattern-id', path: 'patterns[2].id' }),
        expect.objectContaining({ code: 'duplicate-widget-id', path: 'widgets[1].id' }),
        expect.objectContaining({ code: 'duplicate-override', path: 'overrides[1].cellId' }),
      ])
    );
  });
  it('an invalid freshness or range keeps the item unchanged and reports it', () => {
    const freshness = { expectedIntervalMs: 1000, staleAfterMs: 500 };
    const input = {
      ...empty(),
      queries: [panelQuery('q')],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'bar', label: 'Load', binding, min: 100, max: 0, freshness }],
      patterns: [
        {
          id: 'p',
          name: 'P',
          select: {},
          display: {
            status: {
              kind: 'mapping',
              binding,
              default: { state: 'normal', reason: 'Up' },
              mappings: [{ value: 0, state: 'down', reason: 'Down' }],
              freshness,
            },
            hover: {
              rows: [
                { kind: 'value', label: 'CPU', binding, freshness, min: 5, max: 5 },
                { kind: 'combined', label: 'T', min: 10, max: 1, series: [{ binding, direction: 'up' }] },
              ],
            },
          },
        },
      ],
    };
    const result = clean(input);
    expect(result.config).toEqual(input);
    expectItemsEqual(result, input);
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['invalid-freshness', 'patterns[0].display.hover.rows[0].freshness.staleAfterMs'],
      ['invalid-row-bounds', 'patterns[0].display.hover.rows[0].max'],
      ['invalid-row-bounds', 'patterns[0].display.hover.rows[1].max'],
      ['invalid-freshness', 'patterns[0].display.status.freshness.staleAfterMs'],
      ['invalid-freshness', 'widgets[0].freshness.staleAfterMs'],
      ['invalid-widget-bounds', 'widgets[0].max'],
    ]);
  });
});

describe('combined up/down row', () => {
  const up = { queryId: 'tx', match: { device: 'wan1' }, reducer: 'last' };
  const down = { queryId: 'rx', match: { device: 'wan1' }, reducer: 'last' };
  const combined = {
    kind: 'combined',
    label: 'Traffic',
    unit: 'bps',
    capacity: 100000000,
    series: [
      { binding: up, direction: 'up', label: '↑' },
      { binding: down, direction: 'down', label: '↓' },
    ],
  };
  const withRow = (row: unknown) => ({
    ...empty(),
    queries: [panelQuery('tx', 'A'), panelQuery('rx', 'B')],
    overrides: [{ cellId: 'a', display: { hover: { rows: [row] } } }],
  });
  const accepts = (row: unknown) => expect(validateConfig(withRow(row)).diagnostics).toEqual([]);
  const skips = (row: unknown) => {
    const result = validateConfig(withRow(row));
    expect(result.skipped.overrides).toEqual([0]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  };
  it('accepts two bindings with a direction each, or one', () => {
    expect(validateConfig(withRow(combined)).config).toEqual(withRow(combined));
    accepts({ kind: 'combined', label: 'In', series: [{ binding: down, direction: 'down' }] });
  });
  it('accepts max "auto", "capacity" or a number on a combined row only', () => {
    for (const max of ['auto', 'capacity', 50000000]) {
      accepts({ ...combined, max });
    }
    skips({ kind: 'history', label: 'T', binding: up, max: 'capacity' });
  });
  it('accepts a capacity and a capacityBinding on the row and on each series entry', () => {
    for (const capacity of [1, 100000000, '${cell.capacity_a2b_bps}', '${cell.capacity_bps}']) {
      accepts({ ...combined, capacity });
    }
    accepts({
      ...combined,
      capacityBinding: up,
      series: [
        { ...combined.series[0], capacity: '${cell.capacity_a2b_bps}', capacityBinding: up },
        { ...combined.series[1], capacity: 10000000 },
      ],
    });
  });
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not finite', Infinity],
    ['a string without a reference', 'fast'],
    ['an empty string', ''],
    ['a numeric string', '100000000'],
    ['an empty reference', '${}'],
    ['null', null],
    ['an object', { max: 1 }],
  ])('skips a row with a capacity that is %s', (_name, capacity) => {
    skips({ ...combined, capacity });
    skips({ ...combined, series: [{ ...combined.series[0], capacity }, combined.series[1]] });
  });
  it('accepts a row height from 16 to 400 px on a combined or a single history row', () => {
    for (const height of [16, 80, 400]) {
      accepts({ ...combined, height });
      accepts({ kind: 'history', label: 'T', binding: up, height });
    }
  });
  it.each([
    ['below 16', { ...combined, height: 15 }],
    ['above 400', { ...combined, height: 401 }],
    ['not a number', { ...combined, height: 'tall' }],
    ['on a value row', { kind: 'value', label: 'T', binding: up, height: 80 }],
    ['on a metadata row', { kind: 'metadata', label: 'T', path: 'cell.key', height: 80 }],
  ])('skips a row with a height %s', (_name, row) => skips(row));
  it.each([
    ['binding and series', { ...combined, binding: up }],
    ['a history row without a binding', { kind: 'history', label: 'T' }],
    ['a history row with series', { ...combined, kind: 'history' }],
    ['no series', { ...combined, series: [] }],
    ['three series', { ...combined, series: [...combined.series, combined.series[0]] }],
    ['the same direction twice', { ...combined, series: [combined.series[0], { ...combined.series[1], direction: 'up' }] }],
    ['an unknown direction', { ...combined, series: [{ binding: up, direction: 'left' }] }],
    ['a capacity on a single history row', { kind: 'history', label: 'T', binding: up, capacity: 5 }],
  ])('skips %s', (_name, row) => skips(row));
});

describe('link directions', () => {
  const withLink = (link: unknown) => ({
    ...empty(),
    queries: [panelQuery('q')],
    overrides: [{ cellId: 'a', display: { link } }],
  });
  it('accepts a direction with a binding, a capacity and a capacity binding, and a direction with a capacity only', () => {
    const link = {
      a2b: { binding, capacity: '${cell.capacity_a2b_bps}', capacityBinding: binding },
      b2a: { capacity: 200000000 },
      capacity: 100,
      capacityBinding: binding,
    };
    expect(validateConfig(withLink(link))).toMatchObject({ config: withLink(link), diagnostics: [] });
  });
  it.each([
    ['a capacity of 0', { a2b: { capacity: 0 } }],
    ['a negative capacity', { capacity: -1 }],
    ['a string without a reference', { a2b: { capacity: 'fast' } }],
    ['a numeric string', { capacity: '100' }],
    ['null', { b2a: { capacity: null } }],
    ['a binding without a query', { a2b: { capacityBinding: { match: {} } } }],
    ['an old key', { a2bBinding: binding }],
  ])('skips an override with %s', (_name, link) => {
    const result = validateConfig(withLink(link));
    expect(result.skipped.overrides).toEqual([0]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  });
});
