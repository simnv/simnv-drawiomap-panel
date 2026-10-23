import type { DisplayConfig } from '../model/config';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The leaf paths of a partial display: dotted keys. A leaf is a scalar, `null`, an `undefined` value (a cleared field)
 * or an array. An array is one leaf at the array path, because arrays replace as a whole when displays merge.
 */
export function leafPaths(partial: Partial<DisplayConfig>): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (isRecord(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, path ? `${path}.${key}` : key);
      }
    } else if (path) {
      paths.push(path);
    }
  };
  visit(partial, '');
  return paths;
}

/** The value of a dotted path (with `[i]` indexes) in a display, or `undefined`. */
export function valueAtPath(display: unknown, path: string): unknown {
  let at: unknown = display;
  for (const part of path.split(/\.|(?=\[)/).filter(Boolean)) {
    if (typeof at !== 'object' || at === null) {
      return undefined;
    }
    const index = /^\[(\d+)\]$/.exec(part);
    at = (at as Record<string, unknown>)[index ? index[1] : part];
  }
  return at;
}

/**
 * The leaves whose value differs between two displays. A leaf that only one display has counts as different. An
 * edit of one field of a binding changes one leaf, although the editor writes the whole binding.
 */
export function changedLeaves(before: Partial<DisplayConfig> | undefined, after: Partial<DisplayConfig> | undefined) {
  const paths = new Set([...leafPaths(before ?? {}), ...leafPaths(after ?? {})]);
  return Array.from(paths).filter(
    (path) => JSON.stringify(valueAtPath(before, path)) !== JSON.stringify(valueAtPath(after, path))
  );
}
