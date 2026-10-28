import { FieldType, type DataFrame, type Labels } from '@grafana/data';
import { expect, expectTypeOf, it } from 'vitest';
import { equalityKey, indexSeries } from './seriesIndex';
import type { QuerySnapshot } from './snapshot';
import type { QuerySnapshot as LegacySnapshot } from './types';

const frame = (
  labels: Labels,
  times = [0, 60000, 120000],
  values: Array<number | null> = [1, 2, 3],
  name = 'Value'
): DataFrame => ({
  refId: 'rate',
  length: times.length,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: times },
    { name, type: FieldType.number, config: { unit: 'bps' }, labels, values },
  ],
});

it('sorts canonical label strings by code unit, then frame and field order', () => {
  const frames = [
    frame({ z: 'x', a: 'b' }),
    frame({ a: 'a' }),
    frame({ a: 'b', z: 'x' }, [0], [9], 'Other'),
    frame({ a: 'Z' }),
  ];
  const { series } = indexSeries(frames, 'rate');
  expect(series.map((s) => [s.labels, s.frameIndex, s.fieldIndex])).toEqual([
    [{ a: 'Z' }, 3, 1],
    [{ a: 'a' }, 1, 1],
    [{ z: 'x', a: 'b' }, 0, 1],
    [{ a: 'b', z: 'x' }, 2, 1],
  ]);
  expect(series[2].field).toBe(frames[0].fields[1]);
});

it.each([false, true])('keeps distinct labels with the same canonical string separate, reversed=%s', (reversed) => {
  const frames = [frame({ a: 'x', b: 'y' }, [0], [1]), frame({ 'a="x",b': 'y' }, [0], [9])];
  if (reversed) {
    frames.reverse();
  }
  const { series, report } = indexSeries(frames, 'rate');
  expect(series).toHaveLength(2);
  expect(series.map((s) => [s.labels, s.times, s.values])).toEqual(
    frames.map((f) => [f.fields[1].labels, [0], f.fields[1].values])
  );
  expect(report).toEqual([]);
});

it('merges equal labels regardless of their key order', () => {
  const frames = [frame({ a: 'x', b: 'y' }, [0], [1]), frame({ b: 'y', a: 'x' }, [60000], [9])];
  expect(indexSeries(frames, 'rate')).toMatchObject({
    series: [{ labels: { a: 'x', b: 'y' }, times: [0, 60000], values: [1, 9] }],
    report: [],
  });
});

it('uses only the first numeric field and reports many-fields once per refId', () => {
  const frames = [frame({ key: 'node-a' }), frame({ key: 'node-b' })];
  for (const f of frames) {
    f.fields.push({ ...f.fields[1], name: 'Other' });
  }
  const { series, report } = indexSeries(frames, 'rate');
  expect(series).toHaveLength(2);
  expect(series.map((s) => s.field.name)).toEqual(['Value', 'Value']);
  expect(report).toEqual([{ kind: 'many-fields', refId: 'rate', message: expect.any(String) }]);
});

it('filters refIds and keeps all-null series', () => {
  const other = { ...frame({ key: 'node-b' }), refId: 'other' };
  expect(indexSeries([other, frame({ key: 'node-a' }, [0], [null])], 'rate').series).toMatchObject([
    { refId: 'rate', labels: { key: 'node-a' }, values: [null] },
  ]);
  expect(indexSeries([other], 'rate')).toEqual({ series: [], report: [] });
});

it('counts a repeated delivery once without changing samples or field config', () => {
  const f = frame({ key: 'node-a' });
  const before = structuredClone(f);
  expect(indexSeries([f, structuredClone(f)], 'rate')).toMatchObject({
    series: [{ times: [0, 60000, 120000], values: [1, 2, 3] }],
    report: [],
  });
  expect(indexSeries([f, f], 'rate').series).toHaveLength(1);
  expect(f.fields.map(({ values, config }) => ({ values, config }))).toEqual(
    before.fields.map(({ values, config }) => ({ values, config }))
  );
});

