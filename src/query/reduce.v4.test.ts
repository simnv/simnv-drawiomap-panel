import { FieldType } from '@grafana/data';
import { expect, it } from 'vitest';
import { alignUpdown, reduceAcross } from './reduce';
import type { Series } from './seriesIndex';

const series = (values: Array<number | null>, unit: string | undefined = 'bps', times = [0, 60, 120]): Series => ({
  refId: 'rate',
  labels: {},
  frameIndex: 0,
  fieldIndex: 1,
  times,
  values,
  field: { name: 'Value', type: FieldType.number, config: { unit }, values },
});

it.each([
  ['sum', 10],
  ['max', 6],
  ['mean', 5],
] as const)('reduces the last non-null values with %s', (how, value) => {
  expect(reduceAcross([series([1, 4, null]), series([2, 6, null])], how)).toEqual({ value, unit: 'bps' });
});
it('converts bit and byte rates to the unit of the first series', () => {
  expect(reduceAcross([series([1], 'Mbits'), series([500], 'Kbits')], 'sum')).toEqual({ value: 1.5, unit: 'Mbits' });
  expect(reduceAcross([series([1], 'MBs'), series([8], 'Mbits')], 'sum')).toEqual({ value: 2, unit: 'MBs' });
  expect(reduceAcross([series([1], 'Mibits'), series([512], 'Kibits')], 'sum')).toEqual({ value: 1.5, unit: 'Mibits' });
});
it('reports mixed units that cannot be converted', () => {
  expect(reduceAcross([series([1], 'bps'), series([50], 'percent')], 'sum')).toEqual({ mismatch: ['bps', 'percent'] });
  const noUnit = series([2]);
  noUnit.field.config = {};
  expect(reduceAcross([series([1], 'bps'), noUnit], 'sum')).toEqual({ mismatch: ['bps', ''] });
});
it('keeps equal non-rate units and handles missing values without a zero result', () => {
  expect(reduceAcross([series([1], 'percent'), series([50], 'percent')], 'max')).toEqual({
    value: 50,
    unit: 'percent',
  });
  expect(reduceAcross([series([null]), series([NaN, Infinity, null])], 'sum')).toEqual({ value: null, unit: 'bps' });
  expect(reduceAcross([], 'sum')).toEqual({ value: null, unit: undefined });
  expect(reduceAcross([series([null]), series([0])], 'mean')).toEqual({ value: 0, unit: 'bps' });
});
it.each([
  ['sum', [6, null, 10]],
  ['max', [5, null, 7]],
  ['mean', [3, null, 5]],
] as const)('aligns updown members with %s and preserves null gaps', (how, values) => {
  expect(alignUpdown([series([1, 2, 3]), series([5, null, 7])], how)).toEqual({ times: [0, 60, 120], values });
});
it('adds a gap where a member has no timestamp and sorts the union of times', () => {
  expect(alignUpdown([series([1, 3], 'bps', [0, 120]), series([2, 4], 'bps', [60, 120])], 'sum')).toEqual({
    times: [0, 60, 120],
    values: [null, null, 7],
  });
  expect(alignUpdown([], 'sum')).toEqual({ times: [], values: [] });
});
it('converts updown samples to the first unit before the reduce', () => {
  expect(alignUpdown([series([1], 'Mbits', [0]), series([500], 'Kbits', [0])], 'sum')).toEqual({
    times: [0],
    values: [1.5],
  });
});
