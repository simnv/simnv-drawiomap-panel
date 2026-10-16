import { describe, expect, it } from 'vitest';
import { applyLayout, pan, readViewBox, viewBoxFor, zoomAt } from './zoom';

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

describe('zoomAt and pan', () => {
  it('zooms around a point', () => {
    const z = zoomAt(base, 0.5, 500, 250);
    expect(z).toEqual({ x: 250, y: 125, w: 500, h: 250 });
  });
  it('pans', () => {
    expect(pan(base, 10, -5)).toEqual({ x: -10, y: 5, w: 1000, h: 500 });
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
