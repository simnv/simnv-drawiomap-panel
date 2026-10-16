import type { ReducerName } from '../types';

export function reduceValues(values: number[], reducer: ReducerName): number | undefined {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) {
    return undefined;
  }
  switch (reducer) {
    case 'last':
      return nums[nums.length - 1];
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'max':
      return Math.max(...nums);
    case 'min':
      return Math.min(...nums);
  }
}
