import { describe, expect, it, vi } from 'vitest';
import { createHighlightStore } from './highlightStore';

describe('createHighlightStore', () => {
  it('starts empty and returns the same state until a change', () => {
    const store = createHighlightStore();
    expect(store.get()).toEqual({ legend: null, rows: null });
    expect(store.get()).toBe(store.get());
  });

  it('a listener gets one call per change and none for the same value', () => {
    const store = createHighlightStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const ids = ['a', 'b'];
    store.setLegend(ids);
    expect(store.get().legend).toBe(ids);
    store.setLegend(ids);
    expect(listener).toHaveBeenCalledTimes(1);
    const marks = { members: ['a', 'b'], hits: ['a'] };
    store.setRows(marks);
    expect(store.get()).toEqual({ legend: ids, rows: marks });
    store.setRows(marks);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clear sets both to null with one call; a clear of an empty store calls nothing', () => {
    const store = createHighlightStore();
    store.setLegend(['a']);
    store.setRows({ members: ['a'], hits: ['a'] });
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear();
    expect(store.get()).toEqual({ legend: null, rows: null });
    expect(listener).toHaveBeenCalledTimes(1);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops the calls', () => {
    const store = createHighlightStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setLegend(['a']);
    expect(listener).not.toHaveBeenCalled();
  });
});
