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
