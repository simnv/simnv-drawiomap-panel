import { LoadingState, type PanelData } from '@grafana/data';
import { copyFrames } from './boundary';
import type { QuerySnapshot } from './types';

const snapshots = new WeakMap<PanelData, Map<string, QuerySnapshot>>();

/**
 * The eager panel data as a snapshot, one object per `(data, refId)`: the controller's `setPanelData` and the
 * resolver get the same object, so the history cache hits. The frames of the refId are the boundary copy. The fetch
 * time is the time of the first call for that data: a data object has one arrival time.
 */
export function panelSnapshot(data: PanelData | undefined, refId: string, now: () => number = Date.now): QuerySnapshot {
  if (!data) {
    return { state: 'idle' };
  }
  let cache = snapshots.get(data);
  if (!cache) {
    cache = new Map();
    snapshots.set(data, cache);
  }
  const seen = cache.get(refId);
  if (seen) {
    return seen;
  }
  const snapshot = read(data, refId, now());
  cache.set(refId, snapshot);
  return snapshot;
}

/** Interpret eager data consistently without copying Grafana's formatted fields. */
function read(data: PanelData, refId: string, fetchedAt: number): QuerySnapshot {
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
    ? { state: 'ready', frames: copyFrames(frames), fetchedAt, fromCache: loading }
    : { state: 'empty', fetchedAt, fromCache: loading };
}
