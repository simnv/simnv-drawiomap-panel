import { dateTime, FieldType, type DataFrame } from '@grafana/data';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { createQueryController } from './controller';
import { DEFAULT_QUERY_POLICY, type QueryDemand, type QueryExecutor, type QuerySnapshot } from './types';

export const demand = (consumerId = 'hover-a'): QueryDemand => ({
  consumerId,
  query: {
    id: 'cpu',
    name: 'CPU',
    source: {
      kind: 'datasource',
      datasource: { uid: 'prom' },
      target: Object.assign({ refId: 'D' }, { expr: 'cpu' }),
      parameters: {},
    },
  },
  scope: { cell: { device: 'router' } },
  context: {
    timeRange: { from: dateTime(1000), to: dateTime(5000), raw: { from: '1000', to: '5000' } },
    timeZone: 'utc',
    scopedVars: {},
    refreshMs: 0,
    intervalMs: 1000,
    generation: 1,
  },
  maxDataPoints: 200,
});
export const frame = (values: Array<number | null> = [1, null, 3]): DataFrame => ({
  refId: 'D',
  length: values.length,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: values.map((_, i) => 1000 + i * 1000) },
    { name: 'CPU', type: FieldType.number, config: { unit: 'percent' }, labels: { instance: 'router' }, values },
  ],
});
const ready = (): QuerySnapshot => ({ state: 'ready', frames: [frame()], fetchedAt: 0, fromCache: false });
afterEach(() => vi.useRealTimers());

describe('query demand lifecycle', () => {
  it('fetches only on demand and shares one pending request between consumers', () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    expect(execute).not.toHaveBeenCalled();
    const receiveA = vi.fn();
    const receiveB = vi.fn();
    const releaseA = controller.watch(demand(), receiveA);
    const releaseB = controller.watch(demand('hover-b'), receiveB);
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mock.calls[0][1](ready());
    expect(receiveA).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }));
    expect(receiveB).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }));
    releaseA();
    releaseB();
    controller.dispose();
  });
});

it('cancels released work and ignores a non-cancellable Promise after consumer replacement and disposal', async () => {
  let resolve!: (value: QuerySnapshot) => void;
  const pending = new Promise<QuerySnapshot>((r) => {
    resolve = r;
  });
  const cancel = vi.fn();
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    void pending.then(emit);
    return cancel;
  });
  const controller = createQueryController(execute);
  const old = vi.fn();
  const next = vi.fn();
  const release = controller.watch(demand(), old);
  const changed = demand();
  changed.context = { ...changed.context, generation: 2 };
  controller.watch(changed, next);
  expect(cancel).toHaveBeenCalledTimes(1);
  release();
  controller.dispose();
  resolve(ready());
  await pending;
  await Promise.resolve();
  expect(old.mock.calls.map(([s]) => s.state)).toEqual(['loading']);
  expect(next.mock.calls.map(([s]) => s.state)).toEqual(['loading']);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(() => controller.watch(demand(), next)).toThrow('disposed');
});

it('bounds concurrency, rejects queue overflow, and never executes a released queued demand', () => {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, maxConcurrent: 1, maxQueued: 1 });
  const a = demand('a');
  const b = demand('b');
  b.maxDataPoints = 20;
  const c = demand('c');
  c.maxDataPoints = 30;
  const releaseA = controller.watch(a, vi.fn());
  const releaseB = controller.watch(b, vi.fn());
  const overflow = vi.fn();
  controller.watch(c, overflow);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(overflow).toHaveBeenLastCalledWith({ state: 'error', message: 'Diagram query queue is full.' });
  releaseB();
  releaseA();
  expect(execute).toHaveBeenCalledTimes(1);
  controller.watch(b, vi.fn());
  expect(execute).toHaveBeenCalledTimes(2);
  controller.dispose();
});

it('starts queued work after a result, handles synchronous executors, and reports executor exceptions safely', () => {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, maxConcurrent: 1 });
  controller.watch(demand('a'), vi.fn());
  const b = demand('b');
  b.maxDataPoints = 20;
  controller.watch(b, vi.fn());
  execute.mock.calls[0][1](ready());
  expect(execute).toHaveBeenCalledTimes(2);
  controller.dispose();
  const receive = vi.fn();
  createQueryController(() => {
    throw new Error('secret request headers');
  }).watch(demand(), receive);
  expect(receive).toHaveBeenLastCalledWith({ state: 'error', message: 'Diagram query failed.' });
  const sync = createQueryController((_, emit) => {
    emit(ready());
    return () => {};
  });
  sync.watch(demand(), receive);
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }));
  sync.dispose();
});

