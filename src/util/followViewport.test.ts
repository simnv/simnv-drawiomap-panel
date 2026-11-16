import { describe, expect, it } from 'vitest';
import { FOLLOW_BOTTOM, FOLLOW_TOP, followMaxHeight, followOffsets, followShift } from './followViewport';

describe('followOffsets', () => {
  const panel = { top: 100, bottom: 900 };

  it('is 0 for a panel that the view shows whole', () => {
    expect(followOffsets(panel, { top: 100, bottom: 900 }, 20)).toEqual({ top: 0, bottom: 0 });
  });

  it('moves the bottom items up by the hidden part of the bottom', () => {
    expect(followOffsets(panel, { top: 100, bottom: 560 }, 20)).toEqual({ top: 0, bottom: 340, visible: 460 });
  });

  it('moves the top items down by the hidden part of the top less the status band, which scrolls away first', () => {
    expect(followOffsets(panel, { top: 112, bottom: 900 }, 20)).toEqual({ top: 0, bottom: 0 });
    expect(followOffsets(panel, { top: 300, bottom: 900 }, 20)).toEqual({ top: 180, bottom: 0, visible: 600 });
    expect(followOffsets(panel, { top: 300, bottom: 900 }, 0)).toEqual({ top: 200, bottom: 0, visible: 600 });
  });

  it('moves both in a panel taller than the view', () => {
    expect(followOffsets({ top: -200, bottom: 1200 }, { top: 112, bottom: 560 }, 0)).toEqual({
      top: 312,
      bottom: 640,
      visible: 448,
    });
  });

  it('moves nothing when the visible part is too small for the items, or there is none', () => {
    expect(followOffsets(panel, { top: 790, bottom: 900 }, 0)).toEqual({ top: 0, bottom: 0 });
    expect(followOffsets(panel, { top: 600, bottom: 560 }, 0)).toEqual({ top: 0, bottom: 0 });
  });

  it('never moves the items out of the panel', () => {
    // a short panel: the top items stop 40 px above its bottom, the bottom items 40 px below its top
    const short = { top: 0, bottom: 200 };
    expect(followOffsets(short, { top: 180, bottom: 320 }, 0).top).toBeLessThanOrEqual(160);
    expect(followOffsets({ top: 0, bottom: 1000 }, { top: 0, bottom: 130 }, 0).bottom).toBe(870);
  });
});

describe('followShift', () => {
  it('reads the offset that the hook wrote: down for the top items, up for the bottom items', () => {
    const panel = document.createElement('div');
    expect(followShift(panel, false)).toBe(0);
    panel.style.setProperty(FOLLOW_TOP, '120px');
    panel.style.setProperty(FOLLOW_BOTTOM, '40px');
    expect(followShift(panel, false)).toBe(120);
    expect(followShift(panel, true)).toBe(-40);
  });
});

describe('followMaxHeight', () => {
  it('keeps the legend in the visible part while it follows, and is the plain limit else', () => {
    expect(followMaxHeight(300, 8)).toBe('min(300px, calc(var(--dmap-follow-visible, 308px) - 8px))');
  });
});
