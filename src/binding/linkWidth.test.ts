import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, withDefaults, type LinkWidthOptions } from '../types';
import { formatBits, formatTiers, halfWidth, linkWidthRange, parseTiers, sameTiers, tierOf } from './linkWidth';

const tiers = DEFAULT_OPTIONS.linkWidth.tiers!;
const speed: LinkWidthOptions = { ...DEFAULT_OPTIONS.linkWidth, mode: 'capacity' };

describe('link width', () => {
  it('defaults to the load mode, so a saved panel draws as before', () => {
    expect(withDefaults({} as never).linkWidth.mode).toBe('load');
    expect(withDefaults({ linkWidth: { min: 1, max: 8 } } as never).linkWidth).toMatchObject({
      min: 1,
      max: 8,
      mode: 'load',
    });
    // load: from min to max with the percent; the capacity does not change it
    expect(halfWidth(50, 1e9, DEFAULT_OPTIONS.linkWidth)).toBe(6);
    expect(halfWidth(undefined, 1e9, DEFAULT_OPTIONS.linkWidth)).toBe(2);
  });

  it('picks the highest tier at or below the capacity', () => {
    expect(tierOf(30e6, tiers)).toBe(0);
    expect(tierOf(1e8, tiers)).toBe(1);
    expect(tierOf(120e6, tiers)).toBe(1);
    expect(tierOf(1e9, tiers)).toBe(2);
    expect(tierOf(40e9, tiers)).toBe(3);
    expect(tierOf(undefined, tiers)).toBe(-1);
    expect(tierOf(5, [{ min: 10, width: 1 }])).toBe(-1);
  });

  it('draws a half by its capacity in capacity mode, not by its load; no capacity gives min', () => {
    expect(halfWidth(90, 30e6, speed)).toBe(1.5);
    expect(halfWidth(5, 100e6, speed)).toBe(2.5);
    expect(halfWidth(5, 120e6, speed)).toBe(2.5);
    expect(halfWidth(5, 1e9, speed)).toBe(4);
    expect(halfWidth(50, undefined, speed)).toBe(2);
    // tiers that are not valid draw no tier: every half has min
    expect(
      halfWidth(5, 1e9, {
        ...speed,
        tiers: [
          { min: 1e9, width: 3 },
          { min: 1e8, width: 2 },
        ],
      })
    ).toBe(2);
  });

  it('gives the overlay a width range that holds the tier widths and min', () => {
    expect(linkWidthRange(DEFAULT_OPTIONS.linkWidth)).toEqual({ min: 2, max: 10 });
    expect(linkWidthRange(speed)).toEqual({ min: 1.5, max: 5.5 });
  });

  it('reads and writes the tiers as text, and names the problem of a text that is not valid', () => {
    expect(formatTiers(tiers)).toBe('0: 1.5, 100M: 2.5, 1G: 4, 10G: 5.5');
    expect(parseTiers('0: 1.5, 100M: 2.5, 1G: 4, 10G: 5.5')).toEqual({ tiers });
    expect(parseTiers('0:1, 2.5G:3')).toEqual({
      tiers: [
        { min: 0, width: 1 },
        { min: 2.5e9, width: 3 },
      ],
    });
    expect(parseTiers('1G: 4, 100M: 2.5')).toEqual({ error: 'Tier 2: the speeds must go up' });
    expect(parseTiers('0: 0')).toEqual({ error: 'Tier 1: the width must be more than 0' });
    expect(parseTiers('fast: 2')).toMatchObject({ error: expect.stringContaining('Tier 1') });
    expect(parseTiers('')).toMatchObject({ error: expect.stringContaining('at least one tier') });
    expect([30e6, 120e6, 1e9, 2.5e9, 0].map(formatBits)).toEqual(['30M', '120M', '1G', '2.5G', '0']);
  });

  it('writes the editor text exactly: it reads back to the same speeds (155.52M stays 155.52M)', () => {
    const odd = [
      { min: 0, width: 1 },
      { min: 155.52e6, width: 3 },
      { min: 2.048e6 * 1000, width: 4 },
    ];
    const text = formatTiers(odd);
    expect(text).toBe('0: 1, 155.52M: 3, 2.048G: 4');
    expect(parseTiers(text)).toEqual({ tiers: odd });
    // the grammar of cap: k and K both mean 1000
    expect(parseTiers('0: 1, 100k: 2, 200K: 3')).toEqual({
      tiers: [
        { min: 0, width: 1 },
        { min: 1e5, width: 2 },
        { min: 2e5, width: 3 },
      ],
    });
    expect(parseTiers('0: 0x10')).toMatchObject({ error: expect.stringContaining('Tier 1') });
    expect(sameTiers(odd, [...odd])).toBe(true);
    expect(sameTiers(odd, odd.slice(1))).toBe(false);
  });
});
