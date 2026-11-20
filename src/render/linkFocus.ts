import { alphaOf } from '../binding/color';
import type { CellIndex } from '../types';
import { markNearLink } from './overlay';

/** The root while a link has the focus: the panel CSS shows the focus layer. */
export const FOCUS_ACTIVE = 'dmap-link-focus';
/** The last layer of the root: a scrim over the whole diagram, and copies of the kept elements above it. */
export const FOCUS_LAYER = 'dmap-link-focus-layer';
export const FOCUS_SCRIM = 'dmap-link-focus-scrim';
/** The HTML layer of the chart regions in the stage (ChartLayer): a sibling of the root svg. */
export const CHART_LAYER_ATTR = 'data-dmap-chart-layer';
/** A chart region of a kept cell: it does not fade with the focus. */
export const FOCUS_KEPT = 'dmap-focus-kept';
/** The panel wrapper while the focus must not show (in the mode `on`, Shift down with no hover card; in `off`, no Shift): the CSS hides it. */
export const FOCUS_HIDDEN_ATTR = 'data-dmap-focus-hidden';

/**
 * Marks the chart regions of the kept cells (`data-dmap-cell` in `ids`), and clears the others. The chart layer is a
 * child of the stage: a search of the whole stage would go through each element of the svg at each hover.
 */
function markKeptCharts(root: SVGSVGElement, ids: ReadonlySet<string>): void {
  for (const layer of root.parentElement?.children ?? []) {
    if (!layer.hasAttribute(CHART_LAYER_ATTR)) {
      continue;
    }
    for (const region of layer.querySelectorAll('[data-dmap-chart]')) {
      region.classList.toggle(FOCUS_KEPT, ids.has(region.getAttribute('data-dmap-cell') ?? ''));
    }
  }
}

const NS = 'http://www.w3.org/2000/svg';
/** The scrim covers any view: the view box of a diagram is far smaller. */
const FAR = 1e6;

