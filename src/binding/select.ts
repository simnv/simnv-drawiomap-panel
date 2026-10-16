import type { CellMeta, CellSelector, Matcher } from '../types';

const cache = new Map<string, (v: string) => boolean>();

/** "/re/flags" becomes a RegExp test; any other string is an exact match. */
export function compileMatcher(m: Matcher): (v: string) => boolean {
  let fn = cache.get(m);
  if (fn) {
    return fn;
  }
  const re = /^\/(.+)\/([a-z]*)$/.exec(m);
  if (re) {
    const rx = new RegExp(re[1], re[2]);
    fn = (v) => rx.test(v);
  } else {
    fn = (v) => v === m;
  }
  cache.set(m, fn);
  return fn;
}

export function cellMatches(sel: CellSelector, c: CellMeta): boolean {
  if (sel.ids && !sel.ids.includes(c.id) && !sel.ids.includes(c.key)) {
    return false;
  }
  if (sel.kind && sel.kind !== 'any' && sel.kind !== c.kind) {
    return false;
  }
  if (sel.attrs) {
    for (const [k, m] of Object.entries(sel.attrs)) {
      const v = c.attrs[k];
      if (v === undefined || !compileMatcher(m)(v)) {
        return false;
      }
    }
  }
  if (sel.label && !compileMatcher(sel.label)(c.labelText)) {
    return false;
  }
  if (sel.between) {
    const [a, b] = sel.between;
    const f = c.from?.node;
    const t = c.to?.node;
    if (!f || !t) {
      return false;
    }
    if (!((f === a && t === b) || (f === b && t === a))) {
      return false;
    }
  }
  return true;
}

export function selectCells(sel: CellSelector, cells: CellMeta[]): CellMeta[] {
  return cells.filter((c) => cellMatches(sel, c));
}
