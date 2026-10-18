import type { StatusCondition, StatusRule, StatusState } from '../model/config';

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

export function evaluateStatus(rule: StatusRule, values: ResolvedValue[], nowMs: number): StatusView {
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
    return view('missing', reason, 'availability');
  }
  if (rule.freshness) {
    if (available.some((v) => !Number.isFinite(v.sampleAt))) {
      return view('missing', 'Sample timestamp is missing', 'timestamp');
    }
    if (available.some((v) => nowMs - v.sampleAt! > rule.freshness!.staleAfterMs)) {
      return view('stale', `Sample is stale (expected every ${rule.freshness.expectedIntervalMs} ms)`, [
        rule.freshness.expectedIntervalMs,
        rule.freshness.staleAfterMs,
      ]);
    }
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
  return view(condition.state, condition.reason, conditionKey);
}

export function summarizeStatuses(items: CellStatus[]): StatusSummary[] {
  const groups = new Map<string, StatusSummary>();
  for (const { cellId, status } of items) {
    if (status.state === 'normal') {
      continue;
    }
    const key = JSON.stringify([status.conditionKey, status.state, status.reason]);
    const group = groups.get(key);
    if (group) {
      if (!group.cellIds.includes(cellId)) {
        group.cellIds.push(cellId);
      }
    } else {
      groups.set(key, { ...status, cellIds: [cellId] });
    }
  }
  return [...groups.values()];
}
