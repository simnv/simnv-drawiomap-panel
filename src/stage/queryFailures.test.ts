import { describe, expect, it } from 'vitest';
import type { DataQueryRequest } from '@grafana/data';
import type { ReportEntry } from '../binding/report';
import {
  describeQueries,
  failedLabels,
  failedQueries,
  failureCause,
  failureLabel,
  failureText,
  groupQueryFailures,
  otherEntries,
  PANEL_REQUEST,
} from './queryFailures';

const request = (targets: Array<Record<string, unknown>>) => ({ targets }) as unknown as DataQueryRequest;
const NAMES: Record<string, string> = { vm: 'VictoriaMetrics', pg: 'Inventory DB' };
const name = (ref: unknown) => (typeof ref === 'string' ? NAMES[ref] : NAMES[(ref as { uid: string }).uid]);

describe('describeQueries', () => {
  it('names the datasource of each refId and applies the variables to its expression', () => {
    const info = describeQueries(
      request([
        { refId: 'up', datasource: { uid: 'vm', type: 'prometheus' }, expr: 'up{site="$site"}' },
        { refId: 'inv', datasource: { uid: 'pg', type: 'postgres' }, rawSql: 'SELECT *\n  FROM ports' },
      ]),
      name,
      (t) => t.replace('$site', 'lab')
    );
    expect(info('up')).toEqual({ datasource: 'VictoriaMetrics', expression: 'up{site="lab"}' });
    expect(info('inv')).toEqual({ datasource: 'Inventory DB', expression: 'SELECT * FROM ports' });
  });

  it('falls back to the uid, then to the panel datasource, and has no expression for a query with no text', () => {
    const info = describeQueries(
      request([
        { refId: 'a', datasource: { uid: 'gone', type: 'prometheus' }, expr: '' },
        { refId: 'b', expr: 'up' },
      ]),
      name
    );
    expect(info('a')).toEqual({ datasource: 'gone', expression: undefined });
    expect(info('b').datasource).toBe('The panel datasource');
    expect(describeQueries(undefined, name)('x')).toEqual({
      datasource: 'The panel datasource',
      expression: undefined,
    });
  });

  it('names a datasource given as a variable by the datasource it selects, with the scoped variables', () => {
    const seen: unknown[] = [];
    const info = describeQueries(
      {
        ...request([{ refId: 'a', datasource: { uid: '${ds}' }, expr: 'rate(x[$__interval])' }]),
        scopedVars: { __interval: { value: '1m' } },
      } as never,
      name,
      (t, scoped) => {
        seen.push(scoped);
        return t.replace('${ds}', 'vm').replace('$__interval', String(scoped?.__interval?.value));
      }
    );
    expect(info('a')).toEqual({ datasource: 'VictoriaMetrics', expression: 'rate(x[1m])' });
    expect(seen[0]).toEqual({ __interval: { value: '1m' } });
  });

  it('cuts a long expression', () => {
    const expr = `sum(${'x'.repeat(300)})`;
    const { expression } = describeQueries(request([{ refId: 'a', expr }]), name)('a');
    expect(expression).toHaveLength(160);
    expect(expression!.endsWith('…')).toBe(true);
  });
});

