import React, { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { Box, Size } from '../legend/position';
import type { LegendCorner } from '../types';
import { SandboxPortal } from '../util/sandboxHost';
import { TooltipBox } from '../visuals/ChartHover';
import { lastDataText, lastDataTooltip, zoneName } from './lastData';
import { getTipStyles, useAnchoredTip } from './anchoredTip';
import { followBottom } from '../util/followViewport';
import { stampCorner } from './legendCorners';

const getStyles = (theme: GrafanaTheme2) => ({
  // Above the diagram, below the legend (z-index 1, later in the page): a moved legend can cover it.
  // The height (28 px) is the height of the legend chip, so the two texts stand on one line.
  stamp: css`
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    width: max-content;
    padding: 5px ${theme.spacing(0.75)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    font-size: 11px;
    line-height: 16px;
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
    white-space: normal;
    & > span {
      white-space: nowrap;
    }
    cursor: default;
    &:focus-visible {
      outline: 2px solid ${theme.colors.primary.main};
    }
  `,
});

interface Props {
  /** The time of the newest sample, in ms. */
  time: number;
  timeZone: string;
  corner: LegendCorner;
  legend: Box | null;
  area: Size;
}

/**
 * The last data timestamp: the time of the newest sample of the panel data. A pointer or the focus shows a tooltip
 * that says what the time is; a tap toggles it (a phone has no hover).
 */
export const LastDataStamp = forwardRef<HTMLElement, Props>(function LastDataStamp(
  { time, timeZone, corner, legend, area },
  ref
) {
  const styles = useStyles2(getStyles);
  const tipStyles = useStyles2(getTipStyles);
  const [sizes, setSizes] = useState({ single: { width: 0, height: 0 }, wrapped: { width: 0, height: 0 } });
  const single = stampCorner(corner, legend, sizes.single, area);
  const wrap = single.visibility === 'hidden';
  const style = wrap ? stampCorner(corner, legend, sizes.wrapped, area) : single;
  const own = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      own.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );
  const { id: tipId, tip, props: tipProps } = useAnchoredTip(own);
  const text = lastDataText(time, timeZone);
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) {
      return;
    }
    const report = () => {
      // Measure both natural sizes before paint. A short panel can fit two lines beside the legend even when
      // one line fits neither beside nor above it. Restore the spans before the browser draws the timestamp.
      const spans = Array.from(el.querySelectorAll('span'));
      const saved = spans.map((span) => span.style.display);
      const measure = (display: string): Size => {
        spans.forEach((span) => (span.style.display = display));
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      };
      const single = measure('inline');
      const wrapped = measure('block');
      spans.forEach((span, i) => (span.style.display = saved[i]));
      setSizes((old) =>
        old.single.width === single.width &&
        old.single.height === single.height &&
        old.wrapped.width === wrapped.width &&
        old.wrapped.height === wrapped.height
          ? old
          : { single, wrapped }
      );
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [text, styles.stamp]);
  return (
    <>
      <time
        ref={setRef}
        className={styles.stamp}
        // the timestamp stays in the visible part of a panel whose bottom is out of view
        style={{ ...style, translate: followBottom }}
        dateTime={new Date(time).toISOString()}
        aria-label={`Last data timestamp: ${text} (${zoneName(timeZone)})`}
        data-testid="dmap-last-data"
        {...tipProps}
      >
        <span style={{ display: wrap ? 'block' : undefined }}>{text.slice(0, 10)}</span>{' '}
        <span style={{ display: wrap ? 'block' : undefined }}>{text.slice(11)}</span>
      </time>
      {tip && style.visibility !== 'hidden' ? (
        <SandboxPortal>
          <TooltipBox
            x={tip.x}
            y={tip.y}
            anchorHeight={tip.height}
            live={false}
            className={tipStyles.tip}
            id={tipId}
            testId="dmap-last-data-tooltip"
          >
            {lastDataTooltip(time, timeZone)}
          </TooltipBox>
        </SandboxPortal>
      ) : null}
    </>
  );
});
