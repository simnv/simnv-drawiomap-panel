import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';
import type { LegendCorner } from '../types';
import { BarRow } from './BarRow';
import { chipSwatch, type LegendBlock, type LegendEntry, plural } from './model';
import { clampPoint, isDrag, keyMove, type Box, type Point } from './position';

const getStyles = (theme: GrafanaTheme2) => ({
  // Outside the stage, above the diagram, below the corner buttons (z-index 2) and the cards (z-index 3).
  legend: css`
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    /* The size must not depend on the place: an absolute box shrinks near the right edge, and the clamp would loop. */
    width: max-content;
    max-width: min(280px, calc(100% - 8px));
    max-height: 50%;
    overflow-y: auto;
    padding: 2px ${theme.spacing(0.75)} 4px;
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    box-shadow: ${theme.shadows.z1};
    font-size: 11px;
    line-height: 16px;
    color: ${theme.colors.text.secondary};
  `,
  // The drag handle and the toggle: one button. Only it takes all touches (touch-action), so a finger on an entry scrolls.
  chip: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.75)};
    min-height: 20px;
    padding: 0;
    border: none;
    background: none;
    color: ${theme.colors.text.primary};
    font: inherit;
    font-weight: ${theme.typography.fontWeightMedium};
    cursor: grab;
    touch-action: none;
    user-select: none;
    &:focus-visible {
      outline: 2px solid ${theme.colors.primary.main};
    }
  `,
  chipSwatch: css`
    flex: none;
    width: 28px;
    height: 8px;
    border-radius: 2px;
  `,
  block: css`
    margin-top: 2px;
  `,
  // a merged block lists the titles of its members: a long title wraps, also inside a long name
  title: css`
    color: ${theme.colors.text.primary};
    overflow-wrap: anywhere;
  `,
  entries: css`
    display: flex;
    flex-wrap: wrap;
    gap: 0 ${theme.spacing(1)};
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  entry: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
    &:hover,
    &:focus-visible {
      color: ${theme.colors.text.primary};
      outline: 1px solid ${theme.colors.border.strong};
    }
  `,
  swatch: css`
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  `,
  gradient: css`
    flex: none;
    width: 96px;
    height: 8px;
    border-radius: 2px;
  `,
});

interface Props {
  /** All blocks show; the legend scrolls when they do not fit. */
  blocks: LegendBlock[];
  /** The legend starts as a chip. A missing value means collapsed. */
  collapsed?: boolean;
  /** The cells of the entry under the pointer or the focus; null when no entry is active. */
  onHighlight: (cellIds: string[] | null) => void;
  /** The place before the first move: the CSS of the corner. */
  style?: React.CSSProperties;
  corner?: LegendCorner;
  /**
   * The drawn box of the legend at its corner, in px from the top-left of the parent; null when the legend shows
   * nothing. A moved legend reports nothing: the last box of its corner holds.
   */
  onCornerBox?: (box: Box | null) => void;
}

/**
 * The colour legend: one block for each colour scale of the bound cells. It is a chip until the user opens it, and
 * the user can drag it inside its parent (the panel). The place and the state are in this component only.
 */
export const Legend = React.forwardRef<HTMLElement, Props>(function Legend(
  { blocks, collapsed = true, onHighlight, style, corner, onCornerBox },
  ref
) {
  const styles = useStyles2(getStyles);
  // The element is state: the legend renders nothing without blocks, so the node comes and goes. A callback ref gives
  // the forwarded ref and the effects below the current node at all times.
  const rootRef = useRef<HTMLElement | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const setRoot = useCallback(
    (node: HTMLElement | null) => {
      rootRef.current = node;
      setEl(node);
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );
  const [open, setOpen] = useState(!collapsed);
  // A change of the option, or of the corner, resets the legend (state adjustment during render).
  const [wasCollapsed, setWasCollapsed] = useState(collapsed);
  if (wasCollapsed !== collapsed) {
    setWasCollapsed(collapsed);
    setOpen(!collapsed);
  }
  // The place after a move, in px from the top-left of the parent; null: the corner.
  const [pos, setPos] = useState<Point | null>(null);
  // The most height of the legend at its corner, so that the corner offset (the reset button, the status band) never
  // pushes it out of a small panel; it scrolls inside. Null when the place is set by a move.
  const [cornerFit, setCornerFit] = useState<{ maxHeight: number; top: number | null } | null>(null);
  const [wasCorner, setWasCorner] = useState(corner);
  if (wasCorner !== corner) {
    setWasCorner(corner);
    setPos(null);
  }
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  const measure = useCallback(() => {
    const el = rootRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) {
      return null;
    }
    const pr = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      origin: { x: r.left - pr.left, y: r.top - pr.top },
      box: { width: r.width, height: r.height },
      area: { width: pr.width, height: pr.height },
    };
  }, []);
  const place = useCallback(
    (p: Point) => {
      const m = measure();
      setPos(m ? clampPoint(p, m.box, m.area) : p);
    },
    [measure]
  );
  // The legend never leaves the panel: also when the panel gets smaller or the legend grows (it opens).
  // It reads the place from a ref and sets plain values, so a stale callback of the observer does no harm.
  const posRef = useRef(pos);
  posRef.current = pos;
  const reclamp = useCallback(() => {
    const m = measure();
    // a hidden panel has no size: keep the place
    if (!m || (m.area.width === 0 && m.area.height === 0)) {
      return;
    }
    const p = posRef.current;
    if (p === null) {
      const top = typeof style?.top === 'number' ? style.top : null;
      const maxHeight = Math.max(24, Math.min(m.area.height / 2, m.area.height - (top ?? 4) - 4));
      // the top offset (the reset button, the status band) never pushes the legend out of a short panel
      const height = Math.min(Math.max(m.box.height, rootRef.current?.scrollHeight ?? 0), maxHeight);
      const fitTop = top === null ? null : Math.max(0, Math.min(top, m.area.height - height));
      setCornerFit((c) => (c?.maxHeight === maxHeight && c.top === fitTop ? c : { maxHeight, top: fitTop }));
      onCornerBox?.({ ...m.origin, ...m.box });
      return;
    }
    setCornerFit(null);
    const c = clampPoint(p, m.box, m.area);
    if (c.x !== p.x || c.y !== p.y) {
      setPos(c);
    }
  }, [measure, style?.top, onCornerBox]);
  // A new corner moves the legend with no change of its size: measure again, so the corner box is new too.
  useLayoutEffect(() => {
    reclamp();
  }, [reclamp, pos, open, blocks, el, corner]);
  // No blocks: the legend shows nothing and leaves its corner.
  useLayoutEffect(() => {
    if (!el) {
      onCornerBox?.(null);
    }
  }, [el, onCornerBox]);
  useLayoutEffect(() => () => onCornerBox?.(null), [onCornerBox]);
  useEffect(() => {
    if (!el || !el.parentElement || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(reclamp);
    observer.observe(el);
    observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [el, reclamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const m = measure();
    if ((e.pointerType === 'mouse' && e.button !== 0) || !m) {
      return;
    }
    swallowClick.current = false;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: m.origin.x, oy: m.origin.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) {
      return;
    }
    // no button is down: the release was lost
    if (e.buttons === 0) {
      drag.current = null;
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && !isDrag(dx, dy)) {
      return;
    }
    d.moved = true;
    place({ x: d.ox + dx, y: d.oy + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== e.pointerId) {
      return;
    }
    // the click that follows a real drag is not a toggle
    swallowClick.current = drag.current.moved;
    drag.current = null;
  };
  // A cancel or a lost capture ends the drag and leaves no click to swallow.
  const onPointerLost = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id === e.pointerId) {
      drag.current = null;
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    swallowClick.current = false;
    if (e.key === 'Home' && e.target === e.currentTarget.querySelector('button')) {
      e.preventDefault();
      setPos(null);
      return;
    }
    const move = keyMove(e.key, e.shiftKey);
    const m = measure();
    if (!move || !m) {
      return;
    }
    e.preventDefault();
    const from = pos ?? m.origin;
    place({ x: from.x + move.x, y: from.y + move.y });
  };
  // The active entry: "<block key>\n<entry key>", or "<block key>\n" for a gradient bar.
  const [active, setActive] = useState<string | null>(null);
  // The kind of the last pointer of the page, or the keyboard. A tap gives the entry the focus: that focus must not
  // undo the toggle, and a key after a tap must make the focus work again.
  const touch = useRef(false);
  useEffect(() => {
    const kind = (e: PointerEvent) => {
      touch.current = e.pointerType === 'touch';
    };
    const key = () => {
      touch.current = false;
    };
    document.addEventListener('pointerdown', kind, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', kind, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  // A touch outside the entries of this legend ends a tapped highlight.
  useEffect(() => {
    if (active === null || !el) {
      return;
    }
    const away = (e: PointerEvent) => {
      const inEntry =
        e.target instanceof Element && el.contains(e.target) && e.target.closest('[data-testid="dmap-legend-entry"]');
      if (e.pointerType === 'touch' && !inEntry) {
        setActive(null);
      }
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [active, el]);
  // The cells of the active entry now: a data refresh changes them, a closed legend has none.
  const activeIds = useMemo(() => {
    if (!open || active === null) {
      return null;
    }
    const [blockKey, entryKey] = active.split('\n');
    const block = blocks.find((b) => b.key === blockKey);
    return (entryKey ? block?.entries.find((e) => e.key === entryKey)?.cellIds : block?.cellIds) ?? null;
  }, [open, active, blocks]);
  useEffect(() => onHighlight(activeIds), [activeIds, onHighlight]);
  if (!blocks.length) {
    return null;
  }
  // A mouse or a pen: the pointer or the focus shows the entry. A phone has no hover: a tap toggles the entry, and a
  // tap elsewhere ends it. The kind of the last pointer decides, so the focus that a tap gives does not undo the toggle.
  const activate = (key: string) => ({
    tabIndex: 0,
    onPointerEnter: (e: React.PointerEvent) => e.pointerType !== 'touch' && setActive(key),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType !== 'touch' && setActive(null),
    onFocus: () => touch.current || setActive(key),
    onBlur: () => touch.current || setActive(null),
    onClick: () => touch.current && setActive((a) => (a === key ? null : key)),
  });
  const entry = (blockKey: string, e: LegendEntry) => (
    <li
      key={e.key}
      className={styles.entry}
      data-testid="dmap-legend-entry"
      aria-label={`${e.label}: ${plural(e.cellIds.length)}`}
      {...activate(`${blockKey}\n${e.key}`)}
    >
      <span className={styles.swatch} style={{ background: e.color }} data-dmap-swatch="" />
      {e.label}
    </li>
  );
  return (
    <section
      ref={setRoot}
      className={styles.legend}
      style={
        pos
          ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
          : {
              ...style,
              ...(cornerFit === null
                ? {}
                : { maxHeight: cornerFit.maxHeight, ...(cornerFit.top === null ? {} : { top: cornerFit.top }) }),
            }
      }
      aria-label="Colour legend"
      data-testid="dmap-legend"
      data-dmap-corner={corner}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className={styles.chip}
        aria-expanded={open}
        title="Click to open or close. Drag or use the arrow keys to move. Double-click or press Home to put it back."
        data-testid="dmap-legend-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerLost}
        onLostPointerCapture={onPointerLost}
        onDoubleClick={() => setPos(null)}
        onClick={(e) => {
          const swallow = swallowClick.current;
          swallowClick.current = false;
          // a keyboard click (detail 0) always toggles
          if (swallow && e.detail > 0) {
            return;
          }
          setOpen((v) => !v);
          setActive(null);
        }}
      >
        {open ? null : (
          <span className={styles.chipSwatch} style={{ background: chipSwatch(blocks) }} data-dmap-chip-swatch="" />
        )}
        Legend
        <Icon name={open ? 'angle-up' : 'angle-down'} size="sm" aria-hidden />
      </button>
      {open
        ? blocks.map((b) => (
            <div
              key={b.key}
              className={styles.block}
              role="group"
              data-testid="dmap-legend-block"
              aria-label={b.title ?? 'No data'}
            >
              {b.title ? <div className={styles.title}>{b.title}</div> : null}
              {b.bar ? (
                <BarRow bar={b.bar} entries={b.entries} activate={(e) => activate(`${b.key}\n${e.key}`)} />
              ) : (
                <ul className={styles.entries}>
                  {b.gradient ? (
                    <li
                      className={styles.entry}
                      data-testid="dmap-legend-entry"
                      aria-label={`${b.gradient.min} to ${b.gradient.max}: ${plural(b.cellIds.length)}`}
                      {...activate(`${b.key}\n`)}
                    >
                      <span>{b.gradient.min}</span>
                      <span
                        className={styles.gradient}
                        style={{ background: `linear-gradient(to right, ${b.gradient.colors.join(', ')})` }}
                        data-dmap-gradient=""
                      />
                      <span>{b.gradient.max}</span>
                    </li>
                  ) : null}
                  {b.entries.map((e) => entry(b.key, e))}
                </ul>
              )}
            </div>
          ))
        : null}
    </section>
  );
});
