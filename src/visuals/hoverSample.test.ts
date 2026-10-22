import { describe, expect, it } from 'vitest';
import { nearestIndex, sampleAt, timeAt } from './hoverSample';

describe('nearestIndex', () => {
  const t = [0, 10, 20, 40];
  it('picks the nearest sample, the earlier one on a tie', () => {
    expect(nearestIndex(t, 4)).toBe(0);
    expect(nearestIndex(t, 5)).toBe(0);
    expect(nearestIndex(t, 6)).toBe(1);
    expect(nearestIndex(t, 31)).toBe(3);
  });
  it('clamps outside the data and handles an empty series', () => {
    expect(nearestIndex(t, -100)).toBe(0);
    expect(nearestIndex(t, 1000)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('sampleAt', () => {
  it('returns the value and time of the nearest sample', () => {
    expect(sampleAt([0, 10, 20], [1, 2, 3], 11)).toEqual({ time: 10, value: 2 });
  });
  it('returns null for a gap', () => {
    expect(sampleAt([0, 10, 20], [1, null, 3], 9)).toEqual({ time: 10, value: null });
  });
  it('returns undefined without samples', () => {
    expect(sampleAt([], [], 1)).toBeUndefined();
  });
});

describe('timeAt', () => {
  it('maps a fraction over the range and clamps it', () => {
    expect(timeAt(0.5, 100, 200)).toBe(150);
    expect(timeAt(-1, 100, 200)).toBe(100);
    expect(timeAt(2, 100, 200)).toBe(200);
  });
});
