import { CoreApp, dateTime, FieldType, type DataQueryRequest, type TimeRange } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import type { Series } from '../query/snapshot';
import { cadenceOf, freshnessMs, staleCheck } from './freshness';

const range = (to = 100_000, rawTo: TimeRange['raw']['to'] = 'now'): TimeRange => ({
  from: dateTime(0),
  to: dateTime(to),
  raw: { from: 'now-1h', to: rawTo },
});
const request = (intervalMs = 0, interval?: string): DataQueryRequest => ({
  requestId: 'demo',
  app: CoreApp.Dashboard,
  startTime: 100_000,
  range: range(),
  timezone: 'utc',
  scopedVars: {},
  interval: '',
  intervalMs,
  targets: [Object.assign({ refId: 'status' }, { interval })],
});
const series = (times: number[], values: Array<number | null> = times.map(() => 1), refId = 'status'): Series => ({
  refId,
  labels: { name: 'node-1' },
  field: { name: 'Value', type: FieldType.number, config: {}, values },
  frameIndex: 0,
  fieldIndex: 1,
  times,
  values,
});

describe('cadenceOf', () => {
  it('uses the larger of the request step and the matching target minimum step', () => {
    expect(cadenceOf('status', request(15_000, '1m'), [])).toBe(60_000);
    expect(cadenceOf('status', request(90_000, '1m'), [])).toBe(90_000);
    expect(cadenceOf('other', request(15_000, '1m'), [])).toBe(15_000);
    expect(cadenceOf('status', request(0, '1m'), [])).toBe(60_000);
  });

  it('uses the median positive step of that refId when the intervals are absent or zero', () => {
    const samples = [series([0, 10_000, 30_000, 60_000]), series([0, 999_000], undefined, 'other')];
    expect(cadenceOf('status', undefined, samples)).toBe(20_000);
    expect(cadenceOf('status', request(0, '0s'), samples)).toBe(20_000);
    expect(cadenceOf('status', undefined, [series([0, 10_000, 40_000])])).toBe(20_000);
  });

  it('does not infer a step between distinct series or from invalid timestamps', () => {
    expect(cadenceOf('status', undefined, [series([1]), series([100_000])])).toBeUndefined();
    expect(cadenceOf('status', undefined, [series([0, 0, NaN])])).toBeUndefined();
    expect(cadenceOf('status', request(0, 'bad'), [series([0, 20_000])])).toBe(20_000);
  });
});

describe('freshnessMs', () => {
  it.each([
    ['5m', undefined, 300_000],
    ['1h', undefined, 3_600_000],
    ['10ms', undefined, 10],
    ['20s', undefined, 20_000],
    ['3x', 60_000, 180_000],
    ['1.5x', 20_000, 30_000],
    ['0s', undefined, 0],
    ['0x', 20_000, 0],
    ['3x', undefined, undefined],
    ['3x', 0, undefined],
    ['bad', 10, undefined],
  ])('resolves %s with cadence %s to %s ms', (policy, cadence, expected) => {
    expect(freshnessMs(policy, cadence)).toBe(expected);
  });
});

describe('staleCheck', () => {
  it('uses the oldest last non-null sample of all six status series', () => {
    const samples = Array.from({ length: 6 }, () => series([95_000, 100_000]));
    samples[5] = series([80_000, 100_000], [1, null]);
    expect(
      staleCheck(samples, { timeRange: range(), request: request(), freshnessMs: 10_000, instant: false })
    ).toEqual({ stale: false, deadline: 90_000 });
    expect(
      staleCheck(samples, {
        timeRange: range(100_000, dateTime(100_000)),
        freshnessMs: 10_000,
        instant: false,
      })
    ).toEqual({ stale: true });
  });

  it('uses strict age comparison at the end of an absolute range', () => {
    const ctx = { timeRange: range(100_000, '100000'), freshnessMs: 10_000, instant: false };
    expect(staleCheck([series([90_000])], ctx)).toEqual({ stale: false });
    expect(staleCheck([series([89_999])], ctx)).toEqual({ stale: true });
  });

  it('adds the relative range lag to the deadline and clamps a future range end to zero lag', () => {
    expect(
      staleCheck([series([95_000])], {
        timeRange: range(100_000, 'now-1h'),
        request: { ...request(), startTime: 3_700_000 },
        freshnessMs: 10_000,
        instant: false,
      })
    ).toEqual({ stale: false, deadline: 3_705_000 });
    expect(
      staleCheck([series([95_000])], {
        timeRange: range(200_000, 'now/d'),
        request: request(),
        freshnessMs: 10_000,
        instant: false,
      })
    ).toEqual({ stale: false, deadline: 105_000 });
  });

  it('uses zero lag when there is no request', () => {
    expect(
      staleCheck([series([95_000])], {
        timeRange: range(),
        freshnessMs: 10_000,
        instant: false,
      })
    ).toEqual({ stale: false, deadline: 105_000 });
  });

  it('does not check an instant-only target, including one with no timestamp', () => {
    const target = { refId: 'status', instant: true };
    const req = { ...request(), targets: [target] };
    expect(
      staleCheck([series([], [1])], {
        timeRange: range(),
        request: req,
        freshnessMs: 10_000,
        instant: target.instant && !('range' in target && target.range),
      })
    ).toEqual({ stale: false });
  });

  it('checks a target that has both instant and range results', () => {
    const target = { refId: 'status', instant: true, range: true };
    expect(
      staleCheck([series([95_000])], {
        timeRange: range(),
        request: { ...request(), targets: [target] },
        freshnessMs: 10_000,
        instant: target.instant && !target.range,
      })
    ).toEqual({ stale: false, deadline: 105_000 });
  });

  it('reports a missing last sample timestamp, so the caller can show missing', () => {
    const ctx = { timeRange: range(), freshnessMs: 10_000, instant: false };
    expect(staleCheck([series([], [1])], ctx)).toEqual({ stale: false, reason: 'Sample timestamp is missing' });
    expect(staleCheck([series([NaN], [1])], ctx)).toEqual({ stale: false, reason: 'Sample timestamp is missing' });
  });

  it('skips a cadence policy when there are fewer than two points and no interval', () => {
    const samples = [series([1])];
    expect(
      staleCheck(samples, {
        timeRange: range(),
        freshnessMs: freshnessMs('3x', cadenceOf('status', undefined, samples)),
        instant: false,
      })
    ).toEqual({ stale: false });
  });

  it('leaves empty and all-null uses to the no-data status check', () => {
    const ctx = { timeRange: range(), freshnessMs: 10_000, instant: false };
    expect(staleCheck([], ctx)).toEqual({ stale: false });
    expect(staleCheck([series([1], [null])], ctx)).toEqual({ stale: false });
  });
});
