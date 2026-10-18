import type { CellEntry, CellIndex, CellPatch, PatchMap } from '../types';

/** Resolve indexed cells even when they have no binding or rendered patch. */
export function cellAt(target: EventTarget | null, cells: CellIndex): CellEntry | undefined {
  let el = target instanceof Element ? target : null;
  while (el) {
    const id = el.getAttribute('data-dmap-cell') ?? el.getAttribute('data-cell-id');
    const cell = id ? cells.get(id) : undefined;
    if (cell) {
      return (cell.ownerId ? cells.get(cell.ownerId) : undefined) ?? cell;
    }
    el = el.parentElement;
  }
  return undefined;
}

/**
 * The nearest patched cell at or above `target`. Overlay elements point at their cell with data-dmap-cell.
 * With the index, a node part (icon, description) resolves to its node.
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
