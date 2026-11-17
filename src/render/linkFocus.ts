import type { CellIndex } from '../types';

/** The root while a link has the focus: the panel CSS shows the focus layer. */
export const FOCUS_ACTIVE = 'dmap-link-focus';
/** The last layer of the root: a scrim over the whole diagram, and copies of the kept elements above it. */
export const FOCUS_LAYER = 'dmap-link-focus-layer';
export const FOCUS_SCRIM = 'dmap-link-focus-scrim';

const NS = 'http://www.w3.org/2000/svg';
/** The scrim covers any view: the view box of a diagram is far smaller. */
const FAR = 1e6;

/** The focus layer of a root, made at the first focus: hidden by the panel CSS until the root has FOCUS_ACTIVE. */
function focusLayer(root: SVGSVGElement): SVGGElement {
  let layer = root.querySelector<SVGGElement>(`:scope > g.${FOCUS_LAYER}`);
  if (!layer) {
    layer = document.createElementNS(NS, 'g');
    layer.setAttribute('class', FOCUS_LAYER);
    layer.setAttribute('pointer-events', 'none');
    layer.setAttribute('aria-hidden', 'true');
    const scrim = document.createElementNS(NS, 'rect');
    scrim.setAttribute('class', FOCUS_SCRIM);
    scrim.setAttribute('x', String(-FAR));
    scrim.setAttribute('y', String(-FAR));
    scrim.setAttribute('width', String(2 * FAR));
    scrim.setAttribute('height', String(2 * FAR));
    layer.appendChild(scrim);
  }
  if (root.lastElementChild !== layer) {
    root.appendChild(layer);
  }
  return layer;
}

/** The nearest cell group that holds `el`, or null. */
function cellAbove(el: Element): Element | null {
  let p = el.parentElement;
  while (p && !p.hasAttribute('data-cell-id')) {
    p = p.parentElement;
  }
  return p;
}

/** The cells that stay bright: the given cells (`focusMap` adds the node of a port) and the parts of each. */
function keptGroups(index: CellIndex, cellId: string, ends: readonly string[]): Element[] {
  const kept = new Set([cellId, ...ends]);
  const out: Element[] = [];
  for (const id of kept) {
    const group = index.get(id)?.group;
    if (group) {
      out.push(group);
    }
  }
  // the parts outside their cell (an icon, a description, a link label cell)
  for (const entry of index.values()) {
    if (entry.ownerId !== undefined && kept.has(entry.ownerId)) {
      out.push(entry.group);
    }
  }
  // a kept cell inside another kept cell is drawn with it
  const set = new Set(out);
  return [...set].filter((g) => {
    for (let p = g.parentElement; p; p = p.parentElement) {
      if (set.has(p)) {
        return false;
      }
    }
    return true;
  });
}

/** The attributes that a copy must not carry: the hit test, the ids and the screen reader see only the original. */
const COPY_DROPPED = ['id', 'data-cell-id', 'data-dmap-cell', 'role', 'tabindex', 'aria-label'];

/**
 * A clone of `el` in the focus layer, in the place of the original: the transforms of its ancestors apply. A clone,
 * not a `<use>`: a `<use>` instance does not draw a `foreignObject` (an HTML label), and its elements keep their own
 * `pointer-events`, so they would take the pointer from the cells below. The panel CSS gives each clone element
 * `pointer-events: none`.
 */
function copyOf(el: Element, m: DOMMatrix | null): Element {
  const copy = el.cloneNode(true) as Element;
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of COPY_DROPPED) {
      node.removeAttribute(name);
    }
    // a link in a label is no second tab stop (an <image> keeps its href: it is the picture)
    if (node.localName === 'a') {
      node.removeAttribute('href');
      node.removeAttribute('xlink:href');
    }
  }
  if (m && !m.isIdentity) {
    const wrap = document.createElementNS(NS, 'g');
    wrap.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    wrap.appendChild(copy);
    return wrap;
  }
  return copy;
}

/** The transform from the parent of `el` to the focus layer (`to`: the screen transform of the layer). */
function placeOf(el: Element, to: DOMMatrix | null): DOMMatrix | null {
  const parent = el.parentElement as unknown as SVGGraphicsElement | null;
  const from = typeof parent?.getCTM === 'function' ? parent.getCTM() : null;
  return from && to ? to.inverse().multiply(from) : null;
}

/** The focus of each root, so that a paint can draw the copies again with the new state of the cells. */
const focused = new WeakMap<SVGSVGElement, { index: CellIndex; cellId: string; ends: readonly string[] }>();

