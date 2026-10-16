import type { CellPatch, PatchMap } from '../types';

/** The nearest patched cell at or above `target`. Overlay elements point at their cell with data-dmap-cell. */
export function patchAt(target: EventTarget | null, stop: Element, patches: PatchMap): CellPatch | undefined {
  let el = target instanceof Element ? target : null;
  while (el && el !== stop) {
    const id = el.getAttribute('data-dmap-cell') ?? el.getAttribute('data-cell-id');
    if (id) {
      const p = patches.get(id);
      if (p) {
        return p;
      }
    }
    el = el.parentElement;
  }
  return undefined;
}
