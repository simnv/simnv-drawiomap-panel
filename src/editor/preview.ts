import { LoadingState, type PanelData } from '@grafana/data';
import { resolveBinding, type BindingResolver } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2, NamedQuery } from '../model/config';
import type { HistoryFormat } from '../query/frames';
import type { QueryContext, QuerySnapshot } from '../query/types';
import { useEffect, useState } from 'react';

/** Refresh sample-age evaluation when displayed data or dashboard context changes. */
export function usePreviewTime(data: unknown, generation?: number, snapshot?: QuerySnapshot): number {
  const [nowMs, setNowMs] = useState(Date.now);
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
  }, [data, generation, snapshot]);
  return nowMs;
}

/** The current explicit editor result, not a cache or an execution schedule. */
export interface QueryPreview {
  query: NamedQuery;
  cellId?: string;
  context: QueryContext;
  snapshot: QuerySnapshot;
}
export function createPreviewResolver(
  plan: BindingPlan,
  config: DiagramConfigV2,
  data: PanelData,
  preview?: QueryPreview,
  format: HistoryFormat & { generation?: number } = {}
): BindingResolver {
  return (cellId, binding) => {
    const query = config.queries.find((q) => q.id === binding.queryId);
    const scope = plan.cells[cellId]?.scope;
    if (!query || !scope) {
      return { state: 'unsupported', message: 'The query or element is unavailable.' };
    }
    let snapshot: QuerySnapshot = { state: 'idle' };
    if (query.source.kind === 'panel') {
      const refId = query.source.refId;
      const frames = data.series.filter((frame) => frame.refId === refId);
      snapshot = frames.length
        ? { state: 'ready', frames, fetchedAt: 0, fromCache: false }
        : data.state === LoadingState.Error
          ? { state: 'error', message: 'The eager panel query failed.' }
          : data.state === LoadingState.Loading
            ? { state: 'loading' }
            : { state: 'empty', fetchedAt: 0, fromCache: false };
    } else if (
      preview &&
      JSON.stringify(preview.query) === JSON.stringify(query) &&
      (format.generation === undefined || format.generation === preview.context.generation) &&
      JSON.stringify(preview.context.defaultDatasource) === JSON.stringify(config.defaultDatasource) &&
      (preview.cellId === cellId || Object.keys(query.source.parameters).length === 0)
    ) {
      snapshot = preview.snapshot;
    }
    return resolveBinding(snapshot, binding, scope, format);
  };
}
