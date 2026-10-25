import { useEffect, useMemo, useState } from 'react';
import { staleStatuses, type PlanBindResult } from '../binding/engine';
import type { FreshnessPolicy } from '../model/config';

/** The largest delay a timer takes; a longer wait wakes up and sets the timer again. */
const MAX_TIMER_MS = 2147483647;
const NO_DEADLINES: readonly number[] = [];

/**
 * The clock, read again after each deadline passes. `now > deadline` is the test every caller makes: a sample is
 * stale after `sampleAt + staleAfterMs`. One timer at most. A deadline that passed in real time before anyone read
 * the clock (a result arrives with a sample that is already old) is corrected in a microtask of the effect flush,
 * with no timer, so the correction renders before the next animation frame.
 */
export function useClock(deadlines: readonly number[]): number {
  const [now, setNow] = useState(() => Date.now());
  let next = Infinity;
  for (const at of deadlines) {
    if (at >= now && at < next) {
      next = at;
    }
  }
  useEffect(() => {
    if (!Number.isFinite(next)) {
      return;
    }
    const real = Date.now();
    if (real > next) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setNow(Date.now());
        }
      });
      return () => {
        active = false;
      };
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(MAX_TIMER_MS, next - real + 1));
    return () => clearTimeout(timer);
  }, [next, now]);
  return now;
}

/** A sample expires independently of fetch/cache age and query resolution. */
export function useSampleStale(sampleAt: number | undefined, freshness?: FreshnessPolicy): boolean {
  const after = sampleAt !== undefined && freshness ? sampleAt + freshness.staleAfterMs : undefined;
  const now = useClock(after === undefined ? NO_DEADLINES : [after]);
  return after !== undefined && now > after;
}

/**
 * The bind result at the current clock: the status cells whose sample passed its deadline show their stale view.
 * A tick that crosses no deadline gives the same object, so nothing that depends on the result runs again.
 */
export function useStaleStatus(result: PlanBindResult): PlanBindResult {
  const now = useClock(result.deadlines);
  return useMemo(() => staleStatuses(result, now), [result, now]);
}
