import type { CellIndex, Endpoint } from '../types';
import { parseXml } from '../util/xml';
import type { ReportEntry } from './report';

/** The draw.io ids of the cells at the two ends of an edge. */
export interface EdgeEndIds {
  source?: string;
  target?: string;
}

export interface EdgeEnds {
  /** edge cell id → its end cells */
  ends: Map<string, EdgeEndIds>;
  /**
   * cell id → the next cell to search for an end attribute: the node cell of a port, else the parent of the cell in
   * the XML (a shape inside a container). A cell below a layer has no entry: the search stops at the layer.
   */
  parents: Map<string, string>;
  report: ReportEntry[];
}

/** What `endAttr` reads: the cell index and the result of `edgeEnds` for it. */
export interface EndContext {
  index: CellIndex;
  ends: ReadonlyMap<string, EdgeEndIds>;
  parents: ReadonlyMap<string, string>;
}

type Page = { ends: Map<string, EdgeEndIds>; parents: Map<string, string> } | { error: string };

const EMPTY_PAGE: Page = { ends: new Map(), parents: new Map() };

/** Reads the edge ends and the parents of page 1 of a draw.io XML. */
function readPage(xml: string): Page {
  const doc = parseXml(xml);
  if (!doc) {
    return { error: 'the diagram XML does not parse' };
  }
  let model: Element | undefined = doc.documentElement;
  if (model.localName !== 'mxGraphModel') {
    const diagram = doc.getElementsByTagName('diagram')[0];
    if (!diagram) {
      return EMPTY_PAGE;
    }
    model = Array.from(diagram.children).find((el) => el.localName === 'mxGraphModel');
    if (!model) {
      // a page that an older version stored: the host inflates only the export of the editor (src/editor/inflate.ts)
      return diagram.textContent?.trim() ? { error: 'compressed page' } : EMPTY_PAGE;
    }
  }
  const cells = Array.from(model.getElementsByTagName('mxCell'), (cell) => {
    const wrapper = cell.parentElement;
    const wrapped = wrapper?.localName === 'object' || wrapper?.localName === 'UserObject';
    return { el: cell, id: cell.getAttribute('id') ?? (wrapped ? wrapper.getAttribute('id') : null) };
  });
  const parentOf = new Map<string, string | null>();
  for (const { el, id } of cells) {
    if (id !== null) {
      parentOf.set(id, el.getAttribute('parent'));
    }
  }
  // the root has no parent, and a layer is a child of the root: the search stops below them
  const belowLayer = (id: string) => {
    const parent = parentOf.get(id);
    return !!parent && !!parentOf.get(parent);
  };
  const page = { ends: new Map<string, EdgeEndIds>(), parents: new Map<string, string>() };
  for (const { el, id } of cells) {
    if (id === null) {
      continue;
    }
    const parent = parentOf.get(id);
    if (parent && belowLayer(parent)) {
      page.parents.set(id, parent);
    }
    if (el.getAttribute('edge') === '1') {
      const source = el.getAttribute('source');
      const target = el.getAttribute('target');
      page.ends.set(id, { ...(source ? { source } : {}), ...(target ? { target } : {}) });
    }
  }
  return page;
}

/** The last parse: the panel parses the XML once per diagram. */
let lastParse: { xml: string; page: Page } | undefined;

function pageOf(xml: string): Page {
  if (lastParse?.xml !== xml) {
    lastParse = { xml, page: readPage(xml) };
  }
  return lastParse.page;
}

/** The pg-id of the port cell that a portograph endpoint with a port names. */
const portKey = (e: Endpoint) => `${e.node}:${e.port}${e.ordinal > 1 ? `#${e.ordinal}` : ''}`;

/**
 * The ends of each edge of the index (spec 3.8.1). A portograph link ends on the port cell of `pg-from`/`pg-to` when
 * the endpoint names a port, else on the node cell. An end that this does not give comes from the `source`/`target`
 * of the edge in page 1 of `xml`. Pass `xml` only when a bound class reads `${from.…}` or `${to.…}`, or when the
 * editor is open. A page that does not give the ends (a compressed page) gives `no-edge-ends` with the edges that
 * lack an end.
 */
export function edgeEnds(xml: string | undefined, index: CellIndex): EdgeEnds {
  const page = xml ? pageOf(xml) : EMPTY_PAGE;
  const nodes = new Map<string, string>();
  const ports = new Map<string, string>();
  for (const { meta } of index.values()) {
    const byKey = meta.kind === 'node' ? nodes : meta.kind === 'port' ? ports : undefined;
    if (byKey && !byKey.has(meta.key)) {
      byKey.set(meta.key, meta.id);
    }
  }
  const pgEnd = (e: Endpoint | undefined) =>
    e && ((e.port !== undefined ? ports.get(portKey(e)) : undefined) ?? nodes.get(e.node));
  const xmlEnds = 'ends' in page ? page.ends : undefined;
  const result: EdgeEnds = { ends: new Map(), parents: new Map('parents' in page ? page.parents : []), report: [] };
  const lacking: string[] = [];
  for (const { meta } of index.values()) {
    if (meta.kind === 'port') {
      const node = nodes.get(meta.attrs['pg-node'] ?? '');
      if (node !== undefined) {
        result.parents.set(meta.id, node); // port cell before node cell
      }
    }
    const source = pgEnd(meta.from) ?? xmlEnds?.get(meta.id)?.source;
    const target = pgEnd(meta.to) ?? xmlEnds?.get(meta.id)?.target;
    if (source !== undefined || target !== undefined) {
      result.ends.set(meta.id, {
        ...(source !== undefined ? { source } : {}),
        ...(target !== undefined ? { target } : {}),
      });
    }
    if (meta.isEdge && (source === undefined || target === undefined)) {
      lacking.push(meta.id);
    }
  }
  if ('error' in page && lacking.length > 0) {
    result.report.push({ kind: 'no-edge-ends', reason: page.error, cellIds: lacking });
  }
  return result;
}

/**
 * An attribute of the cell at one end of an edge, for `${from.<name>}` and `${to.<name>}` (spec 3.3, 3.8.1). The end
 * cell first, then its parents up to the layer: for a port the node cell, for a shape inside a container the
 * container. `id` is the draw.io id of the end cell. Undefined when the edge has no such end or no cell has the name.
 */
export function endAttr(cellId: string, end: 'from' | 'to', name: string, ctx: EndContext): string | undefined {
  const ends = ctx.ends.get(cellId);
  const start = end === 'from' ? ends?.source : ends?.target;
  if (name === 'id') {
    return start;
  }
  const seen = new Set<string>();
  for (let id = start; id !== undefined && !seen.has(id); id = ctx.parents.get(id)) {
    seen.add(id);
    const attrs = ctx.index.get(id)?.meta.attrs;
    // own names only: `constructor` must not resolve to the inherited function
    if (attrs && Object.hasOwn(attrs, name)) {
      return attrs[name];
    }
  }
  return undefined;
}