it('reopens retained data of the same generation at any age, and refreshes only while consumers remain', () => {
  vi.useFakeTimers();
  let clock = 100;
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    emit(ready());
    return () => {};
  });
  const controller = createQueryController(execute, DEFAULT_QUERY_POLICY, () => clock);
  const a = demand();
  a.context.refreshMs = 500;
  controller.watch(a, vi.fn())();
  const receive = vi.fn();
  clock = 200;
  const release = controller.watch(a, receive);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ fromCache: true, fetchedAt: 100 }));
  clock = 700;
  vi.advanceTimersByTime(500);
  expect(execute).toHaveBeenCalledTimes(2);
  release();
  vi.advanceTimersByTime(3000);
  expect(execute).toHaveBeenCalledTimes(2);
  // The key holds the generation and the frozen range: the result is the data of this dashboard state at any age.
  clock = 2_000_000;
  controller.watch(a, receive)();
  expect(execute).toHaveBeenCalledTimes(2);
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ fromCache: true, fetchedAt: 700 }));
  // A new generation runs again.
  const next = demand();
  next.context = { ...next.context, generation: 2 };
  controller.watch(next, receive);
  expect(execute).toHaveBeenCalledTimes(3);
  controller.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('a shared cache outlives the controller: the next controller of the session serves the retained results', () => {
  const cache = new Map();
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    emit(ready());
    return () => {};
  });
  const first = createQueryController(execute, DEFAULT_QUERY_POLICY, () => 100, cache);
  first.watch(demand(), vi.fn())();
  expect(execute).toHaveBeenCalledTimes(1);
  first.dispose();
  expect(cache.size).toBe(1);
  const second = createQueryController(execute, DEFAULT_QUERY_POLICY, () => 50_000, cache);
  const receive = vi.fn();
  second.watch(demand(), receive);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: 'ready', fromCache: true, fetchedAt: 100 })
  );
  second.dispose();
  // A private cache is cleared on dispose.
  const own = createQueryController(execute, DEFAULT_QUERY_POLICY, () => 100);
  own.watch(demand(), vi.fn())();
  own.dispose();
  const after = createQueryController(execute, DEFAULT_QUERY_POLICY, () => 100);
  after.watch(demand(), vi.fn())();
  expect(execute).toHaveBeenCalledTimes(3);
  after.dispose();
});

it.each([
  ['entries', { maxEntries: 1 }],
  ['values', { maxCachedValues: 6 }],
  ['bytes', { maxCachedBytes: 600 }],
])('evicts inactive least recently used results under the %s budget', (_, limits) => {
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    emit(ready());
    return () => {};
  });
  const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, ...limits });
  const a = demand('a');
  const b = demand('b');
  b.maxDataPoints = 20;
  controller.watch(a, vi.fn())();
  controller.watch(b, vi.fn())();
  controller.watch(b, vi.fn())();
  expect(execute).toHaveBeenCalledTimes(2);
  controller.watch(a, vi.fn())();
  expect(execute).toHaveBeenCalledTimes(3);
  controller.dispose();
});

it.each([{ maxActiveResultValues: 5 }, { maxActiveResultBytes: 10 }])(
  'rejects oversized active results without truncation or retention: %j',
  (limits) => {
    const execute = vi.fn<QueryExecutor>((_, emit) => {
      emit(ready());
      return () => {};
    });
    const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, ...limits });
    const receive = vi.fn();
    controller.watch(demand(), receive)();
    expect(receive).toHaveBeenLastCalledWith({
      state: 'error',
      message: 'Diagram query result exceeds the active result budget. Reduce the range or resolution.',
    });
    controller.watch(demand(), receive)();
    expect(execute).toHaveBeenCalledTimes(2);
    controller.dispose();
  }
);

