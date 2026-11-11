import type { PanelData } from '@grafana/data';

/** The refIds of the panel targets; without a request, the refIds of the loaded frames. */
export function refIdsOf(data: PanelData): string[] {
  const refIds = data.request ? data.request.targets.map((t) => t.refId) : data.series.map((f) => f.refId);
  return [...new Set(refIds.filter((refId): refId is string => !!refId))];
}

/**
 * The refIds of the panel in panel edit. The options pane gets no targets from Grafana (only the returned frames), so
 * the panel publishes them here while it is in panel edit. One panel is in edit at a time.
 */
let edited: string[] | undefined;

export function publishEditedRefIds(refIds: string[] | undefined): void {
  edited = refIds;
}

export function editedRefIds(): string[] | undefined {
  return edited;
}
