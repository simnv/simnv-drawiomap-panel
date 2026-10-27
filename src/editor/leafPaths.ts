import type { DisplayConfig } from '../model/config';
import { jsonCopy } from '../util/json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The leaf paths of a partial display: dotted keys. A leaf is a scalar, `null`, an `undefined` value (a cleared field)
 * or an array. An array is one leaf at the array path, because arrays replace as a whole when displays merge.
 */
export function leafPaths(partial: Partial<DisplayConfig>, units: readonly string[] = []): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (isRecord(value) && Object.keys(value).length > 0 && !units.includes(path)) {
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

/**
 * The paths that a bulk edit writes whole, besides every array (which `leafPaths` already stops at): the health rule,
 * which is replaced as a whole when its kind changes (`mergeDisplay`), and every metric binding. A binding is one unit
 * because the editor writes the whole effective binding (`BindingFields` spreads it), and a partial binding in an
 * override is not valid. A binding in a hover row is inside `hover.rows`, which is already one array.
 */
export const UNIT_PATHS = [
  'status',
  'shape.binding',
  'link.a2b.binding',
  'link.a2b.capacityBinding',
  'link.b2a.binding',
  'link.b2a.capacityBinding',
  'link.capacityBinding',
] as const;

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

/** True for a value that holds nothing: an object without keys (not an array). */
const isEmptyObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

/**
 * The display without `path` (dotted keys, no indexes). Objects that become empty go away with it: a `hover` that
 * keeps another key, for example `enabled: false`, stays.
 */
export function unsetPath<T extends Partial<DisplayConfig>>(display: T, path: string): T {
  const keys = path.split('.');
  const next = jsonCopy(display) as Record<string, unknown>;
  const trail: Array<Record<string, unknown>> = [next];
  for (const key of keys.slice(0, -1)) {
    const child = trail[trail.length - 1][key];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      return display;
    }
    trail.push(child as Record<string, unknown>);
  }
  const leaf = keys[keys.length - 1];
  if (!(leaf in trail[trail.length - 1])) {
    return display;
  }
  delete trail[trail.length - 1][leaf];
  for (let i = trail.length - 1; i > 0; i--) {
    if (!isEmptyObject(trail[i])) {
      break;
    }
    delete trail[i - 1][keys[i - 1]];
  }
  return next as T;
}

/** `getLeaf(display, path)`: the value of a dotted leaf path, or `undefined`. */
export const getLeaf = valueAtPath;

/**
 * A copy of the display with the leaf at `path` set. Missing parents are created. An `undefined` value removes the leaf
 * (and the objects that this leaves empty). Nothing else changes: the other leaves keep their place and value.
 */
export function setLeaf<T extends Partial<DisplayConfig>>(display: T, path: string, value: unknown): T {
  if (value === undefined) {
    return unsetPath(display, path);
  }
  const keys = path.split('.');
  const next = jsonCopy(display) as Record<string, unknown>;
  let at = next;
  for (const key of keys.slice(0, -1)) {
    const child = at[key];
    at = (isRecord(child) ? child : (at[key] = {})) as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = jsonCopy(value);
  return next as T;
}

/**
 * The leaf operations that turn `before` into `after`: one `{ path, value }` for each leaf whose value differs. A leaf
 * that only `before` has has the value `undefined` (the leaf goes). Arrays and the paths in `units` are one leaf.
 */
export function diffLeaves(
  before: Partial<DisplayConfig> | undefined,
  after: Partial<DisplayConfig> | undefined,
  units: readonly string[] = UNIT_PATHS
): Array<{ path: string; value: unknown }> {
  const paths = new Set([...leafPaths(before ?? {}, units), ...leafPaths(after ?? {}, units)]);
  return Array.from(paths).flatMap((path) => {
    const value = valueAtPath(after, path);
    return JSON.stringify(valueAtPath(before, path)) === JSON.stringify(value) ? [] : [{ path, value }];
  });
}
