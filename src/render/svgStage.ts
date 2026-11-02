import { assignTitles } from '../adapter/cellTitle';
import { applyContract, attachLinkLabels, cellMetaFromAttrs, nodeIcons, nodeParts } from '../adapter/portograph';
import { markerEnd } from './geometry';
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

/** The elements of one cell group that belong to it, not to a nested cell. Every list keeps document order. */
interface OwnElements {
  path: Element[];
  /** `ellipse` and `circle`. */
  round: Element[];
  /** Every tag of SHAPE_TAGS. */
  shape: Element[];
  text: Element[];
  foreignObject: Element[];
}

const OWNED_SELECTOR = ['path', 'ellipse', 'circle', ...SHAPE_TAGS, 'text', 'foreignObject'].join(',');
const NO_ELEMENTS: OwnElements = { path: [], round: [], shape: [], text: [], foreignObject: [] };

/**
 * One pass over the SVG. Put each relevant element in the bucket of its nearest cell ancestor.
 * An element below a nested cell goes to the nested cell only. A wrapper group never scans its subtree.
 */
function bucketByOwner(root: Element): Map<Element, OwnElements> {
  const buckets = new Map<Element, OwnElements>();
  // The owner depends on the parent only. Elements with the same parent share one walk.
  const ownerOfParent = new Map<Element, Element | null>();
  const ownerOf = (parent: Element | null): Element | null => {
    if (!parent) {
      return null;
    }
    let owner = ownerOfParent.get(parent);
    if (owner === undefined) {
      owner = parent.hasAttribute('data-cell-id') ? parent : ownerOf(parent.parentElement);
      ownerOfParent.set(parent, owner);
    }
    return owner;
  };
  for (const el of Array.from(root.querySelectorAll(OWNED_SELECTOR))) {
    const owner = ownerOf(el.parentElement);
    if (!owner) {
      continue;
    }
    let bucket = buckets.get(owner);
    if (!bucket) {
      bucket = { path: [], round: [], shape: [], text: [], foreignObject: [] };
      buckets.set(owner, bucket);
    }
    const tag = el.localName;
    if (tag === 'path') {
      bucket.path.push(el);
    } else if (tag === 'ellipse' || tag === 'circle') {
      bucket.round.push(el);
    } else if (tag === 'text') {
      bucket.text.push(el);
    } else if (tag === 'foreignObject') {
      bucket.foreignObject.push(el);
    }
    if (SHAPE_TAGS.has(tag)) {
      bucket.shape.push(el);
    }
  }
  return buckets;
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

function labelOf(own: OwnElements): { el?: Element; text: string } {
  const text = own.text[0];
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
  const fo = own.foreignObject[0];
  if (fo) {
    return { el: fo, text: (fo.textContent ?? '').replace(/\s+/g, ' ').trim() };
  }
  return { text: '' };
}

export function buildCellIndex(root: SVGSVGElement): CellIndex {
  const index: CellIndex = new Map();
  const buckets = bucketByOwner(root);
  for (const group of Array.from(root.querySelectorAll('g[data-cell-id]')) as SVGGElement[]) {
    const id = group.getAttribute('data-cell-id')!;
    if (index.has(id)) {
      throw new Error(`Cell ${id} is duplicated. Assign each pasted cell a unique identity in draw.io.`);
    }
    const own = buckets.get(group) ?? NO_ELEMENTS;
    const paths = own.path as SVGPathElement[];
    // draw.io edge polylines carry fill="none" AND pointer-events="stroke"; stencil outlines have fill="none" only.
    const line = paths.find((p) => p.getAttribute('fill') === 'none' && p.getAttribute('pointer-events') === 'stroke');
    const arrows = line ? paths.filter((p) => p !== line && p.getAttribute('pointer-events') === 'all') : [];
    // Only the dot of a bare end: its centre lies on the first or the last point of the path. A circular label
    // background or a decoration on a waypoint is not an end marker.
    const ends = line
      ? own.round.flatMap((el) => {
          const end = el.closest('switch, foreignObject') ? undefined : markerEnd(line, el as SVGGraphicsElement);
          return end ? [{ el: el as SVGGraphicsElement, end }] : [];
        })
      : [];
    let shape: SVGGraphicsElement | undefined;
    if (!line) {
      shape = own.shape.find((el) => !el.closest('switch, foreignObject')) as SVGGraphicsElement | undefined;
    }
    const label = labelOf(own);
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
  assignTitles(metas);
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
