import { applyMatrix, invert, pathGeometry, scaleOf, toMatrix, type Matrix, type Point } from '../render/geometry';
import type { CellIndex } from '../types';

/** The catch radius around a thin link, in screen px: the same at every zoom. A finger gets more than a mouse. */
export const CATCH_PX = { mouse: 8, touch: 16 } as const;

export const catchRadius = (pointerType: string): number => (pointerType === 'touch' ? CATCH_PX.touch : CATCH_PX.mouse);

/** One straight run of a link path, in root user units. */
export interface Segment {
  cellId: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** The square of the distance from the point (px, py) to the segment `s`. */
export function segmentDistance2(px: number, py: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2)) : 0;
  const ex = s.ax + t * dx - px;
  const ey = s.ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** The segments of a polyline. */
export function segmentsOf(cellId: string, pts: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < pts.length; i++) {
    out.push({ cellId, ax: pts[i - 1].x, ay: pts[i - 1].y, bx: pts[i].x, by: pts[i].y });
  }
  return out;
}

/**
 * The link nearest to `p` within `radius` (the same units as the segments), among the links that `accept` takes.
 * Of two parallel links the closer one wins: the split is the middle line between them.
 */
export function nearestLink(
  segments: readonly Segment[],
  p: Point,
  radius: number,
  accept: (cellId: string) => boolean
): string | undefined {
  let best: string | undefined;
  let bestD = radius * radius;
  for (const s of segments) {
    const d = segmentDistance2(p.x, p.y, s);
    if (d <= bestD && (s.cellId === best || accept(s.cellId))) {
      best = s.cellId;
      bestD = d;
    }
  }
  return best;
}

/** The side of a grid cell, in root user units. */
const GRID_CELL = 64;
/** A segment that covers more cells than this stays in the list that every query scans. */
const MAX_CELLS_PER_SEGMENT = 64;
/** The cell index is clamped to this range, for the same clamp at insert and at query. */
const GRID_LIMIT = 1 << 19;

const cellOf = (v: number): number => Math.max(-GRID_LIMIT, Math.min(GRID_LIMIT, Math.floor(v / GRID_CELL)));
const cellKey = (cx: number, cy: number): number => (cx + GRID_LIMIT) * (2 * GRID_LIMIT + 1) + (cy + GRID_LIMIT);

/**
 * A uniform grid of the segment boxes. `nearest` has the result of `nearestLink` over the same segments, but it
 * reads only the segments in the cells around the point: the candidates are taken in the original order, so the
 * tie rule (the later of two equal distances wins) and the order of the `accept` calls stay the same.
 */
export class SegmentGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly wide: number[] = [];
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(private readonly segments: readonly Segment[]) {
    this.seen = new Uint32Array(segments.length);
    segments.forEach((s, i) => {
      const x0 = cellOf(Math.min(s.ax, s.bx));
      const x1 = cellOf(Math.max(s.ax, s.bx));
      const y0 = cellOf(Math.min(s.ay, s.by));
      const y1 = cellOf(Math.max(s.ay, s.by));
      if (Number.isNaN(s.ax + s.ay + s.bx + s.by)) {
        return; // a segment with no position is never near
      }
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_SEGMENT) {
        this.wide.push(i);
        return;
      }
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          const list = this.cells.get(key);
          if (list) {
            list.push(i);
          } else {
            this.cells.set(key, [i]);
          }
        }
      }
    });
  }

  nearest(p: Point, radius: number, accept: (cellId: string) => boolean): string | undefined {
    const x0 = cellOf(p.x - radius);
    const x1 = cellOf(p.x + radius);
    const y0 = cellOf(p.y - radius);
    const y1 = cellOf(p.y + radius);
    if (!(x1 - x0 + 1 <= 64 && y1 - y0 + 1 <= 64)) {
      return nearestLink(this.segments, p, radius, accept); // a huge radius (or NaN): the plain scan
    }
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const found: number[] = [];
    const take = (i: number) => {
      if (this.seen[i] !== this.stamp) {
        this.seen[i] = this.stamp;
        found.push(i);
      }
    };
    this.wide.forEach(take);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        this.cells.get(cellKey(cx, cy))?.forEach(take);
      }
    }
    found.sort((a, b) => a - b);
    let best: string | undefined;
    let bestD = radius * radius;
    for (const i of found) {
      const s = this.segments[i];
      const d = segmentDistance2(p.x, p.y, s);
      if (d <= bestD && (s.cellId === best || accept(s.cellId))) {
        best = s.cellId;
        bestD = d;
      }
    }
    return best;
  }
}

/**
 * Finds the link near a pointer on one stage. It keeps two caches: the segments of the link paths of the index in
 * root user units (made again for a new index: a new diagram or stage, not a data refresh) and the screen-to-root
 * transform (made again only after `invalidate`: a zoom, a pan, a scroll or a resize). A pointer move reads neither
 * the layout nor a CTM.
 */
export class NearLinkFinder {
  private root?: SVGSVGElement;
  private index?: CellIndex;
  private segments: Segment[] = [];
  private grid?: SegmentGrid;
  private screenToRoot?: { inverse: Matrix; scale: number };

  /** The view moved or the stage changed size: the next find reads the transform again. */
  invalidate(): void {
    this.screenToRoot = undefined;
  }

  /** The link near the client point (x, y), within the catch radius of `pointerType`. */
  find(
    root: SVGSVGElement,
    index: CellIndex,
    x: number,
    y: number,
    pointerType: string,
    accept: (cellId: string) => boolean
  ): string | undefined {
    if (root !== this.root || index !== this.index) {
      this.root = root;
      this.index = index;
      this.segments = linkSegments(root, index);
      this.grid = new SegmentGrid(this.segments);
      this.screenToRoot = undefined;
    }
    if (!this.segments.length) {
      return undefined;
    }
    if (!this.screenToRoot) {
      const ctm = typeof root.getScreenCTM === 'function' ? toMatrix(root.getScreenCTM()) : undefined;
      if (!ctm) {
        return undefined;
      }
      this.screenToRoot = { inverse: invert(ctm), scale: scaleOf(ctm) };
    }
    const { inverse, scale } = this.screenToRoot;
    return this.grid!.nearest(applyMatrix(inverse, { x, y }), catchRadius(pointerType) / scale, accept);
  }
}

/** The segments of every link path of the index, in root user units (a curve gives its sampled polyline). */
export function linkSegments(root: SVGSVGElement, index: CellIndex): Segment[] {
  const out: Segment[] = [];
  for (const [id, entry] of index) {
    if (entry.line && !entry.ownerId) {
      const geo = pathGeometry(entry.line, root);
      if (geo.length > 0) {
        out.push(...segmentsOf(id, geo.polyline(0, geo.length)));
      }
    }
  }
  return out;
}
