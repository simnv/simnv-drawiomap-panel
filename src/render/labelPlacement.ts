import { pointAt, type Point } from './geometry';

/*
 * The placement of the value labels of the link halves: pure numbers, no DOM. Every distance is in root user
 * units (the viewBox space); the caller converts (docs/superpowers/specs/2026-10-25-link-value-labels-design.md,
 * sections 4 and 5). The angle, side and clearance rules are those of portograph's `candidateBox` and ADR-0014.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle turned by `degrees` about its centre; `width` runs along the heading. */
export interface OrientedBox {
  centre: Point;
  width: number;
  height: number;
  degrees: number;
}

export interface LegInput {
  /**
   * The leg in root user units: its vertices, the arc lengths of its bends and its length. The leg runs from the
   * end of the link towards the arrowhead (the split of a two-leg link, or the arrowed end of a one-leg link): the
   * candidates at one distance from the middle try the lower arc length first, away from the arrowhead.
   */
  points: Point[];
  bends: number[];
  length: number;
  /** the slot size without the halo */
  size: { width: number; height: number };
  /** the stroke width of the edge in root units (`strokeLocal × geo.unit`) */
  strokeRoot: number;
}

export type Obstacle =
  /** a cell body, a pill, a chip, a dot, an arrowhead, the room of a status marker or a placed label */
  | { kind: 'rect'; rect: Rect; clearance: number }
  /** a straight run of a drawn edge; `owner` is the cell id of the edge */
  | { kind: 'segment'; a: Point; b: Point; clearance: number; owner: string };

export interface ObstacleIndex {
  add(o: Obstacle): void;
  /** takes an obstacle out again (a label that is placed again leaves its old box) */
  remove(o: Obstacle): void;
  /** the obstacles that can touch `box`; it may return more, never fewer */
  near(box: Rect): Iterable<Obstacle>;
}

export interface Placed {
  centre: Point;
  degrees: number;
  box: OrientedBox;
  /** the arc length of the anchor along the leg */
  along: number;
}
export type Placement = Placed | { dropped: 'short-leg' | 'no-free-spot' };

export const LINK_LABEL_GEOMETRY = { fontSize: 8, normalGap: 4, halo: 2, alongStep: 4, endMargin: 4 } as const;
/** The smallest glyph that reads on a screen: below it the label layer hides (decision 7). */
export const MIN_GLYPH_PX = 7;
/** A run whose horizontal extent is at most this is vertical. draw.io writes two decimals. */
export const VERTICAL_EPS = 0.01;
/** Rounding slack: a box that touches an obstacle is free, a run of exactly the box width fits. */
const EPS = 1e-6;

/** True when the labels read at `viewScale` pixels per user unit (section 6). */
export function labelsVisible(viewScale: number): boolean {
  return LINK_LABEL_GEOMETRY.fontSize * viewScale >= MIN_GLYPH_PX;
}

/**
 * The reading direction of a run and the side a label tries first (portograph `candidateBox`, ADR-0014). A vertical
 * run reads bottom to top and takes the right side first. Any other run keeps its text upright (gravity): the
 * heading is in (−90, 90), and the first side is above the run (up at 0°, up-left at −45°).
 */
export function runHeading(dx: number, dy: number): { degrees: number; first: Point } {
  if (Math.abs(dx) <= VERTICAL_EPS) {
    return { degrees: -90, first: { x: 1, y: 0 } };
  }
  let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (degrees > 90) {
    degrees -= 180;
  }
  if (degrees <= -90) {
    degrees += 180;
  }
  const r = (degrees * Math.PI) / 180;
  return { degrees, first: { x: Math.sin(r), y: -Math.cos(r) } };
}

/** The four corners of an oriented box, in root units. */
export function cornersOf(box: OrientedBox): Point[] {
  const r = (box.degrees * Math.PI) / 180;
  const ux = Math.cos(r);
  const uy = Math.sin(r);
  const hw = box.width / 2;
  const hh = box.height / 2;
  const { x, y } = box.centre;
  return [
    { x: x - ux * hw + uy * hh, y: y - uy * hw - ux * hh },
    { x: x + ux * hw + uy * hh, y: y + uy * hw - ux * hh },
    { x: x + ux * hw - uy * hh, y: y + uy * hw + ux * hh },
    { x: x - ux * hw - uy * hh, y: y - uy * hw + ux * hh },
  ];
}

