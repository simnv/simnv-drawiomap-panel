import { useEffect } from 'react';

/** The px that the top items (the corner row, a top legend) move down to stay in the visible part of the panel. */
export const FOLLOW_TOP = '--dmap-follow-top';
/** The px that the bottom items (a bottom legend, the last data timestamp) move up. */
export const FOLLOW_BOTTOM = '--dmap-follow-bottom';

/** The CSS `translate` of an item at the top of the panel. */
export const followTop = `0 var(${FOLLOW_TOP}, 0px)`;
/** The CSS `translate` of an item at the bottom of the panel. */
export const followBottom = `0 calc(-1 * var(${FOLLOW_BOTTOM}, 0px))`;

/**
 * The px that an item in `panel` is moved by now (down > 0): the CSS variable that `useFollowViewport` wrote. The
 * layout place of the item is its drawn place less this.
 */
export function followShift(panel: HTMLElement, atBottom: boolean): number {
  const value = parseFloat(panel.style.getPropertyValue(atBottom ? FOLLOW_BOTTOM : FOLLOW_TOP)) || 0;
  return atBottom ? -value : value;
}

/** A box in client px. */
interface Span {
  top: number;
  bottom: number;
}

/** A fixed or sticky element (a header bar of Grafana) at or above `el`, outside `panel`. */
function overlayOf(el: Element | null, panel: Element): Element | undefined {
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (e === panel || panel.contains(e)) {
      return undefined;
    }
    const position = getComputedStyle(e).position;
    if (position === 'fixed' || position === 'sticky') {
      return e;
    }
  }
  return undefined;
}

/**
 * The part of `panel` that the user can see, in client px: the viewport, cut by each scrolling ancestor and by the
 * fixed or sticky bars of the page that cover the top or the bottom of the panel (the Grafana header and the
 * dashboard controls). The bars are found with a hit test at the middle of the visible part, so the panel needs no
 * knowledge of the Grafana layout.
 */
export function visibleSpan(panel: Element): Span {
  const r = panel.getBoundingClientRect();
  const viewport = window.visualViewport;
  let top = Math.max(r.top, viewport?.offsetTop ?? 0, 0);
  let bottom = Math.min(r.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
  for (let e = panel.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(e).overflowY)) {
      const c = e.getBoundingClientRect();
      top = Math.max(top, c.top);
      bottom = Math.min(bottom, c.bottom);
    }
  }
  if (typeof document.elementFromPoint !== 'function' || bottom <= top) {
    return { top, bottom };
  }
  const x = Math.min(
    Math.max((Math.max(r.left, 0) + Math.min(r.right, window.innerWidth)) / 2, 0),
    window.innerWidth - 1
  );
  // a bar can sit below another bar (the dashboard controls below the header): test again below each one
  for (let i = 0; i < 3 && bottom > top; i++) {
    const bar = overlayOf(document.elementFromPoint(x, top + 1), panel);
    if (!bar) {
      break;
    }
    top = Math.max(top, bar.getBoundingClientRect().bottom);
  }
  for (let i = 0; i < 3 && bottom > top; i++) {
    const bar = overlayOf(document.elementFromPoint(x, bottom - 1), panel);
    if (!bar) {
      break;
    }
    bottom = Math.min(bottom, bar.getBoundingClientRect().top);
  }
  return { top, bottom };
}

/**
 * How far the top items and the bottom items move. The top items start below the status band, which scrolls away with
 * the panel: they move only when the cut at the top is more than the band. Both are 0 when the panel shows no part.
 */
export function followOffsets(panel: Span, visible: Span, bandHeight: number): { top: number; bottom: number } {
  if (visible.bottom <= visible.top) {
    return { top: 0, bottom: 0 };
  }
  const height = panel.bottom - panel.top;
  const cutTop = Math.min(Math.max(visible.top - panel.top, 0), height);
  const cutBottom = Math.min(Math.max(panel.bottom - visible.bottom, 0), height);
  return { top: Math.round(Math.max(0, cutTop - bandHeight)), bottom: Math.round(cutBottom) };
}

/**
 * Keeps the corner row, the legend and the last data timestamp in the visible part of a panel that is taller than the
 * view or partly scrolled out of it. A scroll or a resize computes the offsets once per frame and writes them as two
 * CSS variables on the panel element: the items move with CSS `translate`, with no render. Nothing runs while the page
 * is still.
 */
export function useFollowViewport(panel: HTMLElement | null, bandHeight: number): void {
  useEffect(() => {
    if (!panel) {
      return;
    }
    let frame: number | undefined;
    let last = '';
    const update = () => {
      frame = undefined;
      const r = panel.getBoundingClientRect();
      const { top, bottom } = followOffsets(r, visibleSpan(panel), bandHeight);
      const key = `${top}|${bottom}`;
      if (key !== last) {
        last = key;
        panel.style.setProperty(FOLLOW_TOP, `${top}px`);
        panel.style.setProperty(FOLLOW_BOTTOM, `${bottom}px`);
      }
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    observer?.observe(panel);
    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      observer?.disconnect();
      panel.style.removeProperty(FOLLOW_TOP);
      panel.style.removeProperty(FOLLOW_BOTTOM);
    };
  }, [panel, bandHeight]);
}
