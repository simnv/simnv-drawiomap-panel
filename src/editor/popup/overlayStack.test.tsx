import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isTop, pop, push, useOverlay } from './overlayStack';

describe('overlayStack', () => {
  it('keeps the order of two entries', () => {
    push('a');
    push('b');
    expect(isTop('b')).toBe(true);
    expect(isTop('a')).toBe(false);
    pop('b');
    expect(isTop('a')).toBe(true);
    pop('a');
    expect(isTop('a')).toBe(false);
  });

  it('pops out of order and keeps the others', () => {
    push('a');
    push('b');
    push('c');
    pop('b');
    expect(isTop('c')).toBe(true);
    pop('c');
    expect(isTop('a')).toBe(true);
    pop('a');
  });

  it('ignores a pop of an unknown id', () => {
    push('a');
    pop('missing');
    expect(isTop('a')).toBe(true);
    pop('a');
  });

  it('pushes on mount and pops on unmount', () => {
    const outer = renderHook(() => useOverlay('outer'));
    const inner = renderHook(() => useOverlay('inner'));
    expect(isTop('inner')).toBe(true);
    inner.unmount();
    expect(isTop('outer')).toBe(true);
    outer.unmount();
    expect(isTop('outer')).toBe(false);
  });
});
