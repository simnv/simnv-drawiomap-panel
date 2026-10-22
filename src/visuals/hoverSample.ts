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
