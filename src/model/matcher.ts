// A matcher is a string of the saved config: "/re/flags" is a regular expression, any other string an exact value.
// This file is a leaf: the config schema and the field selection both use it.
const REGEX = /^\/(.+)\/([a-z]*)$/;
/** g and y make RegExp.test() stateful (lastIndex), so a cached matcher would alternate true/false. */
const STATEFUL_FLAGS = /[gy]/;
const NEVER = (): boolean => false;

const cache = new Map<string, (v: string) => boolean>();

/**
 * Returns a message when the matcher is a "/re/flags" string that is not a valid, stateless regex.
 * A matcher with a ${...} template is checked for flags only: its pattern is known after resolution.
 */
export function matcherError(m: string): string | undefined {
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
export function compileMatcher(m: string): (v: string) => boolean {
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

/** True when the matcher reads as a "/re/flags" regular expression, valid or not. */
export const isRegexMatcher = (m: string): boolean => REGEX.test(m);

/** The text as a regex pattern that matches it literally. The slash is escaped too: the result goes into "/re/". */
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
