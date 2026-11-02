import {
  FieldColorModeId,
  FieldType,
  createTheme,
  getFieldColorModeForField,
  getFieldDisplayName,
  type DataFrame,
  type Field,
} from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { indexFrames, lastSampleTime } from './frames';

const frame = (): DataFrame => ({
  length: 3,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: [1000, 2000, 3000] },
    {
      name: 'CPU',
      type: FieldType.number,
      config: { unit: 'percent' },
      labels: { instance: 'node-rtr-a' },
      values: [1, null, 3],
    },
  ],
});

it('treats a fieldless empty backend frame as an empty result rather than an unsupported one', () => {
  expect(indexFrames([{ length: 0, fields: [] }])).toMatchObject({ empty: true, numeric: false, candidates: [] });
  expect(indexFrames([])).toMatchObject({ empty: true, numeric: false, candidates: [] });
});

it('gives one checked candidate for a numeric field, with its time field and its last sample', () => {
  const f = frame();
  const index = indexFrames([f]);
  expect(index).toMatchObject({ empty: false, numeric: true });
  expect(index.candidates).toHaveLength(1);
  const [candidate] = index.candidates;
  expect(candidate.field).toBe(f.fields[1]);
  expect(candidate.frame).toBe(f);
  expect(candidate.timeField).toBe(f.fields[0]);
  expect(candidate.unsupported).toBeUndefined();
  expect(candidate.lastNumeric).toBe(2);
});

it('finds the last sample that is not null, and -1 when every sample is null', () => {
  const f = frame();
  f.fields[1].values = [2, 4, null];
  expect(indexFrames([f]).candidates[0].lastNumeric).toBe(1);
  const g = frame();
  g.fields[1].values = [null, null, null];
  expect(indexFrames([g]).candidates[0]).toMatchObject({ lastNumeric: -1, unsupported: undefined });
});

it('accepts a frame with a single sample', () => {
  const f = frame();
  f.length = 1;
  f.fields[0].values = [1000];
  f.fields[1].values = [7];
  expect(indexFrames([f]).candidates[0]).toMatchObject({ unsupported: undefined, lastNumeric: 0 });
});

it('gives no candidate and numeric false for a result with no numeric field', () => {
  const f = frame();
  f.fields.splice(1, 1);
  expect(indexFrames([f])).toMatchObject({ empty: false, numeric: false, candidates: [] });
});

it('gives one candidate for each numeric field of each frame', () => {
  const f = frame();
  f.fields.push({ ...f.fields[1], name: 'Other' });
  expect(indexFrames([f, frame()]).candidates.map((c) => c.field.name)).toEqual(['CPU', 'Other', 'CPU']);
});

it.each([
  [
    'missing time field',
    (f: DataFrame) => {
      f.fields.splice(0, 1);
    },
    'exactly one numeric time field',
  ],
  [
    'multiple time fields',
    (f: DataFrame) => {
      f.fields.push({ ...f.fields[0] });
    },
    'exactly one numeric time field',
  ],
  [
    'invalid timestamp',
    (f: DataFrame) => {
      f.fields[0].values[1] = NaN;
    },
    'finite milliseconds',
  ],
  [
    'string timestamp',
    (f: DataFrame) => {
      f.fields[0].values[1] = '2000';
    },
    'finite milliseconds',
  ],
  [
    'unordered time',
    (f: DataFrame) => {
      f.fields[0].values = [3000, 1000, 2000];
    },
    'time order',
  ],
  [
    'mismatched lengths',
    (f: DataFrame) => {
      f.fields[1].values.pop();
    },
    'lengths differ',
  ],
  [
    'mismatched frame length',
    (f: DataFrame) => {
      f.length = 4;
    },
    'lengths differ',
  ],
  [
    'non-finite number',
    (f: DataFrame) => {
      f.fields[1].values[0] = Infinity;
    },
    'finite numbers or null gaps',
  ],
])('explains unsupported %s', (_, change, message) => {
  const f = frame();
  change(f);
  const [candidate] = indexFrames([f]).candidates;
  expect(candidate.unsupported).toEqual(expect.stringContaining(message));
});

