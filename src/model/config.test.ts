import { describe, expect, it } from 'vitest';
import { displayBindings, validateConfig, type DiagramConfigV2 } from './config';

const empty = () => ({ version: 2, queries: [], patterns: [], overrides: [], widgets: [] });

describe('validateConfig', () => {
  it('accepts explicit widget and hover freshness and rejects a policy shorter than its sample cadence', () => {
    const binding = { queryId: 'q', match: {}, reducer: 'last' };
    const freshness = { expectedIntervalMs: 1000, staleAfterMs: 5000 };
    const input = {
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'CPU', binding, freshness }],
      overrides: [{ cellId: 'a', display: { hover: { rows: [{ kind: 'value', label: 'CPU', binding, freshness }] } } }],
    };
    expect(validateConfig(input).config).toEqual(input);
    const invalid = structuredClone(input);
    invalid.widgets[0].freshness.staleAfterMs = 500;
    expect(validateConfig(invalid).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-freshness', path: 'widgets[0].freshness.staleAfterMs' })
    );
    const badRow = structuredClone(input);
    badRow.overrides[0].display.hover.rows[0].freshness.staleAfterMs = 500;
    expect(validateConfig(badRow).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid-freshness',
        path: 'overrides[0].display.hover.rows[0].freshness.staleAfterMs',
      })
    );
  });
  it.each([
    null,
    { ...empty(), version: 3 },
    { ...empty(), extra: true },
    { ...empty(), patterns: [{ id: 'p', name: 'P', select: { label: '/x/g' }, display: {} }] },
    { ...empty(), patterns: [{ id: 'p', name: 'P', select: { kind: 'host' }, display: {} }] },
    { ...empty(), overrides: [{ cellId: 'a', display: { unknown: true } }] },
    { ...empty(), overrides: [{ cellId: 'a', display: { enabled: 'false' } }] },
    { ...empty(), overrides: [{ cellId: 'a', display: { hover: { rows: [{ kind: 'unknown' }] } } }] },
    { ...empty(), widgets: [{ id: 'w', anchorCellId: '', kind: 'round', label: 'W' }] },
  ])('rejects malformed V2 configuration with paths: %j', (input) => {
    const result = validateConfig(input);
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-config', path: expect.any(String), message: expect.any(String) })
    );
  });
  it('rejects duplicate query IDs with an actionable path', () => {
    const query = { id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } };
    const duplicateQueryIds = { ...empty(), queries: [query, query] };
    const result = validateConfig(duplicateQueryIds);
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate-query-id', path: 'queries[1].id' })
    );
  });

  it('preserves native target fields and diagram content across save/reopen', () => {
    const target = {
      refId: 'native',
      expr: 'rate(bytes_total{device="$dm_device"}[5m])',
      datasource: { uid: 'prom', type: 'prometheus' },
      custom: { mode: ['instant', null, 0, false], options: { foo: 'bar' } },
      hide: false,
    };
    const input = {
      ...empty(),
      defaultDatasource: { uid: 'prom' },
      queries: [
        {
          id: 'traffic',
          name: 'Traffic',
          source: { kind: 'datasource', target, parameters: { dm_device: 'cell.device' } },
        },
      ],
    };
    const options = {
      config: input,
      diagram: { xml: '<mxfile label="same"/>', svg: '<svg data-cell-id="device-1"/>', hash: 'abc' },
      rules: [{ name: 'old' }],
    };
    const saved = JSON.parse(JSON.stringify(options));
    expect(validateConfig(saved.config)).toEqual({ config: input, diagnostics: [] });
    expect(saved.diagram).toEqual(options.diagram);
    expect(saved.rules).toEqual(options.rules);
  });

  it.each([
    { refId: 'A', custom: undefined },
    { refId: 'A', custom: () => 1 },
    { refId: 'A', custom: NaN },
    { refId: 'A', custom: new Date(0) },
  ])('rejects native target values that cannot persist losslessly', (target) => {
    const input = {
      ...empty(),
      queries: [
        { id: 'q', name: 'Q', source: { kind: 'datasource', datasource: { uid: 'ds' }, target, parameters: {} } },
      ],
    };
    expect(validateConfig(input).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-native-target', path: 'queries[0].source.target' })
    );
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

  it('requires explicit datasource resolution and reserved parameter names', () => {
    const input = {
      ...empty(),
      queries: [
        {
          id: 'q',
          name: 'Q',
          source: { kind: 'datasource', target: { refId: 'A' }, parameters: { device: 'cell.device' } },
        },
      ],
    };
    expect(validateConfig(input).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-datasource', path: 'queries[0].source.datasource' }),
        expect.objectContaining({ code: 'invalid-parameter-name', path: 'queries[0].source.parameters.device' }),
      ])
    );
  });

  it('rejects duplicate patterns, widgets and element overrides', () => {
    const p = { id: 'p', name: 'P', select: {}, display: {} };
    const w = {
      id: 'w',
      anchorCellId: 'a',
      kind: 'sparkline',
      label: 'W',
      binding: { queryId: 'q', match: {}, reducer: 'last' },
    };
    const o = { cellId: 'a', display: {} };
    const result = validateConfig({
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      patterns: [p, p],
      widgets: [w, w],
      overrides: [o, o],
    });
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-pattern-id', path: 'patterns[1].id' }),
        expect.objectContaining({ code: 'duplicate-widget-id', path: 'widgets[1].id' }),
        expect.objectContaining({ code: 'duplicate-override', path: 'overrides[1].cellId' }),
      ])
    );
  });

  it('checks query references in directional links, shapes, status, hover, overrides and widgets', () => {
    const binding = { queryId: 'removed', match: {}, reducer: 'last' };
    const display = {
      link: { a2bBinding: binding, b2aBinding: binding, capacityBinding: binding },
      shape: { binding },
      status: {
        kind: 'mapping',
        binding,
        default: { state: 'normal', reason: 'Up' },
        mappings: [{ value: 0, state: 'down', reason: 'Down' }],
      },
      hover: {
        rows: [
          { kind: 'value', label: 'CPU', binding },
          { kind: 'history', label: 'Load', binding },
        ],
      },
    };
    const result = validateConfig({
      ...empty(),
      patterns: [{ id: 'p', name: 'P', select: {}, display }],
      overrides: [{ cellId: 'a', display: { shape: { binding } } }],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'W', binding }],
    });
    expect(result.config).toBeUndefined();
    expect(result.diagnostics.filter((d) => d.code === 'unknown-query').map((d) => d.path)).toEqual([
      'patterns[0].display.link.a2bBinding.queryId',
      'patterns[0].display.link.b2aBinding.queryId',
      'patterns[0].display.link.capacityBinding.queryId',
      'patterns[0].display.shape.binding.queryId',
      'patterns[0].display.status.binding.queryId',
      'patterns[0].display.hover.rows[0].binding.queryId',
      'patterns[0].display.hover.rows[1].binding.queryId',
      'overrides[0].display.shape.binding.queryId',
      'widgets[0].binding.queryId',
    ]);
  });

  it('detects legacy options without replacing rules or diagram content', () => {
    const legacy = {
      rules: [{ name: 'old', select: {} }],
      diagram: { xml: '<mxfile/>', svg: '<svg/>', hash: 'old' },
      zoom: { mode: 'fit' },
    };
    const before = JSON.stringify(legacy);
    const result = validateConfig(legacy);
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'legacy-config', message: expect.stringMatching(/explicit/i) })
    );
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('round-trips directional links, every hover kind, status freshness and bounded widgets', () => {
    const binding = { queryId: 'q', match: { device: '${cell.device}' }, field: 'Value', reducer: 'last' as const };
    const config: DiagramConfigV2 = {
      ...empty(),
      version: 2,
      queries: [{ id: 'q', name: 'Health', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          id: 'devices',
          name: 'Devices',
          select: { kind: 'node', attrs: { device: '/^router-/' } },
          display: {
            link: {
              a2bBinding: binding,
              b2aBinding: binding,
              capacityBinding: binding,
              capacity: 1000,
              card: { title: 'Traffic' },
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
              rows: [
                { kind: 'value', label: 'Health', binding },
                { kind: 'history', label: 'History', binding, unit: 'percent' },
                { kind: 'metadata', label: 'Device', path: 'cell.device' },
                { kind: 'drilldown', label: 'Details', url: '/d/health' },
              ],
            },
          },
        },
      ],
      overrides: [{ cellId: 'a', display: { enabled: false } }],
      widgets: [
        { id: 'w', anchorCellId: 'chart', kind: 'bar', binding, label: 'Load', unit: 'percent', min: 0, max: 100 },
      ],
    };
    expect(validateConfig(JSON.parse(JSON.stringify(config)))).toEqual({ config, diagnostics: [] });
  });

  it.each(['device', '${cell.device}', 'labels.device', 'cell.', 'cell.device.extra'])(
    'rejects malformed semantic parameter paths: %s',
    (path) => {
      const result = validateConfig({
        ...empty(),
        defaultDatasource: { uid: 'ds' },
        queries: [
          {
            id: 'q',
            name: 'Q',
            source: { kind: 'datasource', target: { refId: 'A' }, parameters: { dm_device: path } },
          },
        ],
      });
      expect(result.config).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ path: 'queries[0].source.parameters.dm_device' })
      );
    }
  );

  it('rejects impossible widget bounds and freshness windows shorter than the expected cadence', () => {
    const binding = { queryId: 'q', match: {}, reducer: 'last' };
    const result = validateConfig({
      ...empty(),
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      widgets: [{ id: 'w', anchorCellId: 'a', kind: 'bar', label: 'Load', binding, min: 100, max: 0 }],
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
              freshness: { expectedIntervalMs: 10000, staleAfterMs: 100 },
            },
          },
        },
      ],
    });
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-widget-bounds' }),
        expect.objectContaining({ code: 'invalid-freshness' }),
      ])
    );
  });
});

