import { createTheme, FieldType, type DataFrame } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { historyOf, toHistory } from './frames';
import type { QueryBinding } from '../model/config';
import type { QuerySnapshot } from './types';
const binding: QueryBinding = { queryId: 'cpu', match: { instance: 'router' }, reducer: 'last' };
const frame = (): DataFrame => ({
  length: 3,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: [1000, 2000, 3000] },
    {
      name: 'CPU',
      type: FieldType.number,
      config: { unit: 'percent' },
      labels: { instance: 'router' },
      values: [1, null, 3],
    },
  ],
});
const snapshot = (frames = [frame()]): QuerySnapshot => ({ state: 'ready', frames, fetchedAt: 5000, fromCache: true });
it('treats a fieldless empty backend frame as missing data rather than an unsupported result type', () => {
  expect(toHistory(snapshot([{ length: 0, fields: [] }]), binding)).toEqual({
    state: 'empty',
    fetchedAt: 5000,
    fromCache: true,
  });
});
it('preserves numeric samples, null gaps, field configuration and source timestamps independently of cache age', () => {
  const model = toHistory(snapshot(), binding);
  expect(model).toMatchObject({
    state: 'ready',
    timestamps: [1000, 2000, 3000],
    values: [1, null, 3],
    latestValue: 3,
    sampleAt: 3000,
    fetchedAt: 5000,
    fromCache: true,
    field: { config: { unit: 'percent' } },
    latestDisplayValue: { text: '3', suffix: '%' },
  });
});

it.each([
  [
    'missing numeric field',
    (f: DataFrame) => {
      f.fields.splice(1, 1);
    },
  ],
  [
    'missing time field',
    (f: DataFrame) => {
      f.fields.splice(0, 1);
    },
  ],
  [
    'multiple time fields',
    (f: DataFrame) => {
      f.fields.push({ ...f.fields[0] });
    },
  ],
  [
    'invalid timestamp',
    (f: DataFrame) => {
      f.fields[0].values[1] = NaN;
    },
  ],
  [
    'string timestamp',
    (f: DataFrame) => {
      f.fields[0].values[1] = '2000';
    },
  ],
  [
    'unordered time',
    (f: DataFrame) => {
      f.fields[0].values = [3000, 1000, 2000];
    },
  ],
  [
    'mismatched lengths',
    (f: DataFrame) => {
      f.fields[1].values.pop();
    },
  ],
  [
    'non-finite number',
    (f: DataFrame) => {
      f.fields[1].values[0] = Infinity;
    },
  ],
  [
    'ambiguous numeric fields',
    (f: DataFrame) => {
      f.fields.push({ ...f.fields[1], name: 'Other' });
    },
  ],
])('explains unsupported %s', (_, change) => {
  const f = frame();
  change(f);
  expect(toHistory(snapshot([f]), binding)).toMatchObject({ state: 'unsupported', message: expect.any(String) });
});

it('requires an unambiguous field/label match across all frames', () => {
  expect(toHistory(snapshot([frame(), frame()]), binding)).toMatchObject({
    state: 'unsupported',
    message: expect.stringContaining('ambiguous'),
  });
  const f = frame();
  f.fields.push({ ...f.fields[1], name: 'Other' });
  expect(toHistory(snapshot([f]), { ...binding, field: 'Other' })).toMatchObject({
    state: 'ready',
    field: { name: 'Other' },
  });
  expect(toHistory(snapshot(), { ...binding, match: { instance: 'missing' } })).toMatchObject({ state: 'empty' });
  expect(toHistory(snapshot(), { ...binding, match: { instance: '/rout.*/' } })).toMatchObject({ state: 'ready' });
});

it('keeps empty/single-sample/all-null and failure states explicit', () => {
  expect(toHistory(snapshot([]), binding)).toEqual({ state: 'empty', fetchedAt: 5000, fromCache: true });
  const f = frame();
  f.length = 1;
  f.fields[0].values = [1000];
  f.fields[1].values = [7];
  expect(toHistory(snapshot([f]), binding)).toMatchObject({ state: 'ready', values: [7], timestamps: [1000] });
  f.fields[1].values = [null];
  expect(toHistory(snapshot([f]), binding)).toMatchObject({ state: 'empty' });
  for (const state of ['idle', 'loading', 'error', 'unsupported'] as const) {
    const input = state === 'error' || state === 'unsupported' ? { state, message: 'Safe message' } : { state };
    expect(toHistory(input, binding)).toEqual(input);
  }
});

