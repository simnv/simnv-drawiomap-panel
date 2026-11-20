import { describe, expect, it } from 'vitest';
import { cardReducer, createCardStore, pinnedCellOf, type CardState } from './cardState';

const at = { cellId: 'a', x: 10, y: 20 };
const hover: CardState = { ...at, pinned: false };
const pinned: CardState = { ...at, pinned: true };
const states = [null, hover, pinned];

describe('cardReducer', () => {
  it('hover opens a hover card on a cell and closes the card off all cells', () => {
    expect(cardReducer(null, { type: 'hover', at })).toEqual(hover);
    expect(cardReducer(hover, { type: 'hover', at: { cellId: 'b', x: 1, y: 2 } })).toEqual({
      cellId: 'b',
      x: 1,
      y: 2,
      pinned: false,
    });
    expect(cardReducer(hover, { type: 'hover', at: null })).toBeNull();
  });

  it('pin pins the card of a cell, moves the pin to another cell, and a pin on empty space closes it', () => {
    expect(cardReducer(null, { type: 'pin', at })).toEqual(pinned);
    expect(cardReducer(hover, { type: 'pin', at })).toEqual(pinned);
    expect(cardReducer(pinned, { type: 'pin', at: { cellId: 'b', x: 1, y: 2 } })).toEqual({
      cellId: 'b',
      x: 1,
      y: 2,
      pinned: true,
    });
    expect(cardReducer(pinned, { type: 'pin', at: null })).toBeNull();
  });

  it('leave closes a hover card and keeps a pinned card (the same object: no render)', () => {
    expect(cardReducer(hover, { type: 'leave' })).toBeNull();
    expect(cardReducer(pinned, { type: 'leave' })).toBe(pinned);
    expect(cardReducer(null, { type: 'leave' })).toBeNull();
  });

  it('outside closes a pinned card and keeps a hover card', () => {
    expect(cardReducer(pinned, { type: 'outside' })).toBeNull();
    expect(cardReducer(hover, { type: 'outside' })).toBe(hover);
    expect(cardReducer(null, { type: 'outside' })).toBeNull();
  });

  it.each(['close', 'escape', 'stale-cell', 'diagram-changed'] as const)('%s closes every card', (type) => {
    for (const state of states) {
      expect(cardReducer(state, { type })).toBeNull();
    }
  });
});

describe('createCardStore', () => {
  const at = { cellId: 'a', x: 1, y: 2 };

  it('notifies on a change of the state only', () => {
    const store = createCardStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.dispatch({ type: 'leave' });
    expect(calls).toBe(0);
    store.dispatch({ type: 'hover', at });
    expect(store.get()).toEqual({ ...at, pinned: false });
    expect(calls).toBe(1);
    off();
    store.dispatch({ type: 'close' });
    expect(calls).toBe(1);
    expect(store.get()).toBeNull();
  });

  it('adjust changes the state with no notify (a state adjustment during a render)', () => {
    const store = createCardStore();
    store.dispatch({ type: 'pin', at });
    let calls = 0;
    store.subscribe(() => calls++);
    store.adjust({ type: 'diagram-changed' });
    expect(store.get()).toBeNull();
    expect(calls).toBe(0);
  });

  it('keeps the hover-open flag that the card host writes while the state has a hover card', () => {
    const store = createCardStore();
    store.setHoverOpen(true);
    // no card: the flag of an old commit does not count
    expect(store.hoverOpen()).toBe(false);
    store.dispatch({ type: 'hover', at });
    expect(store.hoverOpen()).toBe(true);
    store.dispatch({ type: 'pin', at });
    expect(store.hoverOpen()).toBe(false);
  });

  it('an adjust that drops the hover card turns the hover-open flag off before the host commits again', () => {
    const store = createCardStore();
    store.dispatch({ type: 'hover', at });
    store.setHoverOpen(true);
    store.adjust({ type: 'stale-cell' });
    expect(store.hoverOpen()).toBe(false);
  });

  it('pinnedCellOf names only the cell of a pinned card', () => {
    expect(pinnedCellOf(null)).toBeUndefined();
    expect(pinnedCellOf({ ...at, pinned: false })).toBeUndefined();
    expect(pinnedCellOf({ ...at, pinned: true })).toBe('a');
  });
});
