/** The state of a status: the severity of its value, or why it has none (spec 3.4, 3.6). */
export interface StatusView {
  state: 'normal' | 'warning' | 'critical' | 'down' | 'missing' | 'stale';
  reason: string;
  queryIds: string[];
  conditionKey: string;
  coverage: { available: number; expected: number };
}

/** The one test of a deadline against the clock: a sample is stale after `sampleAt + staleAfterMs`, not at it. */
export const isPast = (deadline: number, now: number): boolean => now > deadline;

/** The level a state shows as: the paint, the status text and the legend tell only these apart. */
export type StatusLevel = 'critical' | 'warning' | 'missing' | 'normal';

/** Down and critical are critical, warning and stale are warning; missing and normal stay as they are. */
export function statusLevel(state: StatusView['state']): StatusLevel {
  return state === 'down' || state === 'critical'
    ? 'critical'
    : state === 'warning' || state === 'stale'
      ? 'warning'
      : state;
}

/** Most severe first. The summary band and its row order use it. */
export const STATUS_SEVERITY: Record<StatusView['state'], number> = {
  down: 0,
  critical: 1,
  warning: 2,
  stale: 3,
  missing: 4,
  normal: 5,
};
