import { type DataSourceRef, type PanelData } from '@grafana/data';
import { resolveBinding, type BindingResolver } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfig, NamedQuery } from '../model/config';
import type { HistoryFormat } from '../query/frames';
import type { QueryContext, QuerySnapshot } from '../query/types';
import { useEffect, useState } from 'react';
import { panelSnapshot } from '../query/panelSnapshot';

/**
 * Refresh sample-age evaluation when displayed data or dashboard context changes.
 * @param activeVersion the version of the shown results: a frame version of the store
 */
export function usePreviewTime(
  data: unknown,
  generation?: number,
  snapshot?: QuerySnapshot,
  activeVersion: number | string = 0,
  deadlines: number[] = []
): number {
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
  /** A result of an earlier context, shown until the new result. Reuse ignores it. */
  kept?: boolean;
}
/** Select compatible prepared results without registering demand or consulting another cache. */
export function previewSnapshot(
  query: NamedQuery,
  config: Pick<DiagramConfig, 'defaultDatasource'>,
  data: PanelData,
  cellId: string,
  preview?: QueryPreview,
  active: QueryPreview[] = [],
  generation?: number,
  purpose: 'display' | 'reuse' = 'display'
): QuerySnapshot {
  if (query.source.kind === 'panel') {
    return panelSnapshot(data, query.source.refId);
  }
  return preparedSnapshot(query, config, cellId, preview, active, generation, purpose);
}

/** Two references name the same datasource: the same uid and type, whatever the key order of their JSON. */
const sameDatasource = (a: DataSourceRef | undefined, b: DataSourceRef | undefined): boolean =>
  a?.uid === b?.uid && a?.type === b?.type;
/** Share compatibility checks; reuse prefers success while display preserves its authoritative result order. */
export function preparedSnapshot(
  query: NamedQuery,
  config: Pick<DiagramConfig, 'defaultDatasource'>,
  cellId: string,
  preview?: QueryPreview,
  active: QueryPreview[] = [],
  generation?: number,
  purpose: 'display' | 'reuse' = 'reuse'
): QuerySnapshot {
  if (query.source.kind === 'panel') {
    return { state: 'idle' };
  }
  const parameterized = Object.keys(query.source.parameters).length > 0;
  const compatible = [...active, preview].filter(
    (result) =>
      result &&
      !(purpose === 'reuse' && result.kept) &&
      JSON.stringify(result.query) === JSON.stringify(query) &&
      (generation === undefined || generation === result.context.generation) &&
      sameDatasource(result.context.defaultDatasource, config.defaultDatasource) &&
      (result.cellId === cellId || !parameterized)
  );
  // Reuse data before empty success. Display must still expose a later saved monitoring failure.
  const successful =
    purpose === 'reuse'
      ? (compatible.find((result) => result?.snapshot.state === 'ready') ??
        compatible.find((result) => result?.snapshot.state === 'empty'))
      : undefined;
  const selected =
    successful ??
    compatible.find((result) => result?.snapshot.state !== 'idle' && result?.snapshot.state !== 'loading');
  return (selected ?? compatible[0])?.snapshot ?? { state: 'idle' };
}
export function createPreviewResolver(
  plan: BindingPlan,
  config: DiagramConfig,
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
