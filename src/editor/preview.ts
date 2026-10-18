import { type PanelData } from '@grafana/data';
import { resolveBinding, type BindingResolver } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2, NamedQuery } from '../model/config';
import type { HistoryFormat } from '../query/frames';
import type { QueryContext, QuerySnapshot } from '../query/types';
import { useEffect, useState } from 'react';
import { panelSnapshot } from '../query/panelSnapshot';

/** Refresh sample-age evaluation when displayed data or dashboard context changes. */
export function usePreviewTime(
  data: unknown,
  generation?: number,
  snapshot?: QuerySnapshot,
  active: QuerySnapshot[] = [],
  deadlines: number[] = []
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
  const deadlineKey = deadlines.join('|');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = Date.now();
      const next = Math.min(
        ...deadlineKey
          .split('|')
          .map(Number)
          .filter((at) => at > now && Number.isFinite(at))
      );
      if (Number.isFinite(next)) {
        timer = setTimeout(
          () => {
            setNowMs(Date.now());
            schedule();
          },
          Math.min(2147483647, next - now)
        );
      }
    };
    schedule();
    return () => clearTimeout(timer);
  }, [deadlineKey]);
  return nowMs;
}

/** Sample-age deadlines only; fetching and cache age do not determine health. */
export function statusDeadlines(plan: BindingPlan, resolve: BindingResolver): number[] {
  return Object.values(plan.cells).flatMap((cell) => {
    const status = cell.display.status;
    if (!status?.freshness || status.enabled === false) {
      return [];
    }
    const model = resolve(cell.cellId, status.binding);
    return model.state === 'ready' && model.sampleAt !== undefined
      ? [model.sampleAt + status.freshness.staleAfterMs + 1]
      : [];
  });
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
    return panelSnapshot(data, query.source.refId, 0);
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
