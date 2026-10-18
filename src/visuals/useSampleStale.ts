import { useEffect, useState } from 'react';
import type { FreshnessPolicy } from '../model/config';

/** A sample expires independently of fetch/cache age and query resolution. */
export function useSampleStale(sampleAt: number | undefined, freshness?: FreshnessPolicy): boolean {
  const [now, update] = useState(() => Date.now());
  const deadline = sampleAt !== undefined && freshness ? sampleAt + freshness.staleAfterMs : undefined;
  const stale = deadline !== undefined && now > deadline;
  useEffect(() => {
    if (deadline === undefined || stale) {
      return;
    }
    const timer = setTimeout(() => update(Date.now()), Math.min(2147483647, Math.max(1, deadline - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [deadline, stale, now]);
  return stale;
}
