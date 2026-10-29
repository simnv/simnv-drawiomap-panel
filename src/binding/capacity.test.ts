import { describe, expect, it } from 'vitest';
import { createTheme, FieldType, type Field } from '@grafana/data';
import type { HistoryModel } from '../query/frames';
import { bitsWithNote, inFieldUnit } from './capacity';
import { halfState, type HalfContext } from './engine';

const field = (unit?: string, max?: number): Field =>
  ({
    name: 'Value',
    type: FieldType.number,
    config: { ...(unit ? { unit } : {}), ...(max ? { max } : {}) },
    values: [],
  }) as Field;
const series = (latestValue: number | undefined, unit?: string): HistoryModel => ({
  state: 'ready',
  field: field(unit) as Field<number | null>,
  timeField: { name: 'Time', type: FieldType.time, config: {}, values: [] } as Field<number>,
  timestamps: [],
  values: [],
  latestValue,
  fetchedAt: 0,
  fromCache: false,
});

describe('inFieldUnit', () => {
  it.each([
    ['bps', 1e8, 1e8],
    ['Bps', 1e9, 125e6],
    ['Mbits', 1e8, 100],
    [undefined, 1e8, 1e8],
    ['m3', 4.1, 4.1],
  ])('unit %s: %d in the canonical unit is %d in the field unit', (unit, amount, expected) => {
    expect(inFieldUnit(amount, field(unit))).toBeCloseTo(expected);
  });
  it('without a field the amount is as it is', () => {
    expect(inFieldUnit(42, undefined)).toBe(42);
  });
});

describe('the note of a unit that is not a data rate', () => {
  it('bitsWithNote converts a rate unit, and keeps the raw value of another unit with the note', () => {
    expect(bitsWithNote(2, 'Bps')).toEqual({ bits: 16 });
    expect(bitsWithNote(2, undefined)).toEqual({ bits: 2 });
    expect(bitsWithNote(2, 'm3')).toEqual({
      bits: 2,
      note: 'unit "m3" is not a data rate, the raw value is used as bit/s',
    });
  });
  it('halfState gives the same note for the value of a link half', () => {
    const ctx: HalfContext = {
      theme: createTheme(),
      display: (_, value) => ({ text: String(value), numeric: value }),
      linkWidth: { min: 1, max: 4 },
    };
    const { state, notes } = halfState(series(2.05, 'm3'), 'v', { amount: 4.1, source: 'series' }, ctx);
    expect(state.percent).toBeCloseTo(50);
    expect(notes).toEqual([bitsWithNote(2.05, 'm3').note]);
  });
});
