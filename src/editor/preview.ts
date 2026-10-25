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

/** The reported outcome of one explicit editor run (a query preview or a pattern preview), not a cache. */
export interface QueryPreview {
  query: NamedQuery;
  cellId?: string;
  context: QueryContext;
  snapshot: QuerySnapshot;
}

/** Two references name the same datasource: the same uid and type, whatever the key order of their JSON. */
const sameDatasource = (a: DataSourceRef | undefined, b: DataSourceRef | undefined): boolean =>
  a?.uid === b?.uid && a?.type === b?.type;

/**
 * The snapshot of a reported result for a query at a cell: the result when it is the outcome of this query, this
 * default datasource and this generation at this cell (at any cell for a query without parameters), else idle.
 */
export function reportedSnapshot(
  result: QueryPreview,
  query: NamedQuery,
  config: Pick<DiagramConfig, 'defaultDatasource'>,
  cellId: string,
  generation?: number
): QuerySnapshot {
  if (query.source.kind === 'panel') {
    return { state: 'idle' };
  }
  const parameterized = Object.keys(query.source.parameters).length > 0;
  const compatible =
    JSON.stringify(result.query) === JSON.stringify(query) &&
    (generation === undefined || generation === result.context.generation) &&
    sameDatasource(result.context.defaultDatasource, config.defaultDatasource) &&
    (result.cellId === cellId || !parameterized);
  return compatible ? result.snapshot : { state: 'idle' };
}

/**
 * The resolver of one reported result, for the report overlay of the popup: the inspector reports the requested
 * outcome, including pending and failed requests. A panel-source query reads the panel data.
 */
export function createPreviewResolver(
  plan: BindingPlan,
  config: Pick<DiagramConfig, 'queries' | 'defaultDatasource'>,
  data: PanelData,
  result: QueryPreview,
  format: HistoryFormat & { generation?: number } = {}
): BindingResolver {
  return (cellId, binding) => {
    const query = config.queries.find((q) => q.id === binding.queryId);
    const scope = plan.cells[cellId]?.scope;
    if (!query || !scope) {
      return { state: 'unsupported', message: 'The query or element is unavailable.' };
    }
    const snapshot =
      query.source.kind === 'panel'
        ? panelSnapshot(data, query.source.refId)
        : reportedSnapshot(result, query, config, cellId, format.generation);
    return resolveBinding(snapshot, binding, scope, format);
  };
}
