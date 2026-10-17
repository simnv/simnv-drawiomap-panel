import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  clampFactor,
  clientToView,
  isDefaultView,
  pinchView,
  readViewBox,
  viewBoxFor,
  zoomAt,
} from './zoom';

const base = { x: 0, y: 0, w: 1000, h: 500 };
const box = { width: 400, height: 300 };

describe('viewBoxFor', () => {
  it('fit keeps the base viewBox and fills the box', () => {
    expect(viewBoxFor({ mode: 'fit', percent: 100, wheel: false, pan: false }, base, box)).toEqual({
      viewBox: base,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    });
  });
  it('fit-width scales to the box width', () => {
    expect(viewBoxFor({ mode: 'fit-width', percent: 100, wheel: false, pan: false }, base, box)).toEqual({
      viewBox: base,
      width: '400px',
      height: '200px',
      overflow: 'auto',
    });
  });
  it('original and custom use pixels', () => {
    expect(viewBoxFor({ mode: 'original', percent: 100, wheel: false, pan: false }, base, box).width).toBe('1000px');
    expect(viewBoxFor({ mode: 'custom', percent: 50, wheel: false, pan: false }, base, box)).toMatchObject({
      width: '500px',
      height: '250px',
    });
  });
});

describe('zoomAt', () => {
  it('zooms around a point', () => {
    const z = zoomAt(base, 0.5, 500, 250);
    expect(z).toEqual({ x: 250, y: 125, w: 500, h: 250 });
  });
});

describe('readViewBox and applyLayout', () => {
  it('reads and writes the root attributes', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.setAttribute('viewBox', '0 0 10 20');
    expect(readViewBox(root)).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    applyLayout(root, { viewBox: { x: 1, y: 2, w: 3, h: 4 }, width: '100%', height: '50px', overflow: 'auto' });
    expect(root.getAttribute('viewBox')).toBe('1 2 3 4');
    expect(root.getAttribute('width')).toBe('100%');
    expect(root.getAttribute('height')).toBe('50px');
    expect(root.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });
  it('falls back to width/height when viewBox is missing', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.setAttribute('width', '12px');
    root.setAttribute('height', '7px');
    expect(readViewBox(root)).toEqual({ x: 0, y: 0, w: 12, h: 7 });
  });
});

describe('pinch and pan math', () => {
  // the svg box is 400x200 px at (100, 50); the base viewBox 1000x500 fills it at 0.4 px per unit
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  it('maps client pixels to viewBox units with xMidYMid meet letterboxing', () => {
    expect(clientToView(base, rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToView(base, rect, 300, 150)).toEqual({ x: 500, y: 250 });
    // a square viewBox in the same box: 200 px wide, centred, so it starts at x = 200 px
    const sq = { x: 0, y: 0, w: 100, h: 100 };
    expect(clientToView(sq, rect, 200, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToView(sq, rect, 400, 250)).toEqual({ x: 100, y: 100 });
  });

  it('a pinch keeps the content point under the gesture midpoint', () => {
    const anchor = clientToView(base, rect, 200, 100);
    const v = pinchView(base, base, rect, anchor, { x: 200, y: 100 }, 2);
    expect(v.w).toBeCloseTo(500);
    expect(v.h).toBeCloseTo(250);
    const back = clientToView(v, rect, 200, 100);
    expect(back.x).toBeCloseTo(anchor.x);
    expect(back.y).toBeCloseTo(anchor.y);
  });

  it('a moving midpoint pans the view with the fingers', () => {
    const anchor = clientToView(base, rect, 200, 100);
    const v = pinchView(base, base, rect, anchor, { x: 240, y: 120 }, 1);
    // 40 px right at 0.4 px per unit: the content moves 100 units right, the view origin 100 units left
    expect(v).toEqual({ x: -100, y: -50, w: 1000, h: 500 });
  });

  it('clamps the scale to 0.2x..10x of the base', () => {
    const anchor = { x: 500, y: 250 };
    const mid = { x: 300, y: 150 };
    expect(pinchView(base, base, rect, anchor, mid, 100).w).toBeCloseTo(100);
    expect(pinchView(base, base, rect, anchor, mid, 0.01).w).toBeCloseTo(5000);
    expect(clampFactor(base, 0.01, base)).toBeCloseTo(0.1);
    expect(clampFactor({ ...base, w: 100, h: 50 }, 0.5, base)).toBeCloseTo(1);
    expect(clampFactor(base, 1.1, base)).toBeCloseTo(1.1);
  });

  it('isDefaultView is true for no view and for the base view only', () => {
    expect(isDefaultView(null, base)).toBe(true);
    expect(isDefaultView({ ...base }, base)).toBe(true);
    expect(isDefaultView({ ...base, x: 1e-9 }, base)).toBe(true);
    expect(isDefaultView(zoomAt(base, 0.9, 0, 0), base)).toBe(false);
    expect(isDefaultView({ ...base, x: 5 }, base)).toBe(false);
  });
});
