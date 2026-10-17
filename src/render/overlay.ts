import type { GrafanaTheme2 } from '@grafana/data';
import type { CellEntry, CellIndex, HalfState, PatchMap } from '../types';
import { PathGeom, pathGeometry, Point } from './geometry';

export const OVERLAY_CLASS = 'dmap-overlay';
const NS = 'http://www.w3.org/2000/svg';

export interface OverlayOptions {
  theme: GrafanaTheme2;
  arrowSize?: number;
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
  if (link.a2b && link.b2a) {
    drawHalf(layer, id, 'a2b', geo, geo.polyline(0, L / 2), link.a2b, L / 2, true, o);
    drawHalf(layer, id, 'b2a', geo, geo.polyline(L / 2, L), link.b2a, L / 2, false, o);
    return;
  }
  if (link.a2b) {
    drawHalf(layer, id, 'a2b', geo, geo.polyline(0, L), link.a2b, L, true, o);
  } else if (link.b2a) {
    drawHalf(layer, id, 'b2a', geo, geo.polyline(0, L), link.b2a, 0, false, o);
  }
}

export function renderOverlay(root: SVGSVGElement, index: CellIndex, patches: PatchMap, opts: OverlayOptions): void {
  const o: Required<OverlayOptions> = { arrowSize: 8, ...opts };
  root.querySelectorAll(`g.${OVERLAY_CLASS}`).forEach((g) => g.remove());
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    if (!entry) {
      continue;
    }
    if (patch.link) {
      drawLink(entry, patch.link, o);
    }
  }
}
