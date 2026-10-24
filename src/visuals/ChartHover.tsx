import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  createTheme,
  dateTimeFormat,
  formattedValueToString,
  type Field,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import { Portal, SeriesTable, useStyles2, useTheme2 } from '@grafana/ui';
import { fieldDisplay, type HistoryModel } from '../query/frames';
import { alignedSamples, nearestIndex, sampleTimes, timeAt } from './hoverSample';
import { placeTooltip } from './tooltipPlace';

/** One series of the tooltip. */
export interface HoverSeries {
  name: string;
  color: string;
  history: HistoryModel;
  /** the formatter of the row, when the field alone does not give it */
  format?: (value: number) => string;
}

export interface ChartHoverProps {
  /** The tooltip shows only when true (the pinned card). Otherwise the children render as they are. */
  enabled: boolean;
  series: HoverSeries[];
  timeRange: TimeRange;
  timeZone?: string;
  /** Width of the chart in px when it is narrower than the row: the pointer maps over the chart, not the row. */
  width?: number;
  label?: string;
  children: React.ReactNode;
}

const getStyles = (theme: GrafanaTheme2) => ({
  // pan-y: a horizontal drag on a phone scrubs the chart, a vertical drag still scrolls the sheet
  wrap: css`
    position: relative;
    touch-action: pan-y;
    &:focus-visible {
      outline: 2px solid ${theme.colors.primary.border};
      outline-offset: 1px;
    }
  `,
  line: css`
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    pointer-events: none;
    background: ${theme.colors.text.secondary};
    opacity: 0.7;
  `,
  // The look of the Grafana tooltip container (background, shadow, padding, radius, z-index). Its own
  // compositing layer and no transition: a new sample repaints this box only, at once.
  box: css`
    position: fixed;
    left: 0;
    top: 0;
    pointer-events: none;
    will-change: transform;
    overflow: hidden;
    max-width: 800px;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.elevated};
    box-shadow: ${theme.shadows.z2};
    border-radius: ${theme.shape.radius.default};
    z-index: ${theme.zIndex.tooltip};
  `,
});

/** Frames the box without a ResizeObserver waits for a size before it gives up. */
const PLACE_RETRIES = 10;

/**
 * The positioned box of the tooltip. The Grafana VizTooltipContainer places itself with a state write in a layout
 * effect and a ResizeObserver (two to four commits for each sample) and moves with a 100 ms transition, so the
 * box trails the pointer. This box writes its place to the DOM, no state, no transition: one commit for each
 * sample. Only a keyboard step is a live region: a pointer scrub would flood a screen reader.
 *
 * The Grafana Portal attaches its container in a layout effect of a parent, after the layout effect of this box:
 * the first measurement sees no size. The box stays hidden until it has a size. A ResizeObserver reports the
 * size when the box is in the document and on each change of its content; without one, frames retry. A change
 * of the viewport places the box again.
 */
