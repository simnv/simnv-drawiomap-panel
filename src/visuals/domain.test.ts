import { describe, expect, it } from 'vitest';
import { yDomain } from './domain';

describe('yDomain default (zero baseline)', () => {
  it('starts a non-negative series at zero, so a flat series stays flat', () => {
    expect(yDomain([41, 41.2, 41])).toEqual([0, 41.2]);
    expect(yDomain([3, 9, 5])).toEqual([0, 9]);
  });
  it('uses 0 to 100 for percent and 0 to 1 for percentunit; a value above the scale still fits', () => {
    expect(yDomain([40, 41], { unit: 'percent' })).toEqual([0, 100]);
    expect(yDomain([0.4, 0.41], { unit: 'percentunit' })).toEqual([0, 1]);
    expect(yDomain([40, 120], { unit: 'percent' })).toEqual([0, 120]);
  });
  it('reaches up to the capacity; a value above the capacity still fits', () => {
    expect(yDomain([10, 20], { capacity: 100 })).toEqual([0, 100]);
    expect(yDomain([10, 150], { capacity: 100 })).toEqual([0, 150]);
    expect(yDomain([10, 20], { capacity: 0 })).toEqual([0, 20]);
  });
  it('skips nulls and values that are not finite', () => {
    expect(yDomain([null, 4, NaN, 2, undefined])).toEqual([0, 4]);
  });
  it('gives 0 to 1 for zeros and no data, 0 to v for one value', () => {
    expect(yDomain([0, 0, 0])).toEqual([0, 1]);
    expect(yDomain([5])).toEqual([0, 5]);
    expect(yDomain([NaN])).toEqual([0, 1]);
    expect(yDomain([])).toEqual([0, 1]);
  });
});

describe('yDomain negative series', () => {
  it('uses min to max for a series with negative values', () => {
    expect(yDomain([-10, 20, 5])).toEqual([-10, 20]);
  });
  it('keeps a minimum span of 10% of |max|, centred on the data', () => {
    const [lo, hi] = yDomain([-100.5, -100]);
    expect(hi - lo).toBeCloseTo(10);
    expect((lo + hi) / 2).toBeCloseTo(-100.25);
    const [lo0, hi0] = yDomain([-0.1, 0]);
    expect(hi0 - lo0).toBeCloseTo(1);
    expect((lo0 + hi0) / 2).toBeCloseTo(-0.05);
  });
  it('ignores the unit top and the capacity, like before', () => {
    expect(yDomain([-10, 20], { unit: 'percent', capacity: 1000 })).toEqual([-10, 20]);
  });
});

describe('yDomain precedence', () => {
  it('an explicit min and max win over the field config and the default', () => {
    expect(yDomain([10, 20], { min: 5, max: 50, fieldMin: 0, fieldMax: 100, capacity: 1000 })).toEqual([5, 50]);
  });
  it('the field config min and max win over the default', () => {
    expect(yDomain([10, 20], { fieldMin: 8, fieldMax: 40, capacity: 1000, unit: 'percent' })).toEqual([8, 40]);
    expect(yDomain([-10, 20], { fieldMin: -50 })).toEqual([-50, 20]);
  });
  it('an explicit max alone keeps the zero baseline', () => {
    expect(yDomain([10, 20], { max: 100 })).toEqual([0, 100]);
  });
  it('the bounds are soft: the range always holds all values', () => {
    expect(yDomain([10, 200], { min: 50, max: 100 })).toEqual([10, 200]);
    expect(yDomain([-5, 20], { fieldMin: 0 })).toEqual([-5, 20]);
  });
  it('a min alone keeps the data max as the top of a negative series', () => {
    expect(yDomain([-20, -10], { min: -50 })).toEqual([-50, -10]);
    expect(yDomain([-20, -10], { fieldMin: -50 })).toEqual([-50, -10]);
  });
  it('null field bounds count as not set', () => {
    expect(yDomain([10, 20], { fieldMin: null, fieldMax: null })).toEqual([0, 20]);
  });
});

describe('yDomain min "auto" (opt-out)', () => {
  it('uses the data min and the data max', () => {
    expect(yDomain([3, 9, 5], { min: 'auto' })).toEqual([3, 9]);
  });
  it('wins over the field min and ignores the unit top and the capacity', () => {
    expect(yDomain([40, 60], { min: 'auto', fieldMin: 0, unit: 'percent', capacity: 1000 })).toEqual([40, 60]);
  });
  it('keeps the minimum span, centred on the data', () => {
    const [lo, hi] = yDomain([41, 41.2, 41], { min: 'auto' });
    expect(hi - lo).toBeCloseTo(4.12);
    expect((lo + hi) / 2).toBeCloseTo(41.1);
  });
  it('keeps an explicit max and moves the min down to get the minimum span', () => {
    expect(yDomain([3, 9], { min: 'auto', max: 20 })).toEqual([3, 20]);
    const [lo, hi] = yDomain([99.9, 100], { min: 'auto', max: 100 });
    expect(hi).toBe(100);
    expect(lo).toBeCloseTo(90);
  });
});
