import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearQuerySessions, generationOf, newQuerySession, querySession, retainQuerySession } from './session';

afterEach(() => {
  clearQuerySessions();
  vi.useRealTimers();
});

describe('query sessions', () => {
  it('gives one session per key, keeps it while held, and drops an unheld one after the grace period', () => {
    vi.useFakeTimers();
    const first = querySession('d#1', 1000);
    expect(querySession('d#1', 1000)).toBe(first);
    const release = retainQuerySession('d#1', 1000);
    const unheld = querySession('d#2', 1000);
    expect(unheld).not.toBe(first);
    // A render that never commits leaks nothing: the pending drop of an unheld session fires. A held one stays.
    vi.advanceTimersByTime(5000);
    expect(querySession('d#2', 1000)).not.toBe(unheld);
    expect(querySession('d#1', 1000)).toBe(first);
    // A remount: the old instance releases, the new one retains within the grace period.
    release();
    release();
    vi.advanceTimersByTime(999);
    const again = retainQuerySession('d#1', 1000);
    vi.advanceTimersByTime(5000);
    expect(querySession('d#1', 1000)).toBe(first);
    again();
    vi.advanceTimersByTime(1000);
    expect(querySession('d#1', 1000)).not.toBe(first);
  });

  it('keeps the generation of the current signature and starts a never-reused one on every change', () => {
    const session = newQuerySession();
    expect(generationOf(session, 'a')).toBe(1);
    expect(generationOf(session, 'a')).toBe(1);
    expect(generationOf(session, 'b')).toBe(2);
    expect(generationOf(session, 'b')).toBe(2);
    // A return to an earlier signature is a new generation, so it fetches again.
    expect(generationOf(session, 'a')).toBe(3);
  });

  it('gives 1,2,3,4 for mount A, change to B, remount A, change to B', () => {
    const session = newQuerySession();
    expect([
      generationOf(session, 'a'),
      generationOf(session, 'b'),
      generationOf(session, 'a'),
      generationOf(session, 'b'),
    ]).toEqual([1, 2, 3, 4]);
  });
});
