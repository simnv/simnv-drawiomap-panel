import { CoreApp, dateTime, FieldType, LoadingState, type DataQueryRequest } from '@grafana/data';
import { Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { createGrafanaExecutor } from './grafana';
import type { ResolvedQueryRequest } from './types';
vi.mock('@grafana/runtime', () => ({ getDataSourceSrv: vi.fn() }));
const frame = {
  length: 2,
  fields: [
    { name: 'time', type: FieldType.time, config: {}, values: [1000, 2000] },
    { name: 'cpu', type: FieldType.number, config: {}, values: [1, null] },
  ],
};
const request = (): ResolvedQueryRequest => ({
  datasource: { uid: 'prom' },
  cacheKey: 'k',
  request: {
    requestId: 'detail-1',
    app: CoreApp.Dashboard,
    startTime: 0,
    range: { from: dateTime(1000), to: dateTime(2000), raw: { from: '1000', to: '2000' } },
    timezone: 'Europe/Paris',
    scopedVars: { dm_device: { text: 'a"b', value: 'a"b' } },
    interval: '10ms',
    intervalMs: 10,
    maxDataPoints: 100,
    targets: [
      Object.assign(
        { refId: 'D' },
        { expr: 'up{device="$dm_device"}', scenarioId: 'random_walk', opaque: { native: [1, 2] } }
      ),
    ],
  } satisfies DataQueryRequest,
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('Grafana query execution boundary', () => {
  it('executes independent requests when randomUUID is unavailable on an HTTP origin', async () => {
    vi.stubGlobal('crypto', {});
    try {
      const query = vi.fn().mockResolvedValue({ data: [frame] });
      const execute = createGrafanaExecutor(async () => ({ query }));
      execute(request(), vi.fn());
      execute(request(), vi.fn());
      await flush();
      expect(query).toHaveBeenCalledTimes(2);
      expect(new Set(query.mock.calls.map(([value]) => value.requestId)).size).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('isolates transport IDs across simultaneous requests and panel controllers without changing native targets', async () => {
    const query = vi.fn().mockResolvedValue({ data: [frame] });
    const input = request();
    const saved = JSON.stringify(input);
    const first = createGrafanaExecutor(async () => ({ query }));
    const second = createGrafanaExecutor(async () => ({ query }));
    first(input, vi.fn());
    first(input, vi.fn());
    second(input, vi.fn());
    await flush();
    expect(new Set(query.mock.calls.map(([value]) => value.requestId)).size).toBe(3);
    expect(JSON.stringify(input)).toBe(saved);
    expect(query.mock.calls.every(([value]) => value.targets === input.request.targets)).toBe(true);
  });
  it('passes native targets and scoped variables untouched to the selected datasource Promise query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [frame] });
    const get = vi.fn().mockResolvedValue({ query });
    const receive = vi.fn();
    const input = request();
    const saved = JSON.stringify(input.request.targets);
    createGrafanaExecutor(get, () => 42)(input, receive);
    await flush();
    expect(get).toHaveBeenCalledWith({ uid: 'prom' });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: input.request.targets,
        scopedVars: input.request.scopedVars,
        range: input.request.range,
        timezone: 'Europe/Paris',
        intervalMs: 10,
        maxDataPoints: 100,
      })
    );
    expect(JSON.stringify(input.request.targets)).toBe(saved);
    expect(receive).toHaveBeenLastCalledWith({ state: 'ready', frames: [frame], fetchedAt: 42, fromCache: false });
  });
});

it('unsubscribes Observable queries and ignores Promise results or late datasource lookup after cancellation', async () => {
  const unsubscribe = vi.fn();
  let send!: (response: { data: Array<typeof frame> }) => void;
  const query = vi.fn(
    () =>
      new Observable<{ data: Array<typeof frame> }>((subscriber) => {
        send = (r) => subscriber.next(r);
        return unsubscribe;
      })
  );
  const receive = vi.fn();
  const cancel = createGrafanaExecutor(async () => ({ query }))(request(), receive);
  await flush();
  send({ data: [frame] });
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }));
  cancel();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  receive.mockClear();
  send({ data: [frame] });
  expect(receive).not.toHaveBeenCalled();
  let resolve!: (r: { data: Array<typeof frame> }) => void;
  const pending = new Promise<{ data: Array<typeof frame> }>((r) => {
    resolve = r;
  });
  const cancelPromise = createGrafanaExecutor(async () => ({ query: () => pending }))(request(), receive);
  await flush();
  cancelPromise();
  resolve({ data: [frame] });
  await flush();
  expect(receive).not.toHaveBeenCalled();
  const delayedQuery = vi.fn();
  const cancelLookup = createGrafanaExecutor(async () => ({ query: delayedQuery }))(request(), receive);
  cancelLookup();
  await flush();
  expect(delayedQuery).not.toHaveBeenCalled();
});

it.each([
  ['empty', { data: [] }, 'empty'],
  ['query error', { data: [], error: { message: 'secret' } }, 'error'],
  ['query errors', { data: [frame], errors: [{ message: 'secret' }] }, 'error'],
  ['error state', { data: [], state: LoadingState.Error }, 'error'],
  ['legacy response', { data: [{ target: 'legacy', datapoints: [[1, 1000]] }] }, 'unsupported'],
  ['streaming', { data: [frame], state: LoadingState.Streaming }, 'unsupported'],
])('reports %s explicitly', async (_, response, state) => {
  const receive = vi.fn();
  createGrafanaExecutor(async () => ({ query: vi.fn().mockResolvedValue(response) }))(request(), receive);
  await flush();
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state }));
  expect(JSON.stringify(receive.mock.calls)).not.toContain('secret');
});

it('reports lookup failures and thrown query failures without exposing raw details', async () => {
  const receive = vi.fn();
  createGrafanaExecutor(async () => {
    throw new Error('secret authorization');
  })(request(), receive);
  await flush();
  expect(receive).toHaveBeenLastCalledWith({
    state: 'error',
    message: 'Datasource lookup failed. Check the selected datasource and permissions.',
  });
  createGrafanaExecutor(async () => ({
    query: () => {
      throw new Error('secret');
    },
  }))(request(), receive);
  await flush();
  expect(receive).toHaveBeenLastCalledWith({ state: 'error', message: 'Datasource query failed.' });
});

it('handles an Observable error, an empty completion, and a loading-only completion explicitly', async () => {
  const receive = vi.fn();
  createGrafanaExecutor(async () => ({
    query: () => new Observable((subscriber) => subscriber.error(new Error('secret'))),
  }))(request(), receive);
  await flush();
  expect(receive).toHaveBeenLastCalledWith({ state: 'error', message: 'Datasource query failed.' });
  createGrafanaExecutor(
    async () => ({ query: () => new Observable((subscriber) => subscriber.complete()) }),
    () => 42
  )(request(), receive);
  await flush();
  expect(receive).toHaveBeenLastCalledWith({ state: 'empty', fetchedAt: 42, fromCache: false });
  createGrafanaExecutor(async () => ({
    query: () =>
      new Observable((subscriber) => {
        subscriber.next({ data: [], state: LoadingState.Loading });
        subscriber.complete();
      }),
  }))(request(), receive);
  await flush();
  expect(receive).toHaveBeenLastCalledWith({
    state: 'error',
    message: 'Datasource query completed without a final response.',
  });
});
