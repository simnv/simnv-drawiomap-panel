import { describe, expect, it } from 'vitest';
import { SHEET_BELOW } from '../interact/Card';
import { legendCorners, stampCorner } from './legendCorners';
import type { LegendCorner } from '../types';

describe('legendCorners', () => {
  it('places the four corners of a wide panel', () => {
    expect(legendCorners(0, 0, 800)).toEqual({
      'top-left': { left: 4, top: 4 },
      // below the area of the Grafana panel menu button
      'top-right': { right: 4, top: 32 },
      'bottom-left': { left: 4, bottom: 4 },
      'bottom-right': { right: 4, bottom: 4 },
    });
  });

  it('puts the top-left legend below the band and the row of the reset button and the badge', () => {
    expect(legendCorners(40, 20, 800)['top-left']).toEqual({ left: 4, top: 40 + 4 + 20 + 4 });
    expect(legendCorners(40, 0, 800)['top-left']).toEqual({ left: 4, top: 44 });
  });

  it('a wide panel keeps the top-right legend below the menu area or the band, not below the row', () => {
    expect(legendCorners(0, 32, 800)['top-right']).toEqual({ right: 4, top: 32 });
    expect(legendCorners(60, 32, 800)['top-right']).toEqual({ right: 4, top: 64 });
  });

  it('a narrow panel puts the top-right legend below the row, when the row shows', () => {
    const narrow = SHEET_BELOW - 1;
    expect(legendCorners(10, 32, narrow)['top-right']).toEqual({ right: 4, top: 10 + 4 + 32 + 4 });
    expect(legendCorners(10, 0, narrow)['top-right']).toEqual({ right: 4, top: 32 });
    expect(legendCorners(10, 32, SHEET_BELOW)['top-right']).toEqual({ right: 4, top: 32 });
  });
});

describe('stampCorner', () => {
  const stamp = { width: 160, height: 28 };
  const area = { width: 800, height: 400 };
  /** A legend of w × h px at a corner of the area, with the corner offset of 4 px. */
  const at = (corner: LegendCorner, width: number, height: number, a = area) => ({
    x: corner.endsWith('left') ? 4 : a.width - 4 - width,
    y: corner.startsWith('top') ? 32 : a.height - 4 - height,
    width,
    height,
  });

  it('puts the timestamp in the bottom-right corner when the legend is at a top corner or hidden', () => {
    expect(stampCorner('top-right', at('top-right', 90, 28), stamp, area)).toEqual({ right: 4, bottom: 4 });
    expect(stampCorner('top-left', at('top-left', 90, 28), stamp, area)).toEqual({ right: 4, bottom: 4 });
    expect(stampCorner('bottom-right', null, stamp, area)).toEqual({ right: 4, bottom: 4 });
  });

  it('puts the timestamp directly left of a bottom-right legend', () => {
    expect(stampCorner('bottom-right', at('bottom-right', 90, 28), stamp, area)).toEqual({
      right: 4 + 90 + 4,
      bottom: 4,
    });
  });

  it('puts the timestamp beside a bottom-left legend, towards the middle of the panel', () => {
    expect(stampCorner('bottom-left', at('bottom-left', 90, 28), stamp, area)).toEqual({ left: 4 + 90 + 4, bottom: 4 });
  });

  it('puts the timestamp above the legend when the row is too narrow for both', () => {
    // 4 + 280 + 4 + 160 + 4 = 452
    const wide = { width: 452, height: 400 };
    expect(stampCorner('bottom-right', at('bottom-right', 280, 120, wide), stamp, wide)).toEqual({
      right: 4 + 280 + 4,
      bottom: 4,
    });
    const narrow = { width: 451, height: 400 };
    expect(stampCorner('bottom-right', at('bottom-right', 280, 120, narrow), stamp, narrow)).toEqual({
      right: 4,
      bottom: 4 + 120 + 4,
    });
    const phone = { width: 375, height: 300 };
    expect(stampCorner('bottom-left', at('bottom-left', 280, 120, phone), stamp, phone)).toEqual({
      left: 4,
      bottom: 4 + 120 + 4,
    });
  });

  it('moves the timestamp to the bottom-left corner when a long top-right legend reaches the bottom-right corner', () => {
    const short = { width: 500, height: 120 };
    expect(stampCorner('top-right', at('top-right', 200, 80, short), stamp, short)).toEqual({ left: 4, bottom: 4 });
  });

  it('hides the timestamp when neither place fits beside a short expanded legend', () => {
    const short = { width: 375, height: 64 };
    expect(stampCorner('bottom-right', at('bottom-right', 280, 32, short), stamp, short).visibility).toBe('hidden');
  });

  it('hides the timestamp when no legend shows and the timestamp cannot fit inside the panel', () => {
    expect(stampCorner('bottom-right', null, stamp, { width: 120, height: 100 }).visibility).toBe('hidden');
    expect(stampCorner('bottom-right', null, stamp, { width: 200, height: 20 }).visibility).toBe('hidden');
  });

  it('hides the timestamp when no place fits in the panel', () => {
    const tiny = { width: 200, height: 60 };
    const legend = at('bottom-right', 190, 50, tiny);
    const place = stampCorner('bottom-right', legend, stamp, tiny);
    expect(place.visibility).toBe('hidden');
  });
});