it('retains field display processors and computes reducer values while preserving the last numeric sample age', () => {
  const f = frame();
  f.fields[1].values = [2, 4, null];
  f.fields[1].display = (value) => ({
    text: `native ${value}`,
    numeric: Number(value),
    prefix: 'before ',
    suffix: ' after',
  });
  expect(toHistory(snapshot([f]), { ...binding, reducer: 'mean' })).toMatchObject({
    latestValue: 3,
    sampleAt: 2000,
    latestDisplayValue: { text: 'native 3', prefix: 'before ', suffix: ' after' },
    values: [2, 4, null],
  });
});

describe('the history cache', () => {
  const theme = createTheme();
  it('gives the same model object for the same snapshot, match, field, reducer and format', () => {
    const s = snapshot();
    const format = { theme, timeZone: 'utc' };
    const first = historyOf(s, binding, format);
    expect(historyOf(s, binding, format)).toBe(first);
    expect(historyOf(s, { ...binding }, { theme, timeZone: 'utc' })).toBe(first);
    expect(toHistory(s, binding, format)).toBe(first);
    // another binding, reducer, unit, decimals, time zone or theme is another model
    expect(historyOf(s, { ...binding, reducer: 'mean' }, format)).not.toBe(first);
    expect(historyOf(s, { ...binding, match: { instance: '/rout.*/' } }, format)).not.toBe(first);
    expect(historyOf(s, binding, { ...format, unit: 'bps' })).not.toBe(first);
    expect(historyOf(s, binding, { ...format, decimals: 1 })).not.toBe(first);
    expect(historyOf(s, binding, { ...format, timeZone: 'Europe/Berlin' })).not.toBe(first);
    expect(historyOf(s, binding, { ...format, theme: createTheme({ colors: { mode: 'light' } }) })).not.toBe(first);
  });
  it('a new snapshot object gives a new model', () => {
    const a = snapshot();
    const b = { ...a };
    expect(historyOf(a, binding)).not.toBe(historyOf(b, binding));
  });
  it('holds the arrays of the snapshot, not copies', () => {
    const s = snapshot();
    const model = historyOf(s, binding);
    if (model.state !== 'ready' || s.state !== 'ready') {
      throw new Error('expected ready');
    }
    expect(model.timestamps).toBe(s.frames[0].fields[0].values);
    expect(model.values).toBe(s.frames[0].fields[1].values);
    expect(model.field).toBe(s.frames[0].fields[1]);
    expect(model.timeField).toBe(s.frames[0].fields[0]);
  });
  it('a unit or decimals override gives a model with its own display processor over the shared arrays', () => {
    const s = snapshot();
    const plain = historyOf(s, binding, { theme });
    const unit = historyOf(s, binding, { theme, unit: 'bps', decimals: 1 });
    if (plain.state !== 'ready' || unit.state !== 'ready') {
      throw new Error('expected ready');
    }
    expect(unit.values).toBe(plain.values);
    expect(unit.timestamps).toBe(plain.timestamps);
    expect(unit.field).not.toBe(plain.field);
    expect(unit.field.config).toMatchObject({ unit: 'bps', decimals: 1 });
    expect(unit.latestDisplayValue).toMatchObject({ text: '3.0', suffix: ' b/s' });
    expect(plain.latestDisplayValue).toMatchObject({ text: '3', suffix: '%' });
  });
  it('keeps the ambiguous and the no-match cases per match key', () => {
    const s = snapshot([frame(), frame()]);
    expect(historyOf(s, binding)).toMatchObject({ state: 'unsupported', message: expect.stringContaining('ambiguous') });
    expect(historyOf(s, { ...binding, match: { instance: 'missing' } })).toMatchObject({ state: 'empty' });
    expect(historyOf(s, { ...binding, field: 'Other' })).toMatchObject({ state: 'empty' });
  });
  it('keeps the checks of a field once per index: a bad field fails for every binding that selects it', () => {
    const f = frame();
    f.fields[1].values[0] = Infinity;
    const s = snapshot([f]);
    expect(historyOf(s, binding)).toMatchObject({ state: 'unsupported', message: expect.stringContaining('finite') });
    expect(historyOf(s, { ...binding, reducer: 'max' })).toMatchObject({ state: 'unsupported' });
  });
});
