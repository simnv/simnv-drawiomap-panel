import { applyContract, attachLinkLabels, cellMetaFromAttrs, nodeIcons, nodeParts } from '../adapter/portograph';
import type { CellEntry, CellIndex, CellMeta } from '../types';

const SHAPE_TAGS = new Set(['rect', 'path', 'ellipse', 'circle', 'polygon', 'image']);

/**
 * Parse the sanitised SVG text (HTML serialisation from sanitizeSvg) and make it the only child
 * of the container. A <template> uses the HTML parser, which handles SVG foreign content and
 * the HTML inside foreignObject labels.
 */
export function mountSvg(container: HTMLElement, svgText: string): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = svgText;
  const root = tpl.content.querySelector('svg');
  if (!root) {
    throw new Error('Not an SVG document');
  }
  container.replaceChildren(root);
  root.style.display = 'block';
  return root;
}

/** True when `el` sits inside a nested cell group below `group`. */
function insideNestedCell(el: Element, group: Element): boolean {
  let p = el.parentElement;
  while (p && p !== group) {
    if (p.hasAttribute('data-cell-id')) {
      return true;
    }
    p = p.parentElement;
  }
  return false;
}

function ownDescendants(group: Element, selector: string): Element[] {
  return Array.from(group.querySelectorAll(selector)).filter((el) => !insideNestedCell(el, group));
}

function metaAttrs(group: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(group.attributes)) {
    if (a.name.startsWith('data-meta-')) {
      attrs[a.name.slice('data-meta-'.length)] = a.value;
    }
  }
  return attrs;
}

function labelOf(group: Element): { el?: Element; text: string } {
  const text = ownDescendants(group, 'text')[0];
  if (text) {
    // A plain-text label of several lines is one <text> per line inside one draw.io label <g>, which
    // holds nothing else but an optional background <rect>. Only that <g> becomes the label.
    const parent = text.parentElement;
    const children = parent ? Array.from(parent.children) : [];
    const lines = children.filter((el) => el.localName === 'text');
    const group =
      parent?.localName === 'g' &&
      !parent.hasAttribute('data-cell-id') &&
      lines.length > 1 &&
      children.every((el) => el.localName === 'text' || el.localName === 'rect');
    const el = group ? parent! : text;
    const own = group ? lines : [text];
    return {
      el,
      text: own
        .map((l) => l.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }
  const fo = ownDescendants(group, 'foreignObject')[0];
  if (fo) {
    return { el: fo, text: (fo.textContent ?? '').replace(/\s+/g, ' ').trim() };
  }
  return { text: '' };
}

export function buildCellIndex(root: SVGSVGElement): CellIndex {
  const index: CellIndex = new Map();
  for (const group of Array.from(root.querySelectorAll('g[data-cell-id]')) as SVGGElement[]) {
    const id = group.getAttribute('data-cell-id')!;
    if (index.has(id)) {
      throw new Error(`Cell ${id} is duplicated. Assign each pasted cell a unique identity in draw.io.`);
    }
    const paths = ownDescendants(group, 'path') as SVGPathElement[];
    // draw.io edge polylines carry fill="none" AND pointer-events="stroke"; stencil outlines have fill="none" only.
    const line = paths.find((p) => p.getAttribute('fill') === 'none' && p.getAttribute('pointer-events') === 'stroke');
    const arrows = line ? paths.filter((p) => p !== line && p.getAttribute('pointer-events') === 'all') : [];
    const ends = line
      ? (ownDescendants(group, 'ellipse, circle').filter(
          (el) => !el.closest('switch, foreignObject')
        ) as SVGGraphicsElement[])
      : [];
    let shape: SVGGraphicsElement | undefined;
    if (!line) {
      shape = ownDescendants(group, Array.from(SHAPE_TAGS).join(',')).find(
        (el) => SHAPE_TAGS.has(el.localName) && !el.closest('switch, foreignObject')
      ) as SVGGraphicsElement | undefined;
    }
    const label = labelOf(group);
    const meta = cellMetaFromAttrs(id, metaAttrs(group), !!line, label.text || undefined);
    const entry: CellEntry = {
      meta,
      group,
      shape,
      line,
      arrows,
      ends,
      label: label.el,
      original: {
        fill: shape?.style.fill,
        stroke: shape?.style.stroke ?? line?.style.stroke,
        strokeWidth: (line ?? (shape as SVGElement | undefined))?.style.strokeWidth,
        text: label.text,
        labelNodes: label.el && Array.from(label.el.childNodes, (n) => n.cloneNode(true)),
      },
    };
    index.set(id, entry);
  }
  const metas = cellMetas(index);
  // pg-schema: no schema makes all cells generic. The Diagram options show the warning for another version.
  applyContract(metas);
  attachLinkLabels(metas);
  const icons = nodeIcons(metas);
  const owners = nodeParts(metas);
  for (const entry of index.values()) {
    if (entry.meta.kind === 'node') {
      entry.iconId = icons.get(entry.meta.key);
    }
    entry.ownerId = owners.get(entry.meta.id);
  }
  return index;
}

export function cellMetas(index: CellIndex): CellMeta[] {
  return Array.from(index.values(), (e) => e.meta);
}
