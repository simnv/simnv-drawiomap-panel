import type { CellIndex, ZoomAlign, ZoomOptions } from '../types';
import { applyMatrix, relativeMatrix } from './geometry';

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

/**
 * The svg box for the configured view `base` in a stage of size `box`. A live view (`view`) changes the viewBox
 * only: the svg box keeps its size, so that the gesture math stays in one coordinate system.
 */
export function viewBoxFor(
  zoom: ZoomOptions,
  base: ViewBox,
  box: { width: number; height: number },
  view: ViewBox = base
): Layout {
  const align = zoom.align ?? 'top';
  const min = zoom.minScale ?? 0;
  const px = (scale: number) => ({ width: `${base.w * scale}px`, height: `${base.h * scale}px` });
  switch (zoom.mode) {
    case 'fit': {
      if (min > Math.min(box.width / base.w, box.height / base.h)) {
        // A dimension that does not overflow fills the box: preserveAspectRatio keeps the diagram centred in it.
        const width = base.w * min > box.width ? `${base.w * min}px` : '100%';
        const height = base.h * min > box.height ? `${base.h * min}px` : '100%';
        return { viewBox: view, width, height, overflow: 'auto', align };
      }
      return { viewBox: view, width: '100%', height: '100%', overflow: 'hidden', align };
    }
    case 'fit-width': {
      if (min > box.width / base.w) {
        return { viewBox: view, ...px(min), overflow: 'auto', align };
      }
      const h = (box.width * base.h) / base.w;
      return { viewBox: view, width: `${box.width}px`, height: `${h}px`, overflow: 'auto', align };
    }
    case 'original':
      return { viewBox: view, ...px(1), overflow: 'auto', align };
    case 'custom':
      return { viewBox: view, ...px((zoom.percent || 100) / 100), overflow: 'auto', align };
  }
}

/**
 * Pixels per user unit of the rendered svg: the `meet` scale of its viewBox in its own rendered rect (not the panel:
 * `minScale` and the Custom mode make the svg larger than the panel). 0 for an svg without a size.
 */
export function viewScaleOf(root: SVGSVGElement): number {
  const rect = root.getBoundingClientRect();
  const vb = readViewBox(root);
  return Math.min(rect.width / vb.w, rect.height / vb.h);
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

/** The box of a cell group in the user space of its svg; undefined when the engine gives no finite box. */
function cellBox(group: SVGGElement): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const root = group.ownerSVGElement;
  if (!root || typeof group.getBBox !== 'function') {
    return undefined;
  }
  try {
    const b = group.getBBox();
    const m = relativeMatrix(group, root);
    if (!m || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) {
      return undefined;
    }
    const corners = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => applyMatrix(m, { x, y }));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  } catch {
    return undefined;
  }
}

/**
 * The view that fits the union of the boxes of the cells `ids`, with `margin` user units on each side (spec 5.3). The
 * view has the aspect of `base`, so the scale is the same on both axes, and its scale stays in MIN_SCALE..MAX_SCALE
 * of the base (`clampFactor`). An id with no cell or no box is skipped; with no box the result is `base`.
 */
export function fitCells(index: CellIndex, ids: string[], base: ViewBox, margin: number): ViewBox {
  let union: { x0: number; y0: number; x1: number; y1: number } | undefined;
  for (const id of ids) {
    const group = index.get(id)?.group;
    const box = group && cellBox(group);
    if (box) {
      union = union
        ? {
            x0: Math.min(union.x0, box.x0),
            y0: Math.min(union.y0, box.y0),
            x1: Math.max(union.x1, box.x1),
            y1: Math.max(union.y1, box.y1),
          }
        : box;
    }
  }
  if (!union) {
    return base;
  }
  const w = union.x1 - union.x0 + 2 * margin;
  const h = union.y1 - union.y0 + 2 * margin;
  const factor = clampFactor(base, Math.max(w / base.w, h / base.h), base);
  const cx = (union.x0 + union.x1) / 2;
  const cy = (union.y0 + union.y1) / 2;
  return { x: cx - (base.w * factor) / 2, y: cy - (base.h * factor) / 2, w: base.w * factor, h: base.h * factor };
}
