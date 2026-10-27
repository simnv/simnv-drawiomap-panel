import { describe, expect, it } from 'vitest';
import { isRecord } from './record';

describe('isRecord', () => {
  it('is true for a plain object, also an empty one', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({})).toBe(true);
  });
  it('is false for null, an array and a scalar', () => {
    for (const value of [null, undefined, [], [1], 0, '', 'x', true]) {
      expect(isRecord(value)).toBe(false);
    }
  });
});
