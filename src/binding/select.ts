import type { CellMeta, CellSelector, Matcher } from '../types';

const REGEX = /^\/(.+)\/([a-z]*)$/;
/** g and y make RegExp.test() stateful (lastIndex), so a cached matcher would alternate true/false. */
const STATEFUL_FLAGS = /[gy]/;
const NEVER = (): boolean => false;

const cache = new Map<string, (v: string) => boolean>();

/**
 * Returns a message when the matcher is a "/re/flags" string that is not a valid, stateless regex.
 * A matcher with a ${...} template is checked for flags only: its pattern is known after resolution.
 */
export function matcherError(m: Matcher): string | undefined {
  const re = REGEX.exec(m);
  if (!re) {
    return undefined;
  }
  if (STATEFUL_FLAGS.test(re[2])) {
    return `invalid regex ${m}: do not use the g or y flag`;
  }
  if (m.includes('${')) {
    return undefined;
  }
  try {
    new RegExp(re[1], re[2]);
    return undefined;
  } catch (e) {
    return `invalid regex ${m}: ${(e as Error).message}`;
  }
}

/** "/re/flags" becomes a RegExp test; any other string is an exact match. An invalid regex matches nothing. */
export function compileMatcher(m: Matcher): (v: string) => boolean {
  let fn = cache.get(m);
  if (fn) {
    return fn;
  }
  const re = REGEX.exec(m);
  if (re) {
    try {
      const rx = new RegExp(re[1], re[2].replace(/[gy]/g, ''));
      fn = (v) => rx.test(v);
    } catch {
      fn = NEVER;
    }
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
