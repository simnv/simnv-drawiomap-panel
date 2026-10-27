import { describe, expect, it, vi } from 'vitest';
import {
  arrowAnchor,
  bendLengths,
  drawnStrokeWidth,
  originalStrokeWidth,
  parsePathPoints,
  pathGeometry,
  pointAt,
  polylineLength,
  relativeMatrix,
  slicePolyline,
} from './geometry';

describe('originalStrokeWidth and drawnStrokeWidth', () => {
  const rect = (attrs: string) => {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><rect ${attrs}/></svg>`;
    return host.querySelector('rect') as SVGElement;
  };
  it('the original width: the original inline style, else the attribute, else 1', () => {
    expect(originalStrokeWidth(rect('stroke-width="4"'), '3')).toBe(3);
    expect(originalStrokeWidth(rect('stroke-width="4"'))).toBe(4);
    expect(originalStrokeWidth(rect('stroke-width="4"'), '')).toBe(4);
    expect(originalStrokeWidth(rect(''))).toBe(1);
    expect(originalStrokeWidth(rect('stroke-width="x"'))).toBe(1);
  });
  it('the drawn width follows a later inline write; the original does not', () => {
    const el = rect('stroke-width="4"');
    expect(drawnStrokeWidth(el)).toBe(4);
    el.style.strokeWidth = '12';
    expect(drawnStrokeWidth(el)).toBe(12);
    expect(originalStrokeWidth(el)).toBe(4);
    expect(originalStrokeWidth(el, '2')).toBe(2);
  });
});

describe('parsePathPoints', () => {
  it('parses M/L absolute', () => {
    expect(parsePathPoints('M 0 0 L 100 0 L 100 50')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
  it('parses compact syntax, relative commands, H/V and Z', () => {
    expect(parsePathPoints('M10,10l20,0v10h-20z')).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 20 },
      { x: 10, y: 20 },
      { x: 10, y: 10 },
    ]);
  });
  it('approximates curves by their end points', () => {
    expect(parsePathPoints('M 0 0 Q 50 50 100 0 C 1 1 2 2 100 100')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });
  it('returns [] for garbage', () => {
    expect(parsePathPoints('')).toEqual([]);
  });
});

describe('length, pointAt, slice', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ];
  it('length', () => expect(polylineLength(pts)).toBe(150));
  it('pointAt with tangent angle', () => {
    expect(pointAt(pts, 75)).toEqual({ x: 75, y: 0, angle: 0 });
    const p = pointAt(pts, 125);
    expect(p.x).toBe(100);
    expect(p.y).toBe(25);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
    expect(pointAt(pts, 999)).toMatchObject({ x: 100, y: 50 });
  });
  it('slice', () => {
    expect(slicePolyline(pts, 0, 75)).toEqual([
      { x: 0, y: 0 },
      { x: 75, y: 0 },
    ]);
    expect(slicePolyline(pts, 75, 150)).toEqual([
      { x: 75, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
});

describe('relativeMatrix', () => {
  const NS = 'http://www.w3.org/2000/svg';
  const ident = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  /** svg > g(a) > path, svg > g(b) > circle: the path and the marker of an edge in two groups */
  const mk = (a = '', b = '') => {
    const svg = document.createElementNS(NS, 'svg');
    svg.innerHTML = `<g transform="${a}"><path d="M 0 0 L 10 0"/></g><g transform="${b}"><circle r="2"/></g>`;
    return { svg, line: svg.querySelector('path')!, marker: svg.querySelector('circle')! };
  };
  it('maps through the CTMs: the inverse of the target times the source', () => {
    const { line, marker } = mk();
    Object.assign(line, { getCTM: () => ({ ...ident, a: 2, d: 2, e: 10, f: 20 }) });
    Object.assign(marker, { getCTM: () => ({ ...ident, e: 5 }) });
    expect(relativeMatrix(marker, line)).toEqual({ a: 0.5, b: 0, c: 0, d: 0.5, e: -2.5, f: -10 });
  });
  it('reads the screen CTMs when asked, and takes a CTM of the target that the caller has read', () => {
    const { svg, line } = mk();
    const own = vi.fn(() => ({ ...ident, a: 2, d: 2 }));
    const root = vi.fn(() => ({ ...ident, e: 4 }));
    Object.assign(line, { getScreenCTM: own, getCTM: () => null });
    Object.assign(svg, { getScreenCTM: root, getCTM: () => null });
    expect(relativeMatrix(line, svg, { screen: true })).toEqual({ a: 2, b: 0, c: 0, d: 2, e: -4, f: 0 });
    root.mockClear();
    expect(relativeMatrix(line, svg, { screen: true, toCtm: ident })).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect(root).not.toHaveBeenCalled();
  });
  it('is undefined for a CTM that is null, singular or not finite', () => {
    for (const bad of [null, { ...ident, a: 0, d: 0 }, { ...ident, d: 1e-12 }, { ...ident, e: NaN }]) {
      const { line, marker } = mk();
      Object.assign(line, { getCTM: () => ident });
      Object.assign(marker, { getCTM: () => bad });
      expect(relativeMatrix(marker, line)).toBeUndefined();
      expect(relativeMatrix(line, marker)).toBeUndefined();
    }
  });
  it('takes a small uniform scale: it is not singular', () => {
    const { line, marker } = mk();
    Object.assign(line, { getCTM: () => ident });
    Object.assign(marker, { getCTM: () => ({ ...ident, a: 1e-6, d: 1e-6 }) });
    expect(relativeMatrix(marker, line)).toEqual({ ...ident, a: 1e-6, d: 1e-6 });
    expect(relativeMatrix(line, marker)).toEqual({ ...ident, a: 1e6, d: 1e6 });
  });
  it('keeps a source that collapses (scale(0)) only when asked: `singular`', () => {
    const { line, marker } = mk();
    const zero = { ...ident, a: 0, d: 0 };
    Object.assign(line, { getCTM: () => ident });
    Object.assign(marker, { getCTM: () => zero });
    expect(relativeMatrix(marker, line, { singular: true })).toEqual(zero);
    expect(relativeMatrix(line, marker, { singular: true })).toBeUndefined();
  });
  it('composes the transform attributes up to the common ancestor when the engine has no CTM (jsdom)', () => {
    const { svg, line, marker } = mk('translate(10 20) scale(2)', 'translate(5,0)');
    expect(relativeMatrix(marker, line)).toEqual({ a: 0.5, b: 0, c: 0, d: 0.5, e: -2.5, f: -10 });
    expect(relativeMatrix(marker, svg)).toEqual({ ...ident, e: 5 });
  });
  it('is undefined for a transform attribute that is not resolved or is singular', () => {
    for (const t of ['rotate(45)', 'scale(0)']) {
      const { line, marker } = mk('', t);
      expect(relativeMatrix(marker, line)).toBeUndefined();
    }
  });
});

describe('pathGeometry', () => {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = () => {
    const svg = document.createElementNS(NS, 'svg');
    const g = document.createElementNS(NS, 'g') as SVGGElement;
    const p = document.createElementNS(NS, 'path') as SVGPathElement;
    p.setAttribute('d', 'M 0 0 L 100 0 L 100 50');
    svg.append(p, g);
    return { g, p };
  };
  it('falls back to the parsed polyline when the browser API is missing (jsdom)', () => {
    const { g, p } = mk();
    const geo = pathGeometry(p, g);
    expect(geo.length).toBe(150);
    expect(geo.pointAt(75)).toEqual({ x: 75, y: 0, angle: 0 });
    expect(geo.polyline(75, 150)).toEqual([
      { x: 75, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
  it('uses getTotalLength/getPointAtLength and converts through the CTMs', () => {
    const { g, p } = mk();
    Object.assign(p, {
      getTotalLength: () => 150,
      getPointAtLength: (d: number) => (d <= 100 ? { x: d, y: 0 } : { x: 100, y: d - 100 }),
      getCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 }),
    });
    Object.assign(g, { getCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }) });
    const geo = pathGeometry(p, g);
    expect(geo.length).toBe(150);
    // the matrix from the path's space into the target's: target⁻¹ × line
    expect(geo.matrix).toEqual({ a: 0.5, b: 0, c: 0, d: 0.5, e: 5, f: 2.5 });
    const m = geo.pointAt(75);
    expect(m.x).toBeCloseTo(42.5); // ((75 + 10) / 2)
    expect(m.y).toBeCloseTo(2.5);
    expect(m.angle).toBeCloseTo(0);
    const poly = geo.polyline(0, 150);
    expect(poly.length).toBeGreaterThan(10);
    expect(poly[0]).toEqual({ x: 5, y: 2.5 });
    expect(poly[poly.length - 1]).toEqual({ x: 55, y: 27.5 });
  });
  it('collapses a path with its own scale(0) to one point and keeps a small scale (the target is the identity)', () => {
    const { g, p } = mk();
    Object.assign(g, { getCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
    for (const s of [0, 1e-5]) {
      Object.assign(p, {
        getTotalLength: () => 150,
        getPointAtLength: (d: number) => (d <= 100 ? { x: d, y: 0 } : { x: 100, y: d - 100 }),
        getCTM: () => ({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 }),
      });
      const poly = pathGeometry(p, g).polyline(0, 150);
      expect(poly[poly.length - 1].x).toBeCloseTo(100 * s, 12);
      expect(poly[poly.length - 1].y).toBeCloseTo(50 * s, 12);
    }
  });
  it('keeps only the own transform of the path for a sibling target in a scaled group', () => {
    const { g, p } = mk();
    // parent group: scale 2, translate (100, 0); the path adds translate (10, 5)
    Object.assign(p, {
      getTotalLength: () => 150,
      getPointAtLength: (d: number) => (d <= 100 ? { x: d, y: 0 } : { x: 100, y: d - 100 }),
      getCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 120, f: 10 }),
    });
    Object.assign(g, { getCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 0 }) });
    const geo = pathGeometry(p, g);
    const m = geo.pointAt(150);
    expect(m.x).toBeCloseTo(110);
    expect(m.y).toBeCloseTo(55);
  });
  it('measures a path once: the length and each arc length are read once, the matrices on every call', () => {
    const { g, p } = mk();
    const getTotalLength = vi.fn(() => 150);
    const getPointAtLength = vi.fn((d: number) => (d <= 100 ? { x: d, y: 0 } : { x: 100, y: d - 100 }));
    const lineCtm = vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }));
    const targetCtm = vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }));
    Object.assign(p, { getTotalLength, getPointAtLength, getCTM: lineCtm });
    Object.assign(g, { getCTM: targetCtm });
    const first = pathGeometry(p, g);
    const poly = first.polyline(0, 150);
    const tip = first.pointAt(75);
    const reads = getPointAtLength.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    const second = pathGeometry(p, g);
    expect(second.length).toBe(150);
    expect(second.bends).toEqual(first.bends);
    expect(second.polyline(0, 150)).toEqual(poly);
    expect(second.pointAt(75)).toEqual(tip);
    expect(getTotalLength).toHaveBeenCalledTimes(1);
    expect(getPointAtLength).toHaveBeenCalledTimes(reads);
    expect(lineCtm).toHaveBeenCalledTimes(2);
    expect(targetCtm).toHaveBeenCalledTimes(2);
    // a new arc length is one more read
    second.pointAt(20);
    expect(getPointAtLength.mock.calls.length).toBeGreaterThan(reads);
    // the matrix of the call applies to the cached points
    targetCtm.mockReturnValue({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect(pathGeometry(p, g).pointAt(75).x).toBeCloseTo(37.5);
    // another path element measures again
    const other = mk();
    const otherLength = vi.fn(() => 150);
    Object.assign(other.p, { getTotalLength: otherLength, getPointAtLength, getCTM: lineCtm });
    pathGeometry(other.p, other.g);
    expect(otherLength).toHaveBeenCalledTimes(1);
  });
});

describe('bendLengths', () => {
  it('lists the arc length of each direction change', () => {
    expect(bendLengths(parsePathPoints('M 0 0 L 100 0 L 100 30 L 200 30'))).toEqual([100, 130]);
  });
  it('ignores collinear vertices, repeated points and the path ends', () => {
    expect(bendLengths(parsePathPoints('M 0 0 L 40 0 L 40 0 L 100 0 L 100 50'))).toEqual([100]);
    expect(bendLengths(parsePathPoints('M 0 0 L 100 0'))).toEqual([]);
  });
  it('ignores a direction change of a few degrees', () => {
    expect(
      bendLengths([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 3 },
      ])
    ).toEqual([]);
    expect(
      bendLengths([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 20 },
      ])
    ).toEqual([100]);
  });
});

describe('arrowAnchor', () => {
  const clear = 16;
  it('keeps the target on a straight path', () => {
    expect(arrowAnchor([], 200, 100, clear)).toBe(100);
  });
  it('keeps the target when it already has the clearance', () => {
    expect(arrowAnchor([40], 300, 150, clear)).toBe(150);
  });
  it('moves the tip off a corner of an L-shaped path to the nearest clear point', () => {
    // L = 200, bend at 100 (the middle): the tip at 100 sits on the corner.
    const at = arrowAnchor([100], 200, 100, clear);
    expect(Math.abs(at - 100)).toBe(clear);
  });
  it('moves the tip out of the jog of a Z-shaped path', () => {
    // runs: 0..100, jog 100..130, 130..230. The middle (115) is inside the jog.
    const at = arrowAnchor([100, 130], 230, 115, clear);
    expect([100 - clear, 130 + clear]).toContain(at);
  });
  it('moves a tip that is too close to a corner on one side only', () => {
    // bend at 110, tip target 100: 10 px before the corner, so it moves back to 94.
    expect(arrowAnchor([110], 300, 100, clear)).toBe(94);
  });
  it('picks the nearest feasible run, not the first', () => {
    // runs 0..60 (feasible 0..44), 60..70, 70..400 (feasible 86..400); target 62 -> 86 is 24 away, 44 is 18 away
    expect(arrowAnchor([60, 70], 400, 62, clear)).toBe(44);
  });
  it('uses the middle of the longest run when no run has the clearance', () => {
    // runs 0..20, 20..45, 45..60: all shorter than 2 * clear; the path ends are no free space for a middle tip
    expect(arrowAnchor([20, 45], 60, 30, clear)).toBe(32.5);
  });
  it('accepts a run of exactly 2 * clear despite rounding', () => {
    // lo = 16 + 32, hi = 80 - 32 - 1e-14
    expect(arrowAnchor([16, 80 - 1e-14], 200, 48, clear)).toBeCloseTo(48, 9);
  });
  it('treats the path ends as free: a single-direction tip stays at the port', () => {
    expect(arrowAnchor([100], 150, 150, clear)).toBe(150);
    expect(arrowAnchor([100], 150, 0, clear)).toBe(0);
  });
  it('pulls a single-direction tip back from a bend near the port', () => {
    // last bend 8 px before the end: the tip moves to 16 px before the bend
    expect(arrowAnchor([100, 192], 200, 200, clear)).toBe(176);
  });
});

describe('pathGeometry bends', () => {
  const NS = 'http://www.w3.org/2000/svg';
  const make = (d: string) => {
    const svg = document.createElementNS(NS, 'svg');
    const g = document.createElementNS(NS, 'g') as SVGGElement;
    const p = document.createElementNS(NS, 'path') as SVGPathElement;
    p.setAttribute('d', d);
    svg.append(p, g);
    return { g, p };
  };
  it('reports the bends of the parsed polyline (jsdom)', () => {
    const { g, p } = make('M 0 0 L 100 0 L 100 30 L 200 30');
    expect(pathGeometry(p, g).bends).toEqual([100, 130]);
  });
  it('reports the scale of the path in the target', () => {
    const { g, p } = make('M 0 0 L 100 0 L 100 50');
    Object.assign(p, {
      getTotalLength: () => 150,
      getPointAtLength: (d: number) => ({ x: d, y: 0 }),
      getCTM: () => ({ a: 0.25, b: 0, c: 0, d: 0.25, e: 0, f: 0 }),
    });
    // an engine with getTotalLength has getCTM on every element
    Object.assign(g, { getCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
    expect(pathGeometry(p, g).unit).toBeCloseTo(0.25);
    expect(pathGeometry(make('M 0 0 L 1 0').p, make('M 0 0 L 1 0').g).unit).toBe(1);
  });
  it('scales the bends to the browser path length', () => {
    const { g, p } = make('M 0 0 L 100 0 L 100 50');
    Object.assign(p, {
      getTotalLength: () => 300,
      getPointAtLength: (d: number) => ({ x: d, y: 0 }),
      getCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    });
    expect(pathGeometry(p, g).bends).toEqual([200]);
  });
});