describe('Y range bounds', () => {
  const binding = { queryId: 'q', match: {}, reducer: 'last' };
  const withRows = (rows: unknown[], widgets: unknown[] = []) => ({
    ...empty(),
    queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
    overrides: [{ cellId: 'a', display: { hover: { rows } } }],
    widgets,
  });
  it('accepts min "auto" or a number and max a number on value and history rows and widgets', () => {
    const input = withRows(
      [
        { kind: 'value', label: 'PoE', binding, min: 'auto' },
        { kind: 'history', label: 'Temp', binding, min: 10, max: 90 },
      ],
      [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'W', binding, min: 'auto', max: 5 }]
    );
    expect(validateConfig(input)).toEqual({ config: input, diagnostics: [] });
  });
  it.each([
    [[{ kind: 'history', label: 'T', binding, min: 'zero' }], []],
    [[{ kind: 'history', label: 'T', binding, max: 'auto' }], []],
    [[], [{ id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'W', binding, min: 'low' }]],
  ])('rejects other bound values: %j %j', (rows, widgets) => {
    expect(validateConfig(withRows(rows, widgets)).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-config' })
    );
  });
  it('rejects a row min above its max', () => {
    expect(
      validateConfig(withRows([{ kind: 'history', label: 'T', binding, min: 10, max: 5 }])).diagnostics
    ).toContainEqual(
      expect.objectContaining({ code: 'invalid-row-bounds', path: 'overrides[0].display.hover.rows[0].max' })
    );
  });
});

