import { describe, expect, it } from 'vitest';
import type { StatusRule } from '../model/config';
import { evaluateStatus, statusLevel, summarizeStatuses } from './status';

const health: StatusRule = {
  kind: 'mapping',
  binding: { queryId: 'health', match: {}, reducer: 'last' },
  default: { state: 'normal', reason: 'Health check passed' },
  mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
};

describe('evaluateStatus', () => {
  it('an invalid freshness policy gives missing "Invalid freshness policy", also for fresh data', () => {
    const rule = { ...health, freshness: { expectedIntervalMs: 15000, staleAfterMs: 1000 } };
    const fresh = { queryId: 'health', availability: 'ready' as const, value: 1, sampleAt: 999 };
    expect(evaluateStatus(rule, [fresh])).toEqual({
      view: expect.objectContaining({ state: 'missing', reason: 'Invalid freshness policy' }),
    });
    const old = { ...fresh, sampleAt: 0 };
    expect(evaluateStatus(rule, [old]).view).toMatchObject({ state: 'missing', reason: 'Invalid freshness policy' });
  });
  it('treats zero as down only through the explicit health mapping', () => {
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'ready', value: 0 }]).view).toMatchObject({
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
    expect(evaluateStatus(health, value(99)).view.state).toBe('normal');
    expect(evaluateStatus(cpu, value(99)).view).toMatchObject({ state: 'critical', reason: 'CPU critical' });
    expect(evaluateStatus(cpu, value(85)).view.state).toBe('warning');
    expect(evaluateStatus(cpu, value(0)).view.state).toBe('normal');
  });
  it('distinguishes missing and incomplete coverage, and gives the stale view with the moment it applies', () => {
    const rule = { ...health, freshness: { expectedIntervalMs: 15000, staleAfterMs: 45000 } };
    const ready = { queryId: 'health', availability: 'ready' as const, value: 1, sampleAt: 10000 };
    expect(evaluateStatus(rule, [])).toEqual({
      view: expect.objectContaining({ state: 'missing', coverage: { available: 0, expected: 1 } }),
    });
    // the view is the fresh one; the stale view waits for the clock, no matter how old the sample is
    const evaluated = evaluateStatus(rule, [ready]);
    expect(evaluated.view.state).toBe('normal');
    expect(evaluated.stale).toEqual({
      after: 55000,
      view: {
        state: 'stale',
        reason: 'Sample is stale (expected every 15000 ms)',
        queryIds: ['health'],
        conditionKey: JSON.stringify([
          'health',
          'mapping',
          [15000, 45000],
          'stale',
          'Sample is stale (expected every 15000 ms)',
        ]),
        coverage: { available: 1, expected: 1 },
      },
    });
    // the oldest sample decides the moment
    expect(evaluateStatus(rule, [ready, { ...ready, sampleAt: 4000 }]).stale?.after).toBe(49000);
    // without a policy, sample age means nothing
    expect(evaluateStatus(health, [ready]).stale).toBeUndefined();
    expect(evaluateStatus(rule, [ready, { queryId: 'health', availability: 'missing' }])).toEqual({
      view: expect.objectContaining({
        state: 'missing',
        reason: 'Incomplete coverage (1/2 values available)',
        coverage: { available: 1, expected: 2 },
      }),
    });
    expect(evaluateStatus(rule, [{ ...ready, sampleAt: undefined }])).toEqual({
      view: expect.objectContaining({ state: 'missing', reason: 'Sample timestamp is missing' }),
    });
    expect(evaluateStatus(rule, [{ ...ready, value: NaN }]).view.state).toBe('missing');
  });
  it('keeps request failure and unsupported data distinct from an absent sample', () => {
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'error' }]).view.reason).toBe('Query failed');
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'unsupported' }]).view.reason).toBe(
      'Unsupported data'
    );
    expect(evaluateStatus(health, [{ queryId: 'health', availability: 'loading' }]).view.reason).toBe('Loading data');
  });
});

describe('summarizeStatuses', () => {
  const viewOf = (rule: StatusRule, values: Parameters<typeof evaluateStatus>[1]) => evaluateStatus(rule, values).view;
  it('merges equal causes by state and reason, counts distinct elements and keeps their IDs', () => {
    const down = viewOf(health, [{ queryId: 'health', availability: 'ready', value: 0 }]);
    const different = viewOf({ ...health, mappings: [{ value: 0, state: 'down', reason: 'Power lost' }] }, [
      { queryId: 'health', availability: 'ready', value: 0 },
    ]);
    const sameReasonDifferentCondition = viewOf(
      {
        ...health,
        binding: { ...health.binding, queryId: 'other' },
        mappings: [{ value: 2, state: 'down', reason: 'Health check failed' }],
      },
      [{ queryId: 'other', availability: 'ready', value: 2 }]
    );
    const normal = viewOf(health, [{ queryId: 'health', availability: 'ready', value: 1 }]);
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
    const missing = (i: number) => viewOf({ ...health, binding: { ...health.binding, queryId: `q${i}` } }, []);
    const warning = viewOf({ ...health, mappings: [{ value: 2, state: 'warning', reason: 'Probe slow' }] }, [
      { queryId: 'health', availability: 'ready', value: 2 },
    ]);
    const down = viewOf(health, [{ queryId: 'health', availability: 'ready', value: 0 }]);
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
      viewOf({ ...health, mappings: [{ value: 0, state: 'down', reason }] }, [
        { queryId: 'health', availability: 'ready', value: 0 },
      ]);
    const summary = summarizeStatuses([
      { cellId: 'a', status: down('One') },
      { cellId: 'b', status: down('Two') },
      { cellId: 'c', status: down('Two') },
    ]);
    expect(summary.map((s) => s.reason)).toEqual(['Two', 'One']);
  });
});

describe('statusLevel', () => {
  it('groups the states into the levels that the paint, the text and the legend show', () => {
    expect(statusLevel('down')).toBe('critical');
    expect(statusLevel('critical')).toBe('critical');
    expect(statusLevel('warning')).toBe('warning');
    expect(statusLevel('stale')).toBe('warning');
    expect(statusLevel('missing')).toBe('missing');
    expect(statusLevel('normal')).toBe('normal');
  });
});
