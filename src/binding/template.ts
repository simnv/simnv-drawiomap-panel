import type { TemplateScope } from '../types';

const PLACEHOLDER = /\$\{([a-zA-Z_][\w]*)(?:\.([^}:]+))?\}/g;
const SCOPE_ROOTS = new Set(['cell', 'from', 'to', 'labels', 'value', 'percent']);

export interface ResolveResult {
  text: string;
  unresolved: string[];
}

/**
 * Replaces ${cell.x}, ${from.x}, ${to.x}, ${labels.x}, ${value}, ${percent}.
 * Unknown roots (dashboard variables such as ${__url_time_range}) stay as they are and are not reported.
 * `encode` applies to each substituted value only (for example encodeURIComponent in URLs).
 */
export function resolveTemplate(
  tpl: string,
  scope: TemplateScope,
  encode: (v: string) => string = (v) => v
): ResolveResult {
  const unresolved: string[] = [];
  const text = tpl.replace(PLACEHOLDER, (whole, root: string, path: string | undefined) => {
    if (!SCOPE_ROOTS.has(root)) {
      return whole;
    }
    if (root === 'value' || root === 'percent') {
      const v = scope[root];
      if (v === undefined) {
        unresolved.push(root);
        return whole;
      }
      return encode(v);
    }
    const obj = scope[root as 'cell' | 'from' | 'to' | 'labels'];
    const key = path ?? '';
    const v = obj?.[key];
    if (v === undefined) {
      unresolved.push(`${root}.${key}`);
      return whole;
    }
    return encode(v);
  });
  return { text, unresolved };
}
