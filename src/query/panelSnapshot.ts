import { LoadingState, type PanelData } from '@grafana/data';
import type { QuerySnapshot } from './types';

/** Interpret eager data consistently without copying Grafana's formatted fields. */
export function panelSnapshot(data: PanelData | undefined, refId: string, fetchedAt: number): QuerySnapshot {
  if (!data) {
    return { state: 'idle' };
  }
  const errors = [...(data.errors ?? []), ...(data.error ? [data.error] : [])];
  // A refId-specific failure belongs to that query. Error without details is request-wide.
  if (
    errors.some((error) => !error.refId || error.refId === refId) ||
    (data.state === LoadingState.Error && !errors.length)
  ) {
    return { state: 'error', message: 'Panel query failed.' };
  }
  // During a refresh Grafana keeps the last series. Show them; only the first load has no series.
  const loading = data.state === LoadingState.Loading || data.state === LoadingState.NotStarted;
  if (loading && !data.series.length) {
    return { state: 'loading' };
  }
  const frames = data.series.filter((frame) => frame.refId === refId);
  return frames.length
    ? { state: 'ready', frames, fetchedAt, fromCache: loading }
    : { state: 'empty', fetchedAt, fromCache: loading };
}
