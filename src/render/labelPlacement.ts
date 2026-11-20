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
  /** the base of the widest arrow head of the edge in root units: the sides ±4 stand beyond its wings */
  headRoot?: number;
  /**
   * The base of the head of the thinnest half in root units (the head at `linkWidth.min`). The sides ±3 stand beyond
   * the wings of the head as it is drawn, between this one and `headRoot`. Without it, `headRoot`.
   */
  headMinRoot?: number;
}

export type Obstacle =
  /** a cell body, a pill, a chip, a dot, an arrowhead of draw.io, the room of a status marker or a placed label */
  | { kind: 'rect'; rect: Rect; clearance: number }
  /**
   * A convex polygon, the reserved head or the hull of a bent taper, with no clearance. `owner` is the cell id of
   * the edge and `leg` the id of the leg whose half draws the head, when known: a label on the sides ±3 of a run of
   * that leg moves with the head, so the head is no obstacle for it when its centreline lies on the line of that run.
   */
  | { kind: 'polygon'; points: Point[]; owner?: string; leg?: string }
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
  /**
   * The width the wide gap counts from, in root units, whatever the drawn width: the widest stroke for the sides ±2,
   * the base of the widest arrow head for ±3 and ±4 (±3 counts from the drawn head; `drawnCentre` gets it).
   */
  maxRoot: number;
  /** the point of the leg the box stands at, and the unit vector of the top side: `drawnCentre` needs them */
  anchor: Point;
  normal: Point;
}
/**
 * Where a label stands: 0 on the own stroke; 1 beside it on the top side (the side the tops of the letters face,
 * `runHeading().first`) and −1 on the bottom side, the near edge of the box `normalGap` beyond the stroke edge; 2 and
 * −2 are the same sides with `wideGap`, for a stroke with a wide chip or pill beside it. On a link so short that
 * every spot beside the stroke meets a head: 3 and −3 (`HEAD_SIDES`) stand `wideGap` beyond the wings of the head of
 * the own half as it is drawn, and 4 and −4 (`WIDEST_HEAD_SIDES`), the last try, `wideGap` beyond the wings of the
 * widest head.
 */
export type LabelSide = 0 | 1 | -1 | 2 | -2 | 3 | -3 | 4 | -4;
export const LABEL_SIDES: readonly LabelSide[] = [0, 1, -1, 2, -2];
/**
 * The places that the two halves of a link share: on the stroke and beside it at the near gap. A half that has none
 * of them free takes its own nearest spot; it does not pull the other half away from its link.
 */
export const NEAR_SIDES: readonly LabelSide[] = [0, 1, -1];
/** The sides beside the drawn heads: tried after every other spot of the label, the bend spots too. */
export const HEAD_SIDES: readonly LabelSide[] = [3, -3];
/** The sides beyond the widest heads: the last try, when an obstacle stands between a drawn head and its widest. */
export const WIDEST_HEAD_SIDES: readonly LabelSide[] = [4, -4];

/** The width the gap of a side counts from: the widest stroke, or for ±3 and ±4 the base of the widest head. */
const gapBase = (leg: LegInput, side: LabelSide): number =>
  Math.abs(side) >= 3 ? Math.max(leg.headRoot ?? 0, leg.strokeRoot) : leg.strokeRoot;
/** The base of the head of the thinnest half, at most the widest one. */
const headMinOf = (leg: LegInput): number => Math.min(leg.headMinRoot ?? gapBase(leg, 3), gapBase(leg, 3));
export type Placement = Placed | { dropped: 'short-leg' | 'no-free-spot' };

