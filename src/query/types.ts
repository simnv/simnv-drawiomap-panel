import type { DataFrame, DataQueryRequest, PanelData, ScopedVars, TimeRange } from '@grafana/data';
import type { DataSourceRef } from '@grafana/schema';
import type { NamedQuery } from '../model/config';
import type { TemplateScope } from '../types';

export interface QueryContext {
  timeRange: TimeRange;
  timeZone: string;
  scopedVars: ScopedVars;
  refreshMs: number;
  intervalMs: number;
  generation: number;
  defaultDatasource?: DataSourceRef;
}
export interface QueryDemand {
  consumerId: string;
  query: NamedQuery;
  scope: TemplateScope;
  context: QueryContext;
  maxDataPoints: number;
}
export type QuerySnapshot =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; frames: DataFrame[]; fetchedAt: number; fromCache: boolean }
  | { state: 'empty'; fetchedAt: number; fromCache: boolean }
  | { state: 'error' | 'unsupported'; message: string };
export interface ResolvedQueryRequest {
  datasource: DataSourceRef;
  request: DataQueryRequest;
  cacheKey: string;
}
export type QueryExecutor = (request: ResolvedQueryRequest, emit: (snapshot: QuerySnapshot) => void) => () => void;
export interface QueryController {
  setPanelData(data: PanelData): void;
  watch(demand: QueryDemand, listener: (value: QuerySnapshot) => void): () => void;
  dispose(): void;
}
export interface QueryPolicy {
  freshMs: number;
  maxEntries: number;
  maxCachedValues: number;
  maxCachedBytes: number;
  maxConcurrent: number;
  maxQueued: number;
  maxActiveResultValues: number;
  maxActiveResultBytes: number;
}
export const DEFAULT_QUERY_POLICY: QueryPolicy = {
  freshMs: 15000,
  maxEntries: 64,
  maxCachedValues: 100000,
  maxCachedBytes: 8388608,
  maxConcurrent: 4,
  maxQueued: 64,
  maxActiveResultValues: 100000,
  maxActiveResultBytes: 8388608,
};
