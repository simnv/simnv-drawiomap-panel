import React from 'react';
import type { TimeRange } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { HistoryModel } from '../query/frames';

export interface MirrorDirection {
  direction: 'up' | 'down';
  color: string;
  /** drawn below the zero line (negative values) */
  mirrored: boolean;
  history: HistoryModel;
}

/** y of a value in a box of height h with 1 px padding */
const yOf = (v: number, [lo, hi]: [number, number], h: number) => {
  const span = hi - lo;
  return span ? 1 + (1 - (v - lo) / span) * (h - 2) : h / 2;
};
/** one decimal; points outside the box stay on its edge */
const round = (n: number, max: number) => Math.round(Math.min(Math.max(n, 0), max) * 10) / 10;

/**
 * Polyline points of one series in a w × h box: one string for each run of values without a gap.
 * A null breaks the line (missing data is not drawn as a slope); a run of one point is dropped.
 * Times map over the dashboard range, as in the Grafana sparkline of the other rows.
 * A mirrored series is drawn as negative values.
 */
export function mirrorSegments(
  values: ReadonlyArray<number | null>,
  times: readonly number[],
  range: { from: number; to: number },
  w: number,
  h: number,
  domain: [number, number],
  mirrored: boolean
): string[] {
  // Long series: keep about two points per pixel.
  const step = Math.max(1, Math.floor(values.length / (2 * Math.max(w, 1))));
  const span = range.to - range.from;
  const segments: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) {
      segments.push(run.join(' '));
    }
    run = [];
  };
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      flush();
      continue;
    }
    if (i % step !== 0 && i !== values.length - 1) {
      continue;
    }
    const x = span > 0 ? ((times[i] - range.from) / span) * w : (i / Math.max(1, values.length - 1)) * w;
    run.push(`${round(x, w)},${round(yOf(mirrored ? -v : v, domain, h), h)}`);
  }
  flush();
  return segments;
}

/**
 * The sparkline of a combined up/down row: a thin zero line, up above it and down mirrored below it.
 * Each direction has its own colour. The SVG stretches to the full row width.
 */
export function MirrorSparkline({
  directions,
  domain,
  width,
  height,
  timeRange,
  label,
}: {
  directions: MirrorDirection[];
  domain: [number, number];
  width: number;
  height: number;
  timeRange: TimeRange;
  label: string;
}) {
  const theme = useTheme2();
  const range = { from: timeRange.from.valueOf(), to: timeRange.to.valueOf() };
  const zero = round(yOf(0, domain, height), height);
  return (
    <svg
      data-testid="dmap-mirror-spark"
      role="img"
      aria-label={label}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <line
        data-testid="dmap-zero-line"
        x1={0}
        x2={width}
        y1={zero}
        y2={zero}
        stroke={theme.colors.border.medium}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {directions.map((d) =>
        d.history.state === 'ready'
          ? mirrorSegments(d.history.values, d.history.timestamps, range, width, height, domain, d.mirrored).map(
              (points, i) => {
                const xs = points.split(' ').map((p) => p.split(',')[0]);
                return (
                  <g key={`${d.direction}-${i}`}>
                    <polygon
                      points={`${xs[0]},${zero} ${points} ${xs[xs.length - 1]},${zero}`}
                      fill={d.color}
                      fillOpacity={0.15}
                      stroke="none"
                    />
                    <polyline
                      data-direction={d.direction}
                      data-mirrored={d.mirrored}
                      points={points}
                      fill="none"
                      stroke={d.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              }
            )
          : null
      )}
    </svg>
  );
}
