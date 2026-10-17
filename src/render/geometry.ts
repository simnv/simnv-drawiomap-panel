export interface Point {
  x: number;
  y: number;
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Z: 0, C: 6, S: 4, Q: 4, T: 2, A: 7 };

/**
 * Vertices of an SVG path. Lines are exact; curves contribute their end point only
 * (draw.io orthogonal edges with rounded=0 are pure M/L). Pure, so jsdom tests work without getPointAtLength.
 */
export function parsePathPoints(d: string): Point[] {
  const tokens = d.match(/[MLHVZCSQTAmlhvzcsqta]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens) {
    return [];
  }
  const pts: Point[] = [];
  let cmd = '';
  let i = 0;
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd.toUpperCase() === 'Z') {
        cur = { ...start };
        pts.push(cur);
        continue;
      }
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARGS[upper];
    if (n === undefined || i + n > tokens.length) {
      break;
    }
    const a: number[] = [];
    for (let k = 0; k < n; k++) {
      a.push(num());
    }
    let next: Point;
    switch (upper) {
      case 'H':
        next = { x: rel ? cur.x + a[0] : a[0], y: cur.y };
        break;
      case 'V':
        next = { x: cur.x, y: rel ? cur.y + a[0] : a[0] };
        break;
      default: {
        const ex = a[n - 2];
        const ey = a[n - 1];
        next = { x: rel ? cur.x + ex : ex, y: rel ? cur.y + ey : ey };
      }
    }
    if (upper === 'M') {
      start = next;
      if (rel) {
        cmd = 'l';
      } else {
        cmd = 'L';
      }
    }
    cur = next;
    pts.push(cur);
  }
  return pts;
}

export function polylineLength(pts: Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return l;
}

export function pointAt(pts: Point[], dist: number): { x: number; y: number; angle: number } {
  if (pts.length === 1) {
    return { ...pts[0], angle: 0 };
  }
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (dist <= acc + seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (dist - acc) / seg));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle };
    }
    acc += seg;
  }
  return { ...pts[pts.length - 1], angle: 0 };
}

/** Sub-polyline between two arc-length positions. */
export function slicePolyline(pts: Point[], from: number, to: number): Point[] {
  const out: Point[] = [pointAt(pts, from)].map(({ x, y }) => ({ x, y }));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    acc += seg;
    if (acc > from && acc < to) {
      out.push(pts[i]);
    }
  }
  const end = pointAt(pts, to);
  out.push({ x: end.x, y: end.y });
  return out;
}

/* ---------- affine matrices (plain objects; no DOMMatrix so jsdom tests work) ---------- */

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c || 1;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/* ---------- path geometry: browser API first, parsed polyline as fallback ---------- */

export interface PathGeom {
  /** arc length in the path's own user units */
  length: number;
  /** point and tangent angle at arc length d, in `target` coordinates */
  pointAt(d: number): { x: number; y: number; angle: number };
  /** sampled points between two arc lengths, in `target` coordinates */
  polyline(from: number, to: number): Point[];
}

type PathApi = SVGPathElement & { getTotalLength(): number; getPointAtLength(d: number): { x: number; y: number } };

/**
 * Geometry of an edge path expressed in the coordinate system of `target` (the overlay group of the link, a sibling of the path).
 * Browser: getTotalLength/getPointAtLength on the real path, points mapped with
 * target.getCTM()^-1 × line.getCTM(), so transforms on the edge or its ancestors are respected.
 * jsdom: pure parser on the d attribute (M/L exact, curves approximated); identity transform.
 */
export function pathGeometry(line: SVGPathElement, target: SVGGraphicsElement): PathGeom {
  const api = line as PathApi;
  const hasApi =
    typeof api.getTotalLength === 'function' &&
    typeof api.getPointAtLength === 'function' &&
    typeof line.getCTM === 'function';
  if (!hasApi) {
    const pts = parsePathPoints(line.getAttribute('d') ?? '');
    return {
      length: polylineLength(pts),
      pointAt: (d) => pointAt(pts, d),
      polyline: (from, to) => slicePolyline(pts, from, to),
    };
  }
  const toM = (m: Matrix | null | undefined): Matrix =>
    m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : IDENTITY;
  const targetCTM = typeof target.getCTM === 'function' ? target.getCTM() : null;
  const M = multiply(invert(toM(targetCTM)), toM(line.getCTM()));
  const length = api.getTotalLength();
  const clamp = (d: number) => Math.min(length, Math.max(0, d));
  const at = (d: number): Point => {
    const p = api.getPointAtLength(clamp(d));
    return applyMatrix(M, { x: p.x, y: p.y });
  };
  return {
    length,
    pointAt(d) {
      const p = at(d);
      const fwd = at(d + 0.5);
      const back = at(d - 0.5);
      return { x: p.x, y: p.y, angle: Math.atan2(fwd.y - back.y, fwd.x - back.x) };
    },
    polyline(from, to) {
      const n = Math.max(2, Math.ceil(Math.abs(to - from) / 4));
      const out: Point[] = [];
      for (let i = 0; i <= n; i++) {
        out.push(at(from + ((to - from) * i) / n));
      }
      return out;
    },
  };
}
