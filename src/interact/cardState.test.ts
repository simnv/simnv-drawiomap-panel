import { describe, expect, it } from 'vitest';
import { cardReducer, type CardState } from './cardState';

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
