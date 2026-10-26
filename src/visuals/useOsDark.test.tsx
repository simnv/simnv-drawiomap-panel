import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOsDark } from './useOsDark';

/** A stub of `matchMedia` for one query: the listeners it holds, and a way to flip the preference. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => list)
  );
  return {
    list,
    listeners,
    flip(next: boolean) {
      list.matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useOsDark', () => {
  it('reads the OS preference, follows a change, and removes its listener on unmount', () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useOsDark());
    expect(result.current).toBe(false);
    expect(media.list.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    act(() => media.flip(true));
    expect(result.current).toBe(true);
    act(() => media.flip(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.list.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(media.listeners.size).toBe(0);
  });
  it('gives false and subscribes to nothing without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result, unmount } = renderHook(() => useOsDark());
    expect(result.current).toBe(false);
    unmount();
  });
});
