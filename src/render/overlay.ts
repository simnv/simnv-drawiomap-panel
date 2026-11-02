import type { GrafanaTheme2 } from '@grafana/data';
import type { CellEntry, CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import type { ArrowStyle } from '../model/v4';
import { arrowAnchor, PathGeom, pathGeometry, Point } from './geometry';
import { pointTaper } from './pointTaper';
import { linkStatusPaint, statusBorderWidth, statusPaint } from '../binding/color';

export const OVERLAY_CLASS = 'dmap-overlay';
/** the length and the base of the arrow head of a thin half, in the units of the edge */
export const ARROW_SIZE = 8;
/** the widest half that keeps the head of `ARROW_SIZE` */
const THIN = 2;
const NS = 'http://www.w3.org/2000/svg';

export interface OverlayOptions {
  theme: GrafanaTheme2;
  /** `linkWidth.max`: the widest drawn half. The split and the reserved heads are fixed for it. */
  maxWidth: number;
  /** `linkWidth.min`: the thinnest drawn half (0 when absent). The drawn widths stay between the two. */
  minWidth?: number;
}

/** The configured range of the drawn widths of the halves (`linkWidth`). */
export interface WidthRange {
  min: number;
  max: number;
}

/** The size of an arrow head: its length along the path and the width of its base. */
export interface HeadSize {
  length: number;
  base: number;
}

/**
 * The arrow head of a half drawn `width` units wide (at most `maxWidth`). A thin half keeps the head of `ARROW_SIZE`.
 * Above, each unit of width adds 2 to the base and 0.5 to the length: the base stays at least twice the stroke (each
 * wing at least 3 units beyond the stroke edge), and the head takes little of a short half from its value label.
 */
export function headSize(width: number, maxWidth: number, style: ArrowStyle = 'triangle'): HeadSize {
  if (style === 'none') {
    return { length: 0, base: 0 };
  }
  const extra = Math.max(0, Math.min(width, maxWidth) - THIN);
  return { length: ARROW_SIZE + extra / 2, base: style === 'point' ? width : ARROW_SIZE + 2 * extra };
}

/**
 * The free path that an arrow tip keeps to the bends on each side, in the units of the overlay: the longest head, at
 * least `2 × ARROW_SIZE` (the clearance before the heads grew, so a link up to `maxWidth` 10 keeps its split and a
 * one-way tip stays at a port behind the usual 20-unit draw.io jetty). It reads `maxWidth`, not the drawn width, so a
 * width change on a refresh never moves a tip.
 */
const tipClearance = (maxWidth: number) => Math.max(2 * ARROW_SIZE, headSize(maxWidth, maxWidth).length);

/**
 * The arc length (in the units of `geo.length`) where the two halves of a link meet: the middle of the path, moved
 * onto one straight run so that both arrow heads, at their widest, stand clear of the bends. The label layer reads
 * the same split.
 */
export function linkSplit(geo: PathGeom, maxWidth: number): number {
  return arrowAnchor(geo.bends, geo.length, geo.length / 2, tipClearance(maxWidth) / geo.unit);
}

/**
 * The overlay group of one link. It is the next sibling of the edge path, after the arrow heads in the same
 * parent. Thus the halves keep the z-order of their edge: above the hidden edge stroke, below the edge label,
 * the link-label cells and all cells that draw.io draws after the edge.
 */
export function ensureOverlay(entry: CellEntry): SVGGElement {
  const line = entry.line!;
  const parent = line.parentNode!;
  let anchor: Element = line;
  for (const a of entry.arrows) {
    if (a.parentNode === parent && anchor.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) {
      anchor = a;
    }
  }
  const next = anchor.nextElementSibling;
  if (next?.localName === 'g' && next.classList.contains(OVERLAY_CLASS)) {
    return next as SVGGElement;
  }
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', OVERLAY_CLASS);
  g.setAttribute('data-dmap-cell', entry.meta.id);
  g.setAttribute('pointer-events', 'visiblePainted');
  anchor.after(g);
  return g;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  return e;
}

/**
 * The drawn width of a half is `HalfState.width` on a grid of this many steps per unit: a quarter unit. The width
 * follows the load percent without steps (`widthFor`), so with live traffic every half would get new points on every
 * refresh, and the points of a point taper are the costly part of the overlay. A quarter unit is a quarter pixel at
 * the usual fit of a diagram (about one pixel per unit), below what a screen shows; a label beside the stroke moves
 * by the same amount at most (`drawnOf` in the label layer reads the same width).
 */
const WIDTH_STEPS = 4;

/**
 * The width the overlay draws for a half of `width`: a width at or beyond an endpoint of the configured range is that
 * endpoint, exactly (`linkWidth.min` and `max` take any number: a min of 1.2 or a max of 2.1 draws as it is); a width
 * strictly inside is the nearest quarter unit, held inside the range. A width above zero is never drawn as zero.
 */
export function drawnWidth(width: number, range: WidthRange): number {
  const lo = Math.min(range.min, range.max);
  const hi = Math.max(range.min, range.max);
  if (width <= lo) {
    return lo;
  }
  if (width >= hi) {
    return hi;
  }
  const quarter = Math.round(width * WIDTH_STEPS) / WIDTH_STEPS;
  const held = Math.min(hi, Math.max(lo, quarter));
  return held > 0 ? held : width;
}

/** A coordinate for an attribute: two decimals, as draw.io writes them. */
export const fmt = (n: number) => String(Math.round(n * 100) / 100);
const pointsAttr = (pts: Point[], point = false) => {
  // Keep subpixel taper samples distinct. Triangle attributes retain the existing two-decimal format.
  const coordinate = point ? String : fmt;
  return pts.map((p) => `${coordinate(p.x)},${coordinate(p.y)}`).join(' ');
};

/**
 * Where a half lies on its path (arc lengths in the units of `geo.length`): its run `from` to `to` and the tip of its
 * head, which points to `to` when `forward`. The points of the half and the head follow from it and the drawn width.
 */
interface HalfPlace {
  geo: PathGeom;
  from: number;
  to: number;
  tip: number;
  forward: boolean;
  maxWidth: number;
  minWidth: number;
  style: ArrowStyle;
}
/** The `points` attributes of a half and of its head at one drawn width. */
interface HalfPointsAttr {
  line: string;
  head: string;
}
/**
 * The elements of one drawn half, with the key of the state they show and the drawn width their points are drawn
 * for. `points` keeps the attributes per drawn width: a width that comes back (traffic that goes up and down) costs
 * no new taper. The widths lie on the quarter grid between `linkWidth.min` and `max`, so the map stays small.
 */
interface HalfDrawn {
  line: SVGPolylineElement;
  arrow?: SVGPolygonElement;
  key: string;
  width: number;
  place: HalfPlace;
  points: Map<number, HalfPointsAttr>;
}
/** The overlay of one link: its layer, the set of halves it was built for, and the elements of each half. */
interface LinkDrawn {
  layer: SVGGElement;
  combo: string;
  a2b?: HalfDrawn;
  b2a?: HalfDrawn;
}
/** The status border of a bitmap device: a rect after its image, with the status colour it shows. */
interface BorderDrawn {
  el: SVGRectElement;
  key: string;
}
/** What `renderOverlay` left under one root. The elements live across refreshes; the keys say what they show. */
interface OverlayState {
  index: CellIndex;
  maxWidth: number;
  minWidth: number;
  links: Map<string, LinkDrawn>;
  borders: Map<string, BorderDrawn>;
}

export const STATUS_BORDER_CLASS = 'dmap-status-border';

/**
 * The status border of a device whose shape is an `<image>`: fill and stroke do nothing on an image, so a rect with
 * the box of the image goes right after it, in the same space (the transform of the image is copied). An image has
 * no stroke of its own: the border has the minimum width.
 */
function drawBorder(image: SVGGraphicsElement, cellId: string, paint: string): SVGRectElement {
  let box = ['x', 'y', 'width', 'height'].map((a) => image.getAttribute(a) ?? '0');
  try {
    const b = image.getBBox();
    if (b.width > 0 && b.height > 0) {
      box = [b.x, b.y, b.width, b.height].map(fmt);
    }
  } catch {
    // no layout in this host: the attributes locate the image
  }
  const [x, y, width, height] = box;
  const rect = el('rect', {
    class: STATUS_BORDER_CLASS,
    'data-dmap-cell': cellId,
    x,
    y,
    width,
    height,
    fill: 'none',
    stroke: paint,
    'stroke-width': statusBorderWidth(0),
    'pointer-events': 'none',
  });
  const transform = image.getAttribute('transform');
  if (transform) {
    rect.setAttribute('transform', transform);
  }
  image.after(rect);
  return rect;
}

const states = new WeakMap<SVGSVGElement, OverlayState>();

/** The fields of a half that its elements show (the width as it is drawn); the geometry is not among them. */
const halfKey = (s: HalfState, range: WidthRange) =>
  `${s.status}|${s.color}|${drawnWidth(s.width, range)}|${s.stepIndex}`;

/** The configured width range a half is drawn in. */
const rangeOf = (place: HalfPlace): WidthRange => ({ min: place.minWidth, max: place.maxWidth });

/**
 * The halves as they are drawn: with the status colour of the link in place of the binding colour when the status
 * paints (`linkStatusPaint`: a status that is not normal wins over the binding colour). `status` and `stepIndex`
 * stay the binding's: the data attributes and the legend highlight read them.
 */
function drawnHalves(patch: CellPatch, theme: GrafanaTheme2): NonNullable<CellPatch['link']> {
  const link = patch.link ?? {};
  const color = linkStatusPaint(patch, theme);
  if (!color) {
    return link;
  }
  return {
    arrow: link.arrow,
    ...(link.a2b ? { a2b: { ...link.a2b, color } } : {}),
    ...(link.b2a ? { b2a: { ...link.b2a, color } } : {}),
  };
}

/** The triangle of a head of `size`, with its tip at arc length `place.tip`. */
function headTriangle(place: HalfPlace, size: HeadSize): [Point, Point, Point] {
  const tip = place.geo.pointAt(place.tip);
  const ang = place.forward ? tip.angle : tip.angle + Math.PI;
  const s = size.length;
  const h = size.base / 2;
  return [
    { x: tip.x, y: tip.y },
    { x: tip.x - s * Math.cos(ang) + h * Math.sin(ang), y: tip.y - s * Math.sin(ang) - h * Math.cos(ang) },
    { x: tip.x - s * Math.cos(ang) - h * Math.sin(ang), y: tip.y - s * Math.sin(ang) + h * Math.cos(ang) },
  ];
}

/** Keep the turns of the sampled path and remove duplicate or collinear points. */
function turns(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const b = out.at(-1);
    if (b && p.x === b.x && p.y === b.y) {
      continue;
    }
    const a = out.at(-2);
    if (
      a &&
      b &&
      Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) <=
        16 * Number.EPSILON * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(p.x - b.x, p.y - b.y) &&
      (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0
    ) {
      out.pop();
    }
    out.push(p);
  }
  return out;
}

