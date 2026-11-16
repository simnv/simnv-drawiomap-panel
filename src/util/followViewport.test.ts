import { describe, expect, it } from 'vitest';
import { FOLLOW_BOTTOM, FOLLOW_TOP, followOffsets, followShift } from './followViewport';

describe('followOffsets', () => {
  const panel = { top: 100, bottom: 900 };

  it('is 0 for a panel that the view shows whole', () => {
    expect(followOffsets(panel, { top: 100, bottom: 900 }, 20)).toEqual({ top: 0, bottom: 0 });
  });

  it('moves the bottom items up by the hidden part of the bottom', () => {
    expect(followOffsets(panel, { top: 100, bottom: 560 }, 20)).toEqual({ top: 0, bottom: 340 });
  });

  it('moves the top items down by the hidden part of the top less the status band, which scrolls away first', () => {
    expect(followOffsets(panel, { top: 112, bottom: 900 }, 20)).toEqual({ top: 0, bottom: 0 });
    expect(followOffsets(panel, { top: 300, bottom: 900 }, 20)).toEqual({ top: 180, bottom: 0 });
    expect(followOffsets(panel, { top: 300, bottom: 900 }, 0)).toEqual({ top: 200, bottom: 0 });
  });

  it('moves both in a panel taller than the view, and nothing for a panel out of view', () => {
    expect(followOffsets({ top: -200, bottom: 1200 }, { top: 112, bottom: 560 }, 0)).toEqual({ top: 312, bottom: 640 });
    expect(followOffsets(panel, { top: 600, bottom: 560 }, 0)).toEqual({ top: 0, bottom: 0 });
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
