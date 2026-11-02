import { FieldType, type DataFrame, type Labels } from '@grafana/data';
import { expect, it } from 'vitest';
import { equalityKey, indexSeries } from './seriesIndex';

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

const canonicalOf = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((name) => `${name}=${JSON.stringify(labels[name])}`)
    .join(',');

/** The general path as it was before the single-frame fast path: every key goes through a Map and a sort. */
function mergeReference(frames: DataFrame[], refId: string) {
  const merged = new Map<
    string,
    { frame: number; labels: Labels; field: DataFrame['fields'][number]; samples: Map<number, number | null> }
  >();
  frames.forEach((f, frameIndex) => {
    const field = f.fields.find((x) => x.type === FieldType.number);
    const time = f.fields.find((x) => x.type === FieldType.time);
    if (f.refId !== refId || !field || !time) {
      return;
    }
    const labels = field.labels ?? {};
    const key = JSON.stringify([
      Object.keys(labels)
        .sort()
        .map((n) => [n, labels[n]]),
      field.name,
    ]);
    const entry = merged.get(key) ?? { frame: frameIndex, labels, field, samples: new Map() };
    merged.set(key, entry);
    time.values.forEach((t, i) => entry.samples.set(t, field.values[i] as number | null));
  });
  return [...merged.values()]
    .map((e) => {
      const times = [...e.samples.keys()].sort((a, b) => a - b);
      return {
        labels: e.labels,
        frameIndex: e.frame,
        canonical: canonicalOf(e.labels),
        times,
        values: times.map((t) => e.samples.get(t)!),
      };
    })
    .sort(
      (a, b) => (a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0) || a.frameIndex - b.frameIndex
    );
}

const shape = (series: ReturnType<typeof indexSeries>['series']) =>
  series.map((s) => ({
    labels: s.labels,
    frameIndex: s.frameIndex,
    canonical: canonicalOf(s.labels),
    times: s.times,
    values: s.values,
  }));

it.each([
  ['one frame per key', [frame({ a: '1' }), frame({ a: '2' }, [0, 1000], [5, null]), frame({ a: '3' }, [], [])]],
  ['trailing null and leading null', [frame({ a: '1' }, [0, 1, 2], [null, 4, null])]],
  ['an empty frame', [frame({ a: '1' }, [], [])]],
  ['duplicate keys with distinct times', [frame({ a: '1' }, [0, 2], [1, 3]), frame({ a: '1' }, [1, 3], [2, 4])]],
  [
    'single and duplicate keys together',
    [frame({ a: '1' }, [0, 2], [1, 3]), frame({ a: '2' }), frame({ a: '1' }, [1], [9]), frame({ a: '3' }, [7], [null])],
  ],
  [
    'labels in shuffled key order, frames out of canonical order',
    [
      frame({ z: '1', a: '9' }, [0, 1], [1, 2]),
      frame({ b: 'x', a: '2' }, [0], [3]),
      frame({ a: '9', z: '1' }, [2], [4]),
      frame({ a: '2', b: 'x' }, [1], [5]),
      frame({ m: '0' }, [0], [6]),
      frame({ a: '1', b: 'y' }, [0], [7]),
    ],
  ],
  ['repeated times inside one frame', [frame({ a: '1' }, [0, 1, 1, 2], [1, 2, 2, 3])]],
])('gives the same series from the fast path and the merge: %s', (_name, frames) => {
  const { series, report } = indexSeries(frames, 'rate');
  expect(shape(series)).toEqual(mergeReference(frames, 'rate'));
  expect(report).toEqual([]);
});

it('uses the arrays of a one-frame key as they are, and copies the arrays of a merged key', () => {
  const single = frame({ a: '1' });
  const [one] = indexSeries([single], 'rate').series;
  expect(one.times).toBe(single.fields[0].values);
  expect(one.values).toBe(single.fields[1].values);
  const pair = [frame({ a: '1' }, [0, 2], [1, 3]), frame({ a: '1' }, [1], [2])];
  const [merged] = indexSeries(pair, 'rate').series;
  expect(merged.times).toEqual([0, 1, 2]);
  expect(merged.times).not.toBe(pair[0].fields[0].values);
});

it('keeps the reports of the merge for a frame with repeated times and for an unsupported frame', () => {
  const clash = frame({ a: '1' }, [0, 1, 1], [1, 2, 3]);
  expect(indexSeries([clash], 'rate').report).toEqual([
    { kind: 'duplicate-series', refId: 'rate', labels: { a: '1' } },
  ]);
  const unordered = frame({ a: '1' }, [2, 1, 0], [1, 2, 3]);
  const { series, report } = indexSeries([unordered, frame({ a: '2' })], 'rate');
  expect(report).toEqual([
    { kind: 'invalid-series', refId: 'rate', message: 'History timestamps must be finite milliseconds in time order.' },
  ]);
  expect(series.map((s) => [s.labels, s.times])).toEqual([
    [{ a: '1' }, []],
    [{ a: '2' }, [0, 60000, 120000]],
  ]);
});

it('keeps the report order: many-fields comes before the invalid-series of the same frame', () => {
  const wide = frame({ a: '1' }, [1, 0], [1, 2]);
  wide.fields.push({ name: 'Second', type: FieldType.number, config: {}, values: [1, 2] });
  expect(indexSeries([wide], 'rate').report.map((r) => r.kind)).toEqual(['many-fields', 'invalid-series']);
});
