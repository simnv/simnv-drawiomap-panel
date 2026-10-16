import type { GrafanaTheme2 } from '@grafana/data';
import type { CellEntry, CellIndex, HalfState, PatchMap, SparklineState } from '../types';
import { parsePathPoints, PathGeom, pathGeometry, Point } from './geometry';

export const OVERLAY_CLASS = 'dmap-overlay';
const NS = 'http://www.w3.org/2000/svg';

export interface OverlayOptions {
  theme: GrafanaTheme2;
  fontSize?: number;
  labelOffset?: number;
  arrowSize?: number;
  sparkHeight?: number;
}

export function ensureOverlay(root: SVGSVGElement): SVGGElement {
  let g = root.querySelector(`:scope > g.${OVERLAY_CLASS}`) as SVGGElement | null;
  if (!g) {
    g = document.createElementNS(NS, 'g');
    g.setAttribute('class', OVERLAY_CLASS);
    g.setAttribute('pointer-events', 'visiblePainted');
    root.appendChild(g);
  }
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
  labelAt: number,
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

  const lp = geo.pointAt(labelAt);
  const nx = -Math.sin(lp.angle);
  const ny = Math.cos(lp.angle);
  const cx = lp.x + nx * o.labelOffset;
  const cy = lp.y + ny * o.labelOffset;
  const w = state.label.length * o.fontSize * 0.6 + 8;
  const h = o.fontSize + 6;
  const g = el('g', {
    class: 'dmap-label',
    'data-dmap-cell': cellId,
    'data-dmap-half': which,
    'pointer-events': 'none',
  });
  g.appendChild(
    el('rect', {
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h,
      rx: 3,
      fill: o.theme.colors.background.primary,
      stroke: state.color,
      'stroke-width': 1,
    })
  );
  const text = el('text', {
    x: cx,
    y: cy,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': o.fontSize,
    'font-family': o.theme.typography.fontFamily,
    fill: o.theme.colors.text.primary,
  });
  text.textContent = state.label;
  g.appendChild(text);
  layer.appendChild(g);
}

function drawLink(
  layer: SVGGElement,
  entry: CellEntry,
  link: { a2b?: HalfState; b2a?: HalfState },
  o: Required<OverlayOptions>
): void {
  if (!entry.line) {
    return;
  }
  const geo = pathGeometry(entry.line, layer);
  const L = geo.length;
  if (!(L > 0)) {
    return;
  }
  const id = entry.meta.id;
  if (link.a2b && link.b2a) {
    drawHalf(layer, id, 'a2b', geo, geo.polyline(0, L / 2), link.a2b, L / 2, true, L / 4, o);
    drawHalf(layer, id, 'b2a', geo, geo.polyline(L / 2, L), link.b2a, L / 2, false, (3 * L) / 4, o);
    return;
  }
  if (link.a2b) {
    drawHalf(layer, id, 'a2b', geo, geo.polyline(0, L), link.a2b, L, true, L / 2, o);
  } else if (link.b2a) {
    drawHalf(layer, id, 'b2a', geo, geo.polyline(0, L), link.b2a, 0, false, L / 2, o);
  }
}

/** Bounding box in the shape's own user units. getBBox when the browser has it, else attributes or path points. */
export function bboxOf(shape: SVGGraphicsElement): { x: number; y: number; w: number; h: number } | undefined {
  if (typeof shape.getBBox === 'function') {
    try {
      const b = shape.getBBox();
      if (b.width > 0 || b.height > 0) {
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      }
    } catch {
      /* detached element */
    }
  }
  const num = (n: string) => parseFloat(shape.getAttribute(n) ?? '');
  if (shape.localName === 'rect' || shape.localName === 'image') {
    return { x: num('x') || 0, y: num('y') || 0, w: num('width'), h: num('height') };
  }
  if (shape.localName === 'ellipse' || shape.localName === 'circle') {
    const rx = num('rx') || num('r');
    const ry = num('ry') || num('r');
    return { x: num('cx') - rx, y: num('cy') - ry, w: 2 * rx, h: 2 * ry };
  }
  const pts = parsePathPoints(
    shape.getAttribute('d') ?? shape.getAttribute('points')?.replace(/[, ]+/g, ' ').replace(/^/, 'M ') ?? ''
  );
  if (!pts.length) {
    return undefined;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function drawSparkline(layer: SVGGElement, entry: CellEntry, s: SparklineState, o: Required<OverlayOptions>): void {
  if (!entry.shape || s.values.length < 2) {
    return;
  }
  const b = bboxOf(entry.shape);
  if (!b) {
    return;
  }
  const H = o.sparkHeight;
  const box =
    s.position === 'top'
      ? { x: b.x, y: b.y - H - 2, w: b.w, h: H }
      : s.position === 'inside'
        ? { x: b.x + 2, y: b.y + b.h - H - 2, w: b.w - 4, h: H }
        : { x: b.x, y: b.y + b.h + 2, w: b.w, h: H };
  const vals = s.values.filter((v) => Number.isFinite(v));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = s.values.map((v, i) => ({
    x: box.x + (i / (s.values.length - 1)) * box.w,
    y: box.y + box.h - ((Number.isFinite(v) ? v - min : 0) / span) * box.h,
  }));
  layer.appendChild(
    el('polyline', {
      class: 'dmap-spark',
      'data-dmap-cell': entry.meta.id,
      points: pointsAttr(pts),
      fill: 'none',
      stroke: s.color,
      'stroke-width': 1.5,
      'pointer-events': 'none',
    })
  );
}

export function renderOverlay(root: SVGSVGElement, index: CellIndex, patches: PatchMap, opts: OverlayOptions): void {
  const o: Required<OverlayOptions> = { fontSize: 10, labelOffset: 11, arrowSize: 8, sparkHeight: 14, ...opts };
  const layer = ensureOverlay(root);
  layer.replaceChildren();
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    if (!entry) {
      continue;
    }
    if (patch.link) {
      drawLink(layer, entry, patch.link, o);
    }
    if (patch.sparkline) {
      drawSparkline(layer, entry, patch.sparkline, o);
    }
  }
}
