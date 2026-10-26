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
  /** the identity of the leg: the stroke pieces of its own edge carry it with their index (`Obstacle.piece`) */
  id?: string;
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
  /** the widest stroke of the edge in root units (`linkWidth.max × geo.unit`) */
  strokeRoot: number;
  /**
   * The bounds of the diagram in root units. The last-resort spot at a bend (which has no run to hold the box) must
   * keep its whole reserved box inside them; the strict ladder does not read them.
   */
  bounds?: Rect;
  /** the thinnest stroke in root units (`linkWidth.min × geo.unit`); the width of a half is drawn between the two */
  minRoot?: number;
}

export type Obstacle =
  /** a cell body, a pill, a chip, a dot, an arrowhead, the room of a status marker or a placed label */
  | { kind: 'rect'; rect: Rect; clearance: number }
  /** a piece of a drawn edge; `owner` is the cell id of the edge, `piece` its place in a leg polyline, when known */
  | { kind: 'segment'; a: Point; b: Point; clearance: number; owner: string; piece?: { leg: string; index: number } };

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
  /** where the box stands: see `LabelSide` */
  side: LabelSide;
  /** the height of the text box (with the halo); `box` is taller: it holds the box for every drawn width */
  height: number;
  /** the widest stroke in root units: the wide gap counts from its edge, whatever the drawn width */
  maxRoot: number;
  /** the point of the leg the box stands at, and the unit vector of the top side: `drawnCentre` needs them */
  anchor: Point;
  normal: Point;
}
/**
 * Where a label stands: 0 on the own stroke; 1 beside it on the top side (the side the tops of the letters face,
 * `runHeading().first`) and −1 on the bottom side, the near edge of the box `normalGap` beyond the stroke edge; 2 and
 * −2 are the same sides with `wideGap`, for a stroke with a wide chip or pill beside it.
 */
export type LabelSide = 0 | 1 | -1 | 2 | -2;
export const LABEL_SIDES: readonly LabelSide[] = [0, 1, -1, 2, -2];
export type Placement = Placed | { dropped: 'short-leg' | 'no-free-spot' };

