import type { GrafanaTheme2 } from '@grafana/data';
import type { CellEntry, CellIndex, HalfState, PatchMap } from '../types';
import { arrowAnchor, PathGeom, pathGeometry, Point } from './geometry';
import type { Rect } from './labelPlacement';
import type { PlanCellPatch } from '../binding/engine';
import type { StatusView } from '../binding/status';

export const OVERLAY_CLASS = 'dmap-overlay';
/** the length of an arrow head of a half, in the units of the edge */
export const ARROW_SIZE = 8;
const NS = 'http://www.w3.org/2000/svg';

export interface OverlayOptions {
  theme: GrafanaTheme2;
  arrowSize?: number;
}

/**
 * The arc length (in the units of `geo.length`) where the two halves of a link meet: the middle of the path, moved
 * onto one straight run so that both arrow heads stand clear of the bends. The label layer reads the same split.
 */
export function linkSplit(geo: PathGeom, arrowSize = ARROW_SIZE): number {
  return arrowAnchor(geo.bends, geo.length, geo.length / 2, (2 * arrowSize) / geo.unit);
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

/** A coordinate for an attribute: two decimals, as draw.io writes them. */
export const fmt = (n: number) => String(Math.round(n * 100) / 100);
const pointsAttr = (pts: Point[]) => pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');

/** The elements of one drawn half, with the key of the state they show. */
interface HalfDrawn {
  line: SVGPolylineElement;
  arrow: SVGPolygonElement;
  key: string;
}
/** The overlay of one link: its layer, the set of halves it was built for, and the elements of each half. */
interface LinkDrawn {
  layer: SVGGElement;
  combo: string;
  a2b?: HalfDrawn;
  b2a?: HalfDrawn;
}
interface MarkerDrawn {
  layer: SVGGElement;
  key: string;
}
/** What `renderOverlay` left under one root. The elements live across refreshes; the keys say what they show. */
interface OverlayState {
  index: CellIndex;
  arrowSize: number;
  links: Map<string, LinkDrawn>;
  markers: Map<string, MarkerDrawn>;
}

const states = new WeakMap<SVGSVGElement, OverlayState>();

/** The fields of a half that its elements show; the geometry is not among them. */
const halfKey = (s: HalfState) => `${s.status}|${s.color}|${s.width}|${s.stepIndex}`;
/** The fields of a marker: its text, its title, and the two theme colours it is painted with. */
const markerKey = (v: StatusView, theme: GrafanaTheme2) =>
  `${v.state}|${v.reason}|${statusColor(v, theme)}|${theme.colors.background.primary}`;

function drawHalf(
  layer: SVGGElement,
  cellId: string,
  which: 'a2b' | 'b2a',
  geo: PathGeom,
  pts: Point[],
  state: HalfState,
  arrowAt: number,
  forward: boolean,
  o: Required<OverlayOptions>
): HalfDrawn {
  const line = layer.appendChild(
    el('polyline', {
      class: 'dmap-half',
      'data-dmap-cell': cellId,
      'data-dmap-half': which,
      'data-dmap-status': state.status,
      'data-dmap-step': state.stepIndex,
      points: pointsAttr(pts),
      fill: 'none',
      stroke: state.color,
      'stroke-width': state.width,
      'stroke-linecap': 'butt',
      'stroke-linejoin': 'round',
      'pointer-events': 'stroke',
    })
  );
  const tip = geo.pointAt(arrowAt);
  const ang = forward ? tip.angle : tip.angle + Math.PI;
  const s = o.arrowSize;
  const tri: Point[] = [
    { x: tip.x, y: tip.y },
    { x: tip.x - s * Math.cos(ang) + (s / 2) * Math.sin(ang), y: tip.y - s * Math.sin(ang) - (s / 2) * Math.cos(ang) },
    { x: tip.x - s * Math.cos(ang) - (s / 2) * Math.sin(ang), y: tip.y - s * Math.sin(ang) + (s / 2) * Math.cos(ang) },
  ];
  const arrow = layer.appendChild(
    el('polygon', {
      class: 'dmap-arrow',
      'data-dmap-cell': cellId,
      'data-dmap-half': which,
      points: pointsAttr(tri),
      fill: state.color,
      'pointer-events': 'none',
    })
  );
  return { line, arrow, key: halfKey(state) };
}

/** Writes a new state into the elements of a drawn half; the points stay (the geometry did not change). */
function updateHalf(drawn: HalfDrawn, state: HalfState): void {
  const key = halfKey(state);
  if (drawn.key === key) {
    return;
  }
  drawn.key = key;
  drawn.line.setAttribute('data-dmap-status', state.status);
  drawn.line.setAttribute('data-dmap-step', String(state.stepIndex));
  drawn.line.setAttribute('stroke', state.color);
  drawn.line.setAttribute('stroke-width', String(state.width));
  drawn.arrow.setAttribute('fill', state.color);
}

function drawLink(
  entry: CellEntry,
  link: { a2b?: HalfState; b2a?: HalfState },
  o: Required<OverlayOptions>
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
  const drawn: LinkDrawn = { layer, combo: comboOf(link) };
  // An arrow stands on one straight run, away from the bends: the triangle must not stick out past a corner.
  const clear = (2 * o.arrowSize) / geo.unit;
  if (link.a2b && link.b2a) {
    const mid = linkSplit(geo, o.arrowSize);
    drawn.a2b = drawHalf(layer, id, 'a2b', geo, geo.polyline(0, mid), link.a2b, mid, true, o);
    drawn.b2a = drawHalf(layer, id, 'b2a', geo, geo.polyline(mid, L), link.b2a, mid, false, o);
  } else if (link.a2b) {
    const at = arrowAnchor(geo.bends, L, L, clear);
    drawn.a2b = drawHalf(layer, id, 'a2b', geo, geo.polyline(0, L), link.a2b, at, true, o);
  } else if (link.b2a) {
    const at = arrowAnchor(geo.bends, L, 0, clear);
    drawn.b2a = drawHalf(layer, id, 'b2a', geo, geo.polyline(0, L), link.b2a, at, false, o);
  }
  return drawn;
}

/** Which halves a link has: the geometry of the overlay depends on this and the path only. */
const comboOf = (link: { a2b?: HalfState; b2a?: HalfState }) => `${link.a2b ? 'a' : ''}${link.b2a ? 'b' : ''}`;

/**
 * Draws the overlay of the patches under `root` and keeps it across calls. A link whose set of halves did not change
 * keeps its elements; a changed state is written into them. A marker with the same state and reason stays. The
 * layers and markers are built again only for a new index or arrow size (a new stage), when a half appears or
 * goes, or when a layer left the DOM.
 */
export function renderOverlay(root: SVGSVGElement, index: CellIndex, patches: PatchMap, opts: OverlayOptions): void {
  const o: Required<OverlayOptions> = { arrowSize: ARROW_SIZE, ...opts };
  let state = states.get(root);
  if (!state || state.index !== index || state.arrowSize !== o.arrowSize) {
    root.querySelectorAll(`g.${OVERLAY_CLASS}`).forEach((g) => g.remove());
    root.querySelectorAll('.dmap-status-marker').forEach((g) => g.remove());
    state = { index, arrowSize: o.arrowSize, links: new Map(), markers: new Map() };
    states.set(root, state);
  }
  const liveLinks = new Set<string>();
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    const link = patch.link;
    if (!entry?.line || !link || (!link.a2b && !link.b2a)) {
      continue;
    }
    liveLinks.add(id);
    const drawn = state.links.get(id);
    if (drawn && drawn.combo === comboOf(link) && drawn.layer.parentNode) {
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
    const next = drawLink(entry, link, o);
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
  const liveMarkers = new Set<string>();
  for (const [id, patch] of patches as Map<string, PlanCellPatch>) {
    const entry = index.get(id);
    const status = patch.statusView;
    if (!entry || !status || status.state === 'normal') {
      continue;
    }
    const key = markerKey(status, opts.theme);
    const drawn = state.markers.get(id);
    if (drawn && drawn.key === key && drawn.layer.parentNode) {
      liveMarkers.add(id);
      // a rebuilt layer went in after the path: the kept marker goes back under it, where a fresh draw puts it
      const primitive = entry.shape ?? entry.line;
      if (primitive && primitive.nextSibling !== drawn.layer) {
        primitive.after(drawn.layer);
      }
      continue;
    }
    drawn?.layer.remove();
    state.markers.delete(id);
    const layer = drawStatusMarker(entry, status, opts.theme);
    if (layer) {
      state.markers.set(id, { layer, key });
      liveMarkers.add(id);
    }
  }
  for (const [id, drawn] of state.markers) {
    if (!liveMarkers.has(id)) {
      drawn.layer.remove();
      state.markers.delete(id);
    }
  }
}

export function statusColor(status: StatusView, theme: GrafanaTheme2): string {
  return status.state === 'critical' || status.state === 'down'
    ? theme.colors.error.text
    : status.state === 'warning' || status.state === 'stale'
      ? theme.colors.warning.text
      : theme.colors.text.secondary;
}

/** The font of a status marker; the label layer measures the widest marker text with it. */
export const STATUS_MARKER_FONT = { family: 'sans-serif', size: 12, weight: 'bold' } as const;
/** the widest text a marker shows */
const WIDEST_MARKER = '? missing';
/** the halo stroke of a marker text */
const MARKER_HALO = 3;
/** the width of `text` in `font`, in user units */
export type TextProbe = (text: string, font: { family: string; size: number; weight?: string }) => number;

export interface StatusMarkerBox {
  /** the element whose user space `anchor` and `bounds` are in: the marker layer draws in it */
  space: SVGGraphicsElement;
  /** the baseline start of the marker text */
  anchor: Point;
  /** the painted box of the widest marker text on that baseline, the halo included */
  bounds: Rect;
}

/**
 * Where the status marker of a cell goes, from the geometry alone: the midpoint of an edge, the bottom-left corner
 * of a shape. `drawStatusMarker` draws at `anchor`; the label layer reserves `bounds` for every patched cell, so a
 * marker that appears on a later refresh never meets a label. Without a probe the width is an estimate.
 */
export function statusMarkerBox(entry: CellEntry, probe?: TextProbe): StatusMarkerBox | undefined {
  const primitive = entry.shape ?? entry.line;
  if (!primitive?.parentNode) {
    return undefined;
  }
  let x = Number(primitive.getAttribute('x') ?? primitive.getAttribute('cx') ?? 0);
  let y = Number(primitive.getAttribute('y') ?? primitive.getAttribute('cy') ?? 0);
  if (entry.line) {
    // the marker layer is a sibling of the edge path: the parent's space
    const space = entry.line.parentNode as SVGGraphicsElement;
    const geometry = pathGeometry(entry.line, space);
    const point = geometry.pointAt(geometry.length / 2);
    x = point.x;
    y = point.y;
  } else {
    // Keep device markers inside the shape, including cells at the SVG's top edge.
    y += Number(primitive.getAttribute('height') ?? 0);
    try {
      const box = primitive.getBBox();
      x = box.x;
      y = box.y + box.height;
    } catch {
      // Some SVG hosts do not expose getBBox; rectangle/ellipse attributes still locate the marker.
    }
  }
  const { family, size, weight } = STATUS_MARKER_FONT;
  const width = probe ? probe(WIDEST_MARKER, { family, size, weight }) : 0.6 * size * WIDEST_MARKER.length;
  const anchor = { x: x + 4, y: y - 4 };
  const grow = MARKER_HALO / 2;
  return {
    space: entry.line ? (entry.line.parentNode as SVGGraphicsElement) : primitive,
    anchor,
    bounds: {
      x: anchor.x - grow,
      y: anchor.y - size - grow,
      width: width + 2 * grow,
      height: size * 1.25 + 2 * grow,
    },
  };
}

function drawStatusMarker(entry: CellEntry, status: StatusView, theme: GrafanaTheme2): SVGGElement | undefined {
  const box = statusMarkerBox(entry);
  const primitive = entry.shape ?? entry.line;
  if (!box || !primitive) {
    return undefined;
  }
  const layer = el('g', { class: 'dmap-status-marker', 'data-dmap-cell': entry.meta.id, 'pointer-events': 'none' });
  primitive.after(layer);
  const transform = entry.line ? null : primitive.getAttribute('transform');
  if (transform) {
    layer.setAttribute('transform', transform);
  }
  const text = el('text', {
    x: box.anchor.x,
    y: box.anchor.y,
    'font-family': STATUS_MARKER_FONT.family,
    'font-size': STATUS_MARKER_FONT.size,
    'font-weight': STATUS_MARKER_FONT.weight,
    fill: statusColor(status, theme),
    stroke: theme.colors.background.primary,
    'stroke-width': MARKER_HALO,
    'paint-order': 'stroke',
  });
  text.textContent = `${status.state === 'missing' || status.state === 'stale' ? '?' : '!'} ${status.state}`;
  const title = el('title', {});
  title.textContent = status.reason;
  layer.append(title, text);
  return layer;
}
