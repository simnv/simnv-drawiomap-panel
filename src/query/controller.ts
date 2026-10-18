import { CoreApp, type DataFrame, type PanelData, type ScopedVars } from '@grafana/data';
import {
  DEFAULT_QUERY_POLICY,
  type QueryController,
  type QueryDemand,
  type QueryExecutor,
  type QueryPolicy,
  type QuerySnapshot,
  type ResolvedQueryRequest,
} from './types';
import { panelSnapshot } from './panelSnapshot';

/** Canonical JSON for persisted query objects and resolved context, never datasource instances. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((k) => [k, item[k]])
        )
      : item
  );
}
function resolve(demand: QueryDemand, now: number): ResolvedQueryRequest {
  const { source } = demand.query;
  if (source.kind !== 'datasource') {
    throw new Error('Panel source must reuse panel data.');
  }
  const datasource = source.datasource ?? demand.context.defaultDatasource;
  if (!datasource?.uid || /\$|\[\[/.test(datasource.uid)) {
    throw new Error('Select an explicit datasource UID or panel default.');
  }
  const scopedVars: ScopedVars = { ...demand.context.scopedVars };
  for (const [name, path] of Object.entries(source.parameters)) {
    if (!/^dm_[A-Za-z_][A-Za-z0-9_]*$/.test(name) || Object.hasOwn(scopedVars, name)) {
      throw new Error('Diagram query parameter names must use dm_ and cannot collide with dashboard variables.');
    }
    const match = /^(cell|from|to)\.(.+)$/.exec(path);
    const value = match ? demand.scope[match[1] as 'cell' | 'from' | 'to']?.[match[2]] : undefined;
    if (value === undefined) {
      throw new Error('A required diagram query parameter is unresolved.');
    }
    scopedVars[name] = { text: value, value };
  }
  const native = stable(source.target);
  const names = [...native.matchAll(/\$(?:\{)?(dm_[A-Za-z_][A-Za-z0-9_]*)|\[\[(dm_[A-Za-z_][A-Za-z0-9_]*)/g)];
  if (names.some((m) => !Object.hasOwn(source.parameters, m[1] ?? m[2]))) {
    throw new Error('A native query references an undeclared dm_ parameter.');
  }
  const maxDataPoints = Math.max(1, Math.floor(demand.maxDataPoints));
  if (!Number.isFinite(maxDataPoints)) {
    throw new Error('Query resolution must be finite.');
  }
  const intervalMs = Math.max(
    1,
    demand.context.intervalMs,
    Math.ceil((demand.context.timeRange.to.valueOf() - demand.context.timeRange.from.valueOf()) / maxDataPoints)
  );
  const request = {
    requestId: `diagram-${demand.context.generation}`,
    app: CoreApp.Dashboard,
    startTime: now,
    targets: [JSON.parse(native)],
    range: demand.context.timeRange,
    rangeRaw: demand.context.timeRange.raw,
    timezone: demand.context.timeZone,
    scopedVars,
    interval: `${intervalMs}ms`,
    intervalMs,
    maxDataPoints,
  };
  const cacheKey = stable({
    datasource,
    targets: request.targets,
    scopedVars,
    range: [request.range.from.valueOf(), request.range.to.valueOf(), request.range.raw],
    timezone: request.timezone,
    intervalMs,
    maxDataPoints,
    generation: demand.context.generation,
  });
  return { datasource: { ...datasource }, request, cacheKey };
}
/** Include vector slots and serialized field configuration in both memory budgets. */
function measureFrames(frames: DataFrame[]): { values: number; bytes: number } {
  const values = frames.reduce((n, frame) => n + frame.fields.reduce((m, field) => m + field.values.length, 0), 0);
  return { values, bytes: JSON.stringify(frames).length * 2 + values * 8 };
}
interface Entry {
  request?: ResolvedQueryRequest;
  panelRef?: string;
  listeners: Set<(s: QuerySnapshot) => void>;
  snapshot: QuerySnapshot;
  cancel?: () => void;
  token: number;
  running?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  refreshMs: number;
}

