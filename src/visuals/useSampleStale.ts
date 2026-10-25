import { useEffect, useMemo, useState } from 'react';
import { staleStatuses, type PlanBindResult } from '../binding/engine';
import { isPast } from '../binding/status';
import type { FreshnessPolicy } from '../model/config';

/** The largest delay a timer takes; a longer wait wakes up and sets the timer again. */
const MAX_TIMER_MS = 2147483647;
const NO_DEADLINES: readonly number[] = [];

/**
 * The clock, read again after each deadline passes. `isPast(deadline, now)` is the test every caller makes: a
 * sample is stale after `sampleAt + staleAfterMs`. One timer at most. The effect compares the stored read with the
 * real clock: a deadline between the two (it passed before anyone read the clock, or the clock went backwards) is
 * corrected in a microtask, with no timer, so the correction renders before the next animation frame. Each read is
 * a new object, so a read that gives the same millisecond still runs the effect and arms the next timer.
 */
export function useClock(deadlines: readonly number[]): number {
  const [clock, setClock] = useState(() => ({ now: Date.now() }));
  const key = useMemo(() => deadlines.join('|'), [deadlines]);
  useEffect(() => {
    if (!key) {
      return;
    }
    const real = Date.now();
    const stored = clock.now;
    const lo = Math.min(stored, real);
    const hi = Math.max(stored, real);
    let next = Infinity;
    let unseen = false;
    for (const at of key.split('|').map(Number)) {
      if (at >= lo && at < hi) {
        unseen = true;
      }
      if (at >= real && at < next) {
        next = at;
      }
    }
    if (unseen) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setClock({ now: Date.now() });
        }
      });
      return () => {
        active = false;
      };
    }
    if (!Number.isFinite(next)) {
      return;
    }
    const timer = setTimeout(() => setClock({ now: Date.now() }), Math.min(MAX_TIMER_MS, next - real + 1));
    return () => clearTimeout(timer);
  }, [key, clock]);
  return clock.now;
}

/** A sample expires independently of fetch/cache age and query resolution. */
export function useSampleStale(sampleAt: number | undefined, freshness?: FreshnessPolicy): boolean {
  const after = sampleAt !== undefined && freshness ? sampleAt + freshness.staleAfterMs : undefined;
  const now = useClock(after === undefined ? NO_DEADLINES : [after]);
  return after !== undefined && isPast(after, now);
}

/**
 * The bind result at the current clock: the status cells whose sample passed its deadline show their stale view.
 * A tick that crosses no deadline gives the same object, so nothing that depends on the result runs again.
 */
export function useStaleStatus(result: PlanBindResult): PlanBindResult {
  const now = useClock(result.deadlines);
  return useMemo(() => staleStatuses(result, now), [result, now]);
}
