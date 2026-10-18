import { LoadingState, type PanelData } from '@grafana/data';
import { resolveBinding, type BindingResolver } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2, NamedQuery } from '../model/config';
import type { HistoryFormat } from '../query/frames';
import type { QueryContext, QuerySnapshot } from '../query/types';
import { useEffect, useState } from 'react';

/** Refresh sample-age evaluation when displayed data or dashboard context changes. */
export function usePreviewTime(
  data: unknown,
  generation?: number,
  snapshot?: QuerySnapshot,
  active: QuerySnapshot[] = []
): number {
  const [nowMs, setNowMs] = useState(Date.now);
  const activeVersion = active
    .map((value) => `${value.state}:${'fetchedAt' in value ? value.fetchedAt : ''}`)
    .join('|');
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setNowMs(Date.now());
      }
    });
    return () => {
      active = false;
    };
  }, [data, generation, snapshot, activeVersion]);
  return nowMs;
}

/** The current explicit editor result, not a cache or an execution schedule. */
export interface QueryPreview {
  query: NamedQuery;
  cellId?: string;
  context: QueryContext;
  snapshot: QuerySnapshot;
}
/** Select compatible prepared results without registering demand or consulting another cache. */
export function previewSnapshot(
  query: NamedQuery,
  config: Pick<DiagramConfigV2, 'defaultDatasource'>,
  data: PanelData,
  cellId: string,
  preview?: QueryPreview,
  active: QueryPreview[] = [],
  generation?: number
): QuerySnapshot {
  if (query.source.kind === 'panel') {
    const refId = query.source.refId;
    const frames = data.series.filter((frame) => frame.refId === refId);
    return frames.length
      ? { state: 'ready', frames, fetchedAt: 0, fromCache: false }
      : data.state === LoadingState.Error
        ? { state: 'error', message: 'The eager panel query failed.' }
        : data.state === LoadingState.Loading
          ? { state: 'loading' }
          : { state: 'empty', fetchedAt: 0, fromCache: false };
  }
  const parameterized = Object.keys(query.source.parameters).length > 0;
  const selected = [...active, preview].find(
    (result) =>
      result &&
      JSON.stringify(result.query) === JSON.stringify(query) &&
      (generation === undefined || generation === result.context.generation) &&
      JSON.stringify(result.context.defaultDatasource) === JSON.stringify(config.defaultDatasource) &&
      (result.cellId === cellId || !parameterized)
  );
  return selected?.snapshot ?? { state: 'idle' };
}
export function createPreviewResolver(
  plan: BindingPlan,
  config: DiagramConfigV2,
  data: PanelData,
  preview?: QueryPreview,
  format: HistoryFormat & { generation?: number } = {},
  active: QueryPreview[] = []
): BindingResolver {
  return (cellId, binding) => {
    const query = config.queries.find((q) => q.id === binding.queryId);
    const scope = plan.cells[cellId]?.scope;
    if (!query || !scope) {
      return { state: 'unsupported', message: 'The query or element is unavailable.' };
    }
    const snapshot = previewSnapshot(query, config, data, cellId, preview, active, format.generation);
    return resolveBinding(snapshot, binding, scope, format);
  };
}
