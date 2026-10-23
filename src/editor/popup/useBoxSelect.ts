import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The pointer moves less than this distance, in CSS pixels, and the press is a click, not a band. */
const BAND_SLOP = 4;
/** A click that a band suppressed must arrive at once; a flag that no click took does not outlive this time. */
const CLICK_WINDOW_MS = 300;

export interface BoxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BoxSelectArgs {
  wrapperRef: React.RefObject<HTMLElement>;
  /** The elements to test against the band, by cell id. Called when the band ends. */
  targets: () => Array<{ id: string; el: Element }>;
  /** The cells that the band touches, in the order of `targets`. */
  onSelect: (ids: string[]) => void;
  /** Presses on these targets (the reset button) never start a band. */
  ignore: (target: EventTarget | null) => boolean;
}

interface Band {
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** The pointer left the slop: the band is drawn and a click is not a click any more. */
  moved: boolean;
}

const overlaps = (a: BoxRect, b: DOMRect | BoxRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The box select of the diagram stage: Shift + drag with a mouse or a pen.
 *
 * - Once the pointer leaves the click slop, the stage takes it (`setPointerCapture`): the move and the release reach
 *   the stage also outside of it.
 * - The release and `pointercancel` end the band. A release outside the stage counts the band clipped to the stage.
 * - Esc during the band cancels it and selects nothing. The listener is on `window` in the capture phase: it runs
 *   before the Esc handling of the popup, so the popup does not ask to close.
 * - The click that follows a band that moved is suppressed (`takeClick`).
 * - Touch pointers never start a band.
 */
export function useBoxSelect({ wrapperRef, targets, onSelect, ignore }: BoxSelectArgs) {
  const latest = useRef({ targets, onSelect, ignore });
  useLayoutEffect(() => {
    latest.current = { targets, onSelect, ignore };
  });
  const band = useRef<Band | null>(null);
  const suppress = useRef(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) {
      return;
    }
    const bounds = () => el.getBoundingClientRect();
    /** The band in client coordinates, clipped to the stage. */
    const clipped = (b: Band): BoxRect => {
      const r = bounds();
      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      const xs = [clamp(b.x0, r.left, r.right), clamp(b.x, r.left, r.right)];
      const ys = [clamp(b.y0, r.top, r.bottom), clamp(b.y, r.top, r.bottom)];
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    const stop = (pointerId: number) => {
      try {
        if (el.hasPointerCapture?.(pointerId)) {
          el.releasePointerCapture(pointerId);
        }
      } catch {
        // the pointer is gone
      }
      band.current = null;
      setRect(null);
      window.removeEventListener('keydown', onKey, true);
    };
    const markClick = () => {
      const stamp = Date.now();
      suppress.current = stamp;
      window.setTimeout(() => {
        if (suppress.current === stamp) {
          suppress.current = 0;
        }
      }, CLICK_WINDOW_MS);
    };
    function onKey(e: KeyboardEvent) {
      const b = band.current;
      if (e.key !== 'Escape' || !b) {
        return;
      }
      // The band is the innermost thing that Esc closes: nothing else may react to this key.
      e.stopImmediatePropagation();
      e.preventDefault();
      stop(b.pointerId);
      // The pointer is still down: its release must not click the cell under it.
      markClick();
    }
    const onDown = (e: PointerEvent) => {
      suppress.current = 0;
      if (
        !e.shiftKey ||
        e.button !== 0 ||
        (e.pointerType !== 'mouse' && e.pointerType !== 'pen') ||
        latest.current.ignore(e.target)
      ) {
        return;
      }
      if (band.current) {
        stop(band.current.pointerId);
      }
      band.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false };
      window.addEventListener('keydown', onKey, true);
    };
    const onMove = (e: PointerEvent) => {
      const b = band.current;
      if (!b || b.pointerId !== e.pointerId) {
        return;
      }
      b.x = e.clientX;
      b.y = e.clientY;
      if (!b.moved && Math.hypot(b.x - b.x0, b.y - b.y0) > BAND_SLOP) {
        b.moved = true;
        // Capture only after the slop: a captured press would send its click to the stage, not to the cell, and
        // Shift + click could not toggle that cell. From here the release reaches the stage also outside of it.
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // a synthetic pointer has no capture
        }
      }
      if (b.moved) {
        const r = bounds();
        const c = clipped(b);
        setRect({ left: c.left - r.left, top: c.top - r.top, width: c.right - c.left, height: c.bottom - c.top });
      }
    };
    const onUp = (e: PointerEvent) => {
      const b = band.current;
      if (!b || b.pointerId !== e.pointerId) {
        return;
      }
      b.x = e.clientX;
      b.y = e.clientY;
      const area = clipped(b);
      const moved = b.moved;
      stop(b.pointerId);
      if (!moved) {
        // A press without a drag is a click: Shift + click toggles the cell.
        return;
      }
      markClick();
      const { targets: list, onSelect: select } = latest.current;
      select(list().flatMap(({ id, el: target }) => (overlaps(area, target.getBoundingClientRect()) ? [id] : [])));
    };
    const onCancel = (e: PointerEvent) => {
      const b = band.current;
      if (!b || b.pointerId !== e.pointerId) {
        return;
      }
      const moved = b.moved;
      stop(b.pointerId);
      if (moved) {
        markClick();
      }
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      band.current = null;
    };
  }, [wrapperRef]);

  return {
    /** The band to draw, relative to the stage, or null. */
    rect,
    /** A band is in progress: the pan must not start. */
    active: () => band.current !== null,
    /** True once after a band: the click that follows is not a click. */
    takeClick: () => {
      const fresh = suppress.current !== 0 && Date.now() - suppress.current <= CLICK_WINDOW_MS;
      suppress.current = 0;
      return fresh;
    },
  };
}