/** The axis-aligned bounds of an oriented box: the rect a placed label reserves. */
export function boundsOf(box: OrientedBox): Rect {
  const xs = cornersOf(box).map((p) => p.x);
  const ys = cornersOf(box).map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const grow = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  width: r.width + 2 * by,
  height: r.height + 2 * by,
});

/** The bounding box of an obstacle, grown by its clearance: the extent the grid files it under. */
export function obstacleBounds(o: Obstacle): Rect {
  if (o.kind === 'rect') {
    return grow(o.rect, o.clearance);
  }
  const x = Math.min(o.a.x, o.b.x);
  const y = Math.min(o.a.y, o.b.y);
  return grow({ x, y, width: Math.abs(o.a.x - o.b.x), height: Math.abs(o.a.y - o.b.y) }, o.clearance);
}

/**
 * A uniform grid over the obstacles: an obstacle is filed in every cell its grown bounding box touches, and a
 * query returns the obstacles of the cells the box touches, each once. `cell` is the cell size in root units.
 */
export function obstacleIndex(items: readonly Obstacle[], cell = 64): ObstacleIndex {
  const cells = new Map<string, Obstacle[]>();
  const span = (r: Rect) => ({
    x0: Math.floor(r.x / cell),
    x1: Math.floor((r.x + r.width) / cell),
    y0: Math.floor(r.y / cell),
    y1: Math.floor((r.y + r.height) / cell),
  });
  const add = (o: Obstacle) => {
    const { x0, x1, y0, y1 } = span(obstacleBounds(o));
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list) {
          list.push(o);
        } else {
          cells.set(key, [o]);
        }
      }
    }
  };
  items.forEach(add);
  return {
    add,
    remove(o) {
      const { x0, x1, y0, y1 } = span(obstacleBounds(o));
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const list = cells.get(`${cx},${cy}`);
          const at = list?.indexOf(o) ?? -1;
          if (list && at >= 0) {
            list.splice(at, 1);
          }
        }
      }
    },
    near(box) {
      const { x0, x1, y0, y1 } = span(box);
      const found = new Set<Obstacle>();
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          for (const o of cells.get(`${cx},${cy}`) ?? []) {
            found.add(o);
          }
        }
      }
      return found;
    },
  };
}

/* ---------- collision tests ---------- */

const project = (pts: Point[], ax: Point) => {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const v = p.x * ax.x + p.y * ax.y;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max };
};

/** The oriented box against an axis-aligned rect: a separating-axis test on the four axes. Touching is free. */
function overlapsRect(corners: Point[], box: OrientedBox, rect: Rect): boolean {
  const rc = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const r = (box.degrees * Math.PI) / 180;
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(r), y: Math.sin(r) },
    { x: -Math.sin(r), y: Math.cos(r) },
  ];
  for (const ax of axes) {
    const a = project(corners, ax);
    const b = project(rc, ax);
    if (a.max <= b.min + EPS || b.max <= a.min + EPS) {
      return false;
    }
  }
  return true;
}

/** The distance from a point to the rect [−hw, hw] × [−hh, hh]; 0 inside. */
const pointToRect = (p: Point, hw: number, hh: number) =>
  Math.hypot(Math.max(-hw - p.x, 0, p.x - hw), Math.max(-hh - p.y, 0, p.y - hh));

const pointToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Liang–Barsky: does the segment a→b meet the rect [−hw, hw] × [−hh, hh]. */
function segmentMeetsRect(a: Point, b: Point, hw: number, hh: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x + hw],
    [dx, hw - a.x],
    [-dy, a.y + hh],
    [dy, hh - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) {
        return false;
      }
    } else {
      const t = q / p;
      if (p < 0) {
        t0 = Math.max(t0, t);
      } else {
        t1 = Math.min(t1, t);
      }
    }
  }
  return t0 <= t1;
}

