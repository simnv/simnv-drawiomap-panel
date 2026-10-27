import type { NamedQuery } from '../model/config';
import type { TemplateScope } from '../types';
import { stable } from './boundary';
import { settled, type QueryContext, type QueryController, type QuerySnapshot } from './types';

/** What one consumer wants from one query at one cell. */
export interface StoreDemand {
  /** the cell, or the anchor cell of a chart widget */
  cellId: string;
  query: NamedQuery;
  scope: TemplateScope;
  context: QueryContext;
  maxDataPoints: number;
  /** `stable([query, scope, context.defaultDatasource])`: the request identity without the generation and the resolution */
  matchKey: string;
}
/** What the frame holds for one consumer. The object is stable until the entry changes. */
export interface Shown {
  /** settled: the current result; else the last settled one with `fromCache: true`, else the current one */
  snapshot: QuerySnapshot;
  /** true when `snapshot` is `last`: a result of an earlier generation or resolution */
  kept: boolean;
  /** the generation of `snapshot` */
  generation: number;
  /** of the request that produced `snapshot` */
  matchKey: string;
  /** the resolution of the request that produced `snapshot` */
  maxDataPoints: number;
  demand: StoreDemand;
}
/** The results of one group (or of one owner), for React: a new object only when a `Shown` or the membership changed. */
export interface Frame {
  version: number;
  /** the entry of the pair; in an owner frame with two groups on one pair, the settled one, else the first */
  get(cellId: string, queryId: string): Shown | undefined;
  readonly size: number;
}
export interface SnapshotStore {
  /** Declare the whole wanted set of a group. New demands are watched, missing ones released, equal ones kept. */
  want(owner: string, group: string, demands: StoreDemand[]): void;
  /** The frame of a group; without a group, of every group of the owner. */
  frame(owner: string, group?: string): Frame;
  /** One call per microtask batch of changes. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** The snapshot of an entry before its first result, and of a demand without an entry. */
export const LOADING: QuerySnapshot = { state: 'loading' };
/** The frame of a hook without a store. */
export const EMPTY_FRAME: Frame = { version: 0, get: () => undefined, size: 0 };

export const matchKeyOf = (query: NamedQuery, scope: TemplateScope, context: QueryContext): string =>
  stable([query, scope, context.defaultDatasource]);
/** The key of a `(cellId, queryId)` pair. The separator cannot occur in an id. */
export const pairKey = (cellId: string, queryId: string): string => `${cellId}\u0000${queryId}`;
/**
 * The key of an entry, also the consumer id of its controller watch. Each part is encoded: an id with ':' (a
 * portograph link id, for example) cannot collide with another tuple.
 */
export const entryKey = (owner: string, group: string, cellId: string, queryId: string): string =>
  [owner, group, cellId, queryId].map(encodeURIComponent).join(':');

const keptCopies = new WeakMap<QuerySnapshot, QuerySnapshot>();
/** A settled result as a kept one: `fromCache: true`, one copy per result so the history cache still hits. */
export function asKept(snapshot: QuerySnapshot): QuerySnapshot {
  if ((snapshot.state !== 'ready' && snapshot.state !== 'empty') || snapshot.fromCache) {
    return snapshot;
  }
  let copy = keptCopies.get(snapshot);
  if (!copy) {
    copy = { ...snapshot, fromCache: true };
    keptCopies.set(snapshot, copy);
  }
  return copy;
}

/**
 * The render check: the entry against the demand of this render, because `want()` runs in an effect after it.
 * The same request identity, generation and resolution: the result as is. The same identity, another generation (a
 * refresh before the effect) or another resolution (a zoom, or the settled entry of another group of the owner on
 * the pair): the result as kept, never as a fresh success of this request (R2-2). Another identity (the query, the
 * scope or the default datasource changed under the same id): loading, never the old data at all.
 */
export function shownSnapshot(shown: Shown, demand: StoreDemand): QuerySnapshot {
  if (shown.matchKey !== demand.matchKey) {
    return LOADING;
  }
  return shown.generation === demand.context.generation && shown.maxDataPoints === demand.maxDataPoints
    ? shown.snapshot
    : asKept(shown.snapshot);
}

interface Entry {
  /** `entryKey(owner, group, cellId, queryId)`, also the consumer id of the controller watch */
  key: string;
  pair: string;
  demand: StoreDemand;
  current: QuerySnapshot;
  /** the last settled result, already as kept, with the generation and the resolution of its request */
  last?: { snapshot: QuerySnapshot; generation: number; matchKey: string; maxDataPoints: number };
  release: () => void;
  /** a watch whose token is not the entry's is over: its emissions are dropped */
  token: number;
  shown?: Shown;
}
interface CachedFrame {
  version: number;
  frame: Frame;
  shown: Map<string, Shown>;
}

const SEP = '\u0000';

/** One store per controller: the live result of every consumer. The controller keeps execution and the cache. */
export function createSnapshotStore(controller: QueryController): SnapshotStore {
  /** `${owner}\0${group}` → pair → entry, in insertion order */
  const groups = new Map<string, Map<string, Entry>>();
  const listeners = new Set<() => void>();
  const frames = new Map<string, CachedFrame>();
  let version = 0;
  let scheduled = false;
  let disposed = false;

  const notify = () => {
    version++;
    if (scheduled) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      for (const listener of [...listeners]) {
        listener();
      }
    });
  };
  const shownOf = (entry: Entry): Shown => {
    if (!entry.shown) {
      const { demand } = entry;
      entry.shown =
        settled(entry.current) || !entry.last
          ? {
              snapshot: entry.current,
              kept: false,
              generation: demand.context.generation,
              matchKey: demand.matchKey,
              maxDataPoints: demand.maxDataPoints,
              demand,
            }
          : {
              snapshot: entry.last.snapshot,
              kept: true,
              generation: entry.last.generation,
              matchKey: entry.last.matchKey,
              maxDataPoints: entry.last.maxDataPoints,
              demand,
            };
    }
    return entry.shown;
  };
  const watch = (entry: Entry) => {
    const token = ++entry.token;
    const { demand } = entry;
    entry.release = controller.watch(
      {
        consumerId: entry.key,
        query: demand.query,
        scope: demand.scope,
        context: demand.context,
        maxDataPoints: demand.maxDataPoints,
      },
      (snapshot) => {
        if (disposed || entry.token !== token) {
          return;
        }
        entry.current = snapshot;
        if (settled(snapshot)) {
          entry.last = {
            snapshot: asKept(snapshot),
            generation: demand.context.generation,
            matchKey: demand.matchKey,
            maxDataPoints: demand.maxDataPoints,
          };
        }
        entry.shown = undefined;
        notify();
      }
    );
  };
  const stop = (entry: Entry) => {
    entry.token++;
    entry.release();
    entry.release = () => {};
  };

  return {
    want(owner, group, demands) {
      if (disposed) {
        return;
      }
      const groupKey = `${owner}${SEP}${group}`;
      let members = groups.get(groupKey);
      const wanted = new Map<string, StoreDemand>();
      for (const demand of demands) {
        const pair = pairKey(demand.cellId, demand.query.id);
        if (!wanted.has(pair)) {
          wanted.set(pair, demand);
        }
      }
      let changed = false;
      if (members) {
        for (const [pair, entry] of members) {
          if (!wanted.has(pair)) {
            stop(entry);
            members.delete(pair);
            changed = true;
          }
        }
      }
      for (const [pair, demand] of wanted) {
        const existing = members?.get(pair);
        if (existing) {
          const old = existing.demand;
          if (
            old.matchKey === demand.matchKey &&
            old.context.generation === demand.context.generation &&
            old.maxDataPoints === demand.maxDataPoints
          ) {
            existing.demand = demand;
            continue;
          }
          // a new generation or a new resolution: the same entry, a new request, the last result until it answers;
          // a new query, scope or default datasource: the old result is not this data
          stop(existing);
          if (old.matchKey !== demand.matchKey) {
            existing.last = undefined;
          } else if (settled(existing.current)) {
            existing.last = {
              snapshot: asKept(existing.current),
              generation: old.context.generation,
              matchKey: old.matchKey,
              maxDataPoints: old.maxDataPoints,
            };
          }
          existing.demand = demand;
          existing.current = LOADING;
          existing.shown = undefined;
          watch(existing);
          changed = true;
          continue;
        }
        if (!members) {
          members = new Map();
          groups.set(groupKey, members);
        }
        const entry: Entry = {
          key: entryKey(owner, group, demand.cellId, demand.query.id),
          pair,
          demand,
          current: LOADING,
          release: () => {},
          token: 0,
        };
        members.set(pair, entry);
        watch(entry);
        changed = true;
      }
      if (members && !members.size) {
        groups.delete(groupKey);
        // the memoised frames of the group and of an owner without groups hold the last results: drop them
        frames.delete(groupKey);
        if (![...groups.keys()].some((key) => key.startsWith(`${owner}${SEP}`))) {
          frames.delete(owner);
        }
      }
      if (changed) {
        notify();
      }
    },
    frame(owner, group) {
      const frameKey = group === undefined ? `${owner}` : `${owner}${SEP}${group}`;
      const cached = frames.get(frameKey);
      if (cached && cached.version === version) {
        return cached.frame;
      }
      const shown = new Map<string, Shown>();
      const consider = (members: Map<string, Entry>) => {
        for (const [pair, entry] of members) {
          const next = shownOf(entry);
          const previous = shown.get(pair);
          if (!previous || (!settled(previous.snapshot) && settled(next.snapshot))) {
            shown.set(pair, next);
          }
        }
      };
      if (group === undefined) {
        for (const [groupKey, members] of groups) {
          if (groupKey.startsWith(`${owner}${SEP}`)) {
            consider(members);
          }
        }
      } else {
        const members = groups.get(frameKey);
        if (members) {
          consider(members);
        }
      }
      if (
        cached &&
        cached.shown.size === shown.size &&
        [...shown].every(([pair, value]) => cached.shown.get(pair) === value)
      ) {
        cached.version = version;
        return cached.frame;
      }
      const frame: Frame = {
        version,
        get: (cellId, queryId) => shown.get(pairKey(cellId, queryId)),
        size: shown.size,
      };
      frames.set(frameKey, { version, frame, shown });
      return frame;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const members of groups.values()) {
        for (const entry of members.values()) {
          stop(entry);
        }
      }
      groups.clear();
      frames.clear();
      notify();
    },
  };
}
