import { useEffect } from 'react';

/** The px that the top items (the corner row, a top legend) move down to stay in the visible part of the panel. */
export const FOLLOW_TOP = '--dmap-follow-top';
/** The px that the bottom items (a bottom legend, the last data timestamp) move up. */
export const FOLLOW_BOTTOM = '--dmap-follow-bottom';
/** The height in px of the visible part of the panel, while the items follow it; absent when the whole panel shows. */
export const FOLLOW_VISIBLE = '--dmap-follow-visible';

/** The CSS `translate` of an item at the top of the panel. */
export const followTop = `0 var(${FOLLOW_TOP}, 0px)`;
/** The CSS `translate` of an item at the bottom of the panel. */
export const followBottom = `0 calc(-1 * var(${FOLLOW_BOTTOM}, 0px))`;

/** A visible part smaller than this does not move the items: they would not fit in it. */
export const MIN_FOLLOW = 120;
/** The items keep this much of the panel below the top items and above the bottom items: they never leave the panel. */
const KEEP = 40;
/** A fixed or sticky element higher than this part of the view is a dialog or a backdrop, not a bar of the page. */
const MAX_BAR = 0.4;

/**
 * The CSS `max-height` of a legend at its corner: at most `px`, and at most the visible part of the panel less
 * `inset` px while the items follow the view.
 */
export const followMaxHeight = (px: number, inset: number) =>
  `min(${px}px, calc(var(${FOLLOW_VISIBLE}, ${px + inset}px) - ${inset}px))`;

/**
 * The px that an item in `panel` is moved by now (down > 0): the CSS variable that `useFollowViewport` wrote. The
 * layout place of the item is its drawn place less this.
 */
export function followShift(panel: HTMLElement, atBottom: boolean): number {
  const value = parseFloat(panel.style.getPropertyValue(atBottom ? FOLLOW_BOTTOM : FOLLOW_TOP)) || 0;
  return atBottom ? -value : value;
}

/** A vertical span in client px. */
export interface Span {
  top: number;
  bottom: number;
}

/** The scrolling ancestors of `el` (they clip it), read once: the layout of the page around a panel seldom changes. */
export function scrollingAncestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(e).overflowY)) {
      out.push(e);
    }
  }
  return out;
}

/**
 * The bar of the page at `hit`: a fixed or sticky element, outside the panel and not around it, at most `MAX_BAR` of
 * the view high (a dialog, a drawer or a sheet is higher, or it is not a bar of the page).
 */
function barOf(hit: Element | null, panel: Element, viewHeight: number): Element | undefined {
  for (let e = hit; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (e === panel || panel.contains(e) || e.contains(panel)) {
      return undefined;
    }
    const position = getComputedStyle(e).position;
    if (position === 'fixed' || position === 'sticky') {
      return e.getBoundingClientRect().height <= viewHeight * MAX_BAR ? e : undefined;
    }
  }
  return undefined;
}

/**
 * The part of `panel` that the user can see, in client px: the visual viewport, cut by the scrolling ancestors and by
 * the bars of the page over the top of the panel (the Grafana header and the dashboard controls). The bars are found
 * with a hit test, so the panel needs no knowledge of the Grafana layout. Grafana has no bar at the bottom: the bottom
 * is not hit-tested, so a sheet or a dialog there never counts.
 */
export function visibleSpan(panel: Element, clips: readonly Element[], r = panel.getBoundingClientRect()): Span {
  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop ?? 0;
  const viewHeight = viewport?.height ?? window.innerHeight;
  const viewLeft = viewport?.offsetLeft ?? 0;
  const viewWidth = viewport?.width ?? window.innerWidth;
  let top = Math.max(r.top, viewTop);
  let bottom = Math.min(r.bottom, viewTop + viewHeight);
  for (const clip of clips) {
    const c = clip.getBoundingClientRect();
    top = Math.max(top, c.top);
    bottom = Math.min(bottom, c.bottom);
  }
  if (typeof document.elementFromPoint !== 'function' || bottom <= top) {
    return { top, bottom };
  }
  const left = Math.max(r.left, viewLeft);
  const right = Math.min(r.right, viewLeft + viewWidth);
  const x = Math.min(Math.max((left + right) / 2, viewLeft), viewLeft + viewWidth - 1);
  // a bar can sit below another bar (the dashboard controls below the header): test again below each one
  for (let i = 0; i < 3 && bottom > top; i++) {
    const bar = barOf(document.elementFromPoint(x, top + 1), panel, viewHeight);
    if (!bar) {
      break;
    }
    top = Math.max(top, bar.getBoundingClientRect().bottom);
  }
  return { top, bottom };
}

