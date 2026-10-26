import type { CellEntry } from '../types';

/**
 * The stroke width a primitive was drawn with, in its user units: the attribute, else the original inline style
 * (`CellEntry.original.strokeWidth`, captured before any patch), else the inline style now, else 1 (the SVG default).
 */
export function strokeWidthOf(el: SVGElement, original?: string): number {
  const n = parseFloat(el.getAttribute('stroke-width') || original || el.style.strokeWidth || '');
  return Number.isFinite(n) ? n : 1;
}

export interface ChartAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  matrix: Matrix;
}

/** The rectangle primitive defines chart bounds. Labels and nested cells never enlarge it. */
export function readChartAnchor(cell: CellEntry, parent: SVGGraphicsElement): ChartAnchor | undefined {
  const shape = cell.shape;
  if (!shape || shape.localName !== 'rect' || typeof shape.getBBox !== 'function') {
    return undefined;
  }
  try {
    const source = shape.getCTM();
    const target = parent.getCTM();
    const valid = (m: Matrix | null): m is Matrix =>
      !!m && [m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) && Math.abs(m.a * m.d - m.b * m.c) > 1e-12;
    if (!valid(source) || !valid(target)) {
      return undefined;
    }
    const bounds = shape.getBBox();
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return undefined;
    }
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      matrix: multiply(invert(target), source),
    };
  } catch {
    return undefined;
  }
}

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

/** A direction change of at most this angle (radians) is no bend: the edge is still one straight run. */
const BEND_ANGLE = (5 * Math.PI) / 180;
/** Rounding slack for the run-length comparisons: a run of exactly 2 × clear fits. */
const EPSILON = 1e-6;

/**
 * Arc length of every bend of a polyline: a vertex where the direction changes by more than a few degrees.
 * Repeated points and collinear vertices are no bends. The path ends are never bends.
 */
export function bendLengths(pts: Point[]): number[] {
  const bends: number[] = [];
  let acc = 0;
  let prev: Point | undefined;
  let heading: number | undefined;
  for (const p of pts) {
    if (!prev) {
      prev = p;
      continue;
    }
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (seg === 0) {
      continue;
    }
    acc += seg;
    const next = Math.atan2(p.y - prev.y, p.x - prev.x);
    if (heading !== undefined) {
      const turn = Math.abs(Math.atan2(Math.sin(next - heading), Math.cos(next - heading)));
      if (turn > BEND_ANGLE) {
        bends.push(acc - seg);
      }
    }
    heading = next;
    prev = p;
  }
  return bends;
}

/**
 * Arc length for an arrow tip, so that the arrow stands on one straight run. The tip keeps `clear` free path on each
 * side, measured to the bends. The path end that holds `target` has no clearance: an arrow at a port stays at the port.
 * Uses the point of a feasible run that is nearest to `target`. Without a feasible run, uses the middle of the longest run.
 */
export function arrowAnchor(bends: number[], length: number, target: number, clear: number): number {
  const stops = [0, ...bends, length];
  let best: number | undefined;
  let longest = { size: -1, mid: target };
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    const lo = from + (i === 1 && target <= 0 ? 0 : clear);
    const hi = to - (i === stops.length - 1 && target >= length ? 0 : clear);
    if (lo <= hi + EPSILON) {
      const at = Math.min(hi, Math.max(lo, target));
      if (best === undefined || Math.abs(at - target) < Math.abs(best - target)) {
        best = at;
      }
    }
    if (to - from > longest.size) {
      longest = { size: to - from, mid: (from + to) / 2 };
    }
  }
  return best ?? longest.mid;
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

/** A plain matrix from a DOMMatrix (or any object with a..f); undefined for null. */
export function toMatrix(m: { a: number; b: number; c: number; d: number; e: number; f: number } | null | undefined) {
  return m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : undefined;
}

/** The scale of a matrix (the square root of its determinant), 1 for a degenerate one. */
export const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

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
  /** arc lengths of the bends (direction changes) of the path, in the units of `length` */
  bends: number[];
  /** length in `target` coordinates of one unit of `length` (1 unless the path has its own scale) */
  unit: number;
  /** the matrix from the path's user space into `target` coordinates (identity in jsdom) */
  matrix: Matrix;
}

type PathApi = SVGPathElement & { getTotalLength(): number; getPointAtLength(d: number): { x: number; y: number } };

