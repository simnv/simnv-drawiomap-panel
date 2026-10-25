import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  clampFactor,
  clientToView,
  isDefaultView,
  pinchView,
  readViewBox,
  viewBoxFor,
  viewScaleOf,
  zoomAt,
} from './zoom';

const base = { x: 0, y: 0, w: 1000, h: 500 };
const box = { width: 400, height: 300 };

describe('viewBoxFor', () => {
  it('fit keeps the base viewBox and fills the box; the diagram goes to the top by default', () => {
    expect(viewBoxFor({ mode: 'fit', percent: 100, wheel: false, pan: false }, base, box)).toEqual({
      viewBox: base,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      align: 'top',
    });
    expect(viewBoxFor({ mode: 'fit', percent: 100, wheel: false, pan: false, align: 'center' }, base, box).align).toBe(
      'center'
    );
  });
  it('fit-width scales to the box width', () => {
    expect(viewBoxFor({ mode: 'fit-width', percent: 100, wheel: false, pan: false }, base, box)).toEqual({
      viewBox: base,
      width: '400px',
      height: '200px',
      overflow: 'auto',
      align: 'top',
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

describe('viewBoxFor with minScale', () => {
  const fit = { mode: 'fit', percent: 100, wheel: false, pan: false } as const;
  const fitWidth = { ...fit, mode: 'fit-width' } as const;

  it('minScale 0 or a minScale below the fit scale keeps the fit layout', () => {
    // the fit scale is min(400 / 1000, 300 / 500) = 0.4
    expect(viewBoxFor({ ...fit, minScale: 0 }, base, box)).toEqual(viewBoxFor(fit, base, box));
    expect(viewBoxFor({ ...fit, minScale: 0.3 }, base, box)).toEqual(viewBoxFor(fit, base, box));
    expect(viewBoxFor({ ...fitWidth, minScale: 0.4 }, base, box)).toEqual(viewBoxFor(fitWidth, base, box));
  });
  it('fit: a minScale above the fit scale gives the diagram its pixel size at minScale and scrolls', () => {
    expect(viewBoxFor({ ...fit, minScale: 1.3 }, base, box)).toEqual({
      viewBox: base,
      width: '1300px',
      height: '650px',
      overflow: 'auto',
      align: 'top',
    });
  });
  it('fit: a dimension that does not overflow fills the box, so that the diagram stays centred in it', () => {
    const tall = { x: 0, y: 0, w: 200, h: 1000 };
    // the fit scale is 0.3; at 1 the diagram is 200 px wide in a 400 px box
    expect(viewBoxFor({ ...fit, minScale: 1 }, tall, box)).toMatchObject({
      width: '100%',
      height: '1000px',
      overflow: 'auto',
    });
    const wide = { x: 0, y: 0, w: 2000, h: 100 };
    expect(viewBoxFor({ ...fit, minScale: 1, align: 'center' }, wide, box)).toMatchObject({
      width: '2000px',
      height: '100%',
      overflow: 'auto',
      align: 'center',
    });
  });
  it('fit-width: the content height is the sheet height times the scale', () => {
    expect(viewBoxFor({ ...fitWidth, minScale: 1.3 }, base, box)).toEqual({
      viewBox: base,
      width: '1300px',
      height: '650px',
      overflow: 'auto',
      align: 'top',
    });
  });
  it('a live view changes the viewBox only: the svg box keeps the size of the configured view', () => {
    const view = { x: 100, y: 50, w: 500, h: 250 };
    expect(viewBoxFor({ ...fit, minScale: 1.3 }, base, box, view)).toEqual({
      ...viewBoxFor({ ...fit, minScale: 1.3 }, base, box),
      viewBox: view,
    });
    expect(viewBoxFor(fitWidth, base, box, view)).toEqual({ ...viewBoxFor(fitWidth, base, box), viewBox: view });
    expect(viewBoxFor({ ...fit, mode: 'original' }, base, box, view)).toMatchObject({ width: '1000px', viewBox: view });
  });
  it('the configured view is the default view also when minScale clamps the scale', () => {
    const layout = viewBoxFor({ ...fit, minScale: 1.3 }, base, box);
    expect(isDefaultView(null, base)).toBe(true);
    expect(isDefaultView(layout.viewBox, base)).toBe(true);
    expect(isDefaultView(zoomAt(layout.viewBox, 0.5, 500, 250), base)).toBe(false);
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
    const layout = { viewBox: { x: 1, y: 2, w: 3, h: 4 }, width: '100%', height: '50px', overflow: 'auto' } as const;
    applyLayout(root, { ...layout, align: 'center' });
    expect(root.getAttribute('viewBox')).toBe('1 2 3 4');
    expect(root.getAttribute('width')).toBe('100%');
    expect(root.getAttribute('height')).toBe('50px');
    expect(root.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    applyLayout(root, { ...layout, align: 'top' });
    expect(root.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
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
    expect(clientToView(base, rect, 100, 50, 'center')).toEqual({ x: 0, y: 0 });
    expect(clientToView(base, rect, 300, 150, 'center')).toEqual({ x: 500, y: 250 });
    // a square viewBox in the same box: 200 px wide, centred, so it starts at x = 200 px
    const sq = { x: 0, y: 0, w: 100, h: 100 };
    expect(clientToView(sq, rect, 200, 50, 'center')).toEqual({ x: 0, y: 0 });
    expect(clientToView(sq, rect, 400, 250, 'center')).toEqual({ x: 100, y: 100 });
  });

  it('a pinch keeps the content point under the gesture midpoint', () => {
    const anchor = clientToView(base, rect, 200, 100, 'center');
    const v = pinchView(base, base, rect, anchor, { x: 200, y: 100 }, 2, 'center');
    expect(v.w).toBeCloseTo(500);
    expect(v.h).toBeCloseTo(250);
    const back = clientToView(v, rect, 200, 100, 'center');
    expect(back.x).toBeCloseTo(anchor.x);
    expect(back.y).toBeCloseTo(anchor.y);
  });

  it('a moving midpoint pans the view with the fingers', () => {
    const anchor = clientToView(base, rect, 200, 100, 'center');
    const v = pinchView(base, base, rect, anchor, { x: 240, y: 120 }, 1, 'center');
    // 40 px right at 0.4 px per unit: the content moves 100 units right, the view origin 100 units left
    expect(v).toEqual({ x: -100, y: -50, w: 1000, h: 500 });
  });

  it('clamps the scale to 0.2x..10x of the base', () => {
    const anchor = { x: 500, y: 250 };
    const mid = { x: 300, y: 150 };
    expect(pinchView(base, base, rect, anchor, mid, 100, 'center').w).toBeCloseTo(100);
    expect(pinchView(base, base, rect, anchor, mid, 0.01, 'center').w).toBeCloseTo(5000);
    expect(clampFactor(base, 0.01, base)).toBeCloseTo(0.1);
    expect(clampFactor({ ...base, w: 100, h: 50 }, 0.5, base)).toBeCloseTo(1);
    expect(clampFactor(base, 1.1, base)).toBeCloseTo(1.1);
  });

  it('maps client pixels with xMidYMin meet: the letterbox is below the diagram', () => {
    // a tall box: the base viewBox 1000x500 fills the width at 0.4 px per unit, 200 px high, at the top
    const tall = { left: 100, top: 50, width: 400, height: 600 };
    expect(clientToView(base, tall, 100, 50, 'top')).toEqual({ x: 0, y: 0 });
    expect(clientToView(base, tall, 300, 150, 'top')).toEqual({ x: 500, y: 250 });
    expect(clientToView(base, tall, 300, 350, 'center')).toEqual({ x: 500, y: 250 });
    // a wide box: the diagram is centred horizontally in both alignments
    const wide = { left: 0, top: 0, width: 800, height: 200 };
    expect(clientToView(base, wide, 200, 0, 'top')).toEqual({ x: 0, y: 0 });
    expect(clientToView(base, wide, 200, 0, 'center')).toEqual({ x: 0, y: 0 });
  });

  it('a top-aligned pinch keeps the content point under the midpoint', () => {
    const tall = { left: 100, top: 50, width: 400, height: 600 };
    const anchor = clientToView(base, tall, 200, 100, 'top');
    const v = pinchView(base, base, tall, anchor, { x: 260, y: 140 }, 1.5, 'top');
    const back = clientToView(v, tall, 260, 140, 'top');
    expect(back.x).toBeCloseTo(anchor.x);
    expect(back.y).toBeCloseTo(anchor.y);
    // a drag with no movement at the default view gives the default view back
    const still = pinchView(base, base, tall, anchor, { x: 200, y: 100 }, 1, 'top');
    expect(isDefaultView(still, base)).toBe(true);
  });

  it('isDefaultView is true for no view and for the base view only', () => {
    expect(isDefaultView(null, base)).toBe(true);
    expect(isDefaultView({ ...base }, base)).toBe(true);
    expect(isDefaultView({ ...base, x: 1e-9 }, base)).toBe(true);
    expect(isDefaultView(zoomAt(base, 0.9, 0, 0), base)).toBe(false);
    expect(isDefaultView({ ...base, x: 5 }, base)).toBe(false);
  });
});

describe('viewScaleOf', () => {
  /** an svg with the viewBox of `base` that the browser renders at `width` × `height` pixels */
  const rendered = (width: number, height: number, vb = base) => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    root.getBoundingClientRect = () => ({ width, height }) as DOMRect;
    return root;
  };
  it('fit: the meet scale of the rendered rect, the smaller of the two ratios', () => {
    expect(viewScaleOf(rendered(400, 300))).toBeCloseTo(0.4);
    expect(viewScaleOf(rendered(1000, 200))).toBeCloseTo(0.4);
  });
  it('fit width: the svg is as wide as the box and as tall as the aspect gives', () => {
    expect(viewScaleOf(rendered(400, 200))).toBeCloseTo(0.4);
  });
  it('a minScale layout renders the svg larger than the panel: the rendered size counts', () => {
    expect(viewScaleOf(rendered(1300, 650))).toBeCloseTo(1.3);
  });
  it('a live view: the scale follows the zoomed viewBox', () => {
    expect(viewScaleOf(rendered(400, 300, { x: 100, y: 50, w: 200, h: 100 }))).toBeCloseTo(2);
  });
  it('an svg without a size gives 0', () => {
    expect(viewScaleOf(rendered(0, 0))).toBe(0);
  });
});
