import { FieldType, LoadingState, type Field, type PanelData } from '@grafana/data';
import type { HistoryModel } from '../query/frames';
import { panelSnapshot } from '../query/panelSnapshot';
import { alignUpdown, reduceAcross, type AcrossReduce } from '../query/reduce';
import type { QuerySnapshot, Series } from '../query/snapshot';
import { defaultReduce } from './units';

/**
 * The helpers that the bind and the card share for the data of one use: the snapshot of a refId, the display field of
 * a row, the instant check and the history of an `updown` direction.
 */

/** The value fields of a row, a text or a chart that format a value. */
export type Show = { unit?: string; decimals?: number };

/** The field with the `unit` and `decimals` of a use: a new display processor reads them (spec 3.7 "Format"). */
export function shownField(field: Field, show: Show): Field {
  if (show.unit === undefined && show.decimals === undefined) {
    return field;
  }
  const config = { ...field.config };
  if (show.unit !== undefined) {
    config.unit = show.unit;
  }
  if (show.decimals !== undefined) {
    config.decimals = show.decimals;
  }
  return { ...field, config, display: undefined };
}

/** A target with `instant` and no `range` is never stale (spec 3.5 step 3). */
export function isInstant(data: PanelData, refId: string): boolean {
  const target = data.request?.targets.find((t) => t.refId === refId) as
    { instant?: unknown; range?: unknown } | undefined;
  return target?.instant === true && target.range !== true;
}

/** A refId whose frames have not arrived yet (A18): the first load, a refresh, a stream. */
export const isLoading = (data: PanelData) =>
  data.state === LoadingState.Loading ||
  data.state === LoadingState.NotStarted ||
  data.state === LoadingState.Streaming;

const LOADING: QuerySnapshot = { state: 'loading' };

/** The snapshot of one refId. While the panel loads, a refId with no frame is `loading`, not `empty` (A18). */
export function snapshotV4(data: PanelData, refId: string): QuerySnapshot {
  const snapshot = panelSnapshot(data, refId);
  return snapshot.state === 'empty' && isLoading(data) ? LOADING : snapshot;
}

/**
 * The history of an `updown` direction: one series as it is, N series reduced at each timestamp (spec 3.7). A
 * timestamp where one of the series has no value is a gap. The default reduce comes from the unit of the first series.
 */
export function directionHistory(
  r: { snapshot: QuerySnapshot; series: Series[] },
  reduce?: AcrossReduce
): HistoryModel {
  if (r.snapshot.state !== 'ready' || !r.series.length) {
    return r.snapshot.state === 'ready'
      ? { state: 'empty', fetchedAt: r.snapshot.fetchedAt, fromCache: false }
      : r.snapshot;
  }
  const first = r.series[0];
  const how = reduce ?? defaultReduce(first.field.config.unit);
  const reduced = reduceAcross(r.series, how);
  const latest = 'mismatch' in reduced || reduced.value === null ? undefined : reduced.value;
  const aligned = alignUpdown(r.series, how);
  let last = aligned.values.length - 1;
  while (last >= 0 && aligned.values[last] === null) {
    last--;
  }
  return {
    state: 'ready',
    field: { ...first.field, values: aligned.values } as Field<number | null>,
    timeField: { name: 'Time', type: FieldType.time, config: {}, values: aligned.times },
    timestamps: aligned.times,
    values: aligned.values,
    latestValue: latest,
    sampleAt: last >= 0 ? aligned.times[last] : undefined,
    fetchedAt: r.snapshot.fetchedAt,
    fromCache: r.snapshot.fromCache,
  };
}
