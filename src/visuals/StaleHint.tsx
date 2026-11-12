import React from 'react';
import { useTheme2 } from '@grafana/ui';

/** The height of one text line of a chart box: the value line, the title line and the stale hint. */
export const LINE_HEIGHT = 22;

/**
 * The hint of a stale chart. It has a fixed block height, so a caller can take that height from the plot
 * and the sum of the lines and the plot always fits the box.
 */
export function StaleHint() {
  const theme = useTheme2();
  return (
    <span
      role="status"
      style={{
        display: 'block',
        height: LINE_HEIGHT,
        lineHeight: `${LINE_HEIGHT}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        color: theme.colors.text.secondary,
      }}
    >
      Stale data
    </span>
  );
}
