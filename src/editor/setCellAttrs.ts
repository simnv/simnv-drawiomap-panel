import { parseSvg } from '../render/sanitize';
import { isWritableCellAttr } from '../model/cellAttrNames';
import type { Diagram } from '../types';
import { fnv1a } from '../util/hash';
import { createXmlElement, parseXml, serializeXml } from '../util/xml';

export { attrNameProblem, isReservedAttr, META_KEY, RESERVED_META } from '../model/cellAttrNames';

/** Read the uncompressed model of page 1 without changing later pages. */
function firstModel(doc: Document): Element {
  const root = doc.documentElement;
  if (root.localName === 'mxGraphModel') {
    return root;
  }
  const page = root.localName === 'mxfile' && Array.from(root.children).find((el) => el.localName === 'diagram');
  if (page) {
    const model = Array.from(page.children).find((el) => el.localName === 'mxGraphModel');
    if (model) {
      return model;
    }
    if (page.textContent?.trim()) {
      throw new Error('Open the diagram in draw.io once and save it. Then the panel can write to it.');
    }
  }
  throw new Error('The diagram XML has no model on page 1.');
}

/** Index all cell ids so a duplicate cannot select only the first cell. */
function xmlCells(model: Element): Map<string, Element> {
  const result = new Map<string, Element>();
  for (const el of Array.from(model.querySelectorAll('object, UserObject, mxCell'))) {
    const id = el.getAttribute('id');
    if (id === null) {
      continue;
    }
    if (result.has(id)) {
      throw new Error(`Duplicate cell id on page 1: ${id}`);
    }
    result.set(id, el);
  }
  return result;
}

/** Move a bare cell's identity and label to the wrapper that draw.io uses for metadata. */
function wrapCell(cell: Element): Element {
  if (cell.localName !== 'mxCell') {
    return cell;
  }
  const wrapper = createXmlElement(cell.ownerDocument, 'object');
  wrapper.setAttribute('id', cell.getAttribute('id')!);
  wrapper.setAttribute('label', cell.getAttribute('value') ?? '');
  cell.removeAttribute('id');
  cell.removeAttribute('value');
  cell.replaceWith(wrapper);
  wrapper.appendChild(cell);
  return wrapper;
}

/** Replace all case variants with one lowercase name, or remove them all. */
function writeAttribute(el: Element, name: string, value: string | null): void {
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.toLowerCase() === name) {
      el.removeAttributeNode(attr);
    }
  }
  if (value !== null) {
    el.setAttribute(name, value);
  }
}

/** Set page 1 cell attributes in the XML and SVG, then update the content hash and time. */
export function setCellAttrs(
  d: Diagram,
  cells: ReadonlyArray<{ id: string; attrs: Record<string, string | null> }>
): Diagram {
  for (const { attrs } of cells) {
    for (const name of Object.keys(attrs)) {
      if (!isWritableCellAttr(name)) {
        throw new Error(`Invalid cell attribute name: ${name}`);
      }
    }
  }
  const doc = parseXml(d.xml);
  if (!doc) {
    throw new Error('The diagram XML does not parse.');
  }
  const index = xmlCells(firstModel(doc));
  const image = parseSvg(d.svg);
  const groups = new Map<string, Element[]>();
  for (const group of Array.from(image.querySelectorAll('g[data-cell-id]'))) {
    const id = group.getAttribute('data-cell-id')!;
    const matches = groups.get(id) ?? [];
    matches.push(group);
    groups.set(id, matches);
  }
  for (const { id, attrs } of cells) {
    const cell = index.get(id);
    if (!cell) {
      throw new Error(`Cell id is not on page 1: ${id}`);
    }
    const matches = groups.get(id);
    if (matches?.length !== 1) {
      throw new Error(`Expected one SVG cell group for id: ${id}`);
    }
    const wrapper = wrapCell(cell);
    index.set(id, wrapper);
    for (const [name, value] of Object.entries(attrs)) {
      const canonical = name.toLowerCase();
      writeAttribute(wrapper, canonical, value);
      writeAttribute(matches[0], `data-meta-${canonical}`, value);
    }
  }
  const xml = serializeXml(doc);
  const svg = new XMLSerializer().serializeToString(image);
  return { ...d, xml, svg, hash: fnv1a(svg + xml), updatedAt: new Date().toISOString() };
}
