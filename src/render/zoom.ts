import type { ZoomAlign, ZoomOptions } from '../types';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  viewBox: ViewBox;
  width: string;
  height: string;
  overflow: 'hidden' | 'auto';
  /** the letterbox position when the box has a different aspect than the viewBox */
  align: ZoomAlign;
}

export function readViewBox(root: SVGSVGElement): ViewBox {
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const [x, y, w, h] = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const w = parseFloat(root.getAttribute('width') ?? '0') || 100;
  const h = parseFloat(root.getAttribute('height') ?? '0') || 100;
  return { x: 0, y: 0, w, h };
}

export function viewBoxFor(zoom: ZoomOptions, base: ViewBox, box: { width: number; height: number }): Layout {
  const align = zoom.align ?? 'top';
  switch (zoom.mode) {
    case 'fit':
      return { viewBox: base, width: '100%', height: '100%', overflow: 'hidden', align };
    case 'fit-width': {
      const h = (box.width * base.h) / base.w;
      return { viewBox: base, width: `${box.width}px`, height: `${h}px`, overflow: 'auto', align };
    }
    case 'original':
      return { viewBox: base, width: `${base.w}px`, height: `${base.h}px`, overflow: 'auto', align };
    case 'custom': {
      const f = (zoom.percent || 100) / 100;
      return { viewBox: base, width: `${base.w * f}px`, height: `${base.h * f}px`, overflow: 'auto', align };
    }
  }
}

/** The preserveAspectRatio value of an alignment. The diagram is always centred horizontally. */
const ASPECT: Record<ZoomAlign, string> = { top: 'xMidYMin meet', center: 'xMidYMid meet' };

/** Scale the viewBox by `factor` (<1 zooms in) around the point (cx, cy) in viewBox units. */
export function zoomAt(vb: ViewBox, factor: number, cx: number, cy: number): ViewBox {
  const w = vb.w * factor;
  const h = vb.h * factor;
  return { x: cx - (cx - vb.x) * factor, y: cy - (cy - vb.y) * factor, w, h };
}

export function applyLayout(root: SVGSVGElement, layout: Layout): void {
  const { x, y, w, h } = layout.viewBox;
  root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  root.setAttribute('width', layout.width);
  root.setAttribute('height', layout.height);
  root.setAttribute('preserveAspectRatio', ASPECT[layout.align]);
}

/** The live view scale stays in this range, relative to the base (configured) view. */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 10;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** The zoomAt factor that keeps the result inside MIN_SCALE..MAX_SCALE of the base. */
export function clampFactor(vb: ViewBox, factor: number, base: ViewBox): number {
  const scale = clampScale(base.w / (vb.w * factor));
  return base.w / (vb.w * scale);
}

/** No live view, or a live view that is the base view. */
export function isDefaultView(view: ViewBox | null, base: ViewBox): boolean {
  if (!view) {
    return true;
  }
  const eps = 1e-6 * Math.max(base.w, base.h);
  return (
    Math.abs(view.x - base.x) <= eps &&
    Math.abs(view.y - base.y) <= eps &&
    Math.abs(view.w - base.w) <= eps &&
    Math.abs(view.h - base.h) <= eps
  );
}

/** Pixels per viewBox unit and the letterbox offset for preserveAspectRatio="xMidYMin meet" or "xMidYMid meet". */
function meet(vb: { w: number; h: number }, rect: Rect, align: ZoomAlign) {
  const k = Math.min(rect.width / vb.w, rect.height / vb.h) || 1;
  return { k, ox: (rect.width - vb.w * k) / 2, oy: align === 'top' ? 0 : (rect.height - vb.h * k) / 2 };
}

/** Client pixel to viewBox units for a viewBox shown in `rect`. Pure: it does not read the DOM. */
export function clientToView(vb: ViewBox, rect: Rect, cx: number, cy: number, align: ZoomAlign): Point {
  const { k, ox, oy } = meet(vb, rect, align);
  return { x: vb.x + (cx - rect.left - ox) / k, y: vb.y + (cy - rect.top - oy) / k };
}

/**
 * The view for a pinch or a drag. `start` is the view when the gesture started, `anchor` is the content
 * point (viewBox units) under the fingers at the start, `mid` is the client position of the fingers now
 * and `ratio` is the finger distance now divided by the distance at the start (1 for one finger).
 * The anchor stays under `mid`. The scale stays inside MIN_SCALE..MAX_SCALE of `base`. `align` must be the
 * alignment of the svg, so that a gesture without movement gives the start view back.
 */
export function pinchView(
  start: ViewBox,
  base: ViewBox,
  rect: Rect,
  anchor: Point,
  mid: Point,
  ratio: number,
  align: ZoomAlign
): ViewBox {
  const scale = clampScale((base.w / start.w) * ratio);
  const w = base.w / scale;
  const h = (start.h * w) / start.w;
  const { k, ox, oy } = meet({ w, h }, rect, align);
  return { x: anchor.x - (mid.x - rect.left - ox) / k, y: anchor.y - (mid.y - rect.top - oy) / k, w, h };
}