/**
 * Dims the diagram around the cell `cellId` (a link or a node) and the cells kept with it (`ends`: for a link its two
 * ends, for a node its links and their other ends). One scrim in the panel colour covers the whole diagram, and
 * copies of the kept cells, their parts and the value labels of the kept links are drawn above it. The
 * cost grows with the kept cells (a node with many links keeps them all), not with the cells that dim: no class goes
 * on the other cells, so the browser restyles and repaints no other cell. The copies take no pointer: the hover still hits the cells
 * below. Undefined, or a cell not in the index, clears.
 */
export function focusCells(
  root: SVGSVGElement,
  index: CellIndex,
  cellId: string | undefined,
  ends: readonly string[] = []
): void {
  const existing = root.querySelector(`:scope > g.${FOCUS_LAYER}`);
  while (existing && existing.lastElementChild && !existing.lastElementChild.classList.contains(FOCUS_SCRIM)) {
    existing.lastElementChild.remove();
  }
  if (cellId === undefined || !index.has(cellId)) {
    focused.delete(root);
    root.classList.remove(FOCUS_ACTIVE);
    return;
  }
  focused.set(root, { index, cellId, ends });
  const layer = focusLayer(root);
  // a label layer hidden at this zoom (too small to read) keeps the labels of the link hidden too
  const ids = new Set([cellId, ...ends]);
  const labels = [...root.querySelectorAll('text[data-dmap-cell]')].filter(
    (t) => ids.has(t.getAttribute('data-dmap-cell') ?? '') && t.parentElement?.getAttribute('visibility') !== 'hidden'
  );
  // all transforms first, then all writes: a node with many links forces one layout, not one for each copy
  const to = typeof layer.getCTM === 'function' ? layer.getCTM() : null;
  const kept = [...keptGroups(index, cellId, ends), ...labels].map((el) => ({ el, m: placeOf(el, to) }));
  const batch = document.createDocumentFragment();
  for (const { el, m } of kept) {
    batch.appendChild(copyOf(el, m));
  }
  layer.appendChild(batch);
  root.classList.add(FOCUS_ACTIVE);
}

/**
 * Draws the copies of the focused cells again after a paint: the copies show the new colours, widths and value labels.
 * A new index (a new diagram) clears the focus.
 */
export function refreshFocus(root: SVGSVGElement, index: CellIndex): void {
  const f = focused.get(root);
  if (f) {
    focusCells(root, index, f.index === index ? f.cellId : undefined, f.ends);
  }
}

/**
 * The node that holds the cell, or the cell itself when it is a node: the `parents` of the edge ends (the node of a
 * port by `pg-node`, the container in the XML), else the nesting of the cell groups.
 */
function nodeOf(index: CellIndex, parents: ReadonlyMap<string, string>, id: string): string | undefined {
  let cell: string | null | undefined = id;
  for (let depth = 0; cell && depth < 32; depth++) {
    if (index.get(cell)?.meta.kind === 'node') {
      return cell;
    }
    const group: SVGGElement | undefined = index.get(cell)?.group;
    cell = parents.get(cell) ?? (group ? cellAbove(group)?.getAttribute('data-cell-id') : undefined);
  }
  return undefined;
}

/**
 * The cells that stay bright with a hovered cell, from the ends of the links (`ends`: link id to its source and
 * target cell; `parents`: the node of a port, the container of a cell). A link keeps its two ends. A node, a port or
 * another cell keeps the links that end on it (a node also those that end on its ports) and their other ends. An end
 * that is a port brings the node that holds it. Built once for a diagram; each call is a map lookup.
 */
export function focusMap(
  index: CellIndex,
  ends: ReadonlyMap<string, { source?: string; target?: string }>,
  parents: ReadonlyMap<string, string> = new Map()
): (cellId: string) => string[] {
  const links = new Map<string, string[]>();
  const attach = (cell: string, link: string) => {
    const list = links.get(cell);
    if (list) {
      list.push(link);
    } else {
      links.set(cell, [link]);
    }
  };
  // each end with the node that holds it
  const endCells = new Map<string, string[]>();
  for (const [link, { source, target }] of ends) {
    const cells = new Set<string>();
    for (const end of new Set([source, target])) {
      if (end === undefined) {
        continue;
      }
      cells.add(end);
      attach(end, link);
      const node = nodeOf(index, parents, end);
      if (node !== undefined && node !== end) {
        cells.add(node);
        attach(node, link);
      }
    }
    endCells.set(link, [...cells]);
  }
  return (cellId) => {
    if (ends.has(cellId)) {
      return endCells.get(cellId) ?? [];
    }
    const attached = links.get(cellId) ?? [];
    return [...new Set([...attached, ...attached.flatMap((l) => endCells.get(l) ?? [])])];
  };
}