/** The measurements of one path that depend on the path alone, in its own user space. */
interface LocalGeom {
  /** true with the browser API (getTotalLength, getPointAtLength, getCTM); false for the parsed polyline (jsdom) */
  api: boolean;
  /** the vertices of the d attribute */
  parsed: Point[];
  /** arc length: getTotalLength, or the parsed polyline length without the API */
  length: number;
  /** arc lengths of the bends, scaled to `length` */
  bends: number[];
  /** the point at a clamped arc length (getPointAtLength once per distinct `d`) */
  at(d: number): Point;
  /** the sample points of `polyline(from, to)`, once per pair */
  samples(from: number, to: number): Point[];
}

/**
 * The cache of `pathGeometry`, by path element. The stage DOM is immutable after the index is built (nothing writes
 * the `d` or the transform of an edge; the zoom writes the viewBox of the root), and a new diagram has new elements,
 * so an entry is never cleared by hand. The matrices are not in it: they are read on every call.
 */
const localGeoms = new WeakMap<SVGPathElement, LocalGeom>();

function localGeom(line: SVGPathElement): LocalGeom {
  const known = localGeoms.get(line);
  if (known) {
    return known;
  }
  const api = line as PathApi;
  const hasApi =
    typeof api.getTotalLength === 'function' &&
    typeof api.getPointAtLength === 'function' &&
    typeof line.getCTM === 'function';
  const parsed = parsePathPoints(line.getAttribute('d') ?? '');
  const parsedLength = polylineLength(parsed);
  let geom: LocalGeom;
  if (!hasApi) {
    geom = {
      api: false,
      parsed,
      length: parsedLength,
      bends: bendLengths(parsed),
      at: (d) => pointAt(parsed, d),
      samples: (from, to) => slicePolyline(parsed, from, to),
    };
  } else {
    const length = api.getTotalLength();
    // Bends come from the vertices of the d attribute. Curves count by their end points, so scale to the real length.
    const scale = parsedLength > 0 && length > 0 ? length / parsedLength : 1;
    const points = new Map<number, Point>();
    const runs = new Map<string, Point[]>();
    const at = (d: number): Point => {
      const clamped = Math.min(length, Math.max(0, d));
      let p = points.get(clamped);
      if (!p) {
        const raw = api.getPointAtLength(clamped);
        p = { x: raw.x, y: raw.y };
        points.set(clamped, p);
      }
      return p;
    };
    geom = {
      api: true,
      parsed,
      length,
      bends: bendLengths(parsed).map((b) => b * scale),
      at,
      samples(from, to) {
        const key = `${from},${to}`;
        let out = runs.get(key);
        if (!out) {
          const n = Math.max(2, Math.ceil(Math.abs(to - from) / 4));
          out = [];
          for (let i = 0; i <= n; i++) {
            out.push(at(from + ((to - from) * i) / n));
          }
          runs.set(key, out);
        }
        return out;
      },
    };
  }
  localGeoms.set(line, geom);
  return geom;
}

/**
 * Geometry of an edge path expressed in the coordinate system of `target` (the overlay group of the link, a sibling of the path).
 * Browser: getTotalLength/getPointAtLength on the real path, points mapped with
 * target.getCTM()^-1 × line.getCTM(), so transforms on the edge or its ancestors are respected.
 * jsdom: pure parser on the d attribute (M/L exact, curves approximated); identity transform.
 * The path is measured once per element (`localGeom`); the matrices are read on every call.
 */
export function pathGeometry(line: SVGPathElement, target: SVGGraphicsElement): PathGeom {
  const local = localGeom(line);
  if (!local.api) {
    return {
      length: local.length,
      pointAt: (d) => pointAt(local.parsed, d),
      polyline: (from, to) => local.samples(from, to),
      bends: local.bends,
      unit: 1,
      matrix: IDENTITY,
    };
  }
  const targetCTM = typeof target.getCTM === 'function' ? target.getCTM() : null;
  const M = multiply(invert(toMatrix(targetCTM) ?? IDENTITY), toMatrix(line.getCTM()) ?? IDENTITY);
  const identity = M.a === 1 && M.b === 0 && M.c === 0 && M.d === 1 && M.e === 0 && M.f === 0;
  const map = (p: Point): Point => (identity ? { x: p.x, y: p.y } : applyMatrix(M, p));
  return {
    length: local.length,
    bends: local.bends,
    unit: scaleOf(M),
    matrix: M,
    pointAt: (d) => tangent(local, d, M),
    polyline: (from, to) => local.samples(from, to).map(map),
  };
}

