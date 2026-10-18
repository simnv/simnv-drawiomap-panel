import { FieldType, type DataFrame } from '@grafana/data';
import { expect, it } from 'vitest';
import { toHistory } from './frames';
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