/** A point tapers along the terminal path, with paired offsets through each turn. */
function pointHalf(place: HalfPlace, width: number): { line: Point[]; head: Point[] } {
  const { geo, from, to, forward } = place;
  const stops = [from, ...geo.bends.filter((d) => d > from && d < to), to];
  const path = turns(stops.slice(1).flatMap((end, i) => geo.polyline(stops[i], end)));
  if (!forward) {
    path.reverse();
  }
  if (path.length < 2) {
    return { line: path, head: [] };
  }
  const { line, head } = pointTaper(path, width, headSize(width, place.maxWidth, 'point').length);
  return { line: forward ? line : line.reverse(), head };
}

/** A convex hull reserves a bent taper without a concave-polygon collision test. */
function headHull(points: Point[]): Point[] {
  if (points.length <= 3) {
    return points;
  }
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const chain = (pts: Point[]) => {
    const out: Point[] = [];
    for (const p of pts) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...chain(sorted), ...chain(sorted.reverse())];
}

/**
 * The points of a half and of its head at a drawn width. A butt-capped stroke that runs to the tip sticks out of the
 * narrow end of the triangle, so the stroke stops at the middle of the head, where the triangle is half its base wide
 * (1 unit beyond the stroke edge on each side, or more). Only the end that holds the tip is cut: a one-way tip that
 * stands back from the port keeps the full stroke.
 */