export const LINK_LABEL_GEOMETRY = {
  fontSize: 9,
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
/** A head whose centreline stands at most this far off the line of a run lies on it (`headOnLine`). */
const HEAD_ON_LINE_EPS = 0.01;

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

/** The last turn that `turn` computed: the boxes of one run share their angle. */
let lastTurn = { degrees: 0, cos: 1, sin: 0 };

/** The cosine and the sine of an angle in degrees. */
function turn(degrees: number): { cos: number; sin: number } {
  // Object.is: the sine of −0 is −0
  if (!Object.is(degrees, lastTurn.degrees)) {
    const r = (degrees * Math.PI) / 180;
    lastTurn = { degrees, cos: Math.cos(r), sin: Math.sin(r) };
  }
  return lastTurn;
}

/** The four corners of an oriented box, in root units. */
export function cornersOf(box: OrientedBox): Point[] {
  const { cos: ux, sin: uy } = turn(box.degrees);
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
  if (o.kind === 'polygon') {
    return aabbOf(o.points)!;
  }
  const x = Math.min(o.a.x, o.b.x);
  const y = Math.min(o.a.y, o.b.y);
  return grow({ x, y, width: Math.abs(o.a.x - o.b.x), height: Math.abs(o.a.y - o.b.y) }, o.clearance);
}

/** An obstacle in the grid with its bounds (`obstacleBounds`) and the number of the last query that met it. */
interface Entry {
  o: Obstacle;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  seen: number;
}

/** The key of a grid cell. Two cells far apart may share a key: their lists merge, the queries only grow. */
const cellKey = (cx: number, cy: number) => cx * 0x4000000 + cy;

/**
 * A uniform grid over the obstacles: an obstacle is filed in every cell its grown bounding box touches, and a
 * query returns the obstacles of the cells the box touches, each once. `cell` is the cell size in root units.
 */
class ObstacleGrid implements ObstacleIndex {
  private readonly cells = new Map<number, Entry[]>();
  private query = 0;

  constructor(private readonly cell: number) {}

  add(o: Obstacle): void {
    const r = obstacleBounds(o);
    const entry: Entry = { o, x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height, seen: 0 };
    const { cell } = this;
    const cx1 = Math.floor(entry.x1 / cell);
    const cy1 = Math.floor(entry.y1 / cell);
    for (let cx = Math.floor(entry.x0 / cell); cx <= cx1; cx++) {
      for (let cy = Math.floor(entry.y0 / cell); cy <= cy1; cy++) {
        const key = cellKey(cx, cy);
        const list = this.cells.get(key);
        if (list) {
          list.push(entry);
        } else {
          this.cells.set(key, [entry]);
        }
      }
    }
  }

  remove(o: Obstacle): void {
    const r = obstacleBounds(o);
    const { cell } = this;
    const cx1 = Math.floor((r.x + r.width) / cell);
    const cy1 = Math.floor((r.y + r.height) / cell);
    for (let cx = Math.floor(r.x / cell); cx <= cx1; cx++) {
      for (let cy = Math.floor(r.y / cell); cy <= cy1; cy++) {
        const list = this.cells.get(cellKey(cx, cy));
        const at = list ? list.findIndex((e) => e.o === o) : -1;
        if (list && at >= 0) {
          list.splice(at, 1);
        }
      }
    }
  }

  near(box: Rect): Set<Obstacle> {
    const found = new Set<Obstacle>();
    this.some(box.x, box.y, box.x + box.width, box.y + box.height, (e) => (found.add(e.o), false));
    return found;
  }

  /**
   * True when `test` holds for an entry of a cell that the box x0..x1 × y0..y1 touches. It meets each entry once, in
   * the order of `near`, and stops at the first that holds.
   */
  some(x0: number, y0: number, x1: number, y1: number, test: (e: Entry) => boolean): boolean {
    const { cell } = this;
    const query = ++this.query;
    const cx1 = Math.floor(x1 / cell);
    const cy1 = Math.floor(y1 / cell);
    for (let cx = Math.floor(x0 / cell); cx <= cx1; cx++) {
      for (let cy = Math.floor(y0 / cell); cy <= cy1; cy++) {
        const list = this.cells.get(cellKey(cx, cy));
        if (!list) {
          continue;
        }
        for (const e of list) {
          if (e.seen !== query) {
            e.seen = query;
            if (test(e)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }
}

/**
 * A uniform grid over the obstacles: an obstacle is filed in every cell its grown bounding box touches, and a
 * query returns the obstacles of the cells the box touches, each once. `cell` is the cell size in root units.
 */
export function obstacleIndex(items: readonly Obstacle[], cell = 64): ObstacleIndex {
  const grid = new ObstacleGrid(cell);
  items.forEach((o) => grid.add(o));
  return grid;
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

/**
 * The oriented box against a convex polygon: a separating-axis test on the axes of the box and the edge normals of
 * the polygon. Touching is free.
 */
function overlapsConvex(corners: Point[], box: OrientedBox, polygon: Point[]): boolean {
  const { cos, sin } = turn(box.degrees);
  const axes: Point[] = [
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    axes.push({ x: p.y - q.y, y: q.x - p.x });
  });
  for (const ax of axes) {
    const a = project(corners, ax);
    const b = project(polygon, ax);
    // the normals of the polygon are not unit length: the tolerance scales with them. A zero-length edge (a collapsed
    // polygon) has no axis to separate on.
    const length = Math.hypot(ax.x, ax.y);
    if (length === 0) {
      continue;
    }
    const eps = EPS * length;
    if (a.max <= b.min + eps || b.max <= a.min + eps) {
      return false;
    }
  }
  return true;
}

/** The distance from a point to the rect [−hw, hw] × [−hh, hh]; 0 inside. */
const pointToRect = (x: number, y: number, hw: number, hh: number) =>
  Math.hypot(Math.max(-hw - x, 0, x - hw), Math.max(-hh - y, 0, y - hh));

/** The distance from (px, py) to the segment (ax, ay)→(bx, by), without a point object. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** The distance from a point to the segment a→b. */
export const pointToSegment = (p: Point, a: Point, b: Point) => segmentDistance(p.x, p.y, a.x, a.y, b.x, b.y);

/** Liang–Barsky: does the segment (ax, ay)→(bx, by) meet the rect [−hw, hw] × [−hh, hh]. */
function segmentMeetsRect(ax: number, ay: number, bx: number, by: number, hw: number, hh: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  // the four edges in the order left, right, top, bottom: p is the direction across the edge, q the room inside it
  for (let edge = 0; edge < 4; edge++) {
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const q = edge === 0 ? ax + hw : edge === 1 ? hw - ax : edge === 2 ? ay + hh : hh - ay;
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

/**
 * A segment whose bounding box stands farther than its clearance plus this from the bounding box of a label box
 * cannot hit the box: the exact test (`BoxProbe.hits`) would find a distance of at least the clearance. The slack is
 * far above the rounding of the exact test at any diagram size, so the quick test never decides a border case.
 */
const REJECT_SLACK = 1e-3;

/**
 * A label box made ready for many obstacle tests: its corners, its bounding box and its rotation, computed once.
 * An upright box (0°) has the x and y axes as its own axes: the bounding box test is then the whole separating-axis
 * test against a rect, and decides a polygon on those axes.
 */
class BoxProbe {
  readonly corners: Point[];
  /** the bounding box as `boundsOf` gives it: the cells of the grid to search */
  readonly bounds: Rect;
  /** the extent of the corners on x and y, exact (`bounds.x + bounds.width` may round) */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cos: number;
  readonly sin: number;
  readonly upright: boolean;

  constructor(readonly box: OrientedBox) {
    this.corners = cornersOf(box);
    const [a, b, c, d] = this.corners;
    this.x0 = Math.min(a.x, b.x, c.x, d.x);
    this.y0 = Math.min(a.y, b.y, c.y, d.y);
    this.x1 = Math.max(a.x, b.x, c.x, d.x);
    this.y1 = Math.max(a.y, b.y, c.y, d.y);
    // `aabbOf(corners)`
    this.bounds = { x: this.x0, y: this.y0, width: this.x1 - this.x0, height: this.y1 - this.y0 };
    ({ cos: this.cos, sin: this.sin } = turn(box.degrees));
    this.upright = box.degrees === 0;
  }

  /** The bounding box apart from x0..x1 × y0..y1 on the x or the y axis; touching (within `EPS`) is apart. */
  private apart(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.x1 <= x0 + EPS || x1 <= this.x0 + EPS || this.y1 <= y0 + EPS || y1 <= this.y0 + EPS;
  }

  /**
   * False when the bounding boxes alone show that the obstacle misses the box; `hits` decides the rest. `x0`..`y1`
   * are the bounds of the obstacle (`obstacleBounds`).
   */
  reaches(o: Obstacle, x0: number, y0: number, x1: number, y1: number): boolean {
    if (o.kind === 'rect') {
      // the x and y axes of the separating-axis test of `hits`. A negative clearance can turn a rect inside out:
      // its extent runs from the lower edge to the higher one.
      return !this.apart(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
    }
    if (o.kind === 'polygon') {
      return true;
    }
    const reach = (o.clearance > 0 ? o.clearance : 0) + REJECT_SLACK;
    return !(
      Math.min(o.a.x, o.b.x) - this.x1 > reach ||
      this.x0 - Math.max(o.a.x, o.b.x) > reach ||
      Math.min(o.a.y, o.b.y) - this.y1 > reach ||
      this.y0 - Math.max(o.a.y, o.b.y) > reach
    );
  }

  /**
   * The obstacle against the box, for an obstacle that `reaches` it (the same bounds). A rect (grown by its
   * clearance; a rect of no width or height is a line that still blocks a box it crosses) and a convex polygon:
   * a separating-axis test, touching is free. A segment: it crosses the box, or it comes nearer than its clearance.
   */
  hits(o: Obstacle, x0: number, y0: number, x1: number, y1: number): boolean {
    if (o.kind === 'rect') {
      // `reaches` tested the x and y axes: they are the axes of an upright box
      return (
        this.upright ||
        (!this.apartOn(this.cos, this.sin, x0, y0, x1, y1) && !this.apartOn(-this.sin, this.cos, x0, y0, x1, y1))
      );
    }
    if (o.kind === 'polygon') {
      return this.hitsPolygon(o.points);
    }
    return this.hitsSegment(o.a, o.b, o.clearance);
  }

  /** The box and the rect x0..x1 × y0..y1 apart on the axis (ax, ay) of the box. */
  private apartOn(ax: number, ay: number, x0: number, y0: number, x1: number, y1: number): boolean {
    let aMin = Infinity;
    let aMax = -Infinity;
    for (const p of this.corners) {
      const v = p.x * ax + p.y * ay;
      aMin = Math.min(aMin, v);
      aMax = Math.max(aMax, v);
    }
    // the corners of the rect in the order (x0, y0), (x1, y0), (x1, y1), (x0, y1)
    const v0 = x0 * ax + y0 * ay;
    const v1 = x1 * ax + y0 * ay;
    const v2 = x1 * ax + y1 * ay;
    const v3 = x0 * ax + y1 * ay;
    const bMin = Math.min(v0, v1, v2, v3);
    const bMax = Math.max(v0, v1, v2, v3);
    return aMax <= bMin + EPS || bMax <= aMin + EPS;
  }

  private hitsPolygon(points: Point[]): boolean {
    if (this.upright) {
      // the x and y axes are the axes of the box: their test is the test of the bounding boxes
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
      if (this.apart(x0, y0, x1, y1)) {
        return false;
      }
    }
    return overlapsConvex(this.corners, this.box, points);
  }

  private hitsSegment(a: Point, b: Point, clearance: number): boolean {
    const { box, cos, sin } = this;
    // the ends in the frame of the box: its centre at 0, its width along x
    const ax = a.x - box.centre.x;
    const ay = a.y - box.centre.y;
    const bx = b.x - box.centre.x;
    const by = b.y - box.centre.y;
    const lax = ax * cos + ay * sin;
    const lay = -ax * sin + ay * cos;
    const lbx = bx * cos + by * sin;
    const lby = -bx * sin + by * cos;
    const hw = box.width / 2;
    const hh = box.height / 2;
    if (segmentMeetsRect(lax, lay, lbx, lby, hw, hh)) {
      return true;
    }
    const distance = Math.min(
      pointToRect(lax, lay, hw, hh),
      pointToRect(lbx, lby, hw, hh),
      segmentDistance(-hw, -hh, lax, lay, lbx, lby),
      segmentDistance(hw, -hh, lax, lay, lbx, lby),
      segmentDistance(hw, hh, lax, lay, lbx, lby),
      segmentDistance(-hw, hh, lax, lay, lbx, lby)
    );
    return distance < clearance - EPS;
  }
}

/**
 * True when the centreline of a head (from its tip to the middle of its base) lies on the line through `a` and `b`.
 * The slack is far below the wide gap that the text keeps beyond the wing.
 */
function headOnLine(points: readonly Point[], a: Point, b: Point): boolean {
  // A hull with more than three vertices belongs to a bent taper. Keep it as an obstacle on every run.
  if (points.length !== 3) {
    return false;
  }
  const [tip, left, right] = points;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const off = (p: Point) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length;
  const base = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  return length > 0 && off(tip) <= HEAD_ON_LINE_EPS && off(base) <= HEAD_ON_LINE_EPS;
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
  return placeHalf(new LegSpots(leg, own), index, sides, bendSpot);
}

/** `placeHalfLabel` over the spots of a leg that the calls for one link share. */
function placeHalf(spots: LegSpots, index: ObstacleIndex, sides: readonly LabelSide[], bendSpot: boolean): Placement {
  const strict = placeOnRuns(spots, index, sides, false);
  if (!bendSpot || 'centre' in strict) {
    return strict;
  }
  // the last resort: the strict ladder found nothing, so the beside-stroke spots at a bend are tried, then the spots
  // beside the drawn heads, then beyond the wings of the widest head (each strict, then at a bend); when they fail
  // too, the strict reason stays
  const beside = HEAD_SIDES.filter((side) => !sides.includes(side));
  const beyond = WIDEST_HEAD_SIDES.filter((side) => !sides.includes(side));
  for (const [ladder, atBends] of [
    [sides, true],
    [beside, false],
    [beside, true],
    [beyond, false],
    [beyond, true],
  ] as const) {
    const found = ladder.length ? placeOnRuns(spots, index, ladder, atBends) : strict;
    if ('centre' in found) {
      return found;
    }
  }
  return strict;
}

/** A straight run of a leg, from arc length `from` to `to`, with what its candidates share. */
interface Run {
  from: number;
  to: number;
  heading: { degrees: number; first: Point };
  /** a piece of the own edge on this run (by its index in this leg): no obstacle */
  ownPiece: (o: Obstacle) => boolean;
  /** `ownPiece`, or the head of the own half on the line of this run: no obstacle beside the drawn heads (±3) */
  ownPieceOrHead: (o: Obstacle) => boolean;
}

/** A candidate anchor: the arc length `d` on `run`, and its point. */
interface Spot {
  d: number;
  anchor: Point;
  run: Run;
}

/** The items of an iterator, made when they are first asked for and kept for the next pass. */
class Lazy<T> {
  private readonly items: T[] = [];

  constructor(private readonly source: Iterator<T>) {}

  at(i: number): T | undefined {
    while (this.items.length <= i) {
      const next = this.source.next();
      if (next.done) {
        return undefined;
      }
      this.items.push(next.value);
    }
    return this.items[i];
  }
}

/**
 * The runs and the candidate anchors of a leg for the label of `own`, in ladder order. Every pass of the ladder over
 * one leg (the near pairs, the strict ladder, the bend spots) reads the same lists: a list grows only as far as a
 * pass reads it.
 */
class LegSpots {
  /** the box size with the halo */
  readonly w: number;
  readonly h: number;
  readonly runs: Run[];
  private strict?: Lazy<Spot>;
  private bends?: Lazy<Spot>;

  constructor(
    readonly leg: LegInput,
    readonly own: string
  ) {
    const { halo } = LINK_LABEL_GEOMETRY;
    this.w = leg.size.width + 2 * halo;
    this.h = leg.size.height + 2 * halo;
    const stops = [0, ...leg.bends, leg.length];
    const arcs = arcLengths(leg.points);
    this.runs = stops.slice(1).map((to, i) => {
      const from = stops[i];
      const a = pointAt(leg.points, from);
      const b = pointAt(leg.points, to);
      const ownPiece = (o: Obstacle) =>
        o.kind === 'segment' &&
        o.owner === own &&
        o.piece !== undefined &&
        o.piece.leg === leg.id &&
        arcs[o.piece.index] >= from - EPS &&
        arcs[o.piece.index + 1] <= to + EPS;
      // the head of the own half, only when its centreline lies on the line of this run: then every drawn head stays
      // within half its base of that line, and the sides ±3 keep the wide gap beyond that half base at every width.
      // A head on another run (it points another way) stays an obstacle at its widest.
      const ownHead = (o: Obstacle) =>
        o.kind === 'polygon' &&
        o.owner === own &&
        o.leg !== undefined &&
        o.leg === leg.id &&
        headOnLine(o.points, a, b);
      return {
        from,
        to,
        heading: runHeading(b.x - a.x, b.y - a.y),
        ownPiece,
        ownPieceOrHead: (o: Obstacle) => ownPiece(o) || ownHead(o),
      };
    });
  }

  /** The candidate anchors: at a bend (`atBends`) or each with its whole box on its run; `only`: one distance. */
  spots(atBends: boolean, only?: number): Lazy<Spot> {
    if (only !== undefined) {
      return new Lazy(this.spotsAt(atBends, only));
    }
    if (atBends) {
      this.bends ??= new Lazy(this.spotsAt(true));
      return this.bends;
    }
    this.strict ??= new Lazy(this.spotsAt(false));
    return this.strict;
  }

  private *spotsAt(atBends: boolean, only?: number): Generator<Spot> {
    const { alongStep } = LINK_LABEL_GEOMETRY;
    const { length } = this.leg;
    const d0 = length / 2;
    // the distances from the middle, the lower one first at each step; the same list serves both sides (`only`: one
    // distance, the spot a label holds)
    yield* this.spotsOn(only ?? d0, atBends);
    for (let k = 1; only === undefined; k++) {
      const lo = d0 - k * alongStep;
      const hi = d0 + k * alongStep;
      if (lo < 0 && hi > length) {
        break;
      }
      if (lo >= 0) {
        yield* this.spotsOn(lo, atBends);
      }
      if (hi <= length) {
        yield* this.spotsOn(hi, atBends);
      }
    }
  }

  private *spotsOn(d: number, atBends: boolean): Generator<Spot> {
    const { endMargin } = LINK_LABEL_GEOMETRY;
    const { w } = this;
    let anchor: Point | undefined;
    // at a bend (`atBends`) the centre may lie on any run that holds `d`: a vertex belongs to both of its runs. The
    // strict ladder takes the first run that holds `d` and needs the whole box on it.
    for (const run of this.runs) {
      if (!(d <= run.to + EPS && d >= run.from - EPS)) {
        continue;
      }
      if (atBends || !(d < run.from + endMargin + w / 2 - EPS || d > run.to - endMargin - w / 2 + EPS)) {
        if (!anchor) {
          const at = pointAt(this.leg.points, d);
          anchor = { x: at.x, y: at.y };
        }
        yield { d, anchor, run };
      }
      if (!atBends) {
        return;
      }
    }
  }
}

/**
 * The ladder over the candidates of `placeHalfLabel`. With `atBends` a candidate needs no whole box on its run: the
 * centre on a run is enough (the box may overhang the run ends, beside a bend), only beside the stroke, and only
 * when the label reads as its own half's (`ownsSpot`). The normal obstacle test decides the rest.
 */
function placeOnRuns(
  spots: LegSpots,
  index: ObstacleIndex,
  sides: readonly LabelSide[],
  atBends: boolean,
  only?: number
): Placement {
  const { leg, own, w, h, runs } = spots;
  const { normalGap, wideGap, endMargin } = LINK_LABEL_GEOMETRY;
  if (!atBends && Math.max(...runs.map((r) => r.to - r.from)) < w + 2 * endMargin - EPS) {
    return { dropped: 'short-leg' };
  }
  // The reservation is the union of the boxes the label can take for any drawn width between `minRoot` and
  // `strokeRoot`. Beside the stroke the near edge of the text box stands `normalGap` (or `wideGap`) beyond the drawn
  // stroke edge: the swept band runs from the near edge at the thinnest stroke to the far edge at the widest. On the
  // stroke it is as high as the largest gap rect.
  const minRoot = Math.min(leg.minRoot ?? leg.strokeRoot, leg.strokeRoot);
  // The wide gap (a chip or a pill beside the stroke is wider than a thin stroke) counts from the edge of the widest
  // stroke for every drawn width: its text does not move with the load. Beside the heads (±3) the band runs from the
  // wing of the thinnest head to the wing of the widest, as beside the stroke (±1) from the thinnest stroke edge.
  const headMin = headMinOf(leg);
  const offsetOf = (side: LabelSide) =>
    Math.sign(side) *
    (Math.abs(side) === 1
      ? normalGap + (minRoot + leg.strokeRoot) / 4 + h / 2
      : Math.abs(side) === 3
        ? wideGap + (headMin + gapBase(leg, side)) / 4 + h / 2
        : wideGap + gapBase(leg, side) / 2 + h / 2);
  const sweptHeight = (side: LabelSide) =>
    side === 0
      ? Math.max(h, leg.strokeRoot + 2)
      : Math.abs(side) === 1
        ? h + (leg.strokeRoot - minRoot) / 2
        : Math.abs(side) === 3
          ? h + (gapBase(leg, side) - headMin) / 2
          : h;
  const candidates = spots.spots(atBends, only);
  for (const side of sides) {
    // on the stroke there is nothing to try at a bend; beside the heads only for a leg that knows a head wider than
    // its stroke
    if ((atBends && side === 0) || (Math.abs(side) >= 3 && !((leg.headRoot ?? 0) > leg.strokeRoot))) {
      continue;
    }
    // beside the drawn heads the text moves with the head of its own half, so that head is no obstacle when it lies
    // on the candidate's run; every other head stays one at its widest
    const besideHead = Math.abs(side) === 3;
    const shift = offsetOf(side);
    const height = sweptHeight(side);
    for (let i = 0, spot = candidates.at(0); spot; spot = candidates.at(++i)) {
      const { d, anchor, run } = spot;
      const { heading } = run;
      const centre = { x: anchor.x + heading.first.x * shift, y: anchor.y + heading.first.y * shift };
      const box: OrientedBox = { centre, width: w, height, degrees: heading.degrees };
      if (
        !collides(box, besideHead ? run.ownPieceOrHead : run.ownPiece, index) &&
        (!atBends || bendSpotFits(leg, own, index, box, side, anchor, heading.first))
      ) {
        return {
          centre,
          degrees: heading.degrees,
          box,
          along: d,
          side,
          height: h,
          maxRoot: gapBase(leg, side),
          anchor,
          normal: heading.first,
        };
      }
    }
  }
  return { dropped: 'no-free-spot' };
}

/**
 * The spot of `placed` again for the size of `leg` (a new slot): the same anchor and side, with the box of the new
 * width, under the strict rules of `placeHalfLabel` (a whole box on its run, the obstacle test). Undefined when the
 * box no longer fits there; the caller then places the label again over the whole ladder. A box at a candidate
 * holds a narrower box at the same centre, so a spot that is free for the new size is the one the ladder would give
 * again, or a nearer one that was blocked before: the label keeps its place.
 */
export function placeAgain(leg: LegInput, own: string, index: ObstacleIndex, placed: Placed): Placed | undefined {
  const again = placeOnRuns(new LegSpots(leg, own), index, [placed.side], false, placed.along);
  return 'centre' in again ? again : undefined;
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
  const maxRoot = gapBase(leg, side);
  return [
    [minRoot, headMinOf(leg)],
    [leg.strokeRoot, maxRoot],
  ].every(([drawn, head]) =>
    ownsSpot(drawnCentre({ side, anchor, normal, height, maxRoot }, drawn, head), leg, own, index)
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
 * The centre of the text for a stroke drawn `drawnRoot` wide and its head `drawnHeadRoot` wide at the base (root
 * units). The reservation of a label (`centre`, `box`) holds the text for every drawn width, so that a change of the
 * load never makes a label collide. The text stands `normalGap` beyond the edge of the stroke as it is drawn (±1),
 * `wideGap` beyond the wing of the head as it is drawn (±3), or `wideGap` beyond a fixed width (`maxRoot`: ±2, ±4).
 */
export function drawnCentre(
  p: Pick<Placed, 'side' | 'anchor' | 'normal' | 'height' | 'maxRoot'>,
  drawnRoot: number,
  drawnHeadRoot = p.maxRoot
): Point {
  if (p.side === 0) {
    return p.anchor;
  }
  const { normalGap, wideGap } = LINK_LABEL_GEOMETRY;
  const near = Math.abs(p.side) === 1;
  const base = near ? drawnRoot : Math.abs(p.side) === 3 ? drawnHeadRoot : p.maxRoot;
  const shift = Math.sign(p.side) * ((near ? normalGap : wideGap) + base / 2 + p.height / 2);
  return { x: p.anchor.x + p.normal.x * shift, y: p.anchor.y + p.normal.y * shift };
}

/**
 * Places the labels of the two halves of one link so that both stand in one near place (`NEAR_SIDES`): on the
 * stroke, else both on the top side, else both on the bottom side. When no near place holds both, each half takes
 * its own first free spot, so a half that is free near its stroke stays there. The first label of a pair is an
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
  // the spots of each leg, made once for every pass below
  const spotsA = new LegSpots(a, own);
  const spotsB = new LegSpots(b, own);
  const pair = (sides: readonly LabelSide[]): [Placement, Placement] => {
    const first = placeHalf(spotsA, index, sides, false);
    const held = hold(first);
    const second = placeHalf(spotsB, index, sides, false);
    drop(held);
    return [first, second];
  };
  for (const side of NEAR_SIDES) {
    const result = pair([side]);
    if ('centre' in result[0] && 'centre' in result[1]) {
      return result;
    }
  }
  // the last pass: the strict ladder for each half, then the bend spots for a half that found nothing. The strict
  // result of the other half does not change, so a pair that fits keeps its places.
  const [first, second] = pair(LABEL_SIDES);
  const rescue = (spots: LegSpots, result: Placement, other: Placement): Placement => {
    if ('centre' in result) {
      return result;
    }
    const held = hold(other);
    const found = placeHalf(spots, index, LABEL_SIDES, true);
    drop(held);
    return 'centre' in found ? found : result;
  };
  const rescued = rescue(spotsA, first, second);
  return [rescued, rescue(spotsB, second, rescued)];
}

/** The box against the obstacles near it; the pieces of the own run and the own head (`exempt`) do not count. */
function collides(box: OrientedBox, exempt: (o: Obstacle) => boolean, index: ObstacleIndex): boolean {
  const probe = new BoxProbe(box);
  if (index instanceof ObstacleGrid) {
    const r = probe.bounds;
    return index.some(
      r.x,
      r.y,
      r.x + r.width,
      r.y + r.height,
      (e) => probe.reaches(e.o, e.x0, e.y0, e.x1, e.y1) && !exempt(e.o) && probe.hits(e.o, e.x0, e.y0, e.x1, e.y1)
    );
  }
  for (const o of index.near(probe.bounds)) {
    const r = obstacleBounds(o);
    const [x0, y0, x1, y1] = [r.x, r.y, r.x + r.width, r.y + r.height];
    if (probe.reaches(o, x0, y0, x1, y1) && !exempt(o) && probe.hits(o, x0, y0, x1, y1)) {
      return true;
    }
  }
  return false;
}
