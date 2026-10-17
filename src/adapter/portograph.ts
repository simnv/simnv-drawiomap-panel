/**
 * The only module that knows the portograph draw.io binding contract (schema 1).
 * See docs/research/portograph-contract.md. Adjust here when the contract changes.
 */
import type { CellKind, CellMeta, Endpoint } from '../types';

export const PG_KINDS: Record<string, CellKind> = {
  node: 'node',
  port: 'port',
  link: 'link',
  'link-label': 'link-label',
};

/** "node", "node:port" or "node:port#n". */
export function parseEndpoint(raw: string): Endpoint {
  const colon = raw.indexOf(':');
  if (colon < 0) {
    return { node: raw, port: undefined, ordinal: 1, raw };
  }
  const node = raw.slice(0, colon);
  let port = raw.slice(colon + 1);
  let ordinal = 1;
  const hash = port.lastIndexOf('#');
  if (hash >= 0 && /^\d+$/.test(port.slice(hash + 1))) {
    ordinal = Number(port.slice(hash + 1));
    port = port.slice(0, hash);
  }
  return { node, port, ordinal, raw };
}

/** Strip HTML tags from a draw.io label attribute. */
export function plainLabel(html: string | undefined): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>\s*<div/gi, '</div>\n<div')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Build the pure cell description from the SVG group attributes.
 * @param id       data-cell-id
 * @param attrs    data-meta-* attributes without the prefix (label, pg-kind, ...)
 * @param isEdge   true when the group holds an edge polyline
 * @param labelText visible text found in the SVG (preferred over attrs.label)
 */
export function cellMetaFromAttrs(
  id: string,
  attrs: Record<string, string>,
  isEdge: boolean,
  labelText?: string
): CellMeta {
  const kind: CellKind = PG_KINDS[attrs['pg-kind'] ?? ''] ?? 'other';
  const key = attrs['pg-id'] ?? id;
  const meta: CellMeta = {
    id,
    kind,
    key,
    attrs: { ...attrs },
    labelText: labelText ?? plainLabel(attrs.label),
    isEdge,
  };
  if (attrs['pg-from']) {
    meta.from = parseEndpoint(attrs['pg-from']);
  }
  if (attrs['pg-to']) {
    meta.to = parseEndpoint(attrs['pg-to']);
  }
  return meta;
}

/** A link's label lives in a separate cell with pg-of. Copy its text onto the link. */
export function attachLinkLabels(cells: CellMeta[]): CellMeta[] {
  const byKey = new Map(cells.filter((c) => c.kind === 'link').map((c) => [c.key, c]));
  for (const c of cells) {
    if (c.kind === 'link-label' && c.attrs['pg-of']) {
      const link = byKey.get(c.attrs['pg-of']);
      if (link && c.labelText) {
        link.labelText = c.labelText;
      }
    }
  }
  return cells;
}

/** Scope values for templates: ${cell.*}, ${from.*}, ${to.*}. */
export function endpointScope(e?: Endpoint): Record<string, string> | undefined {
  if (!e) {
    return undefined;
  }
  return { node: e.node, port: e.port ?? '', ordinal: String(e.ordinal), raw: e.raw };
}

/** Cells that draw the icon of a node: a pg-kind="node-icon" cell with pg-of, else pg-iconTile~<key> and pg-icon~<key>. */
function iconCells(cells: CellMeta[]): { tagged: Map<string, string[]>; byId: Set<string> } {
  const tagged = new Map<string, string[]>();
  for (const c of cells) {
    const of = c.attrs['pg-of'];
    if (c.attrs['pg-kind'] === 'node-icon' && of) {
      tagged.set(of, [...(tagged.get(of) ?? []), c.id]);
    }
  }
  return { tagged, byId: new Set(cells.map((c) => c.id)) };
}

/**
 * Node key → cell id of its icon. A cell with pg-kind="node-icon" and pg-of=<node pg-id> wins.
 * Older exports have no tag: then the icon tile (the background of a glyph) is used, else the icon cell.
 */
export function nodeIcons(cells: CellMeta[]): Map<string, string> {
  const { tagged, byId } = iconCells(cells);
  const out = new Map<string, string>();
  for (const c of cells) {
    if (c.kind !== 'node' || out.has(c.key)) {
      continue;
    }
    const id = tagged.get(c.key)?.[0] ?? [`pg-iconTile~${c.key}`, `pg-icon~${c.key}`].find((i) => byId.has(i));
    if (id) {
      out.set(c.key, id);
    }
  }
  return out;
}

/** Icon cell id → node cell id, for every cell that draws a node icon. A hover on an icon is a hover on its node. */
export function iconOwners(cells: CellMeta[]): Map<string, string> {
  const { tagged, byId } = iconCells(cells);
  const out = new Map<string, string>();
  for (const c of cells) {
    if (c.kind !== 'node') {
      continue;
    }
    for (const id of [...(tagged.get(c.key) ?? []), `pg-iconTile~${c.key}`, `pg-icon~${c.key}`]) {
      if (byId.has(id) && !out.has(id)) {
        out.set(id, c.id);
      }
    }
  }
  return out;
}
