import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { Button, IconButton, useTheme2 } from '@grafana/ui';

/** Heights in px of the items in the top-left row. */
const RESET_SIZE = 32;
const BADGE_HEIGHT = 20;

/** The height of the top-left row: the buttons set it when they show, else the badge. 0: the row is empty. */
export const cornerRowHeight = (buttons: boolean, warnings: number) =>
  buttons ? RESET_SIZE : warnings ? BADGE_HEIGHT : 0;

const styles = {
  // The top-left stack: the reset button and the warning badge in one row.
  // The top-right corner is free: Grafana puts its panel menu button there.
  corner: css`
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    max-width: calc(100% - 8px);
    /* above the legend: in a tiny panel the legend may cover the corner, but the reset button stays clickable */
    z-index: 2;
    /* The empty space beside the row is part of the diagram: only the row and the legend catch the pointer. */
    pointer-events: none;
  `,
  // On a narrow panel the row wraps: the "Edit bindings" button goes to the next line, it never leaves the panel.
  cornerRow: css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    pointer-events: auto;
  `,
  // 32 px: a touch target for a finger
  reset: css`
    margin: 0;
    min-width: 32px;
    min-height: 32px;
    border-radius: 4px;
  `,
  // the text button keeps the 32 px touch target of the reset button
  edit: css`
    margin: 0;
    min-height: 32px;
    white-space: nowrap;
  `,
  badge: css`
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    z-index: 1;
  `,
};

interface Props {
  bandHeight: number;
  /** The live view differs from the configured view: the reset button shows. */
  zoomed: boolean;
  /** Panel edit: the "Edit bindings" button shows. */
  editing: boolean;
  warnings: string[];
  onReset: () => void;
  onEditBindings: () => void;
  /** The drawn height of the row in px, also when it wraps to more lines; 0 when there is no row or no layout. */
  onRowHeight: (height: number) => void;
}

/** The top-left row holds the reset button, the warning badge and, in panel edit, the "Edit bindings" button. */
export const CornerControls = forwardRef<HTMLDivElement, Props>(function CornerControls(
  { bandHeight, zoomed, editing, warnings, onReset, onEditBindings, onRowHeight },
  ref
) {
  const theme = useTheme2();
  const showRow = !!(zoomed || warnings.length || editing);
  const rowRef = useRef<HTMLDivElement>(null);
  // A wrapped row is higher than `cornerRowHeight`: the legend below the row reads the drawn height.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!showRow || !row || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => onRowHeight(row.offsetHeight));
    observer.observe(row);
    return () => {
      observer.disconnect();
      onRowHeight(0);
    };
  }, [showRow, onRowHeight]);
  const buttonStyle = {
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
  };
  return (
    <div
      ref={ref}
      className={styles.corner}
      style={{ left: 4, top: bandHeight + 4, maxHeight: `calc(100% - ${bandHeight + 8}px)` }}
      data-testid="dmap-corner"
    >
      {showRow ? (
        <div ref={rowRef} className={styles.cornerRow} data-testid="dmap-corner-row">
          {zoomed ? (
            <IconButton
              name="search-minus"
              size="lg"
              tooltip="Reset zoom"
              tooltipPlacement="right"
              className={styles.reset}
              style={buttonStyle}
              data-testid="dmap-reset-zoom"
              onClick={onReset}
            />
          ) : null}
          {warnings.length ? (
            <div
              className={styles.badge}
              style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
              title={warnings.join('\n')}
              data-testid="dmap-warning-badge"
            >
              {warnings.length} warning{warnings.length > 1 ? 's' : ''}
            </div>
          ) : null}
          {editing ? (
            <Button
              icon="link"
              size="sm"
              variant="secondary"
              className={styles.edit}
              style={buttonStyle}
              data-testid="dmap-edit-bindings"
              onClick={onEditBindings}
            >
              Edit bindings
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