function halfPoints(place: HalfPlace, width: number): { line: Point[]; head: Point[] } {
  const { geo, from, to, tip, forward } = place;
  if (place.style === 'none') {
    return { line: geo.polyline(from, to), head: [] };
  }
  if (place.style === 'point') {
    return pointHalf(place, width);
  }
  const size = headSize(width, place.maxWidth, place.style);
  const cut = size.length / 2 / geo.unit;
  const atEnd = Math.abs((forward ? to : from) - tip) < 1e-6;
  const [a, b] = !atEnd ? [from, to] : forward ? [from, Math.max(from, to - cut)] : [Math.min(to, from + cut), to];
  return { line: geo.polyline(a, b), head: headTriangle(place, size) };
}

/** The reserved head at `maxWidth`. A bent point uses its convex hull. */
const reserved = new WeakMap<Element, Point[]>();

/**
 * The head at the widest width that the arrow head `arrow` can grow to, in the user space of the overlay layer (the
 * space of the polygon). The label placement reserves it, so a width change on a refresh never puts a head under a
 * label. Undefined for an element that the overlay did not draw.
 */
export function reservedHead(arrow: Element): Point[] | undefined {
  return reserved.get(arrow);
}

/** The `points` attributes of a half at a drawn width, from the memo of the half or computed into it. */
function pointsFor(memo: Map<number, HalfPointsAttr>, place: HalfPlace, width: number): HalfPointsAttr {
  const known = memo.get(width);
  if (known) {
    return known;
  }
  const pts = halfPoints(place, width);
  const point = place.style === 'point';
  // a head of fewer than three points is no polygon: the half has no arrow
  const attrs = { line: pointsAttr(pts.line, point), head: pts.head.length < 3 ? '' : pointsAttr(pts.head, point) };
  memo.set(width, attrs);
  return attrs;
}

