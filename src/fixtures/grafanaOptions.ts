import { cloneDeep, isArray, mergeWith } from 'lodash';

/**
 * The options update of Grafana 12.4 and 13.2: `VizPanel.onOptionsChange` of `@grafana/scenes` merges the new
 * options into a deep copy of the old ones. An array replaces the old value, an explicit `undefined` replaces the old
 * value, and a map merges key by key.
 */
export function grafanaUpdate(options: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  return mergeWith(cloneDeep(options), { ...options, [path]: value }, (objValue, srcValue, key, obj) => {
    if (isArray(srcValue)) {
      return srcValue;
    }
    if (objValue !== srcValue && typeof srcValue === 'undefined') {
      (obj as Record<string, unknown>)[key as string] = srcValue;
      return;
    }
    return;
  });
}

/** The dashboard JSON of the options: it drops each `undefined`. */
export const saveOptions = (options: Record<string, unknown>) => JSON.parse(JSON.stringify(options));
