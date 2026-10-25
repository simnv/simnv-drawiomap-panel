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

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const pointsAttr = (pts: Point[]) => pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');

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
): void {
  layer.appendChild(
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
  layer.appendChild(
    el('polygon', {
      class: 'dmap-arrow',
      'data-dmap-cell': cellId,
      'data-dmap-half': which,
      points: pointsAttr(tri),
      fill: state.color,
      'pointer-events': 'none',
    })
  );
}

function drawLink(entry: CellEntry, link: { a2b?: HalfState; b2a?: HalfState }, o: Required<OverlayOptions>): void {
  if (!entry.line || (!link.a2b && !link.b2a)) {
    return;
  }
  const layer = ensureOverlay(entry);
  // The layer is a sibling of the path: the conversion is identity unless the path has its own transform.
  const geo = pathGeometry(entry.line, layer);
  const L = geo.length;
  if (!(L > 0)) {
    layer.remove();
    return;
  }
  const id = entry.meta.id;
  // An arrow stands on one straight run, away from the bends: the triangle must not stick out past a corner.
  const clear = (2 * o.arrowSize) / geo.unit;
  if (link.a2b && link.b2a) {
    const mid = linkSplit(geo, o.arrowSize);
    drawHalf(layer, id, 'a2b', geo, geo.polyline(0, mid), link.a2b, mid, true, o);
    drawHalf(layer, id, 'b2a', geo, geo.polyline(mid, L), link.b2a, mid, false, o);
    return;
  }
  if (link.a2b) {
    drawHalf(layer, id, 'a2b', geo, geo.polyline(0, L), link.a2b, arrowAnchor(geo.bends, L, L, clear), true, o);
  } else if (link.b2a) {
    drawHalf(layer, id, 'b2a', geo, geo.polyline(0, L), link.b2a, arrowAnchor(geo.bends, L, 0, clear), false, o);
  }
}

export function renderOverlay(root: SVGSVGElement, index: CellIndex, patches: PatchMap, opts: OverlayOptions): void {
  const o: Required<OverlayOptions> = { arrowSize: ARROW_SIZE, ...opts };
  root.querySelectorAll(`g.${OVERLAY_CLASS}`).forEach((g) => g.remove());
  root.querySelectorAll('.dmap-status-marker').forEach((g) => g.remove());
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    if (!entry) {
      continue;
    }
    if (patch.link) {
      drawLink(entry, patch.link, o);
    }
  }
  const statusPatches: PlanCellPatch[] = [...patches.values()];
  const items = statusPatches.flatMap((p) =>
    p.statusView && index.has(p.cellId) ? [{ cellId: p.cellId, status: p.statusView }] : []
  );
  for (const { cellId, status } of items) {
    if (status.state !== 'normal') {
      drawStatusMarker(index.get(cellId)!, status, opts.theme);
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

function drawStatusMarker(entry: CellEntry, status: StatusView, theme: GrafanaTheme2): void {
  const box = statusMarkerBox(entry);
  const primitive = entry.shape ?? entry.line;
  if (!box || !primitive) {
    return;
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
}