function drawHalf(
  layer: SVGGElement,
  cellId: string,
  which: 'a2b' | 'b2a',
  place: HalfPlace,
  state: HalfState
): HalfDrawn {
  const width = drawnWidth(state.width, rangeOf(place));
  const points = new Map<number, HalfPointsAttr>();
  const pts = pointsFor(points, place, width);
  const line = layer.appendChild(
    el('polyline', {
      class: 'dmap-half',
      'data-dmap-cell': cellId,
      'data-dmap-half': which,
      'data-dmap-status': state.status,
      'data-dmap-step': state.stepIndex,
      points: pts.line,
      fill: 'none',
      stroke: state.color,
      'stroke-width': width,
      'stroke-linecap': 'butt',
      'stroke-linejoin': 'round',
      'pointer-events': 'stroke',
    })
  );
  const arrow = !pts.head
    ? undefined
    : layer.appendChild(
        el('polygon', {
          class: 'dmap-arrow',
          'data-dmap-cell': cellId,
          'data-dmap-half': which,
          points: pts.head,
          fill: state.color,
          'pointer-events': 'none',
        })
      );
  if (arrow) {
    reserved.set(arrow, headHull(halfPoints(place, place.maxWidth).head));
  }
  return { line, arrow, key: halfKey(state, rangeOf(place)), width, place, points };
}

/**
 * Writes a new state into the elements of a drawn half. The path did not change; a new width redraws the points of
 * the half and its head (the head grows with the width), in the same elements.
 */
function updateHalf(drawn: HalfDrawn, state: HalfState): void {
  const key = halfKey(state, rangeOf(drawn.place));
  if (drawn.key === key) {
    return;
  }
  drawn.key = key;
  const width = drawnWidth(state.width, rangeOf(drawn.place));
  drawn.line.setAttribute('data-dmap-status', state.status);
  drawn.line.setAttribute('data-dmap-step', String(state.stepIndex));
  drawn.line.setAttribute('stroke', state.color);
  drawn.line.setAttribute('stroke-width', String(width));
  drawn.arrow?.setAttribute('fill', state.color);
  if (drawn.width !== width) {
    drawn.width = width;
    const pts = pointsFor(drawn.points, drawn.place, width);
    drawn.line.setAttribute('points', pts.line);
    drawn.arrow?.setAttribute('points', pts.head);
  }
}

function drawLink(
  entry: CellEntry,
  link: NonNullable<CellPatch['link']>,
  maxWidth: number,
  minWidth: number
): LinkDrawn | undefined {
  if (!entry.line || (!link.a2b && !link.b2a)) {
    return undefined;
  }
  const layer = ensureOverlay(entry);
  // The layer is a sibling of the path: the conversion is identity unless the path has its own transform.
  const geo = pathGeometry(entry.line, layer);
  const L = geo.length;
  if (!(L > 0)) {
    layer.remove();
    return undefined;
  }
  const id = entry.meta.id;
  const style = link.arrow ?? 'point';
  const drawn: LinkDrawn = { layer, combo: linkGeometryKey(link) };
  // An arrow stands on one straight run, away from the bends: the widest triangle must not stick out past a corner.
  const clear = tipClearance(maxWidth) / geo.unit;
  const place = (from: number, to: number, tip: number, forward: boolean): HalfPlace => ({
    geo,
    from,
    to,
    tip,
    forward,
    maxWidth,
    minWidth,
    style,
  });
  if (link.a2b && link.b2a) {
    const mid = linkSplit(geo, maxWidth);
    drawn.a2b = drawHalf(layer, id, 'a2b', place(0, mid, mid, true), link.a2b);
    drawn.b2a = drawHalf(layer, id, 'b2a', place(mid, L, mid, false), link.b2a);
  } else if (link.a2b) {
    drawn.a2b = drawHalf(
      layer,
      id,
      'a2b',
      place(0, L, style === 'point' ? L : arrowAnchor(geo.bends, L, L, clear), true),
      link.a2b
    );
  } else if (link.b2a) {
    drawn.b2a = drawHalf(
      layer,
      id,
      'b2a',
      place(0, L, style === 'point' ? 0 : arrowAnchor(geo.bends, L, 0, clear), false),
      link.b2a
    );
  }
  return drawn;
}

