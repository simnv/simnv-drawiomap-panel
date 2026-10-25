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
