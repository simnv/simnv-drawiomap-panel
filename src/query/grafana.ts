import { LoadingState, toDataFrame, type DataQueryResponse, type DataSourceApi } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import type { DataSourceRef } from '@grafana/schema';
import type { QueryExecutor, QuerySnapshot } from './types';

export type DatasourceLookup = (ref: DataSourceRef) => Promise<Pick<DataSourceApi, 'query'>>;
const transportNamespace = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let transportSequence = 0;

/** Datasource query() owns native interpolation and escaping. No query string is rewritten here. */
export function createGrafanaExecutor(
  get: DatasourceLookup = (ref) => getDataSourceSrv().get(ref),
  now = Date.now
): QueryExecutor {
  return (resolved, emit) => {
    let cancelled = false;
    let subscription: { unsubscribe(): void } | undefined;
    let received = false;
    let finalResponse = false;
    const send = (snapshot: QuerySnapshot) => {
      if (!cancelled) {
        emit(snapshot);
      }
    };
    const fail = () => send({ state: 'error', message: 'Datasource query failed.' });
    const receive = (response: DataQueryResponse) => {
      if (cancelled) {
        return;
      }
      received = true;
      finalResponse = response.state !== LoadingState.Loading && response.state !== LoadingState.NotStarted;
      if (response.error || response.errors?.length || response.state === LoadingState.Error) {
        fail();
        return;
      }
      if (response.state === LoadingState.Streaming || response.key !== undefined) {
        send({
          state: 'unsupported',
          message: 'Streaming and partial response frames are unsupported. Use a finite time-series query.',
        });
        return;
      }
      if (response.state === LoadingState.Loading || response.state === LoadingState.NotStarted) {
        send({ state: 'loading' });
        return;
      }
      if (
        !Array.isArray(response.data) ||
        response.data.some((f) => !f || !('fields' in f) || !Array.isArray(f.fields))
      ) {
        send({ state: 'unsupported', message: 'This datasource did not return supported data frames.' });
        return;
      }
      try {
        const frames = response.data.map((f) => toDataFrame(f));
        send(
          frames.length
            ? { state: 'ready', frames, fetchedAt: now(), fromCache: false }
            : { state: 'empty', fetchedAt: now(), fromCache: false }
        );
      } catch {
        send({ state: 'unsupported', message: 'This datasource returned invalid data frames.' });
      }
    };
    void get(resolved.datasource).then(
      (datasource) => {
        if (cancelled) {
          return;
        }
        try {
          // BackendSrv cancels requests that share a requestId. A context generation
          // is shared by independent cells and panels, so it is not a transport ID.
          const result = datasource.query({
            ...resolved.request,
            requestId: `drawiomap-${transportNamespace}-${++transportSequence}`,
          });
          if ('then' in result) {
            void result.then(receive).catch(fail);
          } else {
            subscription = result.subscribe({
              next: receive,
              error: fail,
              complete: () => {
                if (!received) {
                  send({ state: 'empty', fetchedAt: now(), fromCache: false });
                } else if (!finalResponse) {
                  send({ state: 'error', message: 'Datasource query completed without a final response.' });
                }
              },
            });
            if (cancelled) {
              subscription.unsubscribe();
            }
          }
        } catch {
          fail();
        }
      },
      () =>
        send({ state: 'error', message: 'Datasource lookup failed. Check the selected datasource and permissions.' })
    );
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  };
}