describe('failureCause', () => {
  it.each([
    [
      'Post "http://vm:8428/api/v1/query_range": dial tcp: lookup vm on 127.0.0.11:53: no such host',
      'is not reachable (host not found)',
    ],
    ['dial tcp 192.0.2.10:8428: connect: connection refused', 'is not reachable (connection refused)'],
    ['context deadline exceeded (Client.Timeout exceeded while awaiting headers)', 'does not answer (time-out)'],
    ['401 Unauthorized', 'refuses the access (401, check the credentials)'],
    ['403 Forbidden', 'refuses the access (403)'],
    ['datasource not found', 'is not found (check the datasource of the query)'],
    ['502 Bad Gateway', 'has a server error (502)'],
    ['bad_data: 1:5: parse error: unexpected "}"', 'rejects the query (check the query text)'],
    ['parse error at line 1, col 500: unexpected "}"', 'rejects the query (check the query text)'],
    ['query timed out in expression evaluation', 'stops the query (the query takes too long)'],
    ['pq: column "id" does not exist: SELECT * FROM t WHERE id = 401 LIMIT 500', 'cannot run the query'],
    ['request failed, status code: 502', 'has a server error (502)'],
    ['Invalid API key', 'refuses the access (401, check the credentials)'],
    [
      'error when executing query="vector(" on the time range: singleExpr: unexpected token ""; unparsed data: ""',
      'rejects the query (check the query text)',
    ],
    ['SyntaxError: JSON parse error: Unexpected token < in JSON at position 0', 'cannot run the query'],
    ['something else', 'cannot run the query'],
  ])('%s', (message, cause) => {
    expect(failureCause(message)).toBe(cause);
  });
});

describe('groupQueryFailures', () => {
  const info = describeQueries(
    request([
      { refId: 'up', datasource: { uid: 'vm' }, expr: 'up' },
      { refId: 'load', datasource: { uid: 'vm' }, expr: 'node_load1' },
      { refId: 'inv', datasource: { uid: 'pg' }, rawSql: 'SELECT 1' },
    ]),
    name
  );
  const down = 'dial tcp: lookup vm: no such host';

  it('gives one group for each datasource and cause, with each refId once', () => {
    const groups = groupQueryFailures(
      [
        { refId: 'up', message: down },
        { refId: 'load', message: down },
        { refId: 'up', message: down },
        { refId: 'inv', message: '401 Unauthorized' },
      ],
      info
    );
    expect(groups).toEqual([
      {
        datasource: 'VictoriaMetrics',
        cause: 'is not reachable (host not found)',
        details: down,
        queries: [
          { refId: 'up', expression: 'up' },
          { refId: 'load', expression: 'node_load1' },
        ],
      },
      {
        datasource: 'Inventory DB',
        cause: 'refuses the access (401, check the credentials)',
        details: '401 Unauthorized',
        queries: [{ refId: 'inv', expression: 'SELECT 1' }],
      },
    ]);
    expect(failureLabel(groups[0])).toBe('VictoriaMetrics is not reachable');
    expect(failureLabel(groups[1])).toBe('Inventory DB refuses the access');
  });

  it('writes the cause, one line for each query and the error once', () => {
    const [group] = groupQueryFailures(
      [
        { refId: 'up', message: down },
        { refId: 'load', message: down },
      ],
      info
    );
    expect(failureText(group).split('\n')).toEqual([
      'VictoriaMetrics is not reachable (host not found): 2 queries fail',
      '• up: up',
      '• load: node_load1',
      `Error: ${down}`,
    ]);
  });

  it('lists at most 8 queries and counts the rest', () => {
    const failed = Array.from({ length: 11 }, (_, i) => ({ refId: `q${i}`, message: down }));
    const lines = failureText(groupQueryFailures(failed, () => ({ datasource: 'VM' }))[0]).split('\n');
    expect(lines[0]).toBe('VM is not reachable (host not found): 11 queries fail');
    expect(lines.slice(1, -1)).toHaveLength(9);
    expect(lines[9]).toBe('• and 3 more');
    expect(lines[1]).toBe('• q0');
  });
});

