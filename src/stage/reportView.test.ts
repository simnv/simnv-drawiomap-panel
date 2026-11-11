import { describe, expect, it } from 'vitest';
import { REPORT_KINDS, type ReportEntry } from '../binding/report';
import { groupReport, reportGroupLine, reportLine, reportUse } from './reportView';

describe('groupReport', () => {
  it('combines one missing attribute across uses without changing the source entries', () => {
    const entries: ReportEntry[] = ['status', 'rows[0]', 'url'].map((use, i) => ({
      kind: 'missing-attr',
      cls: 'dev',
      path: `classes.dev.${use}`,
      attr: 'key',
      cellIds: i === 1 ? ['b', 'a'] : ['a', 'b'],
    }));
    const before = JSON.stringify(entries);
    const groups = groupReport(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toEqual(entries);
    expect(groups[0].uses.map((use) => use.label)).toEqual(['status', 'rows[0]', 'url']);
    expect(reportGroupLine(groups[0])).toBe('2 cells have no attribute `key`');
    expect(reportGroupLine(groups[0], true)).toBe(
      'dev: 2 cells have no attribute `key` (used by status, rows[0], url)'
    );
    expect(JSON.stringify(entries)).toBe(before);
  });

  const samples: Record<ReportEntry['kind'], ReportEntry> = {
    schema: { kind: 'schema', path: 'classes.dev.bad', message: 'Unknown field' },
    yaml: { kind: 'yaml', line: 2, message: 'Bad indent' },
    'outdated-config': { kind: 'outdated-config', version: 3 },
    'class-no-match': { kind: 'class-no-match', cls: 'dev', cellIds: ['a'] },
    'class-cycle': { kind: 'class-cycle', cls: 'dev' },
    'class-unknown-parent': { kind: 'class-unknown-parent', cls: 'dev' },
    'class-invalid-parent': { kind: 'class-invalid-parent', cls: 'dev' },
    'unknown-ref': { kind: 'unknown-ref', cls: 'dev', path: 'classes.dev.status', refId: 'up' },
    'unknown-class': { kind: 'unknown-class', cellIds: ['a'], bind: 'absent' },
    'unknown-override': { kind: 'unknown-override', cellId: 'a' },
    'missing-attr': { kind: 'missing-attr', cls: 'dev', path: 'classes.dev.status', attr: 'key', cellIds: ['a'] },
    'matcher-error': {
      kind: 'matcher-error',
      cls: 'dev',
      path: 'classes.dev.status',
      text: '/(/',
      message: 'Bad regex',
      cellIds: ['a'],
    },
    'template-unresolved': { kind: 'template-unresolved', cls: 'dev', path: 'classes.dev.url', cellIds: ['a'] },
    'query-unavailable': { kind: 'query-unavailable', refId: 'up', state: 'error', message: 'Failed' },
    'no-series': { kind: 'no-series', cls: 'dev', use: 'classes.dev.status', cellIds: ['a'] },
    'many-series': { kind: 'many-series', cls: 'dev', use: 'classes.dev.status', cells: [{ id: 'a', count: 2 }] },
    'orphan-series': { kind: 'orphan-series', refId: 'up', labels: [{ job: 'node-a' }], more: 0 },
    'many-fields': { kind: 'many-fields', refId: 'up', message: 'Two fields' },
    'invalid-series': { kind: 'invalid-series', refId: 'up', message: 'Invalid field' },
    'duplicate-series': { kind: 'duplicate-series', refId: 'up', labels: { job: 'node-a' } },
    'unit-mismatch': {
      kind: 'unit-mismatch',
      cls: 'dev',
      use: 'classes.dev.status',
      units: ['s', 'bps'],
      cellIds: ['a'],
    },
    'capacity-fallback': { kind: 'capacity-fallback', cls: 'dev', reason: 'No value', cellIds: ['a'] },
    'bad-cap': { kind: 'bad-cap', attr: 'cap', value: 'fast', cellIds: ['a'] },
    'cap-conflict': { kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['a'] },
    'no-edge-ends': { kind: 'no-edge-ends', reason: 'No XML', cellIds: ['a'] },
    'unused-field': { kind: 'unused-field', cls: 'dev', field: 'up', cellIds: ['a'] },
    'class-no-cells': { kind: 'class-no-cells', cls: 'dev' },
  };

  it.each(REPORT_KINDS)('combines equal causes for %s, including different uses', (kind) => {
    const first = samples[kind];
    const second = { ...first };
    if ('path' in second && kind !== 'schema') {
      second.path = 'classes.dev.rows[0]';
    }
    if ('use' in second) {
      second.use = 'classes.dev.rows[0]';
    }
    if (second.kind === 'unused-field') {
      second.field = 'down';
    }
    const groups = groupReport([first, second]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toEqual([first, second]);
  });

  it.each(REPORT_KINDS)('keeps different causes separate for %s', (kind) => {
    const first = samples[kind];
    const second = { ...first };
    if ('cls' in second) {
      second.cls = 'other';
    } else if ('refId' in second) {
      second.refId = 'other';
    } else if ('message' in second) {
      second.message = 'Another error';
    } else if (second.kind === 'outdated-config') {
      second.version = 2;
    } else if (second.kind === 'unknown-class') {
      second.bind = 'other';
    } else if (second.kind === 'unknown-override') {
      second.cellId = 'other';
    } else if (second.kind === 'bad-cap') {
      second.value = 'slow';
    } else if (second.kind === 'cap-conflict') {
      second.capacity = '3G';
    } else if (second.kind === 'no-edge-ends') {
      second.reason = 'Other reason';
    }
    expect(groupReport([first, second])).toHaveLength(2);
  });

  it.each([
    'missing-attr',
    'matcher-error',
    'template-unresolved',
    'no-series',
    'unit-mismatch',
    'capacity-fallback',
    'unused-field',
    'bad-cap',
    'cap-conflict',
  ] as const)('does not combine different cell sets for %s', (kind) => {
    const first = samples[kind];
    expect(groupReport([first, { ...first, cellIds: ['b'] } as ReportEntry])).toHaveLength(2);
  });

  it('keeps different attributes, refIds, regex errors, units, counts and fallback reasons separate', () => {
    const pairs: Array<[ReportEntry, ReportEntry]> = [
      [samples['missing-attr'], { ...samples['missing-attr'], attr: 'port' } as ReportEntry],
      [samples['unknown-ref'], { ...samples['unknown-ref'], refId: 'down' } as ReportEntry],
      [samples['matcher-error'], { ...samples['matcher-error'], text: '/[/' } as ReportEntry],
      [samples['matcher-error'], { ...samples['matcher-error'], message: 'Other error' } as ReportEntry],
      [samples['unit-mismatch'], { ...samples['unit-mismatch'], units: ['s', 'bytes'] } as ReportEntry],
      [samples['many-series'], { ...samples['many-series'], cells: [{ id: 'a', count: 3 }] } as ReportEntry],
      [samples['capacity-fallback'], { ...samples['capacity-fallback'], reason: 'No unit' } as ReportEntry],
      [samples.schema, { kind: 'schema', path: 'classes.dev.other', message: 'Unknown field' }],
      [samples.yaml, { kind: 'yaml', line: 3, message: 'Bad indent' }],
    ];
    for (const pair of pairs) {
      expect(groupReport(pair)).toHaveLength(2);
    }
  });

  it('sorts blocking kinds first, then keeps the source order for the rest', () => {
    const groups = groupReport([
      samples['cap-conflict'],
      samples['bad-cap'],
      samples['unused-field'],
      samples['no-series'],
      samples['matcher-error'],
      samples['unknown-ref'],
      samples['missing-attr'],
      samples['many-series'],
    ]);
    expect(groups.map((group) => group.entries[0].kind)).toEqual([
      'missing-attr',
      'unknown-ref',
      'matcher-error',
      'no-series',
      'cap-conflict',
      'bad-cap',
      'unused-field',
      'many-series',
    ]);
  });

  it('compares unit sets and per-cell counts independent of order', () => {
    expect(
      groupReport([
        {
          kind: 'many-series',
          cls: 'dev',
          use: 'classes.dev.status',
          cells: [
            { id: 'a', count: 2 },
            { id: 'b', count: 3 },
          ],
        },
        {
          kind: 'many-series',
          cls: 'dev',
          use: 'classes.dev.rows[0]',
          cells: [
            { id: 'b', count: 3 },
            { id: 'a', count: 2 },
          ],
        },
      ])
    ).toHaveLength(1);
    expect(
      groupReport([
        samples['unit-mismatch'],
        { kind: 'unit-mismatch', cls: 'dev', use: 'classes.dev.rows[0]', units: ['bps', 's'], cellIds: ['a'] },
      ])
    ).toHaveLength(1);
  });

  it('keeps distinct capacity attributes and conflict values in separate groups', () => {
    const entries: ReportEntry[] = [
      { kind: 'bad-cap', attr: 'cap', value: 'fast', cellIds: ['a'] },
      { kind: 'bad-cap', attr: 'capacity', value: 'fast', cellIds: ['a'] },
      { kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['a'] },
      { kind: 'cap-conflict', cap: '3G', capacity: '2G', cellIds: ['a'] },
      { kind: 'cap-conflict', cap: '1G', capacity: '3G', cellIds: ['a'] },
    ];
    expect(groupReport(entries)).toHaveLength(5);
  });

  it('reads row labels with quoted class names and keeps override paths explicit', () => {
    const config = {
      version: 4 as const,
      freshness: '1h',
      overrides: {},
      classes: { 'dev.1': { rows: [{ kind: 'value' as const, query: 'load', label: 'load 1m' }] } },
    };
    expect(reportUse('classes["dev.1"].rows[0]', config)).toBe('rows[0] (load 1m)');
    expect(reportUse('classes["dev.1"].status', config)).toBe('status');
    expect(reportUse('overrides["dev.1"].status', config)).toBe('overrides["dev.1"].status');
  });

  it.each([0, 1, 2])('uses correct grammar for %s cells and series', (count) => {
    const cellIds = Array.from({ length: count }, (_, i) => `node-${i}`);
    const cells = `${count} ${count === 1 ? 'cell' : 'cells'}`;
    const have = count === 1 ? 'has' : 'have';
    const entries: Array<[ReportEntry, string]> = [
      [
        { kind: 'missing-attr', cls: 'dev', path: 'classes.dev.status', attr: 'key', cellIds },
        `${cells} ${have} no attribute \`key\``,
      ],
      [{ kind: 'no-series', cls: 'dev', use: 'classes.dev.status', cellIds }, `${cells} ${have} no series`],
      [
        { kind: 'many-series', cls: 'dev', use: 'classes.dev.status', cells: cellIds.map((id) => ({ id, count: 2 })) },
        `${cells} ${have} more than one series`,
      ],
      [
        { kind: 'template-unresolved', cls: 'dev', path: 'classes.dev.url', cellIds },
        `The template does not resolve for ${cells}`,
      ],
      [
        { kind: 'unknown-class', bind: 'absent', cellIds },
        `${cells} ${count === 1 ? 'binds' : 'bind'} unknown class absent`,
      ],
      [
        { kind: 'unused-field', cls: 'dev', field: 'up', cellIds },
        `Not used on ${cells} that ${count === 1 ? 'is' : 'are'} not ${count === 1 ? 'an edge' : 'edges'}`,
      ],
      [
        { kind: 'no-edge-ends', reason: 'No XML', cellIds },
        `${count} ${count === 1 ? 'edge has' : 'edges have'} no ends: No XML`,
      ],
      [{ kind: 'bad-cap', attr: 'cap', value: 'fast', cellIds }, `cap "fast" is not a capacity (${cells})`],
      [{ kind: 'bad-cap', attr: 'capacity', value: 'fast', cellIds }, `capacity "fast" is not a capacity (${cells})`],
      [
        { kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds },
        `cap "1G" and capacity "2G" differ, cap wins over the attribute capacity (${cells})`,
      ],
      [
        { kind: 'orphan-series', refId: 'up', labels: [], more: count },
        `up: ${count} series ${count === 1 ? 'selects' : 'select'} no cell`,
      ],
    ];
    for (const [entry, expected] of entries) {
      expect(reportGroupLine(groupReport([entry])[0])).toBe(expected);
      expect(reportLine(entry)).not.toMatch(/1 cells|1 edges|1 series select /);
    }
  });
});
