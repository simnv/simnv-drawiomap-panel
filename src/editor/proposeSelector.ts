import { cellMatches } from '../binding/select';
import type { CellMeta, CellSelector } from '../types';

export interface Proposal {
  select: CellSelector;
  /** Ids of cells that the selector matches and the selection does not hold. */
  extra: string[];
  /** Ids of selected cells that the selector does not match. */
  missed: string[];
  /** `attrs`: kind and shared attributes. `label`: kind and a label prefix. `ids`: the selected ids. */
  kind: 'attrs' | 'label' | 'ids';
}

/** Identity attributes differ from cell to cell: they never make a selector. */
const IDENTITY_ATTRS = new Set(['pg-id', 'id', 'label', 'pg-schema']);
/** The shortest common label prefix that makes a label selector. */
const MIN_PREFIX = 3;
/** A matcher string that starts and ends with a slash is a regular expression, so it cannot stand for itself. */
const REGEX_LIKE = /^\/(.+)\/([a-z]*)$/;

export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** The matcher that matches this value and no other. */
const exact = (value: string) => (REGEX_LIKE.test(value) ? `/^${escapeRegex(value)}$/` : value);

const commonPrefix = (texts: string[]) => {
  let prefix = texts[0] ?? '';
  for (const text of texts) {
    let i = 0;
    while (i < prefix.length && i < text.length && prefix[i] === text[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
  }
  return prefix;
};

/** Count what a selector matches and misses in the diagram. */
export function measure(select: CellSelector, selected: CellMeta[], all: CellMeta[]) {
  const picked = new Set(selected.map((cell) => cell.id));
  return {
    extra: all.filter((cell) => !picked.has(cell.id) && cellMatches(select, cell)).map((cell) => cell.id),
    missed: selected.filter((cell) => !cellMatches(select, cell)).map((cell) => cell.id),
  };
}

/**
 * Selectors for a group of selected cells, best first. Meaning comes before identity: a selector on shared attributes
 * or on a shared label prefix goes before the plain list of ids, which stays last as the fallback. A candidate that
 * misses a selected cell is dropped. The attribute and label candidates rank together by the fewest extra cells; on a
 * tie the attributes come first.
 */
export function proposeSelector(selected: CellMeta[], all: CellMeta[]): Proposal[] {
  if (selected.length === 0) {
    return [];
  }
  const kinds = new Set(selected.map((cell) => cell.kind));
  const kind = kinds.size === 1 ? selected[0].kind : undefined;
  const proposals: Proposal[] = [];
  const consider = (select: CellSelector, how: Proposal['kind']) => {
    const { extra, missed } = measure(select, selected, all);
    if (missed.length === 0) {
      proposals.push({ select, extra, missed, kind: how });
    }
  };

  // 1. The kind and the attributes that every selected cell shares.
  const shared: Array<[string, string]> = Object.entries(selected[0].attrs).filter(
    ([key, value]) => !IDENTITY_ATTRS.has(key) && selected.every((cell) => cell.attrs[key] === value)
  );
  const withAttrs = (pairs: Array<[string, string]>): CellSelector => ({
    ...(kind ? { kind } : {}),
    ...(pairs.length ? { attrs: Object.fromEntries(pairs.map(([key, value]) => [key, exact(value)])) } : {}),
  });
  // Drop the least selective attribute first (the one most cells of the diagram have). An attribute goes when the
  // selector without it matches no more extra cells than the selector with it.
  const holders = (pair: [string, string]) => all.filter((cell) => cell.attrs[pair[0]] === pair[1]).length;
  let kept = [...shared].sort((a, b) => holders(b) - holders(a));
  let extras = measure(withAttrs(kept), selected, all).extra.length;
  for (const pair of [...kept]) {
    const without = kept.filter((other) => other !== pair);
    const count = measure(withAttrs(without), selected, all).extra.length;
    if (count <= extras) {
      kept = without;
      extras = count;
    }
  }
  const attrs = withAttrs(kept);
  if (attrs.kind || attrs.attrs) {
    consider(attrs, 'attrs');
  }

  // 2. The kind and a label prefix.
  const prefix = commonPrefix(selected.map((cell) => cell.labelText));
  if (prefix.length >= MIN_PREFIX) {
    consider({ ...(kind ? { kind } : {}), label: `/^${escapeRegex(prefix)}/` }, 'label');
  }

  // 3. The ids: it always matches the selection and nothing else.
  const ids: CellSelector = { ids: selected.map((cell) => cell.id) };
  // The semantic candidates (attributes and label) rank together by their extra cells; on a tie the attributes come
  // first. The sort is stable and the tie rule is total, so the order is deterministic.
  const order = { attrs: 0, label: 1, ids: 2 };
  proposals.sort((a, b) => a.extra.length - b.extra.length || order[a.kind] - order[b.kind]);
  proposals.push({ select: ids, ...measure(ids, selected, all), kind: 'ids' });
  return proposals;
}
