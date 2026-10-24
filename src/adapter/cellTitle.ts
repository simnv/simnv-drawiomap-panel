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

const nodeName = (find: FindCell, nodeId: string): string => oneLine(find(nodeId)?.labelText) || readableId(nodeId);

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
    return portTitle(cell, find) || readableId(end.raw);
  }
  if (cell) {
    return oneLine(cell.labelText) || readableId(end.raw);
  }
  return [nodeName(find, end.node), end.port ?? ''].filter(Boolean).join(' ');
}

/**
 * The title of a cell.
 * - port: "<node label> <port label>", for example "Switch-A p9";
 * - link: "<from> ↔ <to>", for example "Switch-A p9 ↔ AP-1" (the link label is a detail, often a speed);
 * - anything else: its label, else a readable form of its id.
 * A link without both ends and a port without a node use the label.
 */
export function cellTitle(cell: CellMeta, find: FindCell): string {
  let title = '';
  if (cell.kind === 'port') {
    title = portTitle(cell, find);
  } else if (cell.kind === 'link' && cell.from && cell.to) {
    title = `${endTitle(cell.from, find)}${SEPARATOR}${endTitle(cell.to, find)}`;
  }
  return title || oneLine(cell.labelText) || readableId(cell.key || cell.id);
}

/** Sets `title` on every cell. Call it after applyContract and attachLinkLabels. */
export function assignTitles(cells: CellMeta[]): CellMeta[] {
  const find = cellFinder(cells);
  for (const c of cells) {
    c.title = cellTitle(c, find);
  }
  return cells;
}

/** What a list or a message calls a cell: its title, else its label, else a readable form of its id. */
export function displayName(cell: Pick<CellMeta, 'title' | 'labelText'> | undefined, id: string): string {
  return cell?.title || oneLine(cell?.labelText) || readableId(id);
}

/** The title of an indexed cell for a template scope (`${cell.title}`): never empty. */
export function scopeTitle(cell: CellMeta): string {
  return displayName(cell, cell.key || cell.id);
}

/**
 * A cell for a list that also shows the id: "<readable id> (<title>)", or the readable id alone when the title adds
 * nothing. The id is the handle of the editor; the title tells what it is.
 */
export function idAndName(cell: Pick<CellMeta, 'title' | 'labelText'> | undefined, id: string): string {
  const name = displayName(cell, id);
  const handle = readableId(id);
  return name === handle ? handle : `${handle} (${name})`;
}
