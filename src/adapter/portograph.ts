/**
 * The only module that knows the portograph draw.io binding contract (schema PG_SCHEMA).
 * See docs/research/portograph-contract.md. Adjust here when the contract changes.
 */
import type { CellEntry, CellKind, CellMeta, Endpoint, HoverKind, TemplateScope } from '../types';
import type { Diagnostic } from '../model/config';
import { scopeTitle } from './cellTitle';

/** Duplicate explicit identities cannot safely select a device, even if labels differ. */
export function cellIdentityDiagnostics(cells: CellMeta[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [key, code] of [
    ['id', 'duplicate-cell-id'],
    ['key', 'duplicate-semantic-id'],
  ] as const) {
    const seen = new Set<string>();
    cells.forEach((cell, i) => {
      if (seen.has(cell[key])) {
        diagnostics.push({
          code,
          path: `cells[${i}].${key}`,
          message: `Cell ${key} ${cell[key]} is ambiguous. Assign each diagram entity a unique ${key === 'key' ? 'pg-id metadata value' : 'cell ID'} in draw.io. Copy/paste may duplicate metadata.`,
        });
      }
      seen.add(cell[key]);
    });
  }
  return diagnostics;
}

/** The pg-schema version that this panel reads. */
export const PG_SCHEMA = '1';
/** draw.io gives the root cell this id. The root carries pg-schema. */
const ROOT_ID = '0';

export const PG_KINDS: Record<string, CellKind> = {
  node: 'node',
  port: 'port',
  link: 'link',
  'link-label': 'link-label',
};

/** The kind of a cell for Options.hover.kinds, see HoverKind. */
export function hoverKind(cell: Pick<CellEntry, 'meta' | 'shape' | 'line' | 'label'>): HoverKind {
  const meta = cell.meta;
  if (meta.kind !== 'other') {
    return meta.kind;
  }
  const id = meta.id;
  if (id === 'pg-canvas' || id.startsWith('pg-layer~')) {
    return 'canvas';
  }
  if (id.startsWith('pg-group~') || id.startsWith('pg-groupTitle~')) {
    return 'group';
  }
  if (id.startsWith('pg-legend')) {
    return 'legend';
  }
  if (meta.attrs['pg-kind'] !== undefined || id.startsWith('pg-')) {
    return 'other';
  }
  // A plain draw.io diagram. The root and the layers draw nothing of their own.
  if (!cell.shape && !cell.line && !cell.label) {
    return 'canvas';
  }
  return meta.isEdge ? 'link' : 'node';
}

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

function schemaWarning(schema: string | undefined): string | undefined {
  return schema === undefined || schema === PG_SCHEMA
    ? undefined
    : `diagram uses portograph contract v${schema}; panel supports ${PG_SCHEMA}`;
}

/**
 * Apply the pg-schema of the root cell to all cells (changes the cells).
 * No pg-schema: the diagram is not a portograph export. All cells become generic: kind "other", key = cell id,
 * no endpoints. The data-meta attributes stay, so rules can still select the cells.
 * A different pg-schema: the cells are read as schema 1, and the result has a warning for the editor.
 */
export function applyContract(cells: CellMeta[]): { schema?: string; warning?: string } {
  const schema = cells.find((c) => c.id === ROOT_ID)?.attrs['pg-schema'];
  if (schema === undefined) {
    for (const c of cells) {
      c.kind = 'other';
      c.key = c.id;
      delete c.from;
      delete c.to;
    }
  }
  return { schema, warning: schemaWarning(schema) };
}

/** The pg-schema warning for the sanitised SVG text, or undefined. For the editor, without a parse of the SVG. */
export function contractWarning(svg: string): string | undefined {
  const root = /<g\b[^>]*\sdata-cell-id="0"[^>]*>/.exec(svg)?.[0];
  return schemaWarning(root ? /\sdata-meta-pg-schema="([^"]*)"/.exec(root)?.[1] : undefined);
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

/** Pure identity/metadata scope shared by the V2 binding plan and query parameters. */
export function cellScope(cell: CellMeta): TemplateScope {
  return {
    cell: { ...cell.attrs, id: cell.id, key: cell.key, label: cell.labelText },
    cellTitle: scopeTitle(cell),
    from: endpointScope(cell.from),
    to: endpointScope(cell.to),
  };
}

/** pg-kind="node-icon" cells by the pg-id of their node (pg-of), and the set of all cell ids. */
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
 * Node key → cell id of the icon shape that takes the state colour. The icon is the cell with
 * pg-kind="node-icon" and pg-of=<node pg-id> (older exports: the cell pg-icon~<pg-id>). Some icons are
 * a white glyph on a tile (pg-iconTile~<pg-id>). Then the tile takes the colour.
 */
export function nodeIcons(cells: CellMeta[]): Map<string, string> {
  const { tagged, byId } = iconCells(cells);
  const out = new Map<string, string>();
  for (const c of cells) {
    if (c.kind !== 'node' || out.has(c.key)) {
      continue;
    }
    const tile = `pg-iconTile~${c.key}`;
    const id = byId.has(tile) ? tile : (tagged.get(c.key)?.[0] ?? [`pg-icon~${c.key}`].find((i) => byId.has(i)));
    if (id) {
      out.set(c.key, id);
    }
  }
  return out;
}

/**
 * Cell id → owner cell id, for the cells that draw a part of a node or a link outside its group: the icon, the
 * icon tile, the description, the link label (pg-linkLabel~<link pg-id>), and each other cell with pg-of whose
 * own kind is not node, link or port. A hover on such a cell is a hover on its owner.
 */
export function nodeParts(cells: CellMeta[]): Map<string, string> {
  const { tagged, byId } = iconCells(cells);
  const out = new Map<string, string>();
  const owners = new Map<string, CellMeta>();
  for (const c of cells) {
    if (c.kind === 'node' || c.kind === 'link' || c.kind === 'port') {
      if (!owners.has(c.key)) {
        owners.set(c.key, c);
      }
    }
    if (c.kind === 'link') {
      const label = `pg-linkLabel~${c.key}`;
      if (byId.has(label) && !out.has(label)) {
        out.set(label, c.id);
      }
    }
    if (c.kind !== 'node') {
      continue;
    }
    const parts = [
      ...(tagged.get(c.key) ?? []),
      `pg-iconTile~${c.key}`,
      `pg-icon~${c.key}`,
      `pg-nodeDescription~${c.key}`,
    ];
    for (const id of parts) {
      if (byId.has(id) && !out.has(id)) {
        out.set(id, c.id);
      }
    }
  }
  for (const c of cells) {
    const of = c.attrs['pg-of'];
    const owner = of === undefined ? undefined : owners.get(of);
    if (owner && owner !== c && c.kind !== 'node' && c.kind !== 'link' && c.kind !== 'port' && !out.has(c.id)) {
      out.set(c.id, owner.id);
    }
  }
  return out;
}
