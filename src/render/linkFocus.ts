import type { CellIndex } from '../types';
import { LINK_LABEL_CLASS } from './linkLabels';

/** The root while a link has the hover mark: the panel CSS dims the cells with FOCUS_DIM. */
export const FOCUS_ACTIVE = 'dmap-link-focus';
export const FOCUS_DIM = 'dmap-link-dim';

const CELL_ATTR = 'data-cell-id';

/**
 * Dims the diagram around the link `cellId`: every cell that is not the link, not one of its `ends` (the cells it
 * joins), not a part of either (a label cell, an icon) and not a container of them gets FOCUS_DIM, and so does the value label of every other link. Only the outermost cell
 * of a dimmed subtree gets the class, so a dimmed cell in a dimmed container does not fade twice. Undefined clears.
 * One pass over the index, only when the mark goes to another link.
 */
export function focusLink(
  root: SVGSVGElement,
  index: CellIndex,
  cellId: string | undefined,
  ends: readonly string[] = []
): void {
  root.classList.remove(FOCUS_ACTIVE);
  root.querySelectorAll(`.${FOCUS_DIM}`).forEach((el) => el.classList.remove(FOCUS_DIM));
  if (cellId === undefined || !index.has(cellId)) {
    return;
  }
  const kept = new Set([cellId, ...ends]);
  const keep = new Set<Element>();
  for (const [id, entry] of index) {
    if (kept.has(id) || (entry.ownerId !== undefined && kept.has(entry.ownerId))) {
      keep.add(entry.group);
    }
  }
  // the containers of a kept cell stay bright; their other cells dim on their own
  const open = new Set<Element>();
  for (const g of keep) {
    for (let p: Element | null = g.parentElement; p && p !== root; p = p.parentElement) {
      open.add(p);
    }
  }
  // the parts of a bright cell (the icon of a node that holds a kept port) stay bright
  for (const entry of index.values()) {
    const owner = entry.ownerId === undefined ? undefined : index.get(entry.ownerId)?.group;
    if (owner && open.has(owner)) {
      keep.add(entry.group);
    }
  }
  for (const entry of index.values()) {
    const g = entry.group;
    if (keep.has(g) || open.has(g) || !root.contains(g)) {
      continue;
    }
    let outer: Element | null = g.parentElement;
    while (outer && outer !== root && !outer.hasAttribute(CELL_ATTR)) {
      outer = outer.parentElement;
    }
    // a cell inside a cell that dims fades with it
    if (outer && outer !== root && !keep.has(outer) && !open.has(outer)) {
      continue;
    }
    g.classList.add(FOCUS_DIM);
  }
  root.querySelectorAll(`text.${LINK_LABEL_CLASS}`).forEach((t) => {
    if (t.getAttribute('data-dmap-cell') !== cellId) {
      t.classList.add(FOCUS_DIM);
    }
  });
  root.classList.add(FOCUS_ACTIVE);
}
