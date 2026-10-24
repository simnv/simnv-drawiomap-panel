import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltipPlace';

describe('placeTooltip', () => {
  it('sits below and to the right of the anchor', () => {
    expect(placeTooltip(100, 50, 200, 80, 1000, 800)).toEqual({ x: 110, y: 60 });
  });
  it('flips to the left of the anchor near the right edge', () => {
    expect(placeTooltip(900, 50, 200, 80, 1000, 800)).toEqual({ x: 690, y: 60 });
  });
  it('flips above the anchor near the bottom edge', () => {
    expect(placeTooltip(100, 780, 200, 80, 1000, 800)).toEqual({ x: 110, y: 690 });
  });
  it('stays inside the view when the box fits on no side', () => {
    expect(placeTooltip(150, 50, 300, 80, 320, 800)).toEqual({ x: 20, y: 60 });
    expect(placeTooltip(5, 50, 300, 80, 200, 800)).toEqual({ x: 0, y: 60 });
  });
  it('uses the given offset', () => {
    expect(placeTooltip(0, 0, 10, 10, 100, 100, 4)).toEqual({ x: 4, y: 4 });
  });
});
