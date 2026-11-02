import { FieldType } from '@grafana/data';
import { expect, it } from 'vitest';
import { alignUpdown, reduceAcross } from '../query/reduce';
import type { Series } from '../query/seriesIndex';
import { directionHistory } from './rowData';

const series = (times: number[], values: Array<number | null>, unit = 'bps'): Series => ({
  refId: 'rate',
  labels: {},
  frameIndex: 0,
  fieldIndex: 1,
  times,
  values,
  field: { name: 'Value', type: FieldType.number, config: { unit }, values },
});
const snapshot = { state: 'ready' as const, frames: [], fetchedAt: 1, fromCache: false };

/** The general path: align and reduce, the way directionHistory did before the one-series shortcut. */
function general(item: Series, how: 'sum' | 'max' | 'mean') {
  const aligned = alignUpdown([item], how);
  const reduced = reduceAcross([item], how);
  let last = aligned.values.length - 1;
  while (last >= 0 && aligned.values[last] === null) {
    last--;
  }
  return {
    times: aligned.times,
    values: aligned.values,
    latest: 'mismatch' in reduced || reduced.value === null ? undefined : reduced.value,
    sampleAt: last >= 0 ? aligned.times[last] : undefined,
  };
}

it.each([
  ['plain values', [0, 60, 120], [1, 2, 3]],
  ['a trailing null', [0, 60, 120], [1, 2, null]],
  ['a leading null', [0, 60, 120], [null, 2, 3]],
  ['only nulls', [0, 60], [null, null]],
  ['one sample', [5], [7]],
  ['no sample', [], []],
])('gives one series as the align gives it: %s', (_name, times, values) => {
  for (const how of ['sum', 'max', 'mean'] as const) {
    const item = series(times, values);
    const model = directionHistory({ snapshot, series: [item] }, how);
    const expected = general(item, how);
    expect(model).toMatchObject({ state: 'ready', timestamps: expected.times, values: expected.values });
    expect(model.state === 'ready' && model.latestValue).toBe(expected.latest);
    expect(model.state === 'ready' && model.sampleAt).toBe(expected.sampleAt);
    expect(model.state === 'ready' && model.timeField.values).toEqual(expected.times);
    expect(model.state === 'ready' && model.field.values).toEqual(expected.values);
  }
});

it('reads the arrays of one series without a copy, and aligns two series', () => {
  const one = series([0, 60], [1, 2]);
  const model = directionHistory({ snapshot, series: [one] });
  expect(model.state === 'ready' && model.values).toBe(one.values);
  expect(model.state === 'ready' && model.timestamps).toBe(one.times);
  const pair = directionHistory({ snapshot, series: [one, series([60, 120], [3, 4])] }, 'sum');
  expect(pair).toMatchObject({ timestamps: [0, 60, 120], values: [null, 5, null], latestValue: 6, sampleAt: 60 });
});
