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

  it('keeps the generation of a known signature and starts the next for a new one', () => {
    const session = newQuerySession();
    expect(generationOf(session, 'a')).toBe(1);
    expect(generationOf(session, 'a')).toBe(1);
    expect(generationOf(session, 'b')).toBe(2);
    // Two repeated panels with different signatures share a session without stepping on each other.
    expect(generationOf(session, 'a')).toBe(1);
    expect(generationOf(session, 'b')).toBe(2);
    for (let i = 0; i < 8; i++) {
      generationOf(session, `fill-${i}`);
    }
    // A forgotten signature gets a new generation.
    expect(generationOf(session, 'a')).toBe(11);
  });

  it('starts a never-reused generation when a mounted provider changes its signature, so a return to A fetches again', () => {
    const session = newQuerySession();
    const a = generationOf(session, 'a');
    const b = generationOf(session, 'b', 'a');
    const again = generationOf(session, 'a', 'b');
    expect([a, b, again]).toEqual([1, 2, 3]);
    // A render that runs twice for one change gives the same generation.
    expect(generationOf(session, 'a', 'b')).toBe(3);
    // A remount with the current signature continues the latest generation of it.
    expect(generationOf(session, 'a')).toBe(3);
  });
});