export function TooltipBox({
  x,
  y,
  live,
  className,
  children,
}: {
  x: number;
  y: number;
  live: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // the anchor of the latest commit, for a size report or a viewport change later
  const anchor = useRef({ x, y });
  // Places the box from its current size. True when the box is in the document and has a size.
  const place = useCallback(() => {
    const el = ref.current;
    if (!el || !el.isConnected) {
      return false;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // the view without the scrollbars; jsdom has no client size
    const root = document.documentElement;
    const p = placeTooltip(
      anchor.current.x,
      anchor.current.y,
      w,
      h,
      root.clientWidth || window.innerWidth,
      root.clientHeight || window.innerHeight
    );
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    if (w > 0 && h > 0) {
      el.style.visibility = '';
      return true;
    }
    return false;
  }, []);
  const observed = typeof ResizeObserver === 'function';
  // Each commit: a new anchor or new content. Without a ResizeObserver, frames retry until the box has a size.
  useLayoutEffect(() => {
    anchor.current = { x, y };
    if (place() || observed) {
      return;
    }
    let tries = 0;
    let frame: number | undefined;
    const retry = () => {
      frame = undefined;
      if (!place() && ++tries < PLACE_RETRIES) {
        frame = requestAnimationFrame(retry);
      }
    };
    frame = requestAnimationFrame(retry);
    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const again = () => void place();
    const observer = observed ? new ResizeObserver(again) : undefined;
    observer?.observe(el);
    const viewport = window.visualViewport;
    window.addEventListener('resize', again);
    viewport?.addEventListener('resize', again);
    viewport?.addEventListener('scroll', again);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', again);
      viewport?.removeEventListener('resize', again);
      viewport?.removeEventListener('scroll', again);
    };
  }, [place, observed]);
  return (
    <div
      ref={ref}
      className={className}
      style={{ visibility: 'hidden' }}
      data-testid="dmap-chart-tooltip"
      aria-live={live ? 'polite' : undefined}
      aria-atomic="true"
    >
      {children}
    </div>
  );
}

/** The formatted value of a sample: the row formatter or the field display processor, "–" for a gap. */
export function formatSample(
  field: Field,
  value: number | null,
  theme: GrafanaTheme2 = createTheme(),
  timeZone?: string,
  format?: (value: number) => string
): string {
  if (value === null) {
    return '–';
  }
  return format ? format(value) : formattedValueToString(fieldDisplay(field, theme, timeZone)(value));
}

interface Hover {
  /** time of the hovered sample in ms: the state changes only when this changes */
  time: number;
  /** the crosshair and the tooltip sit on the sample, not on the pointer (as the Grafana tooltip does) */
  fraction: number;
  x: number;
  y: number;
  kind: 'mouse' | 'touch' | 'key';
}

/**
 * Crosshair and the standard Grafana tooltip (time header, colour, name and value of each series) over a
 * card chart. It reads the prepared history only and never changes the chart or its Y range. It adds no
 * click handler, so the chart keeps its link action. Off when the card is not pinned.
 * Keyboard: the chart is focusable, Left and Right move the sample, Escape hides the tooltip, Enter follows
 * the row link.
 */
export function ChartHover({ enabled, series, timeRange, timeZone, width, label, children }: ChartHoverProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>();
  const frame = useRef<number>();
  const pending = useRef<{ clientX: number; kind: 'mouse' | 'touch' }>();

  const cancelFrame = useCallback(() => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    pending.current = undefined;
  }, []);
  useEffect(() => cancelFrame, [cancelFrame]);

  const kind = hover?.kind;
  useEffect(() => {
    if (kind !== 'touch') {
      return;
    }
    // a touch tooltip stays after the finger lifts; the next touch outside the chart removes it
    const away = (ev: PointerEvent) => {
      if (!ref.current?.contains(ev.target as Node)) {
        cancelFrame();
        setHover(undefined);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [kind, cancelFrame]);

  const from = timeRange.from.valueOf();
  const to = timeRange.to.valueOf();
  const ready = useMemo(
    () =>
      series.flatMap((s) =>
        s.history.state === 'ready' ? [{ s, timestamps: s.history.timestamps, values: s.history.values }] : []
      ),
    [series]
  );
  // the frame callback reads the data, range and hover of the latest render, not those of the render that queued it
  const latest = useRef({ ready, from, to, hover });
  useLayoutEffect(() => {
    latest.current = { ready, from, to, hover };
  });
  const rows = useMemo(() => {
    if (!enabled || !hover) {
      return undefined;
    }
    const picked = alignedSamples(ready, hover.time);
    if (!picked) {
      return undefined;
    }
    return {
      time: picked.time,
      list: ready.map(({ s }, i) => ({
        color: s.color,
        label: s.name,
        value: formatSample(
          (s.history as Extract<HistoryModel, { state: 'ready' }>).field,
          picked.values[i],
          theme,
          timeZone,
          s.format
        ),
      })),
    };
  }, [enabled, hover, ready, theme, timeZone]);

  if (!enabled) {
    return <>{children}</>;
  }
  // Pointer events only note the latest position. One animation frame turns it into a sample; the state
  // changes only when the sample changes, so a fast scrub renders at most once per frame and once per sample.
  const place = (clientX: number, kind: 'mouse' | 'touch') => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) {
      return;
    }
    const { ready: rd, from: f, to: t, hover: cur } = latest.current;
    const picked = alignedSamples(rd, timeAt((clientX - r.left) / r.width, f, t));
    if (!picked) {
      return;
    }
    const fraction = t > f ? Math.min(1, Math.max(0, (picked.time - f) / (t - f))) : 0;
    const next: Hover = {
      time: picked.time,
      fraction,
      x: Math.round(r.left + fraction * r.width),
      y: Math.round(r.top + r.height / 2),
      kind,
    };
    // The same sample at the same place: no state write at all. A write of an equal value would still run the
    // component once before React drops the result.
    if (cur && cur.time === next.time && cur.kind === kind && cur.x === next.x && cur.y === next.y) {
      return;
    }
    setHover(next);
  };
  const move = (ev: React.PointerEvent) => {
    pending.current = { clientX: ev.clientX, kind: ev.pointerType === 'touch' ? 'touch' : 'mouse' };
    if (frame.current !== undefined) {
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const p = pending.current;
      pending.current = undefined;
      if (p) {
        place(p.clientX, p.kind);
      }
    });
  };
  const clear = () => {
    cancelFrame();
    setHover(undefined);
  };
  const key = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') {
      // the chart is focusable inside the row link: Enter still follows the link
      (ev.currentTarget as HTMLElement).closest('a')?.click();
      return;
    }
    if (ev.key === 'Escape') {
      // a queued frame must not open the tooltip after Escape; the event goes on to close the card when nothing was open
      cancelFrame();
      if (hover) {
        ev.stopPropagation();
        ev.preventDefault();
        setHover(undefined);
      }
      return;
    }
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') {
      return;
    }
    const times = sampleTimes(ready);
    const r = ref.current?.getBoundingClientRect();
    if (!times.length || !r) {
      return;
    }
    ev.preventDefault();
    cancelFrame();
    const step = ev.key === 'ArrowRight' ? 1 : -1;
    const at = hover ? nearestIndex(times, hover.time) + step : times.length - 1;
    const t = times[Math.min(times.length - 1, Math.max(0, at))];
    const fraction = to > from ? Math.min(1, Math.max(0, (t - from) / (to - from))) : 0;
    setHover({ time: t, fraction, x: r.left + fraction * r.width, y: r.top + r.height / 2, kind: 'key' });
  };
  return (
    <div
      ref={ref}
      className={styles.wrap}
      style={width === undefined ? undefined : { width }}
      data-testid="dmap-chart-hover"
      data-tooltip-open={rows ? 'true' : undefined}
      tabIndex={0}
      role="group"
      aria-label={`${label ?? series[0]?.name ?? 'Chart'}: use the left and right arrow keys to read values`}
      onPointerDown={move}
      onPointerMove={move}
      onPointerLeave={(ev) => {
        if (ev.pointerType !== 'touch') {
          cancelFrame();
          setHover((h) => (h?.kind === 'key' ? h : undefined));
        }
      }}
      onPointerCancel={clear}
      onBlur={() => {
        cancelFrame();
        setHover((h) => (h?.kind === 'key' ? undefined : h));
      }}
      onKeyDown={key}
    >
      {children}
      {rows && hover ? (
        <>
          <div
            className={styles.line}
            data-testid="dmap-chart-crosshair"
            style={{ left: `${Math.min(1, Math.max(0, hover.fraction)) * 100}%` }}
          />
          <Portal>
            <TooltipBox x={hover.x} y={hover.y} live={hover.kind === 'key'} className={styles.box}>
              <SeriesTable
                timestamp={dateTimeFormat(rows.time, { timeZone, format: 'YYYY-MM-DD HH:mm:ss' })}
                series={rows.list}
              />
            </TooltipBox>
          </Portal>
        </>
      ) : null}
    </div>
  );
}
