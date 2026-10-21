import type { CellIndex } from '../types';

export const LEGEND_ACTIVE = 'dmap-legend-active';
export const LEGEND_MEMBER = 'dmap-legend-member';
export const LEGEND_HIT = 'dmap-legend-hit';

/** The cells and their parts (icon, description, link label). */
function withParts(ids: string[], cells: CellIndex): Set<string> {
  const out = new Set(ids);
  for (const [id, entry] of cells) {
    if (entry.ownerId && out.has(entry.ownerId)) {
      out.add(id);
    }
  }
  return out;
}

/**
 * Shows the cells of a legend entry: the root gets LEGEND_ACTIVE, the cells of the legend LEGEND_MEMBER and the
 * cells of the entry LEGEND_HIT. The panel CSS dims the members that are not hits. `hits` null clears all marks.
 */
export function highlightCells(root: Element, cells: CellIndex, members: string[], hits: string[] | null): void {
  root.classList.remove(LEGEND_ACTIVE);
  root
    .querySelectorAll(`.${LEGEND_MEMBER}, .${LEGEND_HIT}`)
    .forEach((el) => el.classList.remove(LEGEND_MEMBER, LEGEND_HIT));
  if (!hits) {
    return;
  }
  root.classList.add(LEGEND_ACTIVE);
  for (const id of withParts(members, cells)) {
    cells.get(id)?.group.classList.add(LEGEND_MEMBER);
  }
  for (const id of withParts(hits, cells)) {
    cells.get(id)?.group.classList.add(LEGEND_HIT);
  }
}
