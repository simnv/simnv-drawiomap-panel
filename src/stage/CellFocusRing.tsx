import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { useCellPlaces } from './useCellPlaces';
import type { Stage } from './useStage';

export interface CellFocusRingProps {
  stage: Stage;
  /** The positioned element that holds the ring: the places are relative to it. */
  wrapperRef: React.RefObject<HTMLElement>;
  /** The container of the svg root: the focus of its cells, and its scroll. */
  container: HTMLElement | null;
  /** The gap between the cell and the ring, in px: it keeps the ring outside of other outlines on the cell. */
  offset?: number;
}

/**
 * A cell group that takes the focus: a cell of the editor or of the panel (`role="button"`) and a linked legend row
 * of the diagram. The stage CSS turns the browser ring off for these, and the ring below replaces it.
 */
export const FOCUSABLE_CELL = '[data-cell-id][tabindex]';

/** A key that the browser does not count as keyboard use: a modifier alone. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn']);

/** The focus shows: a keyboard focus, not the focus of a click. An engine without `:focus-visible` shows it. */
const focusVisible = (el: Element) => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

/**
 * The keyboard focus ring of a diagram cell, on its painted box (`useCellPlaces`). The ring of the browser takes the
 * box of the cell group, and a draw.io HTML label (a 100% foreignObject) makes that box the whole viewport: the stage
 * turns the outline of its cells off, and this ring replaces it. The ring is its own element, so an outline of the
 * selection on the same cell does not hide it.
 *
 * A cell group with the focus shows the ring when `:focus-visible` matches at the focus, or at a key press later (a
 * click, then a key: the browser turns `:focus-visible` on with no new focus event; a modifier alone does not count).
 */
export function CellFocusRing({ stage, wrapperRef, container, offset = 2 }: CellFocusRingProps) {
  const styles = useStyles2(getStyles);
  const [focused, setFocused] = useState<string | null>(null);
  const { index } = stage;
  useEffect(() => {
    if (!container) {
      return;
    }
    const cellOf = (el: EventTarget | null) => {
      const id = el instanceof Element && el.matches(FOCUSABLE_CELL) ? el.getAttribute('data-cell-id') : null;
      return id !== null && index.get(id)?.group === el ? id : null;
    };
    const onFocus = (e: FocusEvent) =>
      setFocused(e.target instanceof Element && focusVisible(e.target) ? cellOf(e.target) : null);
    const onBlur = () => setFocused(null);
    const onKey = (e: KeyboardEvent) => {
      if (!MODIFIERS.has(e.key)) {
        setFocused(cellOf(document.activeElement));
      }
    };
    container.addEventListener('focusin', onFocus);
    container.addEventListener('focusout', onBlur);
    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('focusin', onFocus);
      container.removeEventListener('focusout', onBlur);
      container.removeEventListener('keydown', onKey);
    };
  }, [container, index]);
  // a group that a new root replaced loses the focus with no blur: the ring follows only the active element
  const ring = focused !== null && index.get(focused)?.group === document.activeElement ? focused : null;
  const [place] = useCellPlaces(stage, ring === null ? [] : [ring], wrapperRef, container);
  return place && place.id === ring ? (
    <div
      className={styles.ring}
      data-testid="dmap-cell-focus"
      data-dmap-focus={ring}
      style={{ left: place.left, top: place.top, width: place.width, height: place.height, outlineOffset: offset }}
    />
  ) : null;
}

const getStyles = (theme: GrafanaTheme2) => ({
  ring: css({
    position: 'absolute',
    zIndex: 1,
    pointerEvents: 'none',
    outline: `2px solid ${theme.colors.primary.border}`,
  }),
});
