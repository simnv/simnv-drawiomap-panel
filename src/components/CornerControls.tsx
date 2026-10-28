import React, { forwardRef } from 'react';
import { css } from '@emotion/css';
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
};

interface Props {
  bandHeight: number;
  /** The live view differs from the configured view: the reset button shows. */
  zoomed: boolean;
  warnings: string[];
  onReset: () => void;
}

/** The top-left row holds the reset button and the warning badge. */
export const CornerControls = forwardRef<HTMLDivElement, Props>(function CornerControls(
  { bandHeight, zoomed, warnings, onReset },
  ref
) {
  const theme = useTheme2();
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
      {zoomed || warnings.length ? (
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
            <div
              className={styles.badge}
              style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
              title={warnings.join('\n')}
              data-testid="dmap-warning-badge"
            >
              {warnings.length} warning{warnings.length > 1 ? 's' : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
