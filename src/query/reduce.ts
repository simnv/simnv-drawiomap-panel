import { toBitsPerSecond } from '../binding/units';
import type { Series } from './snapshot';
import type { ReducerName } from '../types';

/** The reduced value of a history. Null gaps and non-finite values are skipped in place: no filtered copy. */
export function reduceValues(
  values: ReadonlyArray<number | null | undefined>,
  reducer: ReducerName
): number | undefined {
  let count = 0;
  let last = 0;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      continue;
    }
    count++;
    last = v;
    sum += v;
    max = v > max ? v : max;
    min = v < min ? v : min;
  }
  if (!count) {
    return undefined;
  }
  switch (reducer) {
    case 'last':
      return last;
    case 'mean':
      return sum / count;
    case 'max':
      return max;
    case 'min':
      return min;
  }
}

export type AcrossReduce = 'sum' | 'max' | 'mean';

/** Resolve all conversion factors before a reduce or a shared chart. */
function unitFactors(series: Series[]): { unit: string | undefined; factors: number[] } | { mismatch: string[] } {
  const units = series.map((item) => item.field.config.unit);
  const unit = units[0];
  if (units.every((value) => value === unit)) {
    return { unit, factors: units.map(() => 1) };
  }
  const rates = units.map((value) => (value ? toBitsPerSecond(1, value) : undefined));
  if (rates.some((rate) => !rate || rate.unknownUnit !== undefined || !Number.isFinite(rate.bits))) {
    return { mismatch: [...new Set(units.map((value) => value ?? ''))] };
  }
  return { unit, factors: rates.map((rate) => rate!.bits / rates[0]!.bits) };
}

function aggregate(values: Array<number | null | undefined>, how: AcrossReduce): number | null {
  let count = 0;
  let sum = 0;
  let max = -Infinity;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      count++;
      sum += value;
      max = Math.max(max, value);
    }
  }
  return count ? (how === 'max' ? max : how === 'mean' ? sum / count : sum) : null;
}

/** Reduce the last finite value of each series in the unit of the first series. */
export function reduceAcross(
  series: Series[],
  how: AcrossReduce
): { value: number | null; unit: string | undefined } | { mismatch: string[] } {
  const units = unitFactors(series);
  if ('mismatch' in units) {
    return units;
  }
  const values = series.map((item, i) => {
    const value = reduceValues(item.values, 'last');
    return value === undefined ? null : value * units.factors[i];
  });
  return { value: aggregate(values, how), unit: units.unit };
}

/** Reduce a direction at each timestamp. A missing member leaves a gap. */
export function alignUpdown(series: Series[], how: AcrossReduce): { times: number[]; values: Array<number | null> } {
  const times = [...new Set(series.flatMap((item) => item.times))].sort((a, b) => a - b);
  const units = unitFactors(series);
  const samples = series.map((item) => new Map(item.times.map((time, i) => [time, item.values[i]])));
  const values = times.map((time) => {
    if ('mismatch' in units) {
      return null;
    }
    const point = samples.map((sample, i) => {
      const value = sample.get(time);
      return typeof value === 'number' && Number.isFinite(value) ? value * units.factors[i] : null;
    });
    return point.some((value) => value === null) ? null : aggregate(point, how);
  });
  return { times, values };
}