it.each([false, true])('merges range and instant samples in either frame order, reversed=%s', (reversed) => {
  const frames = [frame({ key: 'node-a' }), frame({ key: 'node-a' }, [125000], [4])];
  if (reversed) {
    frames.reverse();
  }
  expect(indexSeries(frames, 'rate')).toMatchObject({
    series: [{ times: [0, 60000, 120000, 125000], values: [1, 2, 3, 4] }],
    report: [],
  });
});

it('uses the later frame for conflicting timestamps and reports one conflict per series', () => {
  const frames = [frame({ key: 'node-a' }), frame({ key: 'node-a' }, [60000, 120000], [8, null])];
  expect(indexSeries(frames, 'rate')).toMatchObject({
    series: [{ times: [0, 60000, 120000], values: [1, 8, null] }],
    report: [{ kind: 'duplicate-series', refId: 'rate', labels: { key: 'node-a' } }],
  });
  expect(indexSeries([...frames].reverse(), 'rate').series[0].values).toEqual([1, 2, 3]);
});

it.each([
  ['missing time', (f: DataFrame) => f.fields.shift()],
  ['multiple times', (f: DataFrame) => f.fields.push({ ...f.fields[0] })],
  ['length mismatch', (f: DataFrame) => f.fields[1].values.pop()],
  [
    'frame length mismatch',
    (f: DataFrame) => {
      f.length++;
    },
  ],
  [
    'unordered time',
    (f: DataFrame) => {
      f.fields[0].values = [60000, 0, 120000];
    },
  ],
  [
    'invalid time',
    (f: DataFrame) => {
      f.fields[0].values[0] = Infinity;
    },
  ],
  [
    'NaN',
    (f: DataFrame) => {
      f.fields[1].values[0] = NaN;
    },
  ],
  [
    'Infinity',
    (f: DataFrame) => {
      f.fields[1].values[0] = Infinity;
    },
  ],
])('reports an invalid series for %s and keeps its label slot', (_, change) => {
  const f = frame({ key: 'node-a' });
  change(f);
  const result = indexSeries([f], 'rate');
  expect(result.report).toEqual([{ kind: 'invalid-series', refId: 'rate', message: expect.any(String) }]);
  expect(result.series).toMatchObject([{ labels: { key: 'node-a' }, times: [], values: [] }]);
});

it('encodes equality tuples without collisions and treats absent labels as empty', () => {
  expect(equalityKey({}, ['key'])).toBe(equalityKey({ key: '' }, ['key']));
  expect(equalityKey({ key: 'a,b', port: 'c' }, ['key', 'port'])).not.toBe(
    equalityKey({ key: 'a', port: 'b,c' }, ['key', 'port'])
  );
  expect(equalityKey({ key: 'a', port: 'b' }, ['key', 'port'])).not.toBe(
    equalityKey({ key: 'a', port: 'b' }, ['port', 'key'])
  );
});

it('keeps the v3 snapshot type available through its former module', () => {
  expectTypeOf<QuerySnapshot>().toEqualTypeOf<LegacySnapshot>();
});

it('checks each frame when two frames share one numeric field object', () => {
  const valid = frame({ key: 'node-a' }, [0], [7]);
  const invalid = { ...valid, fields: [valid.fields[1]] };
  const result = indexSeries([valid, invalid], 'rate');
  expect(result.series).toMatchObject([{ times: [0], values: [7] }]);
  expect(result.report).toEqual([{ kind: 'invalid-series', refId: 'rate', message: expect.any(String) }]);
});

it('treats an inherited object property as an absent label', () => {
  expect(equalityKey({}, ['constructor', '__proto__'])).toBe(
    equalityKey({ constructor: '', ['__proto__']: '' }, ['constructor', '__proto__'])
  );
});
