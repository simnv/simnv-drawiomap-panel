import { describe, expect, it, vi } from 'vitest';
import { clearOwnedAttrs, setOwnedAttrs } from '../../render/cellAttrs';
import type { CellEntry, CellIndex } from '../../types';
import { createEditorLayer, type StageSelection } from './editorLayer';

const NS = 'http://www.w3.org/2000/svg';

function makeIndex(count: number): CellIndex {
  const index: CellIndex = new Map();
  for (let i = 0; i < count; i++) {
    const group = document.createElementNS(NS, 'g') as SVGGElement;
    group.setAttribute('data-cell-id', `c${i}`);
    if (i % 5 === 0) {
      // A diagram value that the layer must hide, and bring back on clear.
      group.setAttribute('tabindex', '-1');
    }
    if (i % 7 === 0) {
      // A lower layer that writes the same names.
      setOwnedAttrs(group, 'applier', { role: 'img', 'aria-label': `applier ${i}` });
    }
    index.set(`c${i}`, { meta: { id: `c${i}` }, group, arrows: [] } as unknown as CellEntry);
  }
  return index;
}

/** The old effect: one full sweep of the index with `includes`. */
function fullSweep(index: CellIndex, s: StageSelection) {
  const { selected, affected, highlight, lighter, primary, extra, missed } = s;
  for (const [id, cell] of index) {
    setOwnedAttrs(cell.group, 'editor', {
      tabindex: '0',
      role: 'button',
      'aria-label': `${id} diagram element`,
      'data-dmap-selected': selected.includes(id) ? 'true' : 'false',
      'data-dmap-primary': id === primary ? 'true' : 'false',
      'data-dmap-extra': extra?.includes(id) ? 'true' : 'false',
      'data-dmap-missed': missed?.includes(id) ? 'true' : 'false',
      'data-dmap-affected': affected.includes(id) ? 'true' : 'false',
      'data-dmap-highlight': highlight.includes(id) ? 'true' : 'false',
      'data-dmap-lighter': lighter?.includes(id) ? 'true' : 'false',
    });
  }
}

/** Every attribute of every cell, in a stable order. */
function dump(index: CellIndex): string[] {
  return [...index.values()].map((cell) =>
    Array.from(cell.group.attributes)
      .map((a) => `${a.name}=${a.value}`)
      .sort()
      .join(' ')
  );
}

/** A small seeded random generator, so a failure repeats. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('createEditorLayer', () => {
  it('gives the DOM of a full sweep after any sequence of selections', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rnd = random(seed);
      const count = 40;
      const a = makeIndex(count);
      const b = makeIndex(count);
      const layer = createEditorLayer(a);
      // Some ids are not in the index; the layer skips them.
      const pickIds = (chance: number) =>
        Array.from({ length: count + 5 }, (_, i) => `c${i}`).filter(() => rnd() < chance);
      const maybe = <T,>(value: T): T | undefined => (rnd() < 0.5 ? value : undefined);
      for (let step = 0; step < 150; step++) {
        const roll = rnd();
        if (roll < 0.05) {
          // A new index life: the stage clears the layer, then the next apply writes every cell.
          layer.clear();
          b.forEach((cell) => clearOwnedAttrs(cell.group, 'editor'));
          expect(dump(a)).toEqual(dump(b));
        }
        const chance = roll < 0.3 ? 0.4 : 0.06;
        const selected = pickIds(chance);
        const selection: StageSelection = {
          selected,
          primary: maybe(selected[selected.length - 1] ?? `c${Math.floor(rnd() * count)}`),
          extra: maybe(pickIds(chance)),
          missed: maybe(pickIds(chance)),
          affected: pickIds(chance),
          highlight: pickIds(chance),
          lighter: maybe(pickIds(chance)),
        };
        layer.apply(selection);
        fullSweep(b, selection);
        expect(dump(a)).toEqual(dump(b));
      }
    }
  });

  it('gives the DOM of a full sweep when the same selection applies twice and when it empties', () => {
    const a = makeIndex(10);
    const b = makeIndex(10);
    const layer = createEditorLayer(a);
    const empty: StageSelection = { selected: [], affected: [], highlight: [] };
    const some: StageSelection = { selected: ['c1', 'c2'], primary: 'c2', affected: ['c3'], highlight: ['c4'] };
    for (const s of [empty, some, some, empty, empty, some]) {
      layer.apply(s);
      fullSweep(b, s);
      expect(dump(a)).toEqual(dump(b));
    }
  });

  it('writes only the cells in the union of the old and the new tagged cells', () => {
    const index = makeIndex(300);
    const layer = createEditorLayer(index);
    const none: StageSelection = { selected: [], affected: [], highlight: [] };
    layer.apply(none);
    const spy = vi.spyOn(Element.prototype, 'setAttribute');
    // The click selects c10: one cell changes.
    layer.apply({ ...none, selected: ['c10'], primary: 'c10' });
    // The next click moves the selection to c20: two cells change.
    layer.apply({ ...none, selected: ['c20'], primary: 'c20' });
    // The selection empties: one cell changes.
    layer.apply(none);
    const writes = spy.mock.calls.length;
    spy.mockRestore();
    // 10 attributes per written cell. A full sweep would write 300 cells x 10 attributes x 3 applies.
    expect(writes).toBeLessThanOrEqual(10 * (1 + 2 + 1));
    expect(index.get('c10')!.group.getAttribute('data-dmap-selected')).toBe('false');
    expect(index.get('c20')!.group.getAttribute('data-dmap-selected')).toBe('false');
  });

  it('removes the layer on clear and brings back the values of the diagram', () => {
    const index = makeIndex(8);
    const before = dump(index);
    const layer = createEditorLayer(index);
    layer.apply({ selected: ['c1'], primary: 'c1', affected: ['c2'], highlight: ['c3'] });
    expect(index.get('c1')!.group.getAttribute('data-dmap-selected')).toBe('true');
    layer.clear();
    expect(dump(index)).toEqual(before);
  });
});
