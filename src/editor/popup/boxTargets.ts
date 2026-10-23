import { hoverKind } from '../../interact/hit';
import type { CellEntry, CellIndex } from '../../types';

/** The structure cells never join a band: the canvas, the layers, the groups and the legend cover many elements. */
const STRUCTURE = new Set(['canvas', 'group', 'legend']);

/**
 * A cell that holds other nodes or links is a container (a root or a layer that draw.io nests, a frame): the band
 * tests what is inside it. A node with ports, icons and labels is not a container.
 */
function holdsElements(entry: CellEntry, index: CellIndex): boolean {
  for (const nested of entry.group.querySelectorAll('g[data-cell-id]')) {
    const kind = index.get(nested.getAttribute('data-cell-id') ?? '')?.meta.kind;
    if (kind === 'node' || kind === 'link') {
      return true;
    }
  }
  return false;
}

/**
 * The cells that a box select tests, with the element whose rectangle counts. A cell that sits inside another
 * selectable cell (a port or an icon in its node) counts through that cell, whose group rectangle includes it. A
 * part outside of its owner (a link label in a layer) counts for its owner, as a click on it does.
 */
export function boxTargets(index: CellIndex): Array<{ id: string; el: Element }> {
  const targets: Array<{ id: string; el: Element }> = [];
  const selectable = (entry: CellEntry) => !STRUCTURE.has(hoverKind(entry)) && !holdsElements(entry, index);
  for (const [id, entry] of index) {
    if (!selectable(entry)) {
      continue;
    }
    let covered = false;
    for (
      let parent = entry.group.parentElement?.closest('g[data-cell-id]');
      parent && !covered;
      parent = parent.parentElement?.closest('g[data-cell-id]')
    ) {
      const outer = index.get(parent.getAttribute('data-cell-id') ?? '');
      covered = !!outer && selectable(outer);
    }
    if (!covered) {
      targets.push({ id: entry.ownerId ?? id, el: entry.group });
    }
  }
  return targets;
}
