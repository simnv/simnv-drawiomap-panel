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
import { Portal, SeriesTable, useStyles2, useTheme2, VizTooltipContainer } from '@grafana/ui';
import { fieldDisplay, type HistoryModel } from '../query/frames';
import { alignedSamples, nearestIndex, sampleTimes, timeAt } from './hoverSample';

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
});

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
  // the frame callback reads the data and range of the latest render, not those of the render that queued it
  const latest = useRef({ ready, from, to });
  useLayoutEffect(() => {
    latest.current = { ready, from, to };
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
    const { ready: rd, from: f, to: t } = latest.current;
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
    // the same sample at the same place keeps the same state object: React skips the render
    setHover((cur) =>
      cur && cur.time === next.time && cur.kind === kind && cur.x === next.x && cur.y === next.y ? cur : next
    );
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
            <VizTooltipContainer position={{ x: hover.x, y: hover.y }} offset={{ x: 10, y: 10 }}>
              <div data-testid="dmap-chart-tooltip">
                <SeriesTable
                  timestamp={dateTimeFormat(rows.time, { timeZone, format: 'YYYY-MM-DD HH:mm:ss' })}
                  series={rows.list}
                />
              </div>
            </VizTooltipContainer>
          </Portal>
        </>
      ) : null}
    </div>
  );
}
