import type { CellIndex } from '../types';

/** The root while a link has the focus: the panel CSS shows the focus layer. */
export const FOCUS_ACTIVE = 'dmap-link-focus';
/** The last layer of the root: a scrim over the whole diagram, and copies of the kept elements above it. */
export const FOCUS_LAYER = 'dmap-link-focus-layer';
export const FOCUS_SCRIM = 'dmap-link-focus-scrim';

const NS = 'http://www.w3.org/2000/svg';
/** The scrim covers any view: the view box of a diagram is far smaller. */
const FAR = 1e6;
let idSeq = 0;

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

/** The cells that stay bright: the link, its ends, the node that holds a port end, and the parts of each. */
function keptGroups(index: CellIndex, cellId: string, ends: readonly string[]): Element[] {
  const kept = new Set([cellId, ...ends]);
  for (const end of ends) {
    const group = index.get(end)?.group;
    const owner = group && cellAbove(group)?.getAttribute('data-cell-id');
    // a port end: the node that holds it stays bright too
    if (owner && index.get(owner)?.meta.kind === 'node') {
      kept.add(owner);
    }
  }
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

/** A copy of `el` in the focus layer, in the place of the original: the transforms of its ancestors apply. */
function copyOf(layer: SVGGElement, el: Element): SVGUseElement {
  if (!el.id) {
    el.id = `dmap-focus-${++idSeq}`;
  }
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${el.id}`);
  const parent = el.parentElement as unknown as SVGGraphicsElement | null;
  const from = typeof parent?.getCTM === 'function' ? parent.getCTM() : null;
  const to = typeof layer.getCTM === 'function' ? layer.getCTM() : null;
  if (from && to) {
    const m = to.inverse().multiply(from);
    if (!m.isIdentity) {
      use.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    }
  }
  return use;
}

/**
 * Dims the diagram around the link `cellId`. One scrim in the panel colour covers the whole diagram, and copies
 * (`<use>`) of the link, the cells that it joins (`ends`), their parts and the value labels of the link are drawn
 * above it. The cost does not grow with the number of cells that dim: a few elements change, and no class goes on the
 * other cells, so the browser restyles and repaints no other cell. The copies take no pointer: the hover still hits
 * the cells below. Undefined, or a cell not in the index, clears.
 */
export function focusLink(
  root: SVGSVGElement,
  index: CellIndex,
  cellId: string | undefined,
  ends: readonly string[] = []
): void {
  root
    .querySelector(`:scope > g.${FOCUS_LAYER}`)
    ?.querySelectorAll('use')
    .forEach((u) => u.remove());
  if (cellId === undefined || !index.has(cellId)) {
    root.classList.remove(FOCUS_ACTIVE);
    return;
  }
  const layer = focusLayer(root);
  const labels = [...root.querySelectorAll('text[data-dmap-cell]')].filter(
    (t) => t.getAttribute('data-dmap-cell') === cellId
  );
  for (const el of [...keptGroups(index, cellId, ends), ...labels]) {
    layer.appendChild(copyOf(layer, el));
  }
  root.classList.add(FOCUS_ACTIVE);
}
