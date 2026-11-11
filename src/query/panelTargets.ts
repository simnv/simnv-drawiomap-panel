import type { PanelData } from '@grafana/data';

/** The refIds of the panel targets; without a request, the refIds of the loaded frames. */
export function refIdsOf(data: PanelData): string[] {
  const refIds = data.request ? data.request.targets.map((t) => t.refId) : data.series.map((f) => f.refId);
  return [...new Set(refIds.filter((refId): refId is string => !!refId))];
}
