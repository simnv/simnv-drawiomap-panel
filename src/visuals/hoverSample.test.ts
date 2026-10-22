import { describe, expect, it } from 'vitest';
import { alignedSamples, nearestIndex, sampleAt, sampleTimes, timeAt } from './hoverSample';

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

describe('alignedSamples', () => {
  const a = { timestamps: [0, 10, 20], values: [1, 2, 3] as Array<number | null> };
  const b = { timestamps: [0, 15, 20], values: [4, null, 6] as Array<number | null> };
  it('picks the nearest time among all series and reads each series at that time', () => {
    expect(alignedSamples([a, b], 14)).toEqual({ time: 15, values: [null, null] });
    expect(alignedSamples([a, b], 11)).toEqual({ time: 10, values: [2, null] });
    expect(alignedSamples([a, b], 19)).toEqual({ time: 20, values: [3, 6] });
  });
  it('is undefined without samples', () => {
    expect(alignedSamples([{ timestamps: [], values: [] }], 1)).toBeUndefined();
  });
  it('lists the distinct sample times in order', () => {
    expect(sampleTimes([a, b])).toEqual([0, 10, 15, 20]);
  });
});
