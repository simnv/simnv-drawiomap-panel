import { describe, expect, it } from 'vitest';
import { reduceValues } from './reduce';

describe('reduceValues', () => {
  const v = [1, NaN, 3, null as unknown as number, 2];
  it('last skips null and NaN', () => expect(reduceValues(v, 'last')).toBe(2));
  it('mean, max, min', () => {
    expect(reduceValues(v, 'mean')).toBe(2);
    expect(reduceValues(v, 'max')).toBe(3);
    expect(reduceValues(v, 'min')).toBe(1);
  });
  it('undefined on empty or all-null', () => {
    expect(reduceValues([], 'last')).toBeUndefined();
    expect(reduceValues([NaN], 'mean')).toBeUndefined();
  });
  it('reads a history with gaps in place: [null, 1, 2] with each reducer', () => {
    const history: ReadonlyArray<number | null> = [null, 1, 2];
    expect(reduceValues(history, 'last')).toBe(2);
    expect(reduceValues(history, 'mean')).toBe(1.5);
    expect(reduceValues(history, 'max')).toBe(2);
    expect(reduceValues(history, 'min')).toBe(1);
    expect(history).toEqual([null, 1, 2]);
  });

  it('last equals the last value of the filtered list for gaps and bad values at either end', () => {
    const cases: Array<Array<number | null | undefined>> = [
      [],
      [null],
      [NaN, null, undefined],
      [1, 2, 3],
      [1, 2, null],
      [1, null, NaN, Infinity, -Infinity, undefined],
      [null, NaN, 5],
      [0, -0, 0],
      [-3, null, null],
    ];
    for (const values of cases) {
      const finite = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      expect(reduceValues(values, 'last')).toBe(finite.length ? finite[finite.length - 1] : undefined);
    }
  });
});
