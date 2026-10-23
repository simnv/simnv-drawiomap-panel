import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHeld } from './useHeld';

describe('useHeld', () => {
  it('does not loop when the value is a new object on every render and hold is false', () => {
    let renders = 0;
    const hook = renderHook(
      ({ tick }: { tick: number }) => {
        renders++;
        return useHeld({ tick }, false);
      },
      { initialProps: { tick: 0 } }
    );
    hook.rerender({ tick: 1 });
    hook.rerender({ tick: 2 });
    expect(renders).toBe(3);
    expect(hook.result.current).toEqual({ tick: 2 });
  });

  it('keeps the first value while hold is true', () => {
    const hook = renderHook(({ tick, hold }: { tick: number; hold: boolean }) => useHeld({ tick }, hold), {
      initialProps: { tick: 0, hold: false },
    });
    const first = hook.result.current;
    hook.rerender({ tick: 1, hold: true });
    hook.rerender({ tick: 2, hold: true });
    expect(hook.result.current).toBe(first);
  });

  it('returns the live value on the render after hold turns false', () => {
    const hook = renderHook(({ tick, hold }: { tick: number; hold: boolean }) => useHeld({ tick }, hold), {
      initialProps: { tick: 0, hold: true },
    });
    hook.rerender({ tick: 1, hold: true });
    expect(hook.result.current).toEqual({ tick: 0 });
    hook.rerender({ tick: 2, hold: false });
    expect(hook.result.current).toEqual({ tick: 2 });
  });
});
