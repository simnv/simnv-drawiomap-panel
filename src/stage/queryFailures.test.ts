import { describe, expect, it } from 'vitest';
import type { DataQueryRequest } from '@grafana/data';
import { describeQueries, failureCause, failureLabel, failureText, groupQueryFailures } from './queryFailures';

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
