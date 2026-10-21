import { describe, expect, it } from 'vitest';
import {
  arrowAnchor,
  bendLengths,
  parsePathPoints,
  pathGeometry,
  pointAt,
  polylineLength,
  slicePolyline,
} from './geometry';

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
    const m = geo.pointAt(75);
    expect(m.x).toBeCloseTo(42.5); // ((75 + 10) / 2)
    expect(m.y).toBeCloseTo(2.5);
    expect(m.angle).toBeCloseTo(0);
    const poly = geo.polyline(0, 150);
    expect(poly.length).toBeGreaterThan(10);
    expect(poly[0]).toEqual({ x: 5, y: 2.5 });
    expect(poly[poly.length - 1]).toEqual({ x: 55, y: 27.5 });
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
