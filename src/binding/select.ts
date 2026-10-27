import { compileMatcher } from '../model/matcher';
import type { CellMeta, CellSelector } from '../types';

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
