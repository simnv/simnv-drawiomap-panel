import { cellFinder, cellTitle, type FindCell } from '../adapter/cellTitle';
import type { CellIndex, CellMeta } from '../types';
import { endContextOf } from './edgeEnds';

/** The SVG metadata stays constant for an index. Build its name lookup only when a link title needs it. */
const finders = new WeakMap<CellIndex, FindCell>();

/** The shared card and accessible title. XML ends are read only when a caller asks for a link title. */
export function diagramTitle(meta: CellMeta, index: CellIndex, xml: string | undefined): string {
  if (meta.kind !== 'link' || xml === undefined) {
    return meta.title || meta.labelText || meta.key;
  }
  let find = finders.get(index);
  if (!find) {
    find = cellFinder([...index.values()].map((entry) => entry.meta));
    finders.set(index, find);
  }
  const ends = endContextOf(xml, index).ends.get(meta.id);
  return cellTitle(meta, find, true, {
    source: ends?.source === undefined ? undefined : index.get(ends.source)?.meta,
    target: ends?.target === undefined ? undefined : index.get(ends.target)?.meta,
  });
}
