import type { CellEntry, CellIndex, CellPatch, HoverKind, PatchMap } from '../types';

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

/** The kind of a cell for Options.hover.kinds, see HoverKind. */
export function hoverKind(cell: Pick<CellEntry, 'meta' | 'shape' | 'line' | 'label'>): HoverKind {
  const meta = cell.meta;
  if (meta.kind !== 'other') {
    return meta.kind;
  }
  const id = meta.id;
  if (id === 'pg-canvas' || id.startsWith('pg-layer~')) {
    return 'canvas';
  }
  if (id.startsWith('pg-group~') || id.startsWith('pg-groupTitle~')) {
    return 'group';
  }
  if (id.startsWith('pg-legend')) {
    return 'legend';
  }
  if (meta.attrs['pg-kind'] !== undefined || id.startsWith('pg-')) {
    return 'other';
  }
  // A plain draw.io diagram. The root and the layers draw nothing of their own.
  if (!cell.shape && !cell.line && !cell.label) {
    return 'canvas';
  }
  return meta.isEdge ? 'link' : 'node';
}

/**
 * The nearest patched cell at or above `target`. Overlay elements point at their cell with data-dmap-cell.
 * With the index, a node part (icon, description) resolves to its node. A patch that `accept` rejects does not
 * stop the walk.
 */
export function patchAt(
  target: EventTarget | null,
  stop: Element,
  patches: PatchMap,
  index?: CellIndex,
  accept: (patch: CellPatch) => boolean = () => true
): CellPatch | undefined {
  let el = target instanceof Element ? target : null;
  while (el && el !== stop) {
    const id = el.getAttribute('data-dmap-cell') ?? el.getAttribute('data-cell-id');
    if (id) {
      const owner = index?.get(id)?.ownerId;
      const p = patches.get(id) ?? (owner ? patches.get(owner) : undefined);
      if (p && accept(p)) {
        return p;
      }
    }
    el = el.parentElement;
  }
  return undefined;
}
