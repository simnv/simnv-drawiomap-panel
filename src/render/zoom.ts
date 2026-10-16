import type { ZoomOptions } from '../types';

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
  switch (zoom.mode) {
    case 'fit':
      return { viewBox: base, width: '100%', height: '100%', overflow: 'hidden' };
    case 'fit-width': {
      const h = (box.width * base.h) / base.w;
      return { viewBox: base, width: `${box.width}px`, height: `${h}px`, overflow: 'auto' };
    }
    case 'original':
      return { viewBox: base, width: `${base.w}px`, height: `${base.h}px`, overflow: 'auto' };
    case 'custom': {
      const f = (zoom.percent || 100) / 100;
      return { viewBox: base, width: `${base.w * f}px`, height: `${base.h * f}px`, overflow: 'auto' };
    }
  }
}

/** Scale the viewBox by `factor` (<1 zooms in) around the point (cx, cy) in viewBox units. */
export function zoomAt(vb: ViewBox, factor: number, cx: number, cy: number): ViewBox {
  const w = vb.w * factor;
  const h = vb.h * factor;
  return { x: cx - (cx - vb.x) * factor, y: cy - (cy - vb.y) * factor, w, h };
}

/** Move the view by (dx, dy) in viewBox units: dragging right shows content further left. */
export function pan(vb: ViewBox, dx: number, dy: number): ViewBox {
  return { ...vb, x: vb.x - dx, y: vb.y - dy };
}

export function applyLayout(root: SVGSVGElement, layout: Layout): void {
  const { x, y, w, h } = layout.viewBox;
  root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  root.setAttribute('width', layout.width);
  root.setAttribute('height', layout.height);
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
}

/** Client pixel to viewBox units. Uses getScreenCTM when the browser provides it. */
export function clientToViewBox(root: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = typeof root.getScreenCTM === 'function' ? root.getScreenCTM() : null;
  if (ctm) {
    const inv = ctm.inverse();
    return { x: inv.a * clientX + inv.c * clientY + inv.e, y: inv.b * clientX + inv.d * clientY + inv.f };
  }
  const r = root.getBoundingClientRect();
  const vb = readViewBox(root);
  return {
    x: vb.x + ((clientX - r.left) / (r.width || 1)) * vb.w,
    y: vb.y + ((clientY - r.top) / (r.height || 1)) * vb.h,
  };
}