describe('the index cache', () => {
  it('gives the same index object for the same frames array', () => {
    const frames = [frame()];
    expect(indexFrames(frames)).toBe(indexFrames(frames));
  });
  it('a new frames array gives a new index', () => {
    const frames = [frame()];
    expect(indexFrames([...frames])).not.toBe(indexFrames(frames));
  });
  it('keeps the check of a field once per index: a bad field stays bad on every read', () => {
    const f = frame();
    f.fields[1].values[0] = Infinity;
    const frames = [f];
    expect(indexFrames(frames).candidates[0].unsupported).toEqual(expect.stringContaining('finite'));
    expect(indexFrames(frames).candidates[0].unsupported).toEqual(expect.stringContaining('finite'));
  });
});

describe('lastSampleTime', () => {
  const timed = (times: unknown[]): DataFrame => ({
    length: times.length,
    fields: [{ name: 'Time', type: FieldType.time, config: {}, values: times }],
  });

  it('gives the newest time of all time fields of all frames', () => {
    expect(lastSampleTime([frame(), timed([500, 4500, 2500]), timed([])])).toBe(4500);
  });

  it('skips values that are not finite times', () => {
    expect(lastSampleTime([timed([1000, null, NaN, Infinity, '9000'])])).toBe(1000);
  });

  it('skips values outside the range of a Date: a time field in ns or µs', () => {
    expect(lastSampleTime([timed([1000, 1.7e18, -1.7e18, 8.64e15])])).toBe(8.64e15);
  });

  it('gives undefined when no frame has a time', () => {
    expect(lastSampleTime([])).toBeUndefined();
    expect(lastSampleTime([timed([])])).toBeUndefined();
    expect(
      lastSampleTime([{ length: 1, fields: [{ name: 'v', type: FieldType.number, config: {}, values: [1] }] }])
    ).toBeUndefined();
  });
});

describe('the series name for the colour by name', () => {
  const named = (mode: string, job = 'ap-1'): DataFrame => {
    const f = frame();
    f.fields[1].config = { ...f.fields[1].config, color: { mode } };
    f.fields[1].labels = { job };
    return f;
  };
  const colourOf = (field: Field) =>
    getFieldColorModeForField(field).getCalculator(field, createTheme())(1, 0, { value: 0, color: 'red' });

  it('is set for palette-classic-by-name, as getFieldDisplayName sets it', () => {
    const mode = FieldColorModeId.PaletteClassicByName;
    const frames = [named(mode), named(mode, 'ap-2')];
    const oracle = [named(mode), named(mode, 'ap-2')];
    indexFrames(frames);
    expect(frames[0].fields[1].state?.displayName).toBe(getFieldDisplayName(oracle[0].fields[1], oracle[0], oracle));
    expect(frames[1].fields[1].state?.displayName).toBe(getFieldDisplayName(oracle[1].fields[1], oracle[1], oracle));
    expect(frames[0].fields[1].state?.displayName).not.toBe(frames[1].fields[1].state?.displayName);
  });

  it('gives the colour of the series name, not of the field name', () => {
    const mode = FieldColorModeId.PaletteClassicByName;
    const f = named(mode);
    const oracle = named(mode);
    getFieldDisplayName(oracle.fields[1], oracle, [oracle]);
    const unprimed = named(mode);
    const field = indexFrames([f]).candidates[0].field;
    expect(colourOf({ ...field })).toBe(colourOf({ ...oracle.fields[1] }));
    expect(colourOf({ ...field })).not.toBe(colourOf({ ...unprimed.fields[1] }));
  });

  it('is not computed for other colour modes: the call is O(frames) per field', () => {
    const f = named(FieldColorModeId.Thresholds);
    indexFrames([f]);
    expect(f.fields[1].state?.displayName).toBeUndefined();
  });
});
