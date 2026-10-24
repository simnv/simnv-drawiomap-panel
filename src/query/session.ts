import type { QueryCache } from './controller';

/**
 * The query session of one panel: the inactive result cache and the data generation. Grafana mounts a new panel
 * component when the panel enters the panel editor, when a lazy panel scrolls back into view and when a dashboard
 * re-renders its layout. The session outlives the component, so the new instance reuses the results and the
 * generation of the old one and runs no query again for the same dashboard state.
 */
export interface QuerySession {
  cache: QueryCache;
  /** The generation of each recent context signature. Repeated panels share a session with different signatures. */
  generations: Map<string, number>;
  /** The last generation given. */
  generation: number;
  /** The last change of a mounted provider, so a repeated render of the same change gives the same generation. */
  change?: { from: string; to: string; generation: number };
}

/** How many context signatures a session remembers. */
const SIGNATURES = 8;

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
  return { cache: new Map(), generations: new Map(), generation: 0 };
}

/**
 * The generation of a context signature. A mount (no `previous`) continues the generation of a known signature, so a
 * remount runs no query again. A mounted provider whose signature changed (`previous` differs) always gets a new
 * generation that no earlier context had: a return to an earlier value must fetch again, because results are reused
 * at any age within a generation. A repeated call for the same change (a render that runs twice) gives the same
 * generation.
 */
export function generationOf(session: QuerySession, signature: string, previous?: string): number {
  const known = session.generations.get(signature);
  if (known !== undefined && (previous === undefined || previous === signature)) {
    return known;
  }
  if (previous !== undefined && session.change?.from === previous && session.change.to === signature) {
    return session.change.generation;
  }
  session.generation++;
  if (previous !== undefined) {
    session.change = { from: previous, to: signature, generation: session.generation };
  }
  session.generations.delete(signature);
  session.generations.set(signature, session.generation);
  while (session.generations.size > SIGNATURES) {
    session.generations.delete(session.generations.keys().next().value!);
  }
  return session.generation;
}

/** Forget every session. For tests. */
export function clearQuerySessions() {
  for (const slot of slots.values()) {
    clearTimeout(slot.timer);
  }
  slots.clear();
}
