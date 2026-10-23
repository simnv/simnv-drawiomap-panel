import { describe, expect, it } from 'vitest';
import type { DiagramConfigV2 } from '../model/config';
import type { Diagram } from '../types';
import { createDraft, type DraftAction } from './draft';
import {
  createHistory,
  MAX_DIAGRAMS,
  MAX_STEPS,
  reduceHistory,
  type HistoryAction,
  type HistoryState,
} from './history';

const config: DiagramConfigV2 = {
  version: 2,
  queries: [],
  overrides: [],
  widgets: [],
  patterns: [{ id: 'p', name: 'P', select: { kind: 'node' }, display: { label: 'Shared' } }],
};
const diagram = (n: number): Diagram => ({ xml: `x${n}`, svg: `s${n}`, hash: `h${n}`, updatedAt: '' });

const run = (state: HistoryState, actions: Array<[HistoryAction, number?]>) =>
  actions.reduce((s, [action, at]) => reduceHistory(s, action, at ?? 0), state);
const display = (label: string): DraftAction => ({ type: 'display', display: { label } });
const start = (opts?: { coalesceMs?: number }) =>
  reduceHistory(createHistory(createDraft(config, diagram(0)), opts), { type: 'select', cellId: 'a' });
const labelOf = (s: HistoryState, cellId = 'a') =>
  s.present.config.overrides.find((o) => o.cellId === cellId)?.display.label;

