import React from 'react';
import { useTheme2 } from '@grafana/ui';

/** The height of one text line of a chart box: the value line, the title line and the stale hint. */
export const LINE_HEIGHT = 22;

/**
 * The smallest plot in px. A box that leaves less room for the plot, after its text lines, shows the text only:
 * a plot is never placed outside its box.
 */
export const MIN_PLOT_HEIGHT = 12;

/** The plot height of a box of `height` px with `lines` text lines above the plot; `null` when the plot is too small. */
export function plotHeightOf(height: number, lines: number): number | null {
  const room = height - lines * LINE_HEIGHT;
  return room >= MIN_PLOT_HEIGHT ? room : null;
}

/** One text line of exactly `LINE_HEIGHT`: it never wraps, a long text ends with an ellipsis, `title` has the full text. */
export function TextLine({
  children,
  title,
  color,
  ...rest
}: {
  children: React.ReactNode;
  title?: string;
  color?: string;
  role?: string;
  'data-testid'?: string;
}) {
  return (
    <div
      {...rest}
      title={title}
      style={{
        height: LINE_HEIGHT,
        lineHeight: `${LINE_HEIGHT}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        color,
      }}
    >
      {children}
    </div>
  );
}

/** The hint of a stale chart: one `TextLine` in the secondary colour, so the caller can take its height from the plot. */
export function StaleHint() {
  const theme = useTheme2();
  return (
    <TextLine role="status" color={theme.colors.text.secondary}>
      Stale data
    </TextLine>
  );
}