it('isolates datasource, native target, scope parameters, dashboard variables, range, timezone, interval, generation, and resolution', () => {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, maxConcurrent: 20 });
  const a = demand('base');
  controller.watch(a, vi.fn());
  const changes: Array<(d: QueryDemand) => void> = [
    (d) => {
      if (d.query.source.kind === 'datasource') {
        d.query.source.datasource = { uid: 'testdata' };
      }
    },
    (d) => {
      if (d.query.source.kind === 'datasource') {
        d.query.source.target = Object.assign({}, d.query.source.target, { expr: 'other' });
      }
    },
    (d) => {
      if (d.query.source.kind === 'datasource') {
        d.query.source.parameters = { dm_device: 'cell.device' };
      }
    },
    (d) => {
      d.context.scopedVars = { site: { text: 'east', value: 'east' } };
    },
    (d) => {
      d.context.timeRange = { ...d.context.timeRange, to: dateTime(6000) };
    },
    (d) => {
      d.context.timeZone = 'browser';
    },
    (d) => {
      d.context.intervalMs = 2000;
    },
    (d) => {
      d.context.generation = 2;
    },
    (d) => {
      d.maxDataPoints = 100;
    },
  ];
  for (const [i, change] of changes.entries()) {
    const d = demand(String(i));
    change(d);
    controller.watch(d, vi.fn());
  }
  expect(execute).toHaveBeenCalledTimes(10);
  expect(new Set(execute.mock.calls.map(([request]) => request.cacheKey)).size).toBe(10);
  controller.dispose();
});

it('reuses eager panel frames and publishes updates/errors without network execution', () => {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute);
  const a = demand();
  a.query.source = { kind: 'panel', refId: 'D' };
  const receive = vi.fn();
  controller.watch(a, receive);
  expect(receive).toHaveBeenLastCalledWith({ state: 'idle' });
  controller.setPanelData({
    state: 'Done' as never,
    series: [frame(), { ...frame(), refId: 'OTHER' }],
    timeRange: a.context.timeRange,
  });
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', frames: [frame()] }));
  controller.setPanelData({ state: 'Loading' as never, series: [], timeRange: a.context.timeRange });
  expect(receive).toHaveBeenLastCalledWith({ state: 'loading' });
  controller.setPanelData({
    state: 'Error' as never,
    series: [],
    timeRange: a.context.timeRange,
    error: { message: 'secret' },
  });
  expect(receive).toHaveBeenLastCalledWith({ state: 'error', message: 'Panel query failed.' });
  expect(execute).not.toHaveBeenCalled();
  controller.dispose();
});

it('keeps parameter values in scoped variables, preserves native targets, and derives interval from width', () => {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute);
  const a = demand();
  a.scope.cell.device = 'router"\\one';
  a.maxDataPoints = 2;
  if (a.query.source.kind === 'datasource') {
    a.query.source.datasource = undefined;
    a.context.defaultDatasource = { uid: 'testdata' };
    a.query.source.parameters = { dm_device: 'cell.device' };
    a.query.source.target = Object.assign(
      { refId: 'D' },
      { expr: 'cpu{device="${dm_device}"}', opaque: { retained: [1, 'x'] } }
    );
  }
  controller.watch(a, vi.fn());
  expect(execute.mock.calls[0][0]).toMatchObject({
    datasource: { uid: 'testdata' },
    request: {
      intervalMs: 2000,
      maxDataPoints: 2,
      scopedVars: { dm_device: { value: 'router"\\one' } },
      targets: [a.query.source.kind === 'datasource' ? a.query.source.target : {}],
    },
  });
  controller.dispose();
});

it.each(['missing datasource', 'missing path', 'collision', 'undeclared parameter', 'bad parameter name'])(
  'rejects %s before execution',
  (reason) => {
    const a = demand();
    if (a.query.source.kind !== 'datasource') {
      throw new Error('fixture');
    }
    if (reason === 'missing datasource') {
      a.query.source.datasource = undefined;
    }
    if (reason === 'missing path') {
      a.query.source.parameters = { dm_device: 'cell.missing' };
    }
    if (reason === 'collision') {
      a.query.source.parameters = { dm_device: 'cell.device' };
      a.context.scopedVars.dm_device = { value: 'global', text: 'global' };
    }
    if (reason === 'undeclared parameter') {
      a.query.source.target = Object.assign({ refId: 'D' }, { expr: 'cpu[$dm_unknown]' });
    }
    if (reason === 'bad parameter name') {
      a.query.source.parameters = { device: 'cell.device' };
    }
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const receive = vi.fn();
    const controller = createQueryController(execute);
    controller.watch(a, receive);
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error', message: expect.any(String) }));
    expect(execute).not.toHaveBeenCalled();
    controller.dispose();
  }
);

it('evicts the least recently used inactive entry and retains recently reopened data', () => {
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    emit(ready());
    return () => {};
  });
  const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, maxEntries: 2 });
  const a = demand('a');
  const b = demand('b');
  b.maxDataPoints = 20;
  const c = demand('c');
  c.maxDataPoints = 30;
  controller.watch(a, vi.fn())();
  controller.watch(b, vi.fn())();
  controller.watch(a, vi.fn())();
  controller.watch(c, vi.fn())();
  controller.watch(a, vi.fn())();
  expect(execute).toHaveBeenCalledTimes(3);
  controller.watch(b, vi.fn())();
  expect(execute).toHaveBeenCalledTimes(4);
  controller.dispose();
});