/**
 * The drawn halves of a link under `root` (its polylines, a2b before b2a); empty for a link the overlay did not draw.
 * The label layer cuts their strokes under the texts that lie on them.
 */
export function overlayHalves(root: SVGSVGElement, cellId: string): SVGPolylineElement[] {
  const drawn = states.get(root)?.links.get(cellId);
  return drawn ? [drawn.a2b?.line, drawn.b2a?.line].filter((line): line is SVGPolylineElement => !!line) : [];
}

/** The half presence and arrow style that both overlay and label geometry depend on. */
export const linkGeometryKey = (link: CellPatch['link']) =>
  `${link?.a2b ? 'a' : ''}${link?.b2a ? 'b' : ''}:${link?.arrow ?? 'point'}`;

/**
 * Draws the overlay of the patches under `root` and keeps it across calls. A link whose set of halves did not change
 * keeps its elements; a changed state (a binding colour, a width, the status paint) is written into them. The layers
 * are built again only for a new index or max width (a new stage, a new split), when a half appears or goes, or when
 * a layer left the DOM.
 */
export function renderOverlay(root: SVGSVGElement, index: CellIndex, patches: PatchMap, opts: OverlayOptions): void {
  const { maxWidth } = opts;
  const minWidth = opts.minWidth ?? 0;
  let state = states.get(root);
  if (!state || state.index !== index || state.maxWidth !== maxWidth || state.minWidth !== minWidth) {
    root.querySelectorAll(`g.${OVERLAY_CLASS}, .${STATUS_BORDER_CLASS}`).forEach((g) => g.remove());
    state = { index, maxWidth, minWidth, links: new Map(), borders: new Map() };
    states.set(root, state);
  }
  const liveLinks = new Set<string>();
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    if (!entry?.line || !(patch.link?.a2b || patch.link?.b2a)) {
      continue;
    }
    const link = drawnHalves(patch, opts.theme);
    liveLinks.add(id);
    const drawn = state.links.get(id);
    if (drawn && drawn.combo === linkGeometryKey(link) && drawn.layer.parentNode) {
      if (link.a2b && drawn.a2b) {
        updateHalf(drawn.a2b, link.a2b);
      }
      if (link.b2a && drawn.b2a) {
        updateHalf(drawn.b2a, link.b2a);
      }
      continue;
    }
    drawn?.layer.remove();
    state.links.delete(id);
    const next = drawLink(entry, link, maxWidth, minWidth);
    if (next) {
      state.links.set(id, next);
    }
  }
  for (const [id, drawn] of state.links) {
    if (!liveLinks.has(id)) {
      drawn.layer.remove();
      state.links.delete(id);
    }
  }
  // the status border of a bitmap device (the applier paints every other shape itself)
  const liveBorders = new Set<string>();
  for (const [id, patch] of patches) {
    const image = index.get(id)?.shape;
    const paint = image?.localName === 'image' ? statusPaint(patch.statusView, opts.theme) : undefined;
    if (!image || !paint) {
      continue;
    }
    liveBorders.add(id);
    const drawn = state.borders.get(id);
    if (drawn && drawn.el.parentNode) {
      if (drawn.key !== paint) {
        drawn.el.setAttribute('stroke', paint);
        drawn.key = paint;
      }
      continue;
    }
    drawn?.el.remove();
    state.borders.set(id, { el: drawBorder(image, id, paint), key: paint });
  }
  for (const [id, drawn] of state.borders) {
    if (!liveBorders.has(id)) {
      drawn.el.remove();
      state.borders.delete(id);
    }
  }
}