/** The point at `d` with the tangent angle, mapped through `M`: the direction between the points 0.5 before and after. */
function tangent(local: LocalGeom, d: number, M: Matrix): { x: number; y: number; angle: number } {
  const p = applyMatrix(M, local.at(d));
  const fwd = applyMatrix(M, local.at(d + 0.5));
  const back = applyMatrix(M, local.at(d - 0.5));
  return { x: p.x, y: p.y, angle: Math.atan2(fwd.y - back.y, fwd.x - back.x) };
}

/* ---------- end markers: which end of an edge does a dot close ---------- */

/** The matrix of one transform attribute. Undefined for a function that is not resolved here. */
function parseTransform(value: string | null): Matrix | undefined {
  let m = IDENTITY;
  for (const fn of value?.match(/[a-z]+\s*\([^)]*\)/gi) ?? []) {
    const [, name, args] = /^([a-z]+)\s*\(([^)]*)\)$/i.exec(fn) ?? [];
    const n = (args ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (!name || n.some((x) => !Number.isFinite(x))) {
      return undefined;
    }
    let t: Matrix;
    if (name === 'translate' && n.length >= 1) {
      t = { ...IDENTITY, e: n[0], f: n[1] ?? 0 };
    } else if (name === 'scale' && n.length >= 1) {
      t = { ...IDENTITY, a: n[0], d: n[1] ?? n[0] };
    } else if (name === 'matrix' && n.length === 6) {
      t = { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
    } else {
      return undefined;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Product of the transform attributes from `el` up to (not including) `stop`. Undefined when one is not resolved. */
export function localMatrix(el: Element, stop: Element | null): Matrix | undefined {
  let m = IDENTITY;
  for (let cur: Element | null = el; cur && cur !== stop; cur = cur.parentElement) {
    const t = parseTransform(cur.getAttribute('transform'));
    if (!t) {
      return undefined;
    }
    m = multiply(t, m);
  }
  return m;
}

/** True for a matrix that can be inverted: finite entries and a determinant that is not near zero. */
export function usable(m: Matrix): boolean {
  const det = m.a * m.d - m.b * m.c;
  return [m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) && Number.isFinite(det) && Math.abs(det) >= 1e-9;
}

/** The matrix that takes the user space of `el` into the user space of `line`. Undefined when it cannot be resolved. */
function toLineSpace(line: SVGPathElement, el: SVGGraphicsElement): Matrix | undefined {
  if (typeof el.getCTM === 'function' && typeof line.getCTM === 'function') {
    const a = el.getCTM();
    const b = line.getCTM();
    if (a && b) {
      return usable(a) && usable(b) ? multiply(invert(b), a) : undefined;
    }
  }
  // jsdom has no getCTM: compose the transform attributes up to the nearest common ancestor.
  let common: Element | null = line.parentElement;
  while (common && !common.contains(el)) {
    common = common.parentElement;
  }
  const up = localMatrix(el, common);
  const down = localMatrix(line, common);
  return up && down && usable(up) && usable(down) ? multiply(invert(down), up) : undefined;
}

/**
 * Which end of the edge path an ellipse or circle closes: 'start' or 'end' when its centre, mapped into the user space
 * of the path, lies within max(r, 3) + 2 of the first or the last point of the path. Anything else (the background of
 * a label, a decoration on a waypoint) is undefined and is not an end marker.
 */
export function markerEnd(line: SVGPathElement, marker: SVGGraphicsElement): 'start' | 'end' | undefined {
  const pts = parsePathPoints(line.getAttribute('d') ?? '');
  if (pts.length < 2) {
    return undefined;
  }
  const num = (name: string) => parseFloat(marker.getAttribute(name) ?? '');
  const r = Math.max(num('r') || 0, num('rx') || 0, num('ry') || 0);
  const m = toLineSpace(line, marker);
  if (!m) {
    return undefined;
  }
  const c = applyMatrix(m, { x: num('cx') || 0, y: num('cy') || 0 });
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
    return undefined;
  }
  const tol = Math.max(r, 3) + 2;
  const dist = (p: Point) => Math.hypot(p.x - c.x, p.y - c.y);
  const ds = dist(pts[0]);
  const de = dist(pts[pts.length - 1]);
  if (Math.min(ds, de) > tol) {
    return undefined;
  }
  return de < ds ? 'end' : 'start';
}
