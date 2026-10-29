import {
  createTheme,
  FieldType,
  MappingType,
  SpecialValueMatch,
  ThresholdsMode,
  type FieldConfig,
  type ValueMapping,
} from '@grafana/data';
import { describe, expect, it } from 'vitest';
import type { QuerySnapshot, Series } from '../query/snapshot';
import { statusOfUse } from './statusV4';

const theme = createTheme();
const READY: QuerySnapshot = { state: 'ready', frames: [], fetchedAt: 0, fromCache: false };
const EMPTY: QuerySnapshot = { state: 'empty', fetchedAt: 0, fromCache: false };

const mappings: ValueMapping[] = [
  {
    type: MappingType.ValueToText,
    options: {
      '0': { text: 'Offline', color: 'magenta', index: 0 },
      '1': { text: 'Up', color: 'transparent', index: 1 },
      '2': { text: 'Down', color: 'blue', index: 2 },
      '3': { text: 'Fault A', color: 'red', index: 3 },
      '4': { text: 'Fault B', color: 'dark-red', index: 4 },
    },
  },
];
const thresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 50, color: 'orange' },
    { value: 80, color: 'red' },
  ],
};

let next = 0;
const series = (values: Array<number | null>, config: FieldConfig = { mappings, thresholds }): Series => ({
  refId: 'up',
  labels: { instance: `node-${next++}` },
  frameIndex: 0,
  fieldIndex: 1,
  times: values.map((_, i) => i * 60_000),
  values,
  field: { name: 'Value', type: FieldType.number, config, values },
});

const opts = { refId: 'up', missing: 'nodata', theme } as const;
const down = { ...opts, missing: 'down' } as const;

describe('statusOfUse: the value of a series', () => {
  it('carries the exact colour and text of a mapping: magenta / Offline', () => {
    expect(statusOfUse(READY, [series([0])], opts)).toEqual({
      state: 'normal',
      severity: 'normal',
      color: theme.visualization.getColorByName('magenta'),
      text: 'Offline',
      refId: 'up',
      value: 0,
    });
  });
  it('gives down for the mapping text Down, whatever its colour', () => {
    expect(statusOfUse(READY, [series([2])], opts)).toMatchObject({
      state: 'down',
      severity: 'down',
      color: theme.visualization.getColorByName('blue'),
      text: 'Down',
    });
  });
  it('carries transparent as a value colour with the severity normal', () => {
    expect(statusOfUse(READY, [series([1])], opts)).toMatchObject({
      state: 'normal',
      severity: 'normal',
      color: theme.visualization.getColorByName('transparent'),
      text: 'Up',
    });
  });
  it('reads the last finite value and formats it with the field unit', () => {
    const s = series([5, 95, null], { thresholds, unit: 'percent' });
    expect(statusOfUse(READY, [s], opts)).toMatchObject({
      state: 'critical',
      color: theme.visualization.getColorByName('red'),
      text: '95%',
    });
  });
  it('uses the display processor that Grafana attached to the field', () => {
    const s = series([7]);
    s.field.display = () => ({ numeric: 7, text: 'seven', color: '#ffa500' });
    expect(statusOfUse(READY, [s], opts)).toMatchObject({ state: 'warning', color: '#ffa500', text: 'seven' });
  });
});

describe('statusOfUse: worst of N', () => {
  it('gives the worst state of the series', () => {
    const result = statusOfUse(
      READY,
      [series([10], { thresholds }), series([90], { thresholds }), series([60], { thresholds })],
      opts
    );
    expect(result).toMatchObject({ state: 'critical', color: theme.visualization.getColorByName('red') });
    expect(statusOfUse(READY, [series([3]), series([2])], opts)).toMatchObject({ state: 'down', text: 'Down' });
  });
  it('between two series of one rank, the first in the series order wins', () => {
    expect(statusOfUse(READY, [series([4]), series([3])], opts)).toMatchObject({ state: 'critical', text: 'Fault B' });
    expect(statusOfUse(READY, [series([3]), series([4])], opts)).toMatchObject({ state: 'critical', text: 'Fault A' });
  });
  it('gives the coverage when a series with no value is the worst: 1 of 2 series have no value', () => {
    expect(statusOfUse(READY, [series([1]), series([null])], opts)).toEqual({
      state: 'missing',
      severity: 'missing',
      text: '–',
      refId: 'up',
      reason: '1 of 2 series have no value',
    });
  });
  it('a worse value state wins over a series with no value', () => {
    expect(statusOfUse(READY, [series([null]), series([3])], opts)).toMatchObject({
      state: 'critical',
      text: 'Fault A',
    });
  });
});

describe('statusOfUse: no data, failed and loading (3.6)', () => {
  it.each([
    ['ready', READY],
    ['empty', EMPTY],
  ] as const)('zero series of a %s query is grey no data with the text –', (_, snapshot) => {
    expect(statusOfUse(snapshot, [], opts)).toEqual({
      state: 'missing',
      severity: 'missing',
      text: '–',
      refId: 'up',
      reason: 'No data',
    });
  });
  it.each([
    ['ready', READY],
    ['empty', EMPTY],
  ] as const)('missing: down gives down for zero series of a %s query', (_, snapshot) => {
    expect(statusOfUse(snapshot, [], down)).toEqual({
      state: 'down',
      severity: 'down',
      text: '–',
      refId: 'up',
      reason: 'No data',
    });
  });
  it.each([
    ['a failed query', { state: 'error', message: 'boom' }, 'Query failed'],
    ['an unsupported result', { state: 'unsupported', message: 'no frames' }, 'Unsupported data'],
    ['a first load', { state: 'loading' }, 'Loading data'],
    ['a query that did not start', { state: 'idle' }, 'Loading data'],
  ] as const)('%s is missing and never down', (_, snapshot, reason) => {
    for (const o of [opts, down]) {
      expect(statusOfUse(snapshot as QuerySnapshot, [], o)).toEqual({
        state: 'missing',
        severity: 'missing',
        text: '–',
        refId: 'up',
        reason,
      });
    }
  });
  it('a failed query is missing also when old series are passed', () => {
    expect(statusOfUse({ state: 'error', message: 'boom' }, [series([3])], down)).toMatchObject({
      state: 'missing',
      reason: 'Query failed',
    });
  });
  it.each([
    ['all null', [null, null]],
    ['NaN', [NaN]],
    ['+Infinity', [Infinity]],
    ['-Infinity', [null, -Infinity]],
    ['no samples', []],
  ] as const)('a series with %s is missing "No value", also with missing: down', (_, values) => {
    for (const o of [opts, down]) {
      expect(statusOfUse(READY, [series([...values])], o)).toEqual({
        state: 'missing',
        severity: 'missing',
        text: '–',
        refId: 'up',
        reason: 'No value',
      });
    }
  });
  it('a special-value mapping null → green does not apply', () => {
    const special: ValueMapping = {
      type: MappingType.SpecialValue,
      options: { match: SpecialValueMatch.Null, result: { text: 'OK', color: 'green', index: 0 } },
    };
    const nanToGreen: ValueMapping = {
      type: MappingType.SpecialValue,
      options: { match: SpecialValueMatch.NaN, result: { text: 'OK', color: 'green', index: 1 } },
    };
    const result = statusOfUse(READY, [series([null, NaN], { mappings: [special, nanToGreen], thresholds })], opts);
    expect(result).toMatchObject({ state: 'missing', text: '–', reason: 'No value' });
    expect(result.color).toBeUndefined();
  });
});
