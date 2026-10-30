import React, { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { Size } from '../legend/position';
import { SandboxPortal } from '../util/sandboxHost';
import { TooltipBox } from '../visuals/ChartHover';
import { lastDataText, lastDataTooltip, zoneName } from './lastData';

const getStyles = (theme: GrafanaTheme2) => ({
  // Above the diagram, below the legend (z-index 1, later in the page): a moved legend can cover it.
  // The height (28 px) is the height of the legend chip, so the two texts stand on one line.
  stamp: css`
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    padding: 5px ${theme.spacing(0.75)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    font-size: 11px;
    line-height: 16px;
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
  /** The place in the panel (`stampCorner`). */
  style: React.CSSProperties;
  /** The drawn size, for the place beside the legend. */
  onSize: (size: Size) => void;
}

/**
 * The last data timestamp: the time of the newest sample of the panel data. A pointer or the focus shows a tooltip
 * that says what the time is; a tap toggles it (a phone has no hover).
 */
export const LastDataStamp = forwardRef<HTMLElement, Props>(function LastDataStamp(
  { time, timeZone, style, onSize },
  ref
) {
  const styles = useStyles2(getStyles);
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
      const r = el.getBoundingClientRect();
      onSize({ width: r.width, height: r.height });
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [onSize, text]);
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
        {text}
      </time>
      {tip ? (
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
