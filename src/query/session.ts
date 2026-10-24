import type { QueryCache } from './controller';

/**
 * The query session of one panel: the inactive result cache and the data generation. Grafana mounts a new panel
 * component when the panel enters the panel editor, when a lazy panel scrolls back into view and when a dashboard
 * re-renders its layout. The session outlives the component, so the new instance reuses the results and the
 * generation of the old one and runs no query again for the same dashboard state.
 */
export interface QuerySession {
  cache: QueryCache;
  /** The context signature of the current state. */
  signature?: string;
  /** The generation of the current state. */
  generation: number;
  /** The last generation given. It only grows, so a generation is never reused. */
  counter: number;
}

interface Slot {
  session: QuerySession;
  /** The mounted providers of the session. */
  refs: number;
  /** Drops the session when nobody holds it for the grace period. */
  timer?: ReturnType<typeof setTimeout>;
}

/** How long an unheld session keeps its results: long enough for a remount, short enough to free a left dashboard. */
export const SESSION_GRACE_MS = 60_000;

const slots = new Map<string, Slot>();

const schedule = (key: string, slot: Slot, graceMs: number) => {
  clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    if (slots.get(key) === slot && slot.refs === 0) {
      slots.delete(key);
    }
  }, graceMs);
};

/**
 * The session of a key. A missing session is created with a pending drop, so a render that never commits leaks
 * nothing. Safe during render: the same key gives the same session.
 */
export function querySession(key: string, graceMs = SESSION_GRACE_MS): QuerySession {
  let slot = slots.get(key);
  if (!slot) {
    slot = { session: newQuerySession(), refs: 0 };
    slots.set(key, slot);
    schedule(key, slot, graceMs);
  }
  return slot.session;
}

/** Hold the session while a provider is mounted. Returns the release. */
export function retainQuerySession(key: string, graceMs = SESSION_GRACE_MS): () => void {
  querySession(key, graceMs);
  const slot = slots.get(key)!;
  slot.refs++;
  clearTimeout(slot.timer);
  slot.timer = undefined;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    slot.refs--;
    if (slot.refs === 0 && slots.get(key) === slot) {
      schedule(key, slot, graceMs);
    }
  };
}

/** A session that no key holds: for a provider without a session key. */
export function newQuerySession(): QuerySession {
  return { cache: new Map(), generation: 0, counter: 0 };
}

/**
 * The generation of a context signature. The session holds one current state. The same signature keeps its
 * generation (a remount, a repeated render). A different one starts a new generation that no earlier state had, so
 * a return to an earlier value fetches again: results are reused at any age within a generation.
 */
export function generationOf(session: QuerySession, signature: string): number {
  if (session.signature === signature) {
    return session.generation;
  }
  session.counter += 1;
  session.signature = signature;
  session.generation = session.counter;
  return session.generation;
}

/** Forget every session. For tests. */
export function clearQuerySessions() {
  for (const slot of slots.values()) {
    clearTimeout(slot.timer);
  }
  slots.clear();
}