describe('failedQueries', () => {
  const unavailable = (refId: string): ReportEntry => ({
    kind: 'query-unavailable',
    refId,
    state: 'error',
    message: 'Panel query failed.',
  });
  const report = [
    unavailable('a'),
    unavailable('b'),
    { kind: 'query-unavailable', refId: 'c', state: 'loading', message: 'Loading data' } as ReportEntry,
  ];

  it('gives each refId its own error, else the request-wide one, and skips a query that loads', () => {
    expect(failedQueries(report, { errors: [{ refId: 'a', message: 'own' }, { message: 'wide' }] })).toEqual([
      { refId: 'a', message: 'own' },
      { refId: 'b', message: 'wide', requestWide: true },
    ]);
  });

  it('reads the deprecated error of Grafana 12.3 and 12.4, and keeps the report text with no error', () => {
    expect(failedQueries([unavailable('a')], { error: { message: 'dial tcp: no such host' } })).toEqual([
      { refId: 'a', message: 'dial tcp: no such host', requestWide: true },
    ]);
    expect(failedQueries([unavailable('a')], {})).toEqual([
      { refId: 'a', message: 'Panel query failed.', requestWide: true },
    ]);
  });
});

describe('a failed query that no cell uses', () => {
  const used: ReportEntry = { kind: 'query-unavailable', refId: 'up', state: 'error', message: 'Panel query failed.' };
  const targets = [
    { refId: 'up', expr: 'up' },
    { refId: 'broken', expr: 'rate(up[5m]' },
    { refId: 'fine', expr: 'up' },
    { refId: 'off', expr: 'x', hide: true },
  ];

  it('comes from the errors of the request, marked unused; a query with no error and a hidden query do not', () => {
    expect(
      failedQueries([used], {
        errors: [
          { refId: 'up', message: 'own' },
          { refId: 'broken', message: 'bad_data: parse error' },
          { refId: 'off', message: 'x' },
        ],
        request: { targets },
      })
    ).toEqual([
      { refId: 'up', message: 'own' },
      { refId: 'broken', message: 'bad_data: parse error', unused: true },
    ]);
  });

  it('takes a request-wide error for each query of the request', () => {
    expect(
      failedQueries([], { error: { message: 'connection refused' }, request: { targets } }).map((f) => f.refId)
    ).toEqual(['up', 'broken', 'fine']);
  });

  it('is marked in its query line', () => {
    const groups = groupQueryFailures([{ refId: 'broken', message: 'bad_data: parse error', unused: true }], () => ({
      datasource: 'VM',
      expression: 'rate(up[5m]',
    }));
    expect(failureText(groups[0]).split('\n')[1]).toBe('• broken (not used): rate(up[5m]');
  });
});

describe('a request-wide error', () => {
  const info = describeQueries(
    request([
      { refId: 'up', datasource: { uid: 'vm' }, expr: 'up' },
      { refId: 'inv', datasource: { uid: 'pg' }, rawSql: 'SELECT 1' },
    ]),
    name
  );

  it('names no datasource when its queries use more than one', () => {
    const groups = groupQueryFailures(
      [
        { refId: 'up', message: 'connection refused', requestWide: true },
        { refId: 'inv', message: 'connection refused', requestWide: true },
      ],
      info
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].datasource).toBe(PANEL_REQUEST);
    expect(failedLabels(groups)('inv')).toBe('A datasource of the panel is not reachable');
  });

  it('names the datasource when all its queries use one', () => {
    const [group] = groupQueryFailures([{ refId: 'up', message: 'connection refused', requestWide: true }], info);
    expect(group.datasource).toBe('VictoriaMetrics');
  });
});

describe('otherEntries', () => {
  const capacity: ReportEntry = { kind: 'capacity-fallback', cls: 'link', reason: 'query failed', cellIds: ['l1'] };
  const noSeries: ReportEntry = { kind: 'capacity-fallback', cls: 'link', reason: 'no series', cellIds: ['l1'] };
  const failedEntry: ReportEntry = { kind: 'query-unavailable', refId: 'a', state: 'error', message: 'x' };

  it('drops the failed queries, and a capacity "query failed" only when a failed query shows', () => {
    expect(otherEntries([failedEntry, capacity, noSeries], [{ refId: 'a', message: 'x' }])).toEqual([noSeries]);
    expect(otherEntries([capacity], [])).toEqual([capacity]);
  });
});
