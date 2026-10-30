import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltipPlace';

// a 200 × 80 box in a 1000 × 800 view, margin 10
const W = 200;
const H = 80;
const VW = 1000;
const VH = 800;

describe('placeTooltip', () => {
  it('sits below and to the right of the anchor', () => {
    expect(placeTooltip(100, 50, W, H, VW, VH)).toEqual({ x: 110, y: 60 });
  });

  it.each([
    ['right edge: flips to the left of the anchor', 900, 50, { x: 690, y: 60 }],
    ['bottom edge: flips above the anchor', 100, 780, { x: 110, y: 690 }],
    ['bottom-right corner: flips on both axes', 900, 780, { x: 690, y: 690 }],
    ['exactly fits after the anchor, with the margin to the edge', 780, 700, { x: 790, y: 710 }],
    ['one px too far: flips', 781, 701, { x: 571, y: 611 }],
    ['left edge: stays after the anchor', 0, 50, { x: 10, y: 60 }],
    ['top edge: stays after the anchor', 100, 0, { x: 110, y: 10 }],
  ])('%s', (_name, x, y, want) => {
    expect(placeTooltip(x, y, W, H, VW, VH)).toEqual(want);
  });

  it.each([
    ['anchor left of the view', -50, 50, { x: 10, y: 60 }],
    ['anchor above the view', 100, -30, { x: 110, y: 10 }],
    ['anchor right of the view', 1200, 50, { x: 790, y: 60 }],
    ['anchor below the view', 100, 900, { x: 110, y: 710 }],
    ['anchor beyond both far edges', 5000, 5000, { x: 790, y: 710 }],
  ])('%s: the box stays inside the view', (_name, x, y, want) => {
    expect(placeTooltip(x, y, W, H, VW, VH)).toEqual(want);
  });

  it('holds the box inside a narrow view when it fits on neither side of the anchor', () => {
    // a 200 px box, anchor at 900 in a 600 px view: before the anchor would be at 690, outside
    expect(placeTooltip(900, 50, W, H, 600, VH)).toEqual({ x: 390, y: 60 });
    expect(placeTooltip(150, 50, 300, H, 320, VH)).toEqual({ x: 10, y: 60 });
  });

  it('puts a box wider than the view at the near margin', () => {
    expect(placeTooltip(5, 50, 300, H, 200, VH)).toEqual({ x: 10, y: 60 });
  });

  it('uses the given margin', () => {
    expect(placeTooltip(0, 0, 10, 10, 100, 100, 4)).toEqual({ x: 4, y: 4 });
    expect(placeTooltip(99, 99, 10, 10, 100, 100, 4)).toEqual({ x: 85, y: 85 });
  });
});

describe('placeTooltip with an anchor box', () => {
  it('sits below the bottom of the anchor box, or above its top: it never covers the box', () => {
    // a 28 px high anchor at y 50: below it at 50 + 28 + 10
    expect(placeTooltip(100, 50, W, H, VW, VH, 10, 10, 28)).toEqual({ x: 110, y: 88 });
    // at the bottom of the view: above the top of the box
    expect(placeTooltip(100, 760, W, H, VW, VH, 10, 10, 28)).toEqual({ x: 110, y: 670 });
  });
});
