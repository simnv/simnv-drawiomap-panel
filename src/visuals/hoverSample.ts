/** Index of the sample nearest to time t, or -1 for an empty series. Timestamps are in time order. */
export function nearestIndex(timestamps: ArrayLike<number>, t: number): number {
  const n = timestamps.length;
  if (!n) {
    return -1;
  }
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo > 0 && t - timestamps[lo - 1] <= timestamps[lo] - t ? lo - 1 : lo;
}

export interface HoverSample {
  /** time of the nearest sample, in ms */
  time: number;
  /** null for a gap: the tooltip shows no value */
  value: number | null;
}

/** The sample of a series nearest to the hovered time, or undefined for a series with no samples. */
export function sampleAt(
  timestamps: ArrayLike<number>,
  values: ArrayLike<number | null>,
  t: number
): HoverSample | undefined {
  const i = nearestIndex(timestamps, t);
  if (i < 0) {
    return undefined;
  }
  const v = values[i];
  return { time: timestamps[i], value: typeof v === 'number' && Number.isFinite(v) ? v : null };
}

/** Time under a pointer: fraction 0..1 of the chart width over the dashboard range. */
export function timeAt(fraction: number, from: number, to: number): number {
  return from + Math.min(1, Math.max(0, fraction)) * (to - from);
}

/**
 * One selected time for several series: the sample time nearest to t among all series (the earlier one on a
 * tie). Each series then gives its value at that exact time, or null when it has no sample there.
 */
export function alignedSamples(
  series: Array<{ timestamps: ArrayLike<number>; values: ArrayLike<number | null> }>,
  t: number
): { time: number; values: Array<number | null> } | undefined {
  let time: number | undefined;
  for (const s of series) {
    const i = nearestIndex(s.timestamps, t);
    if (i < 0) {
      continue;
    }
    const c = s.timestamps[i];
    const better =
      time === undefined ||
      Math.abs(c - t) < Math.abs(time - t) ||
      (Math.abs(c - t) === Math.abs(time - t) && c < time);
    if (better) {
      time = c;
    }
  }
  if (time === undefined) {
    return undefined;
  }
  const at = time;
  return {
    time: at,
    values: series.map((s) => {
      // duplicate timestamps: the last non-null value at exactly this time
      let found: number | null = null;
      for (let i = nearestIndex(s.timestamps, at); i >= 0 && i < s.timestamps.length && s.timestamps[i] === at; i++) {
        const v = s.values[i];
        if (typeof v === 'number' && Number.isFinite(v)) {
          found = v;
        }
      }
      return found;
    }),
  };
}

/** The sorted distinct sample times of all series, for keyboard steps. */
export function sampleTimes(series: Array<{ timestamps: ArrayLike<number> }>): number[] {
  const all = new Set<number>();
  for (const s of series) {
    for (let i = 0; i < s.timestamps.length; i++) {
      all.add(s.timestamps[i]);
    }
  }
  return [...all].sort((a, b) => a - b);
}

/** The value text of a card row, a chart or a tooltip line with no data (spec 3.6, 3.7). */
export const NO_DATA_ROW = 'No data';

/** One line of a chart tooltip: its label, colour and samples, and the formatter of its values. */
export interface TooltipLine {
  label: string;
  color: string;
  times: ArrayLike<number>;
  values: ArrayLike<number | null>;
  /** the line has no finite value: it keeps its place and shows "No data" (spec 3.7) */
  noData?: boolean;
  format?: (value: number) => string;
}

/** One row of a chart tooltip. */
export interface TooltipRow {
  label: string;
  color: string;
  value: string;
}

/**
 * The pinned tooltip of a chart (spec 3.7): all drawn lines at the sample time nearest to `time`, then "+N more". A
 * line with no finite value shows "No data"; a gap of a line shows "–". Undefined when no line has a sample.
 */
export function tooltipRows(
  lines: TooltipLine[],
  time: number,
  more = 0
): { time: number; list: TooltipRow[]; more: number } | undefined {
  const picked = alignedSamples(
    lines.map((l) => ({ timestamps: l.times, values: l.values })),
    time
  );
  if (!picked) {
    return undefined;
  }
  return {
    time: picked.time,
    list: lines.map((l, i) => {
      const v = picked.values[i];
      return {
        label: l.label,
        color: l.color,
        value: l.noData ? NO_DATA_ROW : v === null ? '–' : (l.format ?? String)(v),
      };
    }),
    more,
  };
}
