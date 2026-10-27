import React, { forwardRef } from 'react';
import { css, cx } from '@emotion/css';
import { IconButton, useTheme2 } from '@grafana/ui';

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
  cornerRow: css`
    display: flex;
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
  badge: css`
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    z-index: 1;
  `,
  // In panel edit the badge is a button: reset the browser button look, keep the size of the badge.
  badgeButton: css`
    border: 0;
    margin: 0;
    font-family: inherit;
    line-height: inherit;
    cursor: pointer;
  `,
};

interface Props {
  bandHeight: number;
  /** The live view differs from the configured view: the reset button shows. */
  zoomed: boolean;
  /** Panel edit: the badge is a button that opens the bindings, and the edit button shows. */
  editing: boolean;
  warnings: string[];
  onReset: () => void;
  onWarnings: () => void;
  onEditBindings: () => void;
}

/** The top-left row of the panel: the reset button, the warning badge and, in panel edit, the edit button. */
export const CornerControls = forwardRef<HTMLDivElement, Props>(function CornerControls(
  { bandHeight, zoomed, editing, warnings, onReset, onWarnings, onEditBindings },
  ref
) {
  const theme = useTheme2();
  const buttonStyle = {
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
  };
  const Badge = editing ? 'button' : 'div';
  return (
    <div
      ref={ref}
      className={styles.corner}
      style={{ left: 4, top: bandHeight + 4, maxHeight: `calc(100% - ${bandHeight + 8}px)` }}
      data-testid="dmap-corner"
    >
      {zoomed || warnings.length || editing ? (
        <div className={styles.cornerRow}>
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
            <Badge
              type={editing ? 'button' : undefined}
              className={cx(styles.badge, editing && styles.badgeButton)}
              style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
              title={warnings.join('\n')}
              data-testid="dmap-warning-badge"
              onClick={editing ? onWarnings : undefined}
            >
              {warnings.length} warning{warnings.length > 1 ? 's' : ''}
            </Badge>
          ) : null}
          {editing ? (
            <IconButton
              name="link"
              size="lg"
              tooltip="Edit bindings"
              tooltipPlacement="right"
              className={styles.reset}
              style={buttonStyle}
              data-testid="dmap-edit-bindings"
              onClick={onEditBindings}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
