import type { CellIndex, CellPatch, PatchMap } from '../types';

/**
 * The nearest patched cell at or above `target`. Overlay elements point at their cell with data-dmap-cell.
 * With the index, an icon cell resolves to its node.
 */
export function patchAt(
  target: EventTarget | null,
  stop: Element,
  patches: PatchMap,
  index?: CellIndex
): CellPatch | undefined {
  let el = target instanceof Element ? target : null;
  while (el && el !== stop) {
    const id = el.getAttribute('data-dmap-cell') ?? el.getAttribute('data-cell-id');
    if (id) {
      const owner = index?.get(id)?.ownerId;
      const p = patches.get(id) ?? (owner ? patches.get(owner) : undefined);
      if (p) {
        return p;
      }
    }
    el = el.parentElement;
  }
  return undefined;
}
