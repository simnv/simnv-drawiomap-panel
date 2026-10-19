import { describe, expect, it } from 'vitest';
import type { StatusRule } from '../model/config';
import { evaluateStatus, summarizeStatuses } from './status';

const health: StatusRule = {
  kind: 'mapping',
  binding: { queryId: 'health', match: {}, reducer: 'last' },
  default: { state: 'normal', reason: 'Health check passed' },
  mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
};

describe('evaluateStatus', () => {
  it('treats zero as down only through the explicit health mapping', () => {
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'ready', value: 0 }], 1000)).toMatchObject({
      state: 'down',
      reason: 'Health check failed',
      queryIds: ['health'],
    });
  });
  it('uses deliberately configured ordered thresholds without inventing a failure for high utilization or zero', () => {
    const cpu: StatusRule = {
      ...health,
      kind: 'predicates',
      predicates: [
        { op: 'gte', value: 95, state: 'critical', reason: 'CPU critical' },
        { op: 'gte', value: 80, state: 'warning', reason: 'CPU high' },
      ],
    };
    const value = (value: number) => [{ queryId: 'health', availability: 'ready' as const, value }];
    expect(evaluateStatus(health, value(99), 1000).state).toBe('normal');
    expect(evaluateStatus(cpu, value(99), 1000)).toMatchObject({ state: 'critical', reason: 'CPU critical' });
    expect(evaluateStatus(cpu, value(85), 1000).state).toBe('warning');
    expect(evaluateStatus(cpu, value(0), 1000).state).toBe('normal');
  });
  it('distinguishes missing, stale and incomplete coverage using sample age and configured cadence', () => {
    const rule = { ...health, freshness: { expectedIntervalMs: 15000, staleAfterMs: 45000 } };
    const ready = { queryId: 'health', availability: 'ready' as const, value: 1, sampleAt: 10000 };
    expect(evaluateStatus(rule, [], 55000)).toMatchObject({
      state: 'missing',
      coverage: { available: 0, expected: 1 },
    });
    expect(evaluateStatus(rule, [ready], 55000).state).toBe('normal');
    expect(evaluateStatus(rule, [ready], 55001)).toMatchObject({
      state: 'stale',
      reason: 'Sample is stale (expected every 15000 ms)',
    });
    expect(evaluateStatus(health, [ready], 999999).state).toBe('normal');
    expect(evaluateStatus(rule, [ready, { queryId: 'health', availability: 'missing' }], 12000)).toMatchObject({
      state: 'missing',
      reason: 'Incomplete coverage (1/2 values available)',
      coverage: { available: 1, expected: 2 },
    });
    expect(evaluateStatus(rule, [{ ...ready, sampleAt: undefined }], 12000).state).toBe('missing');
    expect(evaluateStatus(rule, [{ ...ready, value: NaN }], 12000).state).toBe('missing');
  });
  it('keeps request failure and unsupported data distinct from an absent sample', () => {
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'error' }], 0).reason).toBe('Query failed');
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'unsupported' }], 0).reason).toBe(
      'Unsupported data'
    );
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'loading' }], 0).reason).toBe('Loading data');
  });
});

describe('summarizeStatuses', () => {
  it('merges equal causes by state and reason, counts distinct elements and keeps their IDs', () => {
    const down = evaluateStatus(health, [{ queryId: 'health', availability: 'ready', value: 0 }], 0);
    const different = evaluateStatus(
      { ...health, mappings: [{ value: 0, state: 'down', reason: 'Power lost' }] },
      [{ queryId: 'health', availability: 'ready', value: 0 }],
      0
    );
    const sameReasonDifferentCondition = evaluateStatus(
      {
        ...health,
        binding: { ...health.binding, queryId: 'other' },
        mappings: [{ value: 2, state: 'down', reason: 'Health check failed' }],
      },
      [{ queryId: 'other', availability: 'ready', value: 2 }],
      0
    );
    const normal = evaluateStatus(health, [{ queryId: 'health', availability: 'ready', value: 1 }], 0);
    const summary = summarizeStatuses([
      { cellId: 'a', status: down },
      { cellId: 'b', status: down },
      { cellId: 'c', status: different },
      { cellId: 'd', status: sameReasonDifferentCondition },
      { cellId: 'e', status: normal },
      { cellId: 'a', status: down },
    ]);
    expect(summary.map((s) => ({ state: s.state, reason: s.reason, cellIds: s.cellIds }))).toEqual([
      { state: 'down', reason: 'Health check failed', cellIds: ['a', 'b', 'd'] },
      { state: 'down', reason: 'Power lost', cellIds: ['c'] },
    ]);
    expect(summary[0].queryIds).toEqual(['health', 'other']);
  });
  it('gives one row to many elements without data, after more severe causes', () => {
    // each element has its own query, so the condition keys differ
    const missing = (i: number) =>
      evaluateStatus({ ...health, binding: { ...health.binding, queryId: `q${i}` } }, [], 0);
    const warning = evaluateStatus(
      { ...health, mappings: [{ value: 2, state: 'warning', reason: 'Probe slow' }] },
      [{ queryId: 'health', availability: 'ready', value: 2 }],
      0
    );
    const down = evaluateStatus(health, [{ queryId: 'health', availability: 'ready', value: 0 }], 0);
    const items = Array.from({ length: 26 }, (_, i) => ({ cellId: `cell-${i}`, status: missing(i) }));
    const summary = summarizeStatuses([...items, { cellId: 'w', status: warning }, { cellId: 'x', status: down }]);
    expect(summary.map((s) => [s.state, s.reason, s.cellIds.length])).toEqual([
      ['down', 'Health check failed', 1],
      ['warning', 'Probe slow', 1],
      ['missing', 'No data', 26],
    ]);
  });
  it('orders causes of the same severity by the number of elements', () => {
    const down = (reason: string) =>
      evaluateStatus(
        { ...health, mappings: [{ value: 0, state: 'down', reason }] },
        [{ queryId: 'health', availability: 'ready', value: 0 }],
        0
      );
    const summary = summarizeStatuses([
      { cellId: 'a', status: down('One') },
      { cellId: 'b', status: down('Two') },
      { cellId: 'c', status: down('Two') },
    ]);
    expect(summary.map((s) => s.reason)).toEqual(['Two', 'One']);
  });
});