export function createQueryController(
  execute: QueryExecutor,
  policy: QueryPolicy = DEFAULT_QUERY_POLICY,
  now = Date.now
): QueryController {
  const entries = new Map<string, Entry>();
  const consumers = new Map<string, () => void>();
  let disposed = false;
  let panelData: PanelData | undefined;
  let active = 0;
  const queue = new Set<Entry>();
  const cache = new Map<string, { snapshot: QuerySnapshot; values: number; bytes: number }>();
  const retain = (key: string, snapshot: QuerySnapshot) => {
    if (snapshot.state !== 'ready' && snapshot.state !== 'empty') {
      return;
    }
    const frames = snapshot.state === 'ready' ? snapshot.frames : [];
    let size: ReturnType<typeof measureFrames>;
    try {
      size = measureFrames(frames);
    } catch {
      return;
    }
    cache.delete(key);
    cache.set(key, { snapshot, ...size });
    const totals = () =>
      [...cache.values()].reduce((n, value) => ({ values: n.values + value.values, bytes: n.bytes + value.bytes }), {
        values: 0,
        bytes: 0,
      });
    while (
      cache.size > policy.maxEntries ||
      totals().values > policy.maxCachedValues ||
      totals().bytes > policy.maxCachedBytes
    ) {
      cache.delete(cache.keys().next().value!);
    }
  };
  const publish = (entry: Entry, snapshot: QuerySnapshot) => {
    entry.snapshot = snapshot;
    for (const listener of [...entry.listeners]) {
      listener(snapshot);
    }
  };
  const stop = (entry: Entry) => {
    entry.token++;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    queue.delete(entry);
    if (entry.running) {
      entry.running = false;
      active--;
    }
    const cancel = entry.cancel;
    entry.cancel = undefined;
    try {
      cancel?.();
    } catch {
      /* Cancellation is best effort; the token still invalidates callbacks. */
    }
  };
  const pump = () => {
    for (const entry of queue) {
      if (active >= policy.maxConcurrent || disposed) {
        break;
      }
      queue.delete(entry);
      if (!entry.listeners.size) {
        continue;
      }
      entry.running = true;
      active++;
      const token = ++entry.token;
      try {
        const cancel = execute(entry.request!, (snapshot) => {
          if (disposed || entry.token !== token || !entry.listeners.size) {
            return;
          }
          if (snapshot.state === 'ready') {
            let size = { values: Infinity, bytes: Infinity };
            try {
              size = measureFrames(snapshot.frames);
            } catch {
              /* Unmeasurable active results are rejected; inactive cache retention skips them. */
            }
            if (size.values > policy.maxActiveResultValues || size.bytes > policy.maxActiveResultBytes) {
              snapshot = {
                state: 'error',
                message: 'Diagram query result exceeds the active result budget. Reduce the range or resolution.',
              };
            } else {
              snapshot = { ...snapshot, fetchedAt: now(), fromCache: false };
            }
          } else if (snapshot.state === 'empty') {
            snapshot = { ...snapshot, fetchedAt: now(), fromCache: false };
          }
          if (snapshot.state !== 'loading' && snapshot.state !== 'idle' && entry.running) {
            entry.running = false;
            active--;
          }
          publish(entry, snapshot);
          if (
            !disposed &&
            entry.token === token &&
            entry.listeners.size &&
            snapshot.state !== 'loading' &&
            snapshot.state !== 'idle' &&
            entry.refreshMs > 0
          ) {
            clearTimeout(entry.timer);
            entry.timer = setTimeout(() => {
              stop(entry);
              if (!disposed && entry.listeners.size) {
                publish(entry, { state: 'loading' });
                enqueue(entry);
              }
            }, entry.refreshMs);
          }
          pump();
        });
        if (entry.token === token && entry.listeners.size) {
          entry.cancel = cancel;
        } else {
          cancel();
        }
      } catch {
        if (entry.running) {
          entry.running = false;
          active--;
        }
        publish(entry, { state: 'error', message: 'Diagram query failed.' });
      }
    }
  };
  const enqueue = (entry: Entry) => {
    if (active >= policy.maxConcurrent && queue.size >= policy.maxQueued) {
      publish(entry, { state: 'error', message: 'Diagram query queue is full.' });
    } else {
      queue.add(entry);
      pump();
    }
  };
  return {
    setPanelData(data: PanelData) {
      if (disposed) {
        return;
      }
      panelData = data;
      for (const entry of entries.values()) {
        if (entry.panelRef) {
          publish(entry, panelSnapshot(panelData, entry.panelRef, now()));
        }
      }
    },
    watch(demand, listener) {
      if (disposed) {
        throw new Error('Query controller is disposed.');
      }
      consumers.get(demand.consumerId)?.();
      if (demand.query.source.kind === 'panel') {
        const refId = demand.query.source.refId;
        const key = `panel:${refId}`;
        let entry = entries.get(key);
        if (!entry) {
          entry = {
            panelRef: refId,
            listeners: new Set(),
            snapshot: panelSnapshot(panelData, refId, now()),
            token: 0,
            refreshMs: 0,
          };
          entries.set(key, entry);
        }
        const current = entry;
        const receive = (snapshot: QuerySnapshot) => listener(snapshot);
        current.listeners.add(receive);
        receive(current.snapshot);
        let released = false;
        const release = () => {
          if (released) {
            return;
          }
          released = true;
          current.listeners.delete(receive);
          if (consumers.get(demand.consumerId) === release) {
            consumers.delete(demand.consumerId);
          }
          if (!current.listeners.size) {
            entries.delete(key);
          }
        };
        consumers.set(demand.consumerId, release);
        return release;
      }
      let request: ResolvedQueryRequest;
      try {
        request = resolve(demand, now());
      } catch (error) {
        listener({ state: 'error', message: (error as Error).message });
        return () => {};
      }
      let entry = entries.get(request.cacheKey);
      let fresh = !entry;
      if (
        entry &&
        (entry.snapshot.state === 'ready' || entry.snapshot.state === 'empty') &&
        now() - entry.snapshot.fetchedAt >= policy.freshMs
      ) {
        stop(entry);
        publish(entry, { state: 'loading' });
        fresh = true;
      }
      if (!entry) {
        const cached = cache.get(request.cacheKey);
        cache.delete(request.cacheKey);
        const snapshot = cached?.snapshot;
        const isFresh =
          snapshot &&
          (snapshot.state === 'ready' || snapshot.state === 'empty') &&
          now() - snapshot.fetchedAt < policy.freshMs;
        entry = {
          request,
          listeners: new Set(),
          snapshot: isFresh ? { ...snapshot, fromCache: true } : { state: 'loading' },
          token: 0,
          refreshMs: demand.context.refreshMs,
        };
        entries.set(request.cacheKey, entry);
      }
      const current = entry;
      const receive = (snapshot: QuerySnapshot) => listener(snapshot);
      current.listeners.add(receive);
      receive(current.snapshot);
      let released = false;
      const release = () => {
        if (released) {
          return;
        }
        released = true;
        current.listeners.delete(receive);
        if (consumers.get(demand.consumerId) === release) {
          consumers.delete(demand.consumerId);
        }
        if (!current.listeners.size) {
          stop(current);
          retain(request.cacheKey, current.snapshot);
          entries.delete(request.cacheKey);
          pump();
        }
      };
      consumers.set(demand.consumerId, release);
      if (fresh) {
        if (current.snapshot.state === 'loading') {
          enqueue(current);
        } else if (current.refreshMs > 0) {
          current.timer = setTimeout(() => {
            publish(current, { state: 'loading' });
            enqueue(current);
          }, current.refreshMs);
        }
      }
      return release;
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values()) {
        stop(entry);
        entry.listeners.clear();
      }
      entries.clear();
      consumers.clear();
      queue.clear();
      cache.clear();
      panelData = undefined;
    },
  };
}
