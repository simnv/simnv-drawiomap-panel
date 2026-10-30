import React, { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { Box, Size } from '../legend/position';
import type { LegendCorner } from '../types';
import { SandboxPortal } from '../util/sandboxHost';
import { TooltipBox } from '../visuals/ChartHover';
import { lastDataText, lastDataTooltip, zoneName } from './lastData';
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
  // The look of the Grafana tooltip. Fixed in a sandbox host in the body: the Grafana Tooltip renders into
  // #grafana-portal-container, which the frontend sandbox gives the plugin only as a detached mock.
  tip: css`
    position: fixed;
    left: 0;
    top: 0;
    pointer-events: none;
    max-width: 360px;
    padding: ${theme.spacing(0.5, 1)};
    background: ${theme.components.tooltip.background};
    color: ${theme.components.tooltip.text};
    font-size: ${theme.typography.bodySmall.fontSize};
    box-shadow: ${theme.shadows.z2};
    border-radius: ${theme.shape.radius.default};
    z-index: ${theme.zIndex.tooltip};
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
  const [sizes, setSizes] = useState({ single: { width: 0, height: 0 }, wrapped: { width: 0, height: 0 } });
  const single = stampCorner(corner, legend, sizes.single, area);
  const wrap = single.visibility === 'hidden';
  const style = wrap ? stampCorner(corner, legend, sizes.wrapped, area) : single;
  const tipId = useId();
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
  // the anchor of the open tooltip in the viewport; null: closed
  const [tip, setTip] = useState<{ x: number; y: number; height: number } | null>(null);
  // A tap gives the stamp the focus: that focus must not undo the toggle of the tap.
  const touch = useRef(false);
  const show = () => {
    const r = own.current?.getBoundingClientRect();
    setTip(r ? { x: r.right, y: r.top, height: r.height } : { x: 0, y: 0, height: 0 });
  };
  const hide = () => setTip(null);
  const text = lastDataText(time, timeZone);
  // The tooltip has a fixed place: a scroll of the page or of a parent would leave it behind, so it closes.
  const open = tip !== null;
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open]);
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
        style={style}
        dateTime={new Date(time).toISOString()}
        tabIndex={0}
        aria-label={`Last data timestamp: ${text} (${zoneName(timeZone)})`}
        aria-describedby={tip ? tipId : undefined}
        data-testid="dmap-last-data"
        onPointerDown={(e) => {
          touch.current = e.pointerType === 'touch';
        }}
        onPointerEnter={(e) => e.pointerType !== 'touch' && show()}
        onPointerLeave={(e) => e.pointerType !== 'touch' && hide()}
        onFocus={() => touch.current || show()}
        onBlur={() => {
          // the next focus can come from the keyboard
          touch.current = false;
          hide();
        }}
        onKeyDown={(e) => {
          touch.current = false;
          if (e.key === 'Escape' && tip) {
            e.stopPropagation();
            hide();
          }
        }}
        onClick={() => {
          if (touch.current) {
            if (tip) {
              hide();
            } else {
              show();
            }
          }
        }}
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
            className={styles.tip}
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
