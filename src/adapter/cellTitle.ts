/**
 * The human-readable title of a cell: the one place that decides what a card, a list or a message calls a cell.
 * Pure. Only a portograph export (pg-schema, see applyContract) has port and link cells; any other cell keeps its
 * label, else its id.
 */
import type { CellMeta, Endpoint } from '../types';

const SEPARATOR = ' ↔ ';

/** One line of text: a multi-line label becomes one line. */
const oneLine = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * An id that a user can read. A portograph cell id (`pg-port~sw1~eth2~1`) becomes its parts (`sw1 eth2`);
 * the escapes `%7e` and `%25` come back as `~` and `%`. Any other text stays as it is.
 */
export function readableId(id: string): string {
  const m = /^pg-[A-Za-z]+~(.+)$/.exec(id);
  if (!m) {
    return id;
  }
  const parts = m[1].split('~');
  // the last part of a port is its ordinal ("~1"), not a name
  if (id.startsWith('pg-port~') && parts.length > 2 && /^\d+$/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.map((p) => p.replace(/%7e/gi, '~').replace(/%25/g, '%')).join(' ');
}

/** Finds a cell by its pg-id (`CellMeta.key`). */
export type FindCell = (key: string) => CellMeta | undefined;

/** The lookup for a list of cells. The first cell with a key wins. */
export function cellFinder(cells: CellMeta[]): FindCell {
  const byKey = new Map<string, CellMeta>();
  for (const c of cells) {
    if (!byKey.has(c.key)) {
      byKey.set(c.key, c);
    }
  }
  return (key) => byKey.get(key);
}

// a semantic id (pg-id, pg-node, pg-from) is shown as the author wrote it: only an encoded cell id is decoded
const nodeName = (find: FindCell, nodeId: string): string => oneLine(find(nodeId)?.labelText) || nodeId;

/** "<node label> <port label>"; without a node label, the node id. */
function portTitle(cell: CellMeta, find: FindCell): string {
  const node = cell.attrs['pg-node'];
  const port = oneLine(cell.labelText) || oneLine(cell.attrs['pg-port']);
  return [node ? nodeName(find, node) : '', port].filter(Boolean).join(' ');
}

/** One end of a link: the node label plus the port label for a port, the node label for a node. */
function endTitle(end: Endpoint, find: FindCell): string {
  const cell = find(end.raw);
  if (cell?.kind === 'port') {
    return portTitle(cell, find) || end.raw;
  }
  if (cell) {
    return oneLine(cell.labelText) || end.raw;
  }
  return [nodeName(find, end.node), end.port ?? ''].filter(Boolean).join(' ');
}

const NODE_PART = /^pg-(?:iconTile|icon|nodeDescription)~(.+)$/;
const GROUP = /^pg-group(Title)?~(.+)$/;
const LEGEND_PART = /^pg-legend(?:Body|Tile|Swatch)~(.+)$/;

/** The node that an icon, an icon tile or a description belongs to: by pg-of, else by the id suffix. */
function ownerNode(cell: CellMeta, find: FindCell): CellMeta | undefined {
  const of = cell.attrs['pg-of'];
  const byOf = of === undefined ? undefined : find(of);
  if (byOf?.kind === 'node') {
    return byOf;
  }
  const suffix = NODE_PART.exec(cell.id)?.[1];
  const bySuffix = suffix === undefined ? undefined : find(suffix);
  return bySuffix?.kind === 'node' ? bySuffix : undefined;
}

/**
 * The caption that the diagram shows for a portograph structure cell; '' when no rule applies.
 * - icon, icon tile, node description: the title of their node (pg-of, else the id suffix);
 * - group (`pg-group~X`): its own label, else the label of `pg-groupTitle~X`; a group title without label: the group's;
 * - legend body, tile and swatch (`pg-legend...~X`): the label of `pg-legendRow~X`.
 */
function captionOf(cell: CellMeta, find: FindCell): string {
  const owner = NODE_PART.test(cell.id) || cell.attrs['pg-kind'] === 'node-icon' ? ownerNode(cell, find) : undefined;
  if (owner && owner !== cell) {
    return cellTitle(owner, find);
  }
  const group = GROUP.exec(cell.id);
  if (group) {
    const other = group[1] ? `pg-group~${group[2]}` : `pg-groupTitle~${group[2]}`;
    return oneLine(cell.labelText) || oneLine(find(other)?.labelText);
  }
  const legend = LEGEND_PART.exec(cell.id);
  return legend ? oneLine(find(`pg-legendRow~${legend[1]}`)?.labelText) : '';
}

/**
 * The title of a cell.
 * - portograph only: an icon, icon tile or description has the title of its node; a group has its caption (own
 *   label, else its group title cell); a legend body, tile or swatch has the label of its legend row (see captionOf);
 * - port: "<node label> <port label>", for example "Switch-A p9";
 * - link: "<from> ↔ <to>", for example "Switch-A p9 ↔ AP-1" (the link label is a detail, often a speed);
 * - anything else: its label, else a readable form of its id.
 * A link without both ends and a port without a node use the label.
 * The last fallback is the id. With `portograph` (the diagram has pg-schema) a cell without pg-id shows its decoded
 * cell id; any other id stays raw. Without pg-schema nothing is decoded and no port or link cell exists.
 */
export function cellTitle(cell: CellMeta, find: FindCell, portograph = true): string {
  let title = '';
  if (cell.kind === 'port') {
    title = portTitle(cell, find);
  } else if (cell.kind === 'link' && cell.from && cell.to) {
    title = `${endTitle(cell.from, find)}${SEPARATOR}${endTitle(cell.to, find)}`;
  }
  const decode = portograph && !cell.attrs['pg-id'];
  // a node part shows the title of its node even when it has a label of its own (a description)
  title ||= portograph ? captionOf(cell, find) : '';
  return title || oneLine(cell.labelText) || (decode ? readableId(cell.id) : cell.key || cell.id);
}

/** The root cell of a draw.io file; it carries pg-schema. */
const ROOT_ID = '0';

/** Sets `title` on every cell. Call it after applyContract and attachLinkLabels. */
export function assignTitles(cells: CellMeta[]): CellMeta[] {
  const find = cellFinder(cells);
  const portograph = cells.some((c) => c.id === ROOT_ID && c.attrs['pg-schema'] !== undefined);
  for (const c of cells) {
    c.title = cellTitle(c, find, portograph);
    c.handle = portograph ? readableId(c.id) : c.id;
  }
  return cells;
}

/** The cell id as the editor shows it (`CellMeta.handle`); the raw id for a cell that was never indexed. */
const handleOf = (cell: Pick<CellMeta, 'handle'> | undefined, id: string): string => cell?.handle ?? id;

/** What a list or a message calls a cell: its title, else its label, else its handle. */
export function displayName(cell: Pick<CellMeta, 'title' | 'labelText' | 'handle'> | undefined, id: string): string {
  return cell?.title || oneLine(cell?.labelText) || handleOf(cell, id);
}

/** The title of an indexed cell for a template scope (`${cellTitle}`): never empty. */
export function scopeTitle(cell: CellMeta): string {
  return cell.title || oneLine(cell.labelText) || cell.key || cell.id;
}

/**
 * A cell for a list that also shows the id: "<handle> (<title>)", or the handle alone when the title adds nothing.
 * The id is the handle of the editor; the title tells what it is.
 */
export function idAndName(cell: Pick<CellMeta, 'title' | 'labelText' | 'handle'> | undefined, id: string): string {
  const name = displayName(cell, id);
  const handle = handleOf(cell, id);
  return name === handle ? handle : `${handle} (${name})`;
}

/** The identity of a cell: its pg-id as the author wrote it, else its handle. */
export function identityOf(cell: Pick<CellMeta, 'attrs' | 'handle'> | undefined, id: string): string {
  return cell?.attrs['pg-id'] ?? handleOf(cell, id);
}