export const LINK_LABEL_GEOMETRY = {
  fontSize: 8,
  normalGap: 2,
  wideGap: 4,
  halo: 1,
  alongStep: 4,
  endMargin: 4,
} as const;
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
 * run reads bottom to top and takes the left side first (the side the letters' tops face). Any other run keeps its text upright (gravity): the
 * heading is in (−90, 90), and the first side is above the run (up at 0°, up-left at −45°).
 */
export function runHeading(dx: number, dy: number): { degrees: number; first: Point } {
  if (Math.abs(dx) <= VERTICAL_EPS) {
    return { degrees: -90, first: { x: -1, y: 0 } };
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

/** The axis-aligned box of some points: the one AABB of the module. Undefined without a point. */
export function aabbOf(points: readonly Point[]): Rect | undefined {
  if (!points.length) {
    return undefined;
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The axis-aligned bounds of an oriented box: the rect a placed label reserves. */
export function boundsOf(box: OrientedBox): Rect {
  return aabbOf(cornersOf(box))!;
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

/** The distance from a point to the segment a→b. */
export const pointToSegment = (p: Point, a: Point, b: Point) => {
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

/** The arc length at every vertex of a polyline. */
const arcLengths = (pts: readonly Point[]): number[] => {
  const out = [0];
  for (let i = 1; i < pts.length; i++) {
    out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return out;
};

/* ---------- candidates ---------- */

/**
 * Places the label of one half: the first free candidate in the ladder order (on the stroke over the whole leg, then
 * the top side, then the bottom side, then both again with the wide gap; from the middle of the leg outwards in steps of `alongStep`, the lower arc
 * length first). A candidate stands on one straight run with `endMargin` to the bends; on the stroke its centre is
 * on the leg, beside it the near edge of its box is `normalGap` beyond the stroke edge. `own` is the cell id of the edge: the pieces of its own run (`leg.id`, `Obstacle.piece`) are no obstacle,
 * its other runs are.
 */
export function placeHalfLabel(
  leg: LegInput,
  own: string,
  index: ObstacleIndex,
  sides: readonly LabelSide[] = LABEL_SIDES,
  bendSpot = false
): Placement {
  const strict = placeOnRuns(leg, own, index, sides, false);
  if (!bendSpot || 'centre' in strict) {
    return strict;
  }
  // the last resort: the strict ladder found nothing, so the beside-stroke spots at a bend are tried; when they fail
  // too, the strict reason stays
  const relaxed = placeOnRuns(leg, own, index, sides, true);
  return 'centre' in relaxed ? relaxed : strict;
}

/**
 * The ladder over the candidates of `placeHalfLabel`. With `atBends` a candidate needs no whole box on its run: the
 * centre on a run is enough (the box may overhang the run ends, beside a bend), only beside the stroke, and only
 * when the label reads as its own half's (`ownsSpot`). The normal obstacle test decides the rest.
 */
function placeOnRuns(
  leg: LegInput,
  own: string,
  index: ObstacleIndex,
  sides: readonly LabelSide[],
  atBends: boolean
): Placement {
  const { halo, normalGap, wideGap, alongStep, endMargin } = LINK_LABEL_GEOMETRY;
  const w = leg.size.width + 2 * halo;
  const h = leg.size.height + 2 * halo;
  const stops = [0, ...leg.bends, leg.length];
  const runs = stops.slice(1).map((to, i) => ({ from: stops[i], to }));
  if (!atBends && Math.max(...runs.map((r) => r.to - r.from)) < w + 2 * endMargin - EPS) {
    return { dropped: 'short-leg' };
  }
  // The reservation is the union of the boxes the label can take for any drawn width between `minRoot` and
  // `strokeRoot`. Beside the stroke the near edge of the text box stands `normalGap` (or `wideGap`) beyond the drawn
  // stroke edge: the swept band runs from the near edge at the thinnest stroke to the far edge at the widest. On the
  // stroke it is as high as the largest gap rect.
  const minRoot = Math.min(leg.minRoot ?? leg.strokeRoot, leg.strokeRoot);
  // The wide gap (a chip or a pill beside the stroke is wider than a thin stroke) counts from the edge of the widest
  // stroke for every drawn width: its text does not move with the load.
  const offsetOf = (side: LabelSide) =>
    Math.sign(side) *
    (Math.abs(side) === 2 ? wideGap + leg.strokeRoot / 2 + h / 2 : normalGap + (minRoot + leg.strokeRoot) / 4 + h / 2);
  const sweptHeight = (side: LabelSide) =>
    side === 0 ? Math.max(h, leg.strokeRoot + 2) : Math.abs(side) === 2 ? h : h + (leg.strokeRoot - minRoot) / 2;
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
  // the pieces of the own edge that lie on the candidate's run (by their index in this leg) are no obstacle
  const arcs = arcLengths(leg.points);
  const candidates = distances.flatMap((d) => {
    // at a bend (`atBends`) the centre may lie on any run that holds `d`: a vertex belongs to both of its runs
    const holding = runs.filter((r) => d <= r.to + EPS && d >= r.from - EPS);
    return (atBends ? holding : holding.slice(0, 1)).flatMap((run) => {
      if (!atBends && (d < run.from + endMargin + w / 2 - EPS || d > run.to - endMargin - w / 2 + EPS)) {
        return [];
      }
      const a = pointAt(leg.points, run.from);
      const b = pointAt(leg.points, run.to);
      const anchor = pointAt(leg.points, d);
      const ownPiece = (o: Obstacle) =>
        o.kind === 'segment' &&
        o.owner === own &&
        o.piece !== undefined &&
        o.piece.leg === leg.id &&
        arcs[o.piece.index] >= run.from - EPS &&
        arcs[o.piece.index + 1] <= run.to + EPS;
      return [{ d, anchor: { x: anchor.x, y: anchor.y }, heading: runHeading(b.x - a.x, b.y - a.y), ownPiece }];
    });
  });
  for (const side of sides) {
    if (atBends && side === 0) {
      continue;
    }
    for (const { d, anchor, heading, ownPiece } of candidates) {
      const shift = offsetOf(side);
      const centre = { x: anchor.x + heading.first.x * shift, y: anchor.y + heading.first.y * shift };
      const box: OrientedBox = { centre, width: w, height: sweptHeight(side), degrees: heading.degrees };
      if (
        !collides(box, ownPiece, index) &&
        (!atBends || bendSpotFits(leg, own, index, box, side, anchor, heading.first))
      ) {
        return {
          centre,
          degrees: heading.degrees,
          box,
          along: d,
          side,
          height: h,
          maxRoot: leg.strokeRoot,
          anchor,
          normal: heading.first,
        };
      }
    }
  }
  return { dropped: 'no-free-spot' };
}

/**
 * The guard of a spot at a bend: the distance of the label centre to the stroke of its own leg is at most
 * `OWN_NEARER` times its distance to the stroke of any other link. 0.6 means the own stroke is at least 1.67 times
 * nearer: with the normal gap and a 10 unit stroke the centre stands about 13 off its stroke, so a neighbour must be
 * 22 or more away from the centre. A looser factor lets a label sit nearly between two links; a stricter one (0.5)
 * refuses lanes of 40 units, which are crowded but still readable.
 */
export const OWN_NEARER = 0.6;

/**
 * The checks that only a spot at a bend needs: the whole reserved box lies inside the bounds of the diagram (when the
 * leg knows them: Fit would clip a label that leaves them), and the guard holds at the painted centre of the text for
 * the thinnest and for the widest drawn stroke, not at the centre of the swept reservation.
 */
function bendSpotFits(
  leg: LegInput,
  own: string,
  index: ObstacleIndex,
  box: OrientedBox,
  side: LabelSide,
  anchor: Point,
  normal: Point
): boolean {
  const b = leg.bounds;
  if (b) {
    const r = boundsOf(box);
    if (
      r.x < b.x - EPS ||
      r.y < b.y - EPS ||
      r.x + r.width > b.x + b.width + EPS ||
      r.y + r.height > b.y + b.height + EPS
    ) {
      return false;
    }
  }
  const height = leg.size.height + 2 * LINK_LABEL_GEOMETRY.halo;
  const minRoot = Math.min(leg.minRoot ?? leg.strokeRoot, leg.strokeRoot);
  return [minRoot, leg.strokeRoot].every((drawn) =>
    ownsSpot(drawnCentre({ side, anchor, normal, height, maxRoot: leg.strokeRoot }, drawn), leg, own, index)
  );
}

function ownsSpot(centre: Point, leg: LegInput, own: string, index: ObstacleIndex): boolean {
  let ownDistance = Infinity;
  for (let i = 1; i < leg.points.length; i++) {
    ownDistance = Math.min(ownDistance, pointToSegment(centre, leg.points[i - 1], leg.points[i]));
  }
  // a stroke farther than this cannot break the factor
  const reach = ownDistance / OWN_NEARER;
  const around: Rect = { x: centre.x - reach, y: centre.y - reach, width: 2 * reach, height: 2 * reach };
  for (const o of index.near(around)) {
    if (o.kind === 'segment' && o.owner !== own && pointToSegment(centre, o.a, o.b) < reach - EPS) {
      return false;
    }
  }
  return true;
}

/**
 * The centre of the text for a stroke drawn `drawnRoot` wide (root units). The reservation of a label (`centre`,
 * `box`) always uses the widest stroke, so that a change of the load never makes a label collide; the text stands
 * `normalGap` (or `wideGap`) beyond the edge of the stroke as it is drawn.
 */
export function drawnCentre(
  p: Pick<Placed, 'side' | 'anchor' | 'normal' | 'height' | 'maxRoot'>,
  drawnRoot: number
): Point {
  if (p.side === 0) {
    return p.anchor;
  }
  const { normalGap, wideGap } = LINK_LABEL_GEOMETRY;
  const wide = Math.abs(p.side) === 2;
  const shift = Math.sign(p.side) * ((wide ? wideGap : normalGap) + (wide ? p.maxRoot : drawnRoot) / 2 + p.height / 2);
  return { x: p.anchor.x + p.normal.x * shift, y: p.anchor.y + p.normal.y * shift };
}

/**
 * Places the labels of the two halves of one link so that both stand in one place: on the stroke, else both on the
 * top side, else both on the bottom side, then the same two sides with the wide gap. Only when no single place holds both, each half takes its own first free
 * spot. The first label of a pair is an
 * obstacle for the second while the pair is placed; the index holds no label of the pair when this returns.
 */
export function placeLinkLabels(a: LegInput, b: LegInput, own: string, index: ObstacleIndex): [Placement, Placement] {
  const hold = (p: Placement): Obstacle | undefined => {
    if (!('centre' in p)) {
      return undefined;
    }
    const o: Obstacle = { kind: 'rect', rect: boundsOf(p.box), clearance: 0 };
    index.add(o);
    return o;
  };
  const drop = (o: Obstacle | undefined) => o && index.remove(o);
  const pair = (sides: readonly LabelSide[]): [Placement, Placement] => {
    const first = placeHalfLabel(a, own, index, sides);
    const held = hold(first);
    const second = placeHalfLabel(b, own, index, sides);
    drop(held);
    return [first, second];
  };
  for (const side of LABEL_SIDES) {
    const result = pair([side]);
    if ('centre' in result[0] && 'centre' in result[1]) {
      return result;
    }
  }
  // the last pass: the strict ladder for each half, then the bend spots for a half that found nothing. The strict
  // result of the other half does not change, so a pair that fits keeps its places.
  const [first, second] = pair(LABEL_SIDES);
  const rescue = (leg: LegInput, result: Placement, other: Placement): Placement => {
    if ('centre' in result) {
      return result;
    }
    const held = hold(other);
    const found = placeHalfLabel(leg, own, index, LABEL_SIDES, true);
    drop(held);
    return 'centre' in found ? found : result;
  };
  const rescued = rescue(a, first, second);
  return [rescued, rescue(b, second, rescued)];
}

/** The box against the obstacles near it; the pieces of the own run (`ownPiece`) do not count. */
function collides(box: OrientedBox, ownPiece: (o: Obstacle) => boolean, index: ObstacleIndex): boolean {
  const corners = cornersOf(box);
  for (const o of index.near(boundsOf(box))) {
    if (o.kind === 'rect') {
      if (overlapsRect(corners, box, grow(o.rect, o.clearance))) {
        return true;
      }
    } else if (!ownPiece(o) && segmentHits(box, o.a, o.b, o.clearance)) {
      return true;
    }
  }
  return false;
}