/**
 * How far the top items and the bottom items move, and the visible height. The top items start below the status band,
 * which scrolls away with the panel: they move only when the cut at the top is more than the band. The items never
 * leave the panel, and a visible part smaller than `MIN_FOLLOW` (or none) moves nothing.
 */
export function followOffsets(
  panel: Span,
  visible: Span,
  bandHeight: number
): { top: number; bottom: number; visible?: number } {
  const height = panel.bottom - panel.top;
  const shown = visible.bottom - visible.top;
  if (shown < MIN_FOLLOW) {
    return { top: 0, bottom: 0 };
  }
  const cutTop = Math.min(Math.max(visible.top - panel.top, 0), height);
  const cutBottom = Math.min(Math.max(panel.bottom - visible.bottom, 0), height);
  const top = Math.round(Math.min(Math.max(0, cutTop - bandHeight), Math.max(0, height - bandHeight - KEEP)));
  const bottom = Math.round(Math.min(cutBottom, Math.max(0, height - KEEP)));
  return top || bottom ? { top, bottom, visible: Math.round(shown) } : { top: 0, bottom: 0 };
}

/**
 * Keeps the corner row, the legend and the last data timestamp in the visible part of a panel that is taller than the
 * view or partly scrolled out of it. A scroll of the page (of an element around the panel), a resize, or a move of the
 * panel in the view computes the offsets once per frame and writes them as CSS variables on the panel element: the
 * items move with CSS `translate`, with no render. Nothing runs while the page is still, and nothing for a panel out
 * of view. A panel in an iframe (an embedded panel) follows only the scroll inside its own frame.
 */
export function useFollowViewport(panel: HTMLElement | null, bandHeight: number): void {
  useEffect(() => {
    if (!panel) {
      return;
    }
    let frame: number | undefined;
    let last = '';
    let clips = scrollingAncestors(panel);
    let inView = true;
    const write = (top: number, bottom: number, visible?: number) => {
      const key = `${top}|${bottom}|${visible}`;
      if (key === last) {
        return;
      }
      last = key;
      panel.style.setProperty(FOLLOW_TOP, `${top}px`);
      panel.style.setProperty(FOLLOW_BOTTOM, `${bottom}px`);
      if (visible === undefined) {
        panel.style.removeProperty(FOLLOW_VISIBLE);
      } else {
        panel.style.setProperty(FOLLOW_VISIBLE, `${visible}px`);
      }
    };
    const update = () => {
      frame = undefined;
      if (!inView) {
        return;
      }
      const r = panel.getBoundingClientRect();
      const { top, bottom, visible } = followOffsets(r, visibleSpan(panel, clips, r), bandHeight);
      write(top, bottom, visible);
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(update);
    };
    // only a scroll of the page or of an element around the panel moves it: not a scroll inside the legend, a card,
    // or a dialog
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t === document || t === window || (t instanceof Node && t.contains(panel))) {
        schedule();
      }
    };
    const onResize = () => {
      clips = scrollingAncestors(panel);
      schedule();
    };
    // A move of the panel with no scroll (a row above it opens or closes, the controls wrap) changes how much of it
    // shows: the observer reports each step of 5 %. It also stops the work for a panel out of view.
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              inView = entries[entries.length - 1].isIntersecting;
              if (inView) {
                schedule();
              } else {
                write(0, 0);
              }
            },
            { threshold: Array.from({ length: 21 }, (_, i) => i / 20) }
          )
        : undefined;
    io?.observe(panel);
    schedule();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    // the pointer comes back to the panel: a change that no event reported shows now at the latest
    panel.addEventListener('pointerenter', schedule);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    ro?.observe(panel);
    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      panel.removeEventListener('pointerenter', schedule);
      panel.style.removeProperty(FOLLOW_TOP);
      panel.style.removeProperty(FOLLOW_BOTTOM);
      panel.style.removeProperty(FOLLOW_VISIBLE);
    };
  }, [panel, bandHeight]);
}