it('does not leave a refresh timer when a consumer releases while receiving a result', () => {
  vi.useFakeTimers();
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute);
  const a = demand();
  a.context.refreshMs = 50;
  const release = controller.watch(a, (snapshot) => {
    if (snapshot.state === 'ready') {
      release();
    }
  });
  execute.mock.calls[0][1](ready());
  expect(vi.getTimerCount()).toBe(0);
  controller.dispose();
});

it('keeps subscriptions independent when two consumers pass the same listener', () => {
  const execute = vi.fn<QueryExecutor>(() => () => {});
  const controller = createQueryController(execute);
  const receive = vi.fn();
  const releaseA = controller.watch(demand('a'), receive);
  const releaseB = controller.watch(demand('b'), receive);
  releaseA();
  receive.mockClear();
  execute.mock.calls[0][1](ready());
  expect(receive).toHaveBeenCalledTimes(1);
  releaseB();
  controller.dispose();
});

it('shares an active result with a later consumer at any age', () => {
  let clock = 0;
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    emit(ready());
    return () => {};
  });
  const controller = createQueryController(execute, DEFAULT_QUERY_POLICY, () => clock);
  controller.watch(demand('a'), vi.fn());
  clock = 100_000;
  const receive = vi.fn();
  controller.watch(demand('b'), receive);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ fetchedAt: 0 }));
  controller.dispose();
});

it('shares an Observable executor and unsubscribes only after its final consumer releases', () => {
  const source = new Subject<QuerySnapshot>();
  const unsubscribe = vi.fn();
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    const subscription = source.subscribe(emit);
    return () => {
      unsubscribe();
      subscription.unsubscribe();
    };
  });
  const controller = createQueryController(execute);
  const a = vi.fn();
  const b = vi.fn();
  const releaseA = controller.watch(demand('a'), a);
  const releaseB = controller.watch(demand('b'), b);
  releaseA();
  expect(unsubscribe).not.toHaveBeenCalled();
  source.next(ready());
  expect(a.mock.calls.map(([value]) => value.state)).toEqual(['loading']);
  expect(b).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }));
  releaseB();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  controller.dispose();
});

it('never publishes an obsolete Promise result into a new selection or its cache', async () => {
  let finishOld!: (s: QuerySnapshot) => void;
  let finishNew!: (s: QuerySnapshot) => void;
  const old = new Promise<QuerySnapshot>((r) => {
    finishOld = r;
  });
  const next = new Promise<QuerySnapshot>((r) => {
    finishNew = r;
  });
  const execute = vi.fn<QueryExecutor>((_, emit) => {
    void (execute.mock.calls.length === 1 ? old : next).then(emit);
    return () => {};
  });
  const controller = createQueryController(execute);
  const receiveOld = vi.fn();
  const receiveNew = vi.fn();
  controller.watch(demand(), receiveOld);
  const selected = demand();
  selected.scope.cell.device = 'second';
  selected.maxDataPoints = 100;
  controller.watch(selected, receiveNew);
  finishOld(ready());
  await old;
  await Promise.resolve();
  expect(receiveOld.mock.calls.map(([s]) => s.state)).toEqual(['loading']);
  expect(receiveNew.mock.calls.map(([s]) => s.state)).toEqual(['loading']);
  finishNew({ state: 'ready', frames: [frame([9])], fetchedAt: 0, fromCache: false });
  await next;
  await Promise.resolve();
  expect(receiveNew).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', frames: [frame([9])] }));
  controller.dispose();
});

it('counts numeric vector storage in the active byte budget even for cheaply serialized zero samples', () => {
  const f = frame(new Array(1000).fill(0));
  f.fields[0].values.fill(0);
  const execute: QueryExecutor = (_, emit) => {
    emit({ state: 'ready', frames: [f], fetchedAt: 0, fromCache: false });
    return () => {};
  };
  const controller = createQueryController(execute, { ...DEFAULT_QUERY_POLICY, maxActiveResultBytes: 12000 });
  const receive = vi.fn();
  controller.watch(demand(), receive);
  expect(receive).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: 'error', message: expect.stringContaining('budget') })
  );
  controller.dispose();
});

