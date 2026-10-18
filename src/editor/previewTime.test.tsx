import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePreviewTime } from './preview';

afterEach(() => vi.useRealTimers());
it('reevaluates each sample-age deadline and releases timers on change and unmount', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const view = renderHook(({ deadlines }) => usePreviewTime(undefined, 1, undefined, [], deadlines), {
    initialProps: { deadlines: [2001, 3001] },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.result.current).toBe(1000);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.result.current).toBe(2001);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.result.current).toBe(3001);
  view.rerender({ deadlines: [5001] });
  expect(vi.getTimerCount()).toBe(1);
  view.rerender({ deadlines: [] });
  expect(vi.getTimerCount()).toBe(0);
  view.rerender({ deadlines: [5001] });
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