describe('history', () => {
  it('undoes ten edits and redoes them', () => {
    let s = start({ coalesceMs: 0 });
    for (let i = 1; i <= 10; i++) {
      s = reduceHistory(s, { type: 'display', display: { label: `v${i}` } });
    }
    expect(s.past).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      s = reduceHistory(s, { type: 'undo' });
    }
    expect(JSON.stringify(s.present.config)).toBe(JSON.stringify(s.present.saved));
    expect(s.future).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      s = reduceHistory(s, { type: 'redo' });
    }
    expect(labelOf(s)).toBe('v10');
    expect(s.future).toHaveLength(0);
  });

  it('changes nothing at the ends but the edit run', () => {
    const s = start();
    expect(reduceHistory(s, { type: 'undo' })).toEqual(s);
    expect(reduceHistory(s, { type: 'redo' })).toEqual(s);
  });

  it('ends the edit run when there is nothing to undo or redo', () => {
    // "a" is a step; an undo with an empty past does not exist here, so build the case: undo, then a key press that
    // finds nothing to undo, then an edit of the same leaf within the window must be a new step.
    let s = run(start(), [[display('a'), 1000], [{ type: 'undo' }], [{ type: 'undo' }, 1100]]);
    expect(s.session).toBeUndefined();
    s = run(s, [
      [display('x'), 1200],
      [{ type: 'redo' }, 1250],
      [display('xy'), 1300],
    ]);
    expect(s.past).toHaveLength(2);
    // A redo with an empty future ends the run as well.
    const edited = run(start(), [[display('a'), 1000]]);
    expect(edited.session).toBeDefined();
    expect(reduceHistory(edited, { type: 'redo' }, 1010).session).toBeUndefined();
  });

  it('does not count a selection or a scope change as a step', () => {
    let s = start();
    s = run(s, [
      [{ type: 'select', cellId: 'b' }],
      [{ type: 'scope', scope: 'pattern', patternId: 'p', patternIndex: 0 }],
    ]);
    expect(s.past).toHaveLength(0);
    expect(s.present.cellId).toBe('b');
    expect(s.present.scope).toBe('pattern');
  });

  it('keeps typing "abc" in one field as one step', () => {
    const s = run(start(), [
      [display('a'), 1000],
      [display('ab'), 1100],
      [display('abc'), 1200],
    ]);
    expect(s.past).toHaveLength(1);
    expect(labelOf(s)).toBe('abc');
    expect(labelOf(reduceHistory(s, { type: 'undo' }))).toBeUndefined();
  });

  it('makes two fields two steps', () => {
    const s = run(start(), [
      [display('a'), 1000],
      [{ type: 'display', display: { url: 'u' } }, 1100],
    ]);
    expect(s.past).toHaveLength(2);
  });

  it('splits a run after the window', () => {
    const s = run(start(), [
      [display('a'), 1000],
      [display('ab'), 1801],
    ]);
    expect(s.past).toHaveLength(2);
  });

  it('splits a run at a selection between keystrokes', () => {
    const s = run(start(), [
      [display('a'), 1000],
      [{ type: 'select', cellId: 'a' }, 1010],
      [display('ab'), 1020],
    ]);
    expect(s.past).toHaveLength(2);
  });

  it('splits a run when the owner changes', () => {
    const s = run(start(), [
      [display('a'), 1000],
      [{ type: 'select', cellId: 'b' }, 1010],
      [display('a'), 1020],
    ]);
    expect(s.past).toHaveLength(2);
    // Same leaf, other owner, no select in between: a pattern scope change is a scope action and splits as well.
    const t = run(start(), [
      [display('a'), 1000],
      [{ type: 'scope', scope: 'pattern', patternId: 'p', patternIndex: 0 }, 1010],
      [display('a2'), 1020],
    ]);
    expect(t.past).toHaveLength(2);
  });

  it('does not join a multi-leaf edit', () => {
    const edit: DraftAction = { type: 'display', display: { shape: { enabled: true, binding: undefined } } };
    const s = run(start(), [
      [edit, 1000],
      [edit, 1010],
    ]);
    expect(s.past).toHaveLength(2);
  });

  it('joins nothing when coalescing is off', () => {
    const s = run(start({ coalesceMs: 0 }), [
      [display('a'), 1000],
      [display('ab'), 1001],
    ]);
    expect(s.past).toHaveLength(2);
  });

  it('ends the run on undo and redo', () => {
    let s = run(start(), [
      [display('a'), 1000],
      [display('ab'), 1001],
    ]);
    s = run(s, [[{ type: 'undo' }], [{ type: 'redo' }], [display('abc'), 1002]]);
    expect(s.past).toHaveLength(2);
  });

  it('clears the history on applied and reset', () => {
    let s = run(start(), [
      [display('a')],
      [{ type: 'query', query: { id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } } }],
    ]);
    expect(s.past.length).toBeGreaterThan(0);
    const applied = reduceHistory(s, { type: 'applied' });
    expect(applied.past).toHaveLength(0);
    expect(applied.future).toHaveLength(0);
    s = reduceHistory(reduceHistory(s, { type: 'undo' }), { type: 'reset' });
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
  });

  it('makes a diagram action one step and undoes it', () => {
    const next = diagram(1);
    let s = reduceHistory(start(), { type: 'diagram', diagram: next });
    expect(s.past).toHaveLength(1);
    expect(s.present.diagram).toBe(next);
    s = reduceHistory(s, { type: 'undo' });
    expect(s.present.diagram?.hash).toBe('h0');
  });

  it('keeps the selection when it undoes, and drops a scope whose pattern is gone', () => {
    let s = start();
    s = run(s, [[{ type: 'scope', scope: 'pattern', patternId: 'p', patternIndex: 0 }], [display('x')]]);
    expect(s.present.scope).toBe('pattern');
    s = reduceHistory(s, { type: 'undo' });
    expect(s.present.scope).toBe('pattern');
    expect(s.present.cellId).toBe('a');
    // A pattern added by a step: undo removes it, so the scope falls back to the element.
    let t = start();
    t = reduceHistory(t, { type: 'pattern', pattern: { id: 'n', name: 'N', select: { kind: 'node' }, display: {} } });
    t = reduceHistory(t, { type: 'scope', scope: 'pattern', patternId: 'n', patternIndex: 1 });
    t = reduceHistory(t, { type: 'undo' });
    expect(t.present.scope).toBe('element');
    expect(t.present.patternId).toBeUndefined();
  });

  it('caps the steps at the limit', () => {
    let s = start({ coalesceMs: 0 });
    for (let i = 0; i < MAX_STEPS + 20; i++) {
      s = reduceHistory(s, display(`v${i}`));
    }
    expect(s.past).toHaveLength(MAX_STEPS);
  });

  it('coalesces typing into one field of a binding that the editor writes whole', () => {
    const binding = (field: string) => ({ queryId: 'q', match: {}, reducer: 'last' as const, field });
    const typing = (input: HistoryState) =>
      run(input, [
        [{ type: 'display', display: { shape: { binding: binding('a') } } }, 1000],
        [{ type: 'display', display: { shape: { binding: binding('ab') } } }, 1100],
        [{ type: 'display', display: { shape: { binding: binding('abc') } } }, 1200],
      ]);
    // A fresh override: the first keystroke creates the binding (many leaves), the next ones change one leaf.
    const fresh = typing(start());
    expect(fresh.past).toHaveLength(1);
    expect(fresh.present.config.overrides[0].display.shape?.binding?.field).toBe('abc');
    // An existing binding: one leaf per keystroke from the start.
    const withBinding: DiagramConfigV2 = {
      ...config,
      overrides: [{ cellId: 'a', display: { shape: { binding: binding('') } } }],
    };
    const existing = typing(reduceHistory(createHistory(createDraft(withBinding)), { type: 'select', cellId: 'a' }));
    expect(existing.past).toHaveLength(1);
    // Another leaf of the same binding is another step.
    const other = reduceHistory(
      existing,
      { type: 'display', display: { shape: { binding: { ...binding('abc'), reducer: 'max' } } } },
      1300
    );
    expect(other.past).toHaveLength(2);
    // Pattern scope.
    const pattern = typing(
      reduceHistory(start(), { type: 'scope', scope: 'pattern', patternId: 'p', patternIndex: 0 })
    );
    expect(pattern.past).toHaveLength(1);
  });

  it('keeps the diagram cap when undo and redo move steps between past and future', () => {
    const entry = (d: Diagram) => ({ ...createDraft(config, d) });
    const [d1, d2, d3, d4, d5, d6] = [1, 2, 3, 4, 5, 6].map(diagram);
    const base = createHistory(entry(d6));
    // Five distinct revisions in the past (d5 twice) and a sixth in the present.
    let s: HistoryState = { ...base, past: [d1, d2, d3, d4, d5, d5].map(entry) };
    const distinct = (x: HistoryState) => new Set([...x.past, ...x.future].map((e) => e.diagram)).size;
    expect(distinct(s)).toBe(5);
    s = reduceHistory(s, { type: 'undo' });
    expect(distinct(s)).toBeLessThanOrEqual(MAX_DIAGRAMS);
    // The oldest whole step went; the steps that stay keep their own diagram.
    expect(s.past[0].diagram).toBe(d2);
    expect(s.present.diagram).toBe(d5);
    expect(s.future.map((e) => e.diagram)).toEqual([d6]);
    // Redo into a state that would exceed it again: the cap holds on this path too.
    const wide: HistoryState = {
      ...base,
      present: entry(d5),
      past: [d1, d2, d3, d4].map(entry),
      future: [d5, d6].map(entry),
    };
    const back = reduceHistory(
      { ...wide, present: entry(d6), past: [d1, d2, d3, d4, d5].map(entry), future: [] },
      { type: 'undo' }
    );
    expect(distinct(back)).toBeLessThanOrEqual(MAX_DIAGRAMS);
    const forward = reduceHistory(back, { type: 'redo' });
    expect(distinct(forward)).toBeLessThanOrEqual(MAX_DIAGRAMS);
    expect(forward.present.diagram).toBe(d6);
  });

  it('caps the distinct diagram revisions in past and future', () => {
    let s = start();
    for (let i = 1; i <= MAX_DIAGRAMS + 3; i++) {
      s = reduceHistory(s, { type: 'diagram', diagram: diagram(i) });
    }
    const distinct = new Set([...s.past, ...s.future].map((d) => d.diagram));
    expect(distinct.size).toBeLessThanOrEqual(MAX_DIAGRAMS);
    expect(s.past.length).toBeLessThan(MAX_DIAGRAMS + 3);
    // The newest steps stay undoable.
    const undone = reduceHistory(s, { type: 'undo' });
    expect(undone.present.diagram?.hash).toBe(`h${MAX_DIAGRAMS + 2}`);
  });
});