describe('keep the last result during a refresh', () => {
  const states = (receive: ReturnType<typeof vi.fn>) =>
    receive.mock.calls.map(([snapshot]) => (snapshot as QuerySnapshot).state);

  it('reports loading only on the first load and keeps ready data while the refresh timer runs', () => {
    vi.useFakeTimers();
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    const a = demand();
    a.context.refreshMs = 500;
    const receive = vi.fn();
    controller.watch(a, receive);
    expect(receive).toHaveBeenLastCalledWith({ state: 'loading' });
    execute.mock.calls[0][1](ready());
    vi.advanceTimersByTime(500);
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mock.calls[1][1]({ state: 'loading' });
    expect(states(receive)).toEqual(['loading', 'ready', 'ready']);
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', fromCache: true }));
    execute.mock.calls[1][1](ready());
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', fromCache: false }));
    controller.dispose();
  });

  it('does not restart a pending run when another consumer joins the entry', () => {
    const cancel = vi.fn();
    const execute = vi.fn<QueryExecutor>(() => cancel);
    const controller = createQueryController(execute);
    controller.watch(demand('a'), vi.fn());
    controller.watch(demand('b'), vi.fn());
    expect(execute).toHaveBeenCalledTimes(1);
    const receiveC = vi.fn();
    controller.watch(demand('c'), receiveC);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    execute.mock.calls[0][1](ready());
    expect(receiveC).toHaveBeenLastCalledWith(expect.objectContaining({ fromCache: false }));
    controller.dispose();
  });

  it('keeps the error while the refresh after an error runs, then shows the new result', () => {
    vi.useFakeTimers();
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    const a = demand();
    a.context.refreshMs = 500;
    const receive = vi.fn();
    controller.watch(a, receive);
    execute.mock.calls[0][1]({ state: 'error', message: 'Datasource query failed.' });
    vi.advanceTimersByTime(500);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(states(receive)).toEqual(['loading', 'error']);
    execute.mock.calls[1][1](ready());
    expect(states(receive)).toEqual(['loading', 'error', 'ready']);
    controller.dispose();
  });

  it('keeps the previous panel frames while the panel query runner loads', () => {
    const controller = createQueryController(vi.fn<QueryExecutor>(() => () => {}));
    const a = demand();
    a.query.source = { kind: 'panel', refId: 'D' };
    const receive = vi.fn();
    controller.watch(a, receive);
    controller.setPanelData({ state: 'Loading' as never, series: [frame()], timeRange: a.context.timeRange });
    expect(receive).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'ready', frames: [frame()], fromCache: true })
    );
    controller.dispose();
  });
});

describe('the boundary copy', () => {
  it('publishes one copy of the frames per ready emission: every listener gets the same object, not the executor input', () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const controller = createQueryController(execute);
    const receiveA = vi.fn();
    const receiveB = vi.fn();
    controller.watch(demand('a'), receiveA);
    controller.watch(demand('b'), receiveB);
    const input = ready();
    const inputValues = input.state === 'ready' ? input.frames[0].fields[1].values : [];
    execute.mock.calls[0][1](input);
    const a: QuerySnapshot = receiveA.mock.lastCall![0];
    const b: QuerySnapshot = receiveB.mock.lastCall![0];
    if (a.state !== 'ready' || b.state !== 'ready' || input.state !== 'ready') {
      throw new Error('expected ready snapshots');
    }
    expect(a.frames).toBe(b.frames);
    expect(a.frames).not.toBe(input.frames);
    expect(a.frames[0].fields[1].values).not.toBe(inputValues);
    expect(a.frames[0].fields[1].values).toEqual([1, null, 3]);
    // A streaming producer appends in place: the published values do not change.
    inputValues.push(99);
    expect(a.frames[0].fields[1].values).toEqual([1, null, 3]);
    expect(a.frames[0].fields[1].config).toEqual({ unit: 'percent' });
    controller.dispose();
  });

  it('retains the copy, not the executor input, for the next consumer of the same generation', () => {
    const execute = vi.fn<QueryExecutor>(() => () => {});
    const cache = new Map();
    const controller = createQueryController(execute, DEFAULT_QUERY_POLICY, Date.now, cache);
    const release = controller.watch(demand('a'), vi.fn());
    const input = ready();
    execute.mock.calls[0][1](input);
    release();
    const retained = [...cache.values()][0].snapshot;
    expect(retained.state).toBe('ready');
    if (retained.state === 'ready' && input.state === 'ready') {
      expect(retained.frames).not.toBe(input.frames);
      expect(retained.frames[0].fields[1].values).not.toBe(input.frames[0].fields[1].values);
    }
    controller.dispose();
  });
});