/** An rgb colour as a computed style writes it: `rgb(r, g, b)`, `rgb(r g b)`, `rgba(r, g, b, a)` or `rgb(r g b / a)`. */
const RGB = /^rgba?\(\s*[\d.]+(?:\s*,\s*|\s+)[\d.]+(?:\s*,\s*|\s+)[\d.]+(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i;

/**
 * The page colour of the diagram: the computed `background-color` of the root svg (draw.io writes the page background
 * there; the browser has resolved `light-dark()`), when it is an opaque rgb colour. Undefined for none (transparent)
 * or a value that cannot be read.
 */
export function pageColour(root: SVGSVGElement): string | undefined {
  const value = typeof getComputedStyle === 'function' ? getComputedStyle(root).backgroundColor.trim() : '';
  return RGB.test(value) && alphaOf(value) === 1 ? value : undefined;
}

/** The focus layer of a root, or null: a child of the root, the last one unless a layer came after it. */
function existingLayer(root: SVGSVGElement): SVGGElement | null {
  const isLayer = (c: Element | null) => c?.localName === 'g' && c.classList.contains(FOCUS_LAYER);
  const last = root.lastElementChild;
  if (isLayer(last)) {
    return last as SVGGElement;
  }
  for (const c of root.children) {
    if (isLayer(c)) {
      return c as SVGGElement;
    }
  }
  return null;
}

/** The focus layer of a root, made at the first focus: hidden by the panel CSS until the root has FOCUS_ACTIVE. */
function focusLayer(root: SVGSVGElement, existing: SVGGElement | null): SVGGElement {
  let layer = existing;
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
const COPY_DROPPED = new Set([
  'id',
  'data-cell-id',
  'data-dmap-cell',
  'role',
  'tabindex',
  'aria-label',
  'pointer-events',
]);

/**
 * A clone of `el` in the focus layer, in the place of the original: the transforms of its ancestors apply. A clone,
 * not a `<use>`: a `<use>` instance does not draw a `foreignObject` (an HTML label), and its elements keep their own
 * `pointer-events`, so they would take the pointer from the cells below. The copy has no `pointer-events` of its own
 * (no attribute and no inline style; the sanitiser removes each `<style>` of a diagram), so each of its elements
 * inherits the `none` of the focus layer.
 */
function copyOf(el: Element, m: DOMMatrix | null): Element {
  const copy = el.cloneNode(true) as Element;
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    // one pass over the attributes of the node, not one lookup for each dropped name
    for (const name of node.getAttributeNames()) {
      if (COPY_DROPPED.has(name)) {
        node.removeAttribute(name);
      }
    }
    // draw.io writes `pointer-events: all` in the style of an HTML label
    if (/pointer-events/i.test(node.getAttribute('style') ?? '')) {
      (node as HTMLElement | SVGElement).style.removeProperty('pointer-events');
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

/** The transform from the parent of `el` to the focus layer (`back`: the inverse of the screen transform of the layer). */
function placeOf(el: Element, back: DOMMatrix | null): DOMMatrix | null {
  const parent = el.parentElement as unknown as SVGGraphicsElement | null;
  const from = typeof parent?.getCTM === 'function' ? parent.getCTM() : null;
  return from && back ? back.multiply(from) : null;
}

/**
 * The value labels of the cells `ids` (linkLabels: a `text` with `data-dmap-cell` in a layer of the root), and the
 * number of hidden layers of the root. A label layer hidden at this zoom (too small to read) keeps the labels of the
 * link hidden too. Only the layers of the root and their children are read, not the whole svg.
 */
function valueLabels(root: SVGSVGElement, layer: Element, ids: ReadonlySet<string>) {
  const labels: Element[] = [];
  let hidden = 0;
  for (const group of root.children) {
    if (group === layer) {
      continue;
    }
    if (group.getAttribute('visibility') === 'hidden') {
      hidden++;
      continue;
    }
    for (const t of group.children) {
      if (t.localName === 'text' && ids.has(t.getAttribute('data-dmap-cell') ?? '')) {
        labels.push(t);
      }
    }
  }
  return { labels, hidden };
}

/** The number of hidden layers of the root (the label layer at a small zoom): a change shows or hides the labels. */
function hiddenLayers(root: SVGSVGElement, layer: Element | null): number {
  let hidden = 0;
  for (const group of root.children) {
    if (group !== layer && group.getAttribute('visibility') === 'hidden') {
      hidden++;
    }
  }
  return hidden;
}

/**
 * Gives the root FOCUS_ACTIVE or takes it away, only when that changes: `classList.add` of a class that is there still
 * writes the attribute, and the observers of the svg (the chart layer) run for each such write.
 */
function setActive(root: SVGSVGElement, on: boolean): void {
  if (root.classList.contains(FOCUS_ACTIVE) !== on) {
    root.classList.toggle(FOCUS_ACTIVE, on);
  }
}

/** Removes the copies from the focus layer; the scrim stays. */
function clearCopies(layer: SVGGElement | null): void {
  while (layer?.lastElementChild && !layer.lastElementChild.classList.contains(FOCUS_SCRIM)) {
    layer.lastElementChild.remove();
  }
}

/**
 * The focus of each root, so that a paint can draw the copies again with the new state of the cells. `hidden`: the
 * hidden layers of the root when the copies were made (see followView).
 */
const focused = new WeakMap<
  SVGSVGElement,
  { index: CellIndex; cellId: string; ends: readonly string[]; hidden: number }
>();

/**
 * Dims the diagram around the cell `cellId` (a link or a node) and the cells kept with it (`ends`: for a link its two
 * ends, for a node its links and their other ends). One scrim covers the whole diagram, in the page colour of the
 * diagram (else the panel CSS gives the panel colour), so the diagram fades toward its own background, and
 * copies of the kept cells, their parts and the value labels of the kept links are drawn above it. The
 * cost grows with the kept cells (a node with many links keeps them all), not with the cells that dim: no class goes
 * on the other cells, so the browser restyles and repaints no other cell. The copies take no pointer: the hover still hits the cells
 * below. Undefined, or a cell not in the index, clears.
 *
 * All reads come before all writes (the page colour, the kept elements and their transforms; then the copies, the
 * scrim colour and the classes), so a call forces at most one style and layout pass, not one for each read: none
 * when the layout is clean at the call, one at the first read when a write before it left the layout dirty (a new
 * focus layer; the hover writes its near mark after this call). A class or a colour that does not change is not
 * written again.
 */
export function focusCells(
  root: SVGSVGElement,
  index: CellIndex,
  cellId: string | undefined,
  ends: readonly string[] = []
): void {
  const existing = existingLayer(root);
  if (cellId === undefined || !index.has(cellId)) {
    clearCopies(existing);
    focused.delete(root);
    setActive(root, false);
    markKeptCharts(root, new Set());
    return;
  }
  // the one write before the reads, and only at the first focus or after a new label layer: the layer goes last
  const layer = focusLayer(root, existing);
  // a scrim in the page colour looks the same as the cells at 25% opacity, at the cost of one rect: opacity on the
  // large groups of the diagram makes the browser draw them again at each repaint
  const fill = pageColour(root) ?? '';
  const ids = new Set([cellId, ...ends]);
  const { labels, hidden } = valueLabels(root, layer, ids);
  const to = typeof layer.getCTM === 'function' ? layer.getCTM() : null;
  const back = to ? to.inverse() : null;
  const kept = [...keptGroups(index, cellId, ends), ...labels].map((el) => ({ el, m: placeOf(el, back) }));
  // the writes
  const batch = document.createDocumentFragment();
  for (const { el, m } of kept) {
    batch.appendChild(copyOf(el, m));
  }
  clearCopies(layer);
  const scrim = layer.firstElementChild as SVGElement | null;
  if (scrim?.classList.contains(FOCUS_SCRIM) && scrim.style.getPropertyValue('fill') !== fill) {
    scrim.style.setProperty('fill', fill || null);
  }
  layer.appendChild(batch);
  markKeptCharts(root, ids);
  setActive(root, true);
  focused.set(root, { index, cellId, ends, hidden });
}

/**
 * A new view (a pan, a zoom, a new size) with the focus on `cellId`: the copies lie in the svg, so they move with the
 * view box and stay. Only a layer of the root that shows or hides at the new zoom (the value labels) draws them again:
 * the copies of the labels, and the cuts in the strokes under the labels. False when the root has no focus on
 * `cellId`.
 */
export function followView(root: SVGSVGElement, cellId: string): boolean {
  const f = focused.get(root);
  if (f?.cellId !== cellId) {
    return false;
  }
  if (hiddenLayers(root, existingLayer(root)) !== f.hidden) {
    focusCells(root, f.index, f.cellId, f.ends);
  }
  return true;
}

/**
 * The near mark and the focus of the hovered cell `id` (undefined: none) under `root`; true when `id` is a link. With
 * no focus map (`focusOf` undefined) only the near mark changes. The focus comes first: it reads the layout (the page
 * colour and the transforms) before it writes, and the near class written before those reads would force a layout at
 * each hover switch. So the copies of a new focus do not carry the near class of their link: that is right only while
 * no CSS styles the near class (NEAR_CLASS); a rule for it would need the class in the copies too.
 */
export function markHover(
  root: SVGSVGElement,
  index: CellIndex,
  id: string | undefined,
  focusOf: ((cellId: string) => string[]) | undefined
): boolean {
  const link = id !== undefined && !!index.get(id)?.line;
  if (focusOf) {
    // a cell with no links (a chart, a free shape) dims nothing
    const kept = id === undefined ? [] : focusOf(id);
    focusCells(root, index, link || kept.length ? id : undefined, kept);
  }
  markNearLink(root, link ? id : undefined);
  return link;
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
 * Draws the copies of the focused cells again after a change in the cells with no paint (the cuts in the strokes
 * after a late web font): the copies keep the old state until then, also while a pinned card keeps the focus.
 */
export function redrawFocus(root: SVGSVGElement): void {
  const f = focused.get(root);
  if (f) {
    focusCells(root, f.index, f.cellId, f.ends);
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
