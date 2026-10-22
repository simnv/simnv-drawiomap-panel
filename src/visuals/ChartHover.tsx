import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  createTheme,
  dateTimeFormat,
  getDisplayProcessor,
  formattedValueToString,
  type Field,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import { SeriesTable, useStyles2, useTheme2, VizTooltipContainer } from '@grafana/ui';
import type { HistoryModel } from '../query/frames';
import { sampleAt, timeAt } from './hoverSample';

/** One series of the tooltip. */
export interface HoverSeries {
  name: string;
  color: string;
  history: HistoryModel;
}

export interface ChartHoverProps {
  /** The tooltip shows only when true (the pinned card). Otherwise the children render as they are. */
  enabled: boolean;
  series: HoverSeries[];
  timeRange: TimeRange;
  timeZone?: string;
  children: React.ReactNode;
}

const getStyles = (theme: GrafanaTheme2) => ({
  // pan-y: a horizontal drag on a phone scrubs the chart, a vertical drag still scrolls the sheet
  wrap: css`
    position: relative;
    touch-action: pan-y;
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

/** The formatted value of a sample: the field display processor (unit, decimals), "–" for a gap. */
export function formatSample(
  field: Field,
  value: number | null,
  theme: GrafanaTheme2 = createTheme(),
  timeZone?: string
): string {
  if (value === null) {
    return '–';
  }
  const display = field.display ?? getDisplayProcessor({ field, theme, timeZone });
  return formattedValueToString(display(value));
}

interface Pointer {
  fraction: number;
  x: number;
  y: number;
  touch: boolean;
}

/**
 * Crosshair and the standard Grafana tooltip (time header, colour, name and value of each series) over a
 * card chart. It reads the prepared history only and never changes the chart or its Y range. It adds no
 * click handler, so the chart keeps its link action. Off when the card is not pinned.
 */
export function ChartHover({ enabled, series, timeRange, timeZone, children }: ChartHoverProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const ref = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<Pointer>();

  const touch = pointer?.touch;
  useEffect(() => {
    if (!touch) {
      return;
    }
    // a touch tooltip stays after the finger lifts; the next touch outside the chart removes it
    const away = (ev: PointerEvent) => {
      if (!ref.current?.contains(ev.target as Node)) {
        setPointer(undefined);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [touch]);

  const from = timeRange.from.valueOf();
  const to = timeRange.to.valueOf();
  const rows = useMemo(() => {
    if (!enabled || !pointer) {
      return undefined;
    }
    const t = timeAt(pointer.fraction, from, to);
    let time: number | undefined;
    const list = series.flatMap((s) => {
      if (s.history.state !== 'ready') {
        return [];
      }
      const sample = sampleAt(s.history.timestamps, s.history.values, t);
      if (!sample) {
        return [];
      }
      time ??= sample.time;
      return [{ color: s.color, label: s.name, value: formatSample(s.history.field, sample.value, theme, timeZone) }];
    });
    return list.length && time !== undefined ? { time, list } : undefined;
  }, [enabled, pointer, series, from, to, theme, timeZone]);

  if (!enabled) {
    return <>{children}</>;
  }
  const move = (ev: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) {
      return;
    }
    setPointer({
      fraction: (ev.clientX - r.left) / r.width,
      x: ev.clientX,
      y: ev.clientY,
      touch: ev.pointerType === 'touch',
    });
  };
  return (
    <div
      ref={ref}
      className={styles.wrap}
      data-testid="dmap-chart-hover"
      onPointerDown={move}
      onPointerMove={move}
      onPointerLeave={(ev) => {
        if (ev.pointerType !== 'touch') {
          setPointer(undefined);
        }
      }}
      onPointerCancel={() => setPointer(undefined)}
    >
      {children}
      {rows && pointer ? (
        <>
          <div
            className={styles.line}
            data-testid="dmap-chart-crosshair"
            style={{ left: `${Math.min(1, Math.max(0, pointer.fraction)) * 100}%` }}
          />
          <VizTooltipContainer position={{ x: pointer.x, y: pointer.y }} offset={{ x: 10, y: 10 }}>
            <div data-testid="dmap-chart-tooltip">
              <SeriesTable
                timestamp={dateTimeFormat(rows.time, { timeZone, format: 'YYYY-MM-DD HH:mm:ss' })}
                series={rows.list}
              />
            </div>
          </VizTooltipContainer>
        </>
      ) : null}
    </div>
  );
}