describe('combined up/down history row', () => {
  const up = { queryId: 'tx', match: { device: 'wan1' }, reducer: 'last' };
  const down = { queryId: 'rx', match: { device: 'wan1' }, reducer: 'last' };
  const combined = {
    kind: 'history',
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
    queries: [
      { id: 'tx', name: 'TX', source: { kind: 'panel', refId: 'A' } },
      { id: 'rx', name: 'RX', source: { kind: 'panel', refId: 'B' } },
    ],
    overrides: [{ cellId: 'a', display: { hover: { rows: [row] } } }],
  });
  it('accepts two bindings with a direction each, or one', () => {
    expect(validateConfig(withRow(combined))).toEqual({ config: withRow(combined), diagnostics: [] });
    const single = { kind: 'history', label: 'In', series: [{ binding: down, direction: 'down' }] };
    expect(validateConfig(withRow(single)).diagnostics).toEqual([]);
  });
  it('accepts max "auto", "capacity" or a number on a combined row only', () => {
    for (const max of ['auto', 'capacity', 50000000]) {
      expect(validateConfig(withRow({ ...combined, max })).diagnostics).toEqual([]);
    }
    const plain = validateConfig(withRow({ kind: 'history', label: 'T', binding: up, max: 'capacity' }));
    expect(plain.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  });
  it('accepts a capacity as a positive number or a template', () => {
    for (const capacity of [1, 100000000, '${cell.capacity_a2b_bps}', '${cell.capacity_bps}']) {
      expect(validateConfig(withRow({ ...combined, capacity })).diagnostics).toEqual([]);
    }
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
  ])('rejects a capacity that is %s', (_name, capacity) => {
    const result = validateConfig(withRow({ ...combined, capacity }));
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  });
  it('rejects a template capacity on a row without a series list', () => {
    const result = validateConfig(
      withRow({ kind: 'history', label: 'T', binding: up, capacity: '${cell.capacity_bps}' })
    );
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  });
  it('accepts a row height from 16 to 400 px on a combined or a single history row', () => {
    for (const height of [16, 80, 400]) {
      expect(validateConfig(withRow({ ...combined, height })).diagnostics).toEqual([]);
      expect(validateConfig(withRow({ kind: 'history', label: 'T', binding: up, height })).diagnostics).toEqual([]);
    }
  });
  it.each([
    ['below 16', { ...combined, height: 15 }],
    ['above 400', { ...combined, height: 401 }],
    ['not a number', { ...combined, height: 'tall' }],
    ['not finite', { ...combined, height: Infinity }],
    ['null', { ...combined, height: null }],
    ['on a value row', { kind: 'value', label: 'T', binding: up, height: 80 }],
    ['on a metadata row', { kind: 'metadata', label: 'T', path: 'cell.key', height: 80 }],
    ['on a drilldown row', { kind: 'drilldown', label: 'T', url: '/d/x', height: 80 }],
  ])('rejects a row height %s', (_name, row) => {
    const result = validateConfig(withRow(row));
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  });
  it('lists the bindings of the series for query references', () => {
    const config = validateConfig(withRow(combined)).config!;
    expect(displayBindings(config.overrides[0].display)).toEqual([
      { binding: up, path: 'hover.rows[0].series[0].binding' },
      { binding: down, path: 'hover.rows[0].series[1].binding' },
    ]);
    const unknown = withRow({
      ...combined,
      series: [combined.series[0], { ...combined.series[1], binding: { ...down, queryId: 'nope' } }],
    });
    expect(validateConfig(unknown).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unknown-query',
        path: 'overrides[0].display.hover.rows[0].series[1].binding.queryId',
      })
    );
  });
  it.each([
    ['binding and series', { ...combined, binding: up }],
    ['no binding and no series', { kind: 'history', label: 'T' }],
    ['no series', { ...combined, series: [] }],
    ['three series', { ...combined, series: [...combined.series, combined.series[0]] }],
    [
      'the same direction twice',
      { ...combined, series: [combined.series[0], { ...combined.series[1], direction: 'up' }] },
    ],
    ['an unknown direction', { ...combined, series: [{ binding: up, direction: 'left' }] }],
    ['series on a value row', { ...combined, kind: 'value' }],
    ['a capacity without series', { kind: 'history', label: 'T', binding: up, capacity: 5 }],
  ])('rejects %s', (_name, row) => {
    const result = validateConfig(withRow(row));
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-config' }));
  });
});