/** The segment against the box: it crosses the box, or it comes nearer than `clearance`. */
function segmentHits(box: OrientedBox, a: Point, b: Point, clearance: number): boolean {
  const r = (box.degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const local = (p: Point): Point => {
    const x = p.x - box.centre.x;
    const y = p.y - box.centre.y;
    return { x: x * cos + y * sin, y: -x * sin + y * cos };
  };
  const la = local(a);
  const lb = local(b);
  const hw = box.width / 2;
  const hh = box.height / 2;
  if (segmentMeetsRect(la, lb, hw, hh)) {
    return true;
  }
  const corners: Point[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  const distance = Math.min(
    pointToRect(la, hw, hh),
    pointToRect(lb, hw, hh),
    ...corners.map((c) => pointToSegment(c, la, lb))
  );
  return distance < clearance - EPS;
}

/** True when `p` lies on the segment a→b (the anchor of a label lies on its own run). */
const onSegment = (p: Point, a: Point, b: Point) => pointToSegment(p, a, b) <= 1e-3;

/* ---------- candidates ---------- */

/**
 * Places the label of one half: the first free candidate in the portograph order (the first side over the whole
 * leg, then the second; from the middle of the leg outwards in steps of `alongStep`, the lower arc length first).
 * A candidate stands on one straight run with `endMargin` to the bends; its box is `normalGap` outside the stroke
 * edge. `own` is the cell id of the edge: its own run is no obstacle, its other runs are.
 */
export function placeHalfLabel(leg: LegInput, own: string, index: ObstacleIndex): Placement {
  const { halo, normalGap, alongStep, endMargin } = LINK_LABEL_GEOMETRY;
  const w = leg.size.width + 2 * halo;
  const h = leg.size.height + 2 * halo;
  const stops = [0, ...leg.bends, leg.length];
  const runs = stops.slice(1).map((to, i) => ({ from: stops[i], to }));
  if (Math.max(...runs.map((r) => r.to - r.from)) < w + 2 * endMargin - EPS) {
    return { dropped: 'short-leg' };
  }
  const gap = normalGap + leg.strokeRoot / 2;
  const offset = gap + h / 2;
  const d0 = leg.length / 2;
  // the distances from the middle, the lower one first at each step; the same list serves both sides
  const distances: number[] = [d0];
  for (let k = 1; ; k++) {
    const lo = d0 - k * alongStep;
    const hi = d0 + k * alongStep;
    if (lo < 0 && hi > leg.length) {
      break;
    }
    if (lo >= 0) {
      distances.push(lo);
    }
    if (hi <= leg.length) {
      distances.push(hi);
    }
  }
  const candidates = distances.flatMap((d) => {
    const run = runs.find((r) => d <= r.to + EPS && d >= r.from - EPS);
    if (!run || d < run.from + endMargin + w / 2 - EPS || d > run.to - endMargin - w / 2 + EPS) {
      return [];
    }
    const a = pointAt(leg.points, run.from);
    const b = pointAt(leg.points, run.to);
    const anchor = pointAt(leg.points, d);
    return [{ d, anchor: { x: anchor.x, y: anchor.y }, heading: runHeading(b.x - a.x, b.y - a.y) }];
  });
  for (const side of [1, -1]) {
    for (const { d, anchor, heading } of candidates) {
      const centre = { x: anchor.x + side * heading.first.x * offset, y: anchor.y + side * heading.first.y * offset };
      const box: OrientedBox = { centre, width: w, height: h, degrees: heading.degrees };
      if (!collides(box, anchor, own, index)) {
        return { centre, degrees: heading.degrees, box, along: d };
      }
    }
  }
  return { dropped: 'no-free-spot' };
}

function collides(box: OrientedBox, anchor: Point, own: string, index: ObstacleIndex): boolean {
  const corners = cornersOf(box);
  for (const o of index.near(boundsOf(box))) {
    if (o.kind === 'rect') {
      if (overlapsRect(corners, box, grow(o.rect, o.clearance))) {
        return true;
      }
    } else if (!(o.owner === own && onSegment(anchor, o.a, o.b)) && segmentHits(box, o.a, o.b, o.clearance)) {
      return true;
    }
  }
  return false;
}
