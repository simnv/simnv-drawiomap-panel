import { useEffect, useLayoutEffect, useRef } from 'react';
import { clampFactor, clientToView, isDefaultView, pinchView, Point, Rect, ViewBox, zoomAt } from '../render/zoom';
import type { ZoomAlign } from '../types';

/** A tap moves less than this distance, in CSS pixels. */
const TAP_SLOP = 6;
/** Pinch-zoom and Ctrl+wheel: the view scale changes by exp(-deltaY * WHEEL_RATE). */
const WHEEL_RATE = 0.01;
const WHEEL_MAX_DELTA = 50;

interface Args {
  wrapperRef: React.RefObject<HTMLDivElement>;
  root?: SVGSVGElement;
  base?: ViewBox;
  view: ViewBox | null;
  setView: React.Dispatch<React.SetStateAction<ViewBox | null>>;
  /** The "Wheel zoom" option: the plain wheel zooms. Ctrl+wheel (a trackpad pinch) always zooms. */
  wheel: boolean;
  /** The "Drag pan" option: a mouse drag pans also at the configured view. */
  dragPan: boolean;
  /** The "Align" option: the gesture math uses the letterbox position of the svg. */
  align: ZoomAlign;
  /** Events on these targets (the card) are not gestures. */
  ignore: (t: EventTarget | null) => boolean;
}

interface Pointer {
  type: string;
  x: number;
  y: number;
  x0: number;
  y0: number;
}

interface Gesture {
  start: ViewBox;
  rect: Rect;
  anchor: Point;
  dist: number;
  align: ZoomAlign;
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const midOf = (pts: Pointer[]): Point =>
  pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : { x: pts[0].x, y: pts[0].y };
const distOf = (pts: Pointer[]) => (pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0);

/**
 * Pinch zoom, drag pan and wheel zoom of the live view. The live view is panel state only: it does not
 * change the saved options.
 *
 * - Two fingers: the pinch zooms around the midpoint, a move of the midpoint pans.
 * - One finger: at the configured view the hook does not capture it, so the page scrolls and a tap pins
 *   a card. When the view is zoomed, one finger pans; a tap (less than 6 px of movement) still pins a card.
 * - Mouse or pen: a drag pans when the view is zoomed or "Drag pan" is on.
 * - Ctrl+wheel (a trackpad pinch) zooms. The plain wheel zooms only when "Wheel zoom" is on.
 */
export function usePanZoom({ wrapperRef, root, base, view, setView, wheel, dragPan, align, ignore }: Args) {
  const latest = useRef({ view, wheel, dragPan, align, ignore });
  useLayoutEffect(() => {
    latest.current = { view, wheel, dragPan, align, ignore };
  });
  const state = useRef({
    pointers: new Map<number, Pointer>(),
    gesture: null as Gesture | null,
    moved: false,
    applied: false,
    suppressClick: false,
  });
  const zoomed = !!base && !isDefaultView(view, base);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !root || !base) {
      return;
    }
    const s = state.current;
    const isZoomed = () => !isDefaultView(latest.current.view, base);

    // Start (or restart) the gesture from the pointers that are down now.
    const begin = () => {
      const pts = [...s.pointers.values()];
      const one = pts[0];
      const pans =
        pts.length > 1 ||
        (pts.length === 1 && (one.type === 'touch' ? isZoomed() : latest.current.dragPan || isZoomed()));
      if (!pans) {
        s.gesture = null;
        return;
      }
      const start = latest.current.view ?? base;
      const rect = rectOf(root);
      const mid = midOf(pts);
      const anchor = clientToView(start, rect, mid.x, mid.y, latest.current.align);
      s.gesture = { start, rect, anchor, dist: distOf(pts), align: latest.current.align };
    };
    const end = (e: PointerEvent) => {
      if (!s.pointers.delete(e.pointerId)) {
        return;
      }
      if (s.pointers.size) {
        begin();
        return;
      }
      // A drag that moved the view is not a click.
      s.suppressClick = s.applied;
      s.gesture = null;
      s.moved = false;
      s.applied = false;
    };

    const onDown = (e: PointerEvent) => {
      if (latest.current.ignore(e.target) || (e.pointerType !== 'touch' && e.button !== 0)) {
        return;
      }
      if (!s.pointers.size) {
        s.moved = false;
        s.applied = false;
        s.suppressClick = false;
      }
      s.pointers.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      begin();
    };
    const onMove = (e: PointerEvent) => {
      const p = s.pointers.get(e.pointerId);
      if (!p) {
        return;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (!s.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_SLOP) {
        s.moved = true;
        // Capture only after the slop: a captured tap would send its click to the wrapper, not to the cell.
        if (s.gesture && typeof el.setPointerCapture === 'function') {
          for (const id of s.pointers.keys()) {
            try {
              el.setPointerCapture(id);
            } catch {
              // the pointer is gone
            }
          }
        }
      }
      const g = s.gesture;
      if (!g || !s.moved) {
        return;
      }
      const pts = [...s.pointers.values()];
      const ratio = g.dist && pts.length > 1 ? distOf(pts) / g.dist : 1;
      s.applied = true;
      setView(pinchView(g.start, base, g.rect, g.anchor, midOf(pts), ratio, g.align));
    };
    // A mouse that leaves the panel without capture does not send pointerup to the panel.
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && !el.hasPointerCapture?.(e.pointerId)) {
        end(e);
      }
    };
    // Two fingers, or one finger on a zoomed view: the gesture is ours, the page does not scroll or zoom.
    const onTouchMove = (e: TouchEvent) => {
      if (e.cancelable && !latest.current.ignore(e.target) && (e.touches.length > 1 || isZoomed())) {
        e.preventDefault();
      }
    };
    // React adds wheel listeners as passive, so preventDefault needs a native listener.
    const onWheel = (e: WheelEvent) => {
      // the wheel scrolls a long card
      if (latest.current.ignore(e.target)) {
        return;
      }
      let factor: number;
      if (e.ctrlKey) {
        const d = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, e.deltaY));
        factor = Math.exp(d * WHEEL_RATE);
      } else if (latest.current.wheel) {
        factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      } else {
        return;
      }
      e.preventDefault();
      const rect = rectOf(root);
      setView((v) => {
        const cur = v ?? base;
        const c = clientToView(cur, rect, e.clientX, e.clientY, latest.current.align);
        return zoomAt(cur, clampFactor(cur, factor, base), c.x, c.y);
      });
    };

    // The capture phase: an element in the diagram that stops a pointer event does not stop the pan. A chart region
    // is a React portal, and React stops a native event at the portal container, below the wrapper.
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', end, true);
    el.addEventListener('pointercancel', end, true);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', end, true);
      el.removeEventListener('pointercancel', end, true);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('touchmove', onTouchMove, true);
      el.removeEventListener('wheel', onWheel);
      s.pointers.clear();
      s.gesture = null;
    };
  }, [wrapperRef, root, base, setView]);

  return {
    /** The live view differs from the configured view. */
    zoomed,
    /** A pan or a pinch is in progress: no hover card. */
    busy: () => state.current.gesture !== null,
    /** True once after a drag that moved the view: the click that follows is not a tap. */
    takeClick: () => {
      const s = state.current;
      const v = s.suppressClick;
      s.suppressClick = false;
      return v;
    },
  };
}
