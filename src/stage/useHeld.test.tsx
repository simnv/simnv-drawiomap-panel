import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHeld } from './useHeld';

describe('useHeld', () => {
  it('returns the value while not held, and the last unheld value while held', () => {
    const { result, rerender } = renderHook(({ value, hold }: { value: number; hold: boolean }) => useHeld(value, hold), {
      initialProps: { value: 1, hold: false },
    });
    expect(result.current).toBe(1);
    rerender({ value: 2, hold: false });
    expect(result.current).toBe(2);
    rerender({ value: 3, hold: true });
    expect(result.current).toBe(2);
    rerender({ value: 4, hold: true });
    expect(result.current).toBe(2);
    rerender({ value: 4, hold: false });
    expect(result.current).toBe(4);
  });

  it('keeps the first value when held from the start', () => {
    const { result, rerender } = renderHook(({ value, hold }: { value: string; hold: boolean }) => useHeld(value, hold), {
      initialProps: { value: 'a', hold: true },
    });
    rerender({ value: 'b', hold: true });
    expect(result.current).toBe('a');
    rerender({ value: 'b', hold: false });
    expect(result.current).toBe('b');
  });
});
