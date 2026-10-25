import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClock, useSampleStale } from './useSampleStale';

afterEach(() => vi.useRealTimers());

describe('useClock', () => {
  it('reads the clock again after each deadline, holds one timer, and releases it on change and unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const view = renderHook(({ deadlines }) => useClock(deadlines), { initialProps: { deadlines: [2000, 3000] } });
    expect(view.result.current).toBe(1000);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // at the deadline itself the sample is not yet past it: the test every caller makes is `now > deadline`
    expect(view.result.current).toBe(1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(view.result.current).toBe(2001);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(view.result.current).toBe(3001);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ deadlines: [5000] });
    expect(vi.getTimerCount()).toBe(1);
    view.rerender({ deadlines: [] });
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ deadlines: [5000] });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('corrects a deadline that is already passed when it arrives, in a microtask and with no timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const view = renderHook(({ deadlines }) => useClock(deadlines), { initialProps: { deadlines: [] as number[] } });
    expect(view.result.current).toBe(1000);
    vi.setSystemTime(9000);
    await act(async () => {
      view.rerender({ deadlines: [5000] });
    });
    expect(view.result.current).toBe(9000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('caps a far deadline at the largest timer delay and sets the timer again after the wake-up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const far = 2147483647 * 2;
    const view = renderHook(() => useClock([far]));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2147483647);
    });
    expect(view.result.current).toBe(2147483647);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('useSampleStale', () => {
  it('is false without a policy or a sample, and true after sampleAt + staleAfterMs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    const policy = { expectedIntervalMs: 1000, staleAfterMs: 5000 };
    expect(renderHook(() => useSampleStale(undefined, policy)).result.current).toBe(false);
    expect(renderHook(() => useSampleStale(8000)).result.current).toBe(false);
    const view = renderHook(() => useSampleStale(8000, policy));
    expect(view.result.current).toBe(false);
    act(() => vi.advanceTimersByTime(3000));
    expect(view.result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
