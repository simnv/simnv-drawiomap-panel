import { rangeUtil, type DataQueryRequest, type TimeRange } from '@grafana/data';
import type { Series } from '../query/snapshot';
import type { CellPatch } from '../types';
import { isPast } from './status';

/** The status that applies after a relative range deadline. The bind does not read the clock. */
export type StaleMark<S> = { after: number; status: S };
export interface FreshnessPatch<S> extends CellPatch {
  statusV4?: S;
  staleStatusV4?: StaleMark<S>;
}
export type FreshnessPatchMap<S> = Map<string, FreshnessPatch<S>>;

function durationMs(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const ms = rangeUtil.intervalToMs(value);
    return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  } catch {
    return undefined;
  }
}

/** Use the larger request or target step. Without either step, use the median sample step. */
export function cadenceOf(refId: string, request: DataQueryRequest | undefined, series: Series[]): number | undefined {
  const target = request?.targets.find((item) => item.refId === refId);
  const targetStep = target && 'interval' in target ? durationMs(target.interval) : undefined;
  const interval = Math.max(request?.intervalMs || 0, targetStep ?? 0);
  if (Number.isFinite(interval) && interval > 0) {
    return interval;
  }
  const steps: number[] = [];
  for (const item of series) {
    if (item.refId !== refId) {
      continue;
    }
    for (let i = 1; i < item.times.length; i++) {
      const step = item.times[i] - item.times[i - 1];
      if (Number.isFinite(step) && step > 0) {
        steps.push(step);
      }
    }
  }
  if (!steps.length) {
    return undefined;
  }
  steps.sort((a, b) => a - b);
  const middle = Math.floor(steps.length / 2);
  return steps.length % 2 ? steps[middle] : (steps[middle - 1] + steps[middle]) / 2;
}

/** Resolve a duration or a factor of the query cadence. No cadence means no factor check. */
export function freshnessMs(policy: string, cadence: number | undefined): number | undefined {
  if (/^\d+(?:\.\d+)?x$/.test(policy)) {
    if (cadence === undefined || !Number.isFinite(cadence) || cadence <= 0) {
      return undefined;
    }
    const ms = Number(policy.slice(0, -1)) * cadence;
    return Number.isFinite(ms) ? ms : undefined;
  }
  return /^\d+(?:ms|s|m|h)$/.test(policy) ? durationMs(policy) : undefined;
}

/** Check age at an absolute range end, or give the clock the first relative deadline. Capacity callers skip this check. */
export function staleCheck(
  series: Series[],
  ctx: { timeRange: TimeRange; request?: DataQueryRequest; freshnessMs?: number; instant: boolean }
): { stale: boolean; deadline?: number; reason?: string } {
  if (ctx.instant || ctx.freshnessMs === undefined || !Number.isFinite(ctx.freshnessMs) || ctx.freshnessMs < 0) {
    return { stale: false };
  }
  let oldest = Infinity;
  for (const item of series) {
    let last = item.values.length - 1;
    while (last >= 0 && item.values[last] === null) {
      last--;
    }
    if (last < 0) {
      continue;
    }
    const time = item.times[last];
    if (!Number.isFinite(time)) {
      return { stale: false, reason: 'Sample timestamp is missing' };
    }
    oldest = Math.min(oldest, time);
  }
  if (!Number.isFinite(oldest)) {
    return { stale: false };
  }
  const to = ctx.timeRange.to.valueOf();
  const relative = typeof ctx.timeRange.raw.to === 'string' && ctx.timeRange.raw.to.includes('now');
  if (!relative) {
    return { stale: isPast(oldest + ctx.freshnessMs, to) };
  }
  const lag = Math.max(0, (ctx.request?.startTime ?? to) - to);
  return { stale: false, deadline: oldest + ctx.freshnessMs + lag };
}
