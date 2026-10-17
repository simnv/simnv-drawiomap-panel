import { describe, expect, it } from 'vitest';
import { parsePathPoints, pathGeometry, pointAt, polylineLength, slicePolyline } from './geometry';

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
