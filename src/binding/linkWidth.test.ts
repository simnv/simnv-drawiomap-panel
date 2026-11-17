import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, withDefaults, type LinkWidthOptions } from '../types';
import {
  formatBits,
  formatTiers,
  halfWidth,
  linkWidthRange,
  logWidth,
  parseTiers,
  sameTiers,
  scaleSpeedWidths,
  speedOf,
  tierOf,
} from './linkWidth';

const tiers = [
  { min: 0, width: 1.5 },
  { min: 1e8, width: 2.5 },
  { min: 1e9, width: 4 },
  { min: 1e10, width: 5.5 },
];
const speed: LinkWidthOptions = { ...DEFAULT_OPTIONS.linkWidth, mode: 'capacity', tiers };
const auto: LinkWidthOptions = { min: 1.5, max: 5.5, mode: 'capacity', tiers: [] };

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
    // an empty text is the automatic log scale
    expect(parseTiers('')).toEqual({ tiers: [] });
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

  it('has no default tiers: the Link speed mode is automatic until tiers are written', () => {
    expect(DEFAULT_OPTIONS.linkWidth.tiers).toEqual([]);
    expect(linkWidthRange(auto)).toEqual({ min: 1.5, max: 5.5 });
    // a min above max gives a sorted range
    expect(linkWidthRange({ ...auto, min: 6, max: 2 })).toEqual({ min: 2, max: 6 });
  });

  it('counts speeds to 3 significant digits: cap=1G and 1 000 400 000 are one speed', () => {
    expect(speedOf({ capacity: 1e9 })).toBe(speedOf({ capacity: 1.0004e9 }));
    expect(speedOf({ capacity: 0 })).toBeUndefined();
    expect(speedOf({})).toBeUndefined();
    expect(speedOf(undefined)).toBeUndefined();
  });

  it('places the speeds of the panel on a log scale from min to max', () => {
    // 10G, 25G, 100G: the slowest is min, the fastest max, 25G at its log place
    expect(logWidth(10e9, 10e9, 100e9, auto)).toBe(1.5);
    expect(logWidth(100e9, 10e9, 100e9, auto)).toBe(5.5);
    expect(logWidth(25e9, 10e9, 100e9, auto)).toBeCloseTo(1.5 + 4 * Math.log10(2.5));
    // 100M, 1G, 10G: even steps
    expect(logWidth(1e9, 1e8, 1e10, auto)).toBeCloseTo(3.5);
    // one speed only: the middle
    expect(logWidth(1e9, 1e9, 1e9, auto)).toBe(3.5);
  });

  it('scales the halves of all the links after the bind; a half with no capacity keeps min', () => {
    type Half = { capacity?: number; width: number };
    type Patch = { link: { a2b?: Half; b2a?: Half } };
    const half = (capacity: number | undefined): Half => ({ capacity, width: 1.5 });
    const keep: Patch = { link: { a2b: half(undefined) } };
    const patches = new Map<string, Patch>([
      ['slow', { link: { a2b: half(10e9), b2a: half(10e9) } }],
      ['mid', { link: { a2b: half(25e9) } }],
      ['fast', { link: { a2b: half(100e9) } }],
      ['none', keep],
    ]);
    const before = patches.get('fast');
    scaleSpeedWidths(patches, auto);
    expect(patches.get('slow')!.link.a2b!.width).toBe(1.5);
    expect(patches.get('mid')!.link.a2b!.width).toBeCloseTo(3.09, 2);
    expect(patches.get('fast')!.link.a2b!.width).toBe(5.5);
    // a changed patch is a new object; the old one is not touched
    expect(patches.get('fast')).not.toBe(before);
    expect(before!.link.a2b!.width).toBe(1.5);
    expect(patches.get('none')).toBe(keep);
    // with tiers, or in load mode, nothing changes
    const tiered = new Map<string, Patch>([['fast', { link: { a2b: half(100e9) } }]]);
    scaleSpeedWidths(tiered, speed);
    expect(tiered.get('fast')!.link.a2b!.width).toBe(1.5);
  });
});
