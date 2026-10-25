import { invalidFreshness, type StatusCondition, type StatusRule, type StatusState } from '../model/config';

export interface ResolvedValue {
  queryId: string;
  availability: 'ready' | 'missing' | 'loading' | 'error' | 'unsupported';
  value?: number;
  sampleAt?: number;
}

export interface StatusView {
  state: StatusState | 'missing' | 'stale';
  reason: string;
  queryIds: string[];
  conditionKey: string;
  coverage: { available: number; expected: number };
}

export interface CellStatus {
  cellId: string;
  status: StatusView;
}

export interface StatusSummary extends StatusView {
  cellIds: string[];
}

/** The text of a row, a widget or a status whose freshness policy is shorter than one sample interval. */
export const INVALID_FRESHNESS_TEXT = 'Invalid freshness policy';

/** The one test of a deadline against the clock: a sample is stale after `sampleAt + staleAfterMs`, not at it. */
export const isPast = (deadline: number, now: number): boolean => now > deadline;

export interface EvaluatedStatus {
  /** the status as if every sample were fresh */
  view: StatusView;
  /** set when a valid policy covers timed samples: the view that applies when the clock is after `after` */
  stale?: { after: number; view: StatusView };
}

/**
 * The status of a rule from its values, without the clock: the stale view and the moment it applies come apart, so
 * the bind is a function of the data and `staleStatuses` (engine.ts) applies the clock.
 */
export function evaluateStatus(rule: StatusRule, values: ResolvedValue[]): EvaluatedStatus {
  const selected = values.filter((v) => v.queryId === rule.binding.queryId);
  const available = selected.filter((v) => v.availability === 'ready' && Number.isFinite(v.value));
  const coverage = { available: available.length, expected: Math.max(1, selected.length) };
  const view = (state: StatusView['state'], reason: string, condition: unknown): StatusView => ({
    state,
    reason,
    queryIds: [rule.binding.queryId],
    conditionKey: JSON.stringify([rule.binding.queryId, rule.kind, condition, state, reason]),
    coverage,
  });
  if (available.length < coverage.expected) {
    const reason = available.length
      ? `Incomplete coverage (${available.length}/${coverage.expected} values available)`
      : selected.some((v) => v.availability === 'error')
        ? 'Query failed'
        : selected.some((v) => v.availability === 'unsupported')
          ? 'Unsupported data'
          : selected.some((v) => v.availability === 'loading')
            ? 'Loading data'
            : 'No data';
    return { view: view('missing', reason, 'availability') };
  }
  let stale: EvaluatedStatus['stale'];
  if (rule.freshness) {
    // a policy that can never be met makes the element unavailable: stale data must never show as healthy
    if (invalidFreshness(rule.freshness)) {
      return { view: view('missing', INVALID_FRESHNESS_TEXT, 'freshness') };
    }
    if (available.some((v) => !Number.isFinite(v.sampleAt))) {
      return { view: view('missing', 'Sample timestamp is missing', 'timestamp') };
    }
    // the oldest sample decides: the status is stale once the clock is after its sample time plus the policy
    stale = {
      after: Math.min(...available.map((v) => v.sampleAt!)) + rule.freshness.staleAfterMs,
      view: view('stale', `Sample is stale (expected every ${rule.freshness.expectedIntervalMs} ms)`, [
        rule.freshness.expectedIntervalMs,
        rule.freshness.staleAfterMs,
      ]),
    };
  }
  const value = available[0]?.value;
  let condition: StatusCondition = rule.default;
  let conditionKey: unknown = 'default';
  if (rule.kind === 'mapping') {
    const match = rule.mappings.find((m) => m.value === value);
    if (match) {
      condition = match;
      conditionKey = ['mapping', match.value];
    }
  } else {
    const match = rule.predicates.find(
      (p) =>
        value !== undefined &&
        {
          eq: value === p.value,
          ne: value !== p.value,
          gt: value > p.value,
          gte: value >= p.value,
          lt: value < p.value,
          lte: value <= p.value,
        }[p.op]
    );
    if (match) {
      condition = match;
      conditionKey = ['predicate', match.op, match.value];
    }
  }
  return { view: view(condition.state, condition.reason, conditionKey), stale };
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

/**
 * One summary per cause (state and reason) for all cells that are not normal. Cells with different queries or
 * conditions but the same cause merge into one summary. The order is severity, then the number of cells.
 */
export function summarizeStatuses(items: CellStatus[]): StatusSummary[] {
  const groups = new Map<string, StatusSummary>();
  for (const { cellId, status } of items) {
    if (status.state === 'normal') {
      continue;
    }
    const key = JSON.stringify([status.state, status.reason]);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...status, queryIds: [...status.queryIds], cellIds: [cellId] });
      continue;
    }
    if (!group.cellIds.includes(cellId)) {
      group.cellIds.push(cellId);
    }
    for (const id of status.queryIds) {
      if (!group.queryIds.includes(id)) {
        group.queryIds.push(id);
      }
    }
  }
  return [...groups.values()].sort(
    (a, b) => STATUS_SEVERITY[a.state] - STATUS_SEVERITY[b.state] || b.cellIds.length - a.cellIds.length
  );
}
