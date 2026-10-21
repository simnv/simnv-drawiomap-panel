import type { LowerBound } from '../model/config';

export type { LowerBound };

export interface DomainOptions {
  /** the min of the row or the chart widget */
  min?: LowerBound;
  /** the max of the row or the chart widget */
  max?: number;
  /** the Min and Max of the Grafana field config */
  fieldMin?: number | null;
  fieldMax?: number | null;
  /** the Grafana unit: percent tops at 100, percentunit at 1 */
  unit?: string;
  /** the capacity of the series, in the unit of the values */
  capacity?: number;
}

/** Units with a fixed top: percent is 0 to 100, percentunit is 0 to 1. */
const UNIT_TOP: Record<string, number> = { percent: 100, percentunit: 1 };

const num = (v: number | null | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * The Y range of each sparkline and chart: card rows, link halves and chart widgets use this one function.
 *
 * - Default: a series without negative values starts at 0, so a small change does not look like a big climb.
 *   The top is the largest value, the capacity or the top of the unit (percent), whichever is largest.
 * - A series with negative values, or min "auto": the data min to the data max. The span is at least 10% of
 *   |max| (1 when max is 0), centred on the data.
 * - Precedence for each bound: the row or widget min and max, then the field config Min and Max, then the default.
 * - The bounds are soft: the range always holds all values.
 */
export function yDomain(values: ArrayLike<number | null | undefined>, opts: DomainOptions = {}): [number, number] {
  let dmin = Infinity;
  let dmax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      dmin = Math.min(dmin, v);
      dmax = Math.max(dmax, v);
    }
  }
  const empty = dmin > dmax;
  const setMin = typeof opts.min === 'number' ? num(opts.min) : num(opts.fieldMin);
  const setMax = num(opts.max) ?? num(opts.fieldMax);
  const auto = opts.min === 'auto' || (setMin === undefined && !empty && dmin < 0);
  if (auto && !empty) {
    const hi = Math.max(setMax ?? dmax, dmax);
    const span = hi === 0 ? 1 : Math.abs(hi) / 10;
    if (hi - dmin >= span) {
      return [dmin, hi];
    }
    if (setMax !== undefined) {
      return [hi - span, hi];
    }
    const centre = (dmin + hi) / 2;
    return [centre - span / 2, centre + span / 2];
  }
  const lo = Math.min(setMin ?? 0, empty ? Infinity : dmin);
  const cap = opts.capacity !== undefined && opts.capacity > 0 ? opts.capacity : 0;
  // a series with negative values keeps its data max as the top, also when a min is set
  const negative = !empty && dmin < 0;
  let hi = setMax ?? (negative ? dmax : Math.max(cap, UNIT_TOP[opts.unit ?? ''] ?? 0));
  if (!empty) {
    hi = Math.max(hi, dmax);
  }
  return [lo, hi > lo ? hi : lo + (Math.abs(lo) / 10 || 1)];
}
