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
});
