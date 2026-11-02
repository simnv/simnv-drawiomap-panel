import { pointAt, polylineLength, slicePolyline, type Point } from './geometry';

interface Section {
  centre: Point;
  normal: Point;
  radius: number;
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

/** Includes touches, but excludes disjoint collinear segments. */
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = minus(b, a),
    cd = minus(d, c),
    ac = minus(c, a);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) <= 16 * Number.EPSILON * Math.hypot(ab.x, ab.y) * Math.hypot(cd.x, cd.y)) {
    if (Math.abs(cross(ac, ab)) > 16 * Number.EPSILON * Math.hypot(ac.x, ac.y) * Math.hypot(ab.x, ab.y)) {
      return false;
    }
    return (
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + 1e-10 &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + 1e-10
    );
  }
  const t = cross(ac, cd) / denominator,
    u = cross(ac, ab) / denominator;
  return t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10;
}

/** The margin of the box test below: wider than the tolerance of `intersects`, so no touching pair is skipped. */
const BOX_EPS = 1e-6;

/**
 * True when no two nonadjacent segments of the closed outline meet. Every pair is tested, but a pair whose boxes do
 * not meet skips the segment test: the outline is a long ribbon of short segments, so most pairs stop at the boxes.
 */
function simple(points: Point[]): boolean {
  const n = points.length;
  const x0 = new Float64Array(n);
  const x1 = new Float64Array(n);
  const y0 = new Float64Array(n);
  const y1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    x0[i] = Math.min(a.x, b.x) - BOX_EPS;
    x1[i] = Math.max(a.x, b.x) + BOX_EPS;
    y0[i] = Math.min(a.y, b.y) - BOX_EPS;
    y1[i] = Math.max(a.y, b.y) + BOX_EPS;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) {
        continue;
      }
      if (x0[i] > x1[j] || x0[j] > x1[i] || y0[i] > y1[j] || y0[j] > y1[i]) {
        continue;
      }
      if (intersects(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) {
        return false;
      }
    }
  }
  return true;
}

function outline(sections: Section[], tip: Point, scale: number, keepBase: boolean): Point[] {
  const side = (sign: number) =>
    sections.map(({ centre, normal, radius }, i) => {
      const r = sign * radius * (keepBase && i === 0 ? 1 : scale);
      return { x: centre.x + normal.x * r, y: centre.y + normal.y * r };
    });
  return [tip, ...side(1).reverse(), ...side(-1)];
}

/** A bounded, symmetric ribbon follows the path from its full-width base to its port tip. */
export function pointTaper(
  path: Point[],
  width: number,
  headLength: number
): { line: Point[]; head: Point[]; folded: boolean } {
  path = path.filter((p, i) => i === 0 || p.x !== path[i - 1].x || p.y !== path[i - 1].y);
  const length = polylineLength(path);
  if (length <= 0) {
    return { line: [], head: [], folded: false };
  }
  const base = Math.max(0, length - headLength);
  const taper = slicePolyline(path, base, length);
  taper[taper.length - 1] = path.at(-1)!;
  const total = length - base;
  const arcs = [0];
  const angles: number[] = [];
  for (let i = 1; i < taper.length; i++) {
    const a = taper[i - 1],
      b = taper[i];
    arcs.push(arcs.at(-1)! + Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const previous = angles.at(-1) ?? angle;
    angles.push(previous + Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous)));
  }
  const line = base > 0 ? slicePolyline(path, 0, base) : [];
  if (taper.length === 2) {
    const n = { x: (Math.sin(angles[0]) * width) / 2, y: (-Math.cos(angles[0]) * width) / 2 };
    return {
      line,
      head: [taper[1], { x: taper[0].x + n.x, y: taper[0].y + n.y }, { x: taper[0].x - n.x, y: taper[0].y - n.y }],
      folded: false,
    };
  }
  const samples = new Set([0, total]);
  const step = Math.min(0.25, total / 48);
  for (let s = step; s < total; s += step) {
    samples.add(s);
  }
  const turns = arcs.slice(1, -1).map((at, i) => {
    const reach = Math.min(at - arcs[i], arcs[i + 2] - at) / 2;
    samples.add(at);
    samples.add(at - reach);
    samples.add(at + reach);
    return { at, reach, change: angles[i + 1] - angles[i] };
  });
  const arcEpsilon = 32 * Number.EPSILON * total;
  const sections: Section[] = [...samples]
    .sort((a, b) => a - b)
    .filter((s, i, all) => s < total - arcEpsilon && (i === 0 || s - all[i - 1] > arcEpsilon))
    .map((s) => {
      // Both boundaries use the same centre, radius and normal at each arc position.
      let angle = angles[0];
      for (const turn of turns) {
        angle += turn.change * Math.max(0, Math.min(1, (s - turn.at + turn.reach) / (2 * turn.reach)));
      }
      return {
        centre: pointAt(taper, s),
        normal: { x: Math.sin(angle), y: -Math.cos(angle) },
        radius: (width / 2) * (1 - s / total),
      };
    });
  const tip = taper.at(-1)!;
  // A degenerate fold crosses the base again, crosses a nonadjacent segment, or retraces an adjacent segment.
  const a = outline(sections, tip, 1, true);
  const baseA = a[sections.length],
    baseB = a[sections.length + 1];
  let folded = taper.slice(2).some((p, i) => intersects(baseA, baseB, taper[i + 1], p));
  for (let i = 0; i < taper.length - 1; i++) {
    if (i > 0) {
      const incoming = minus(taper[i], taper[i - 1]);
      const outgoing = minus(taper[i + 1], taper[i]);
      folded ||=
        Math.abs(cross(incoming, outgoing)) <=
          16 * Number.EPSILON * Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y) &&
        incoming.x * outgoing.x + incoming.y * outgoing.y < 0;
    }
    for (let j = i + 2; j < taper.length - 1; j++) {
      folded ||= intersects(taper[i], taper[i + 1], taper[j], taper[j + 1]);
    }
  }
  // Limit both radii together if an inner boundary would cross. The base stays full-width unless the path folds.
  for (let scale = 1; scale >= 2 ** -40; scale /= 2) {
    const head = outline(sections, tip, scale, !folded);
    if (simple(head)) {
      return { line, head, folded };
    }
  }
  // A retraced centreline cannot have a simple ribbon. Keep a small tip on its final segment.
  const last = taper[taper.length - 2];
  const tail = Math.hypot(tip.x - last.x, tip.y - last.y);
  const r = Math.min(width / 2, tail / 4);
  const normal = { x: (tip.y - last.y) / tail, y: -(tip.x - last.x) / tail };
  return {
    line,
    head: [
      tip,
      { x: last.x + normal.x * r, y: last.y + normal.y * r },
      { x: last.x - normal.x * r, y: last.y - normal.y * r },
    ],
    folded: true,
  };
}
