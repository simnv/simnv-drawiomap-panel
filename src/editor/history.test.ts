import { describe, expect, it } from 'vitest';
import { history, pushVersion, undo, redo } from './history';

describe('diagram history', () => {
  it('undoes and redoes a write without changing the previous stack', () => {
    const base = history('original');
    const edited = pushVersion(base, 'edited');
    expect(undo(edited).present).toBe('original');
    expect(redo(undo(edited)).present).toBe('edited');
    expect(base.present).toBe('original');
  });

  it('holds at most 50 versions, including the current diagram', () => {
    let stack = history(0);
    for (let version = 1; version <= 60; version++) {
      stack = pushVersion(stack, version);
    }
    for (let step = 0; step < 60; step++) {
      stack = undo(stack);
    }
    expect(stack.present).toBe(11);
    for (let step = 0; step < 60; step++) {
      stack = redo(stack);
    }
    expect(stack.present).toBe(60);
  });

  it('drops redo after a new write and ignores an unchanged version', () => {
    const edited = pushVersion(history('a'), 'b');
    expect(pushVersion(edited, 'b')).toBe(edited);
    const replacement = pushVersion(undo(edited), 'c');
    expect(redo(replacement)).toBe(replacement);
    expect(undo(history('a')).present).toBe('a');
  });
});
