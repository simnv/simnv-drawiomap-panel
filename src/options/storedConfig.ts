const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The value to give to `onChange` so that Grafana stores `next` and not a mix of `stored` and `next`. Grafana 12.4
 * and 13.2 merge an options update into the old options (`VizPanel.onOptionsChange` of `@grafana/scenes`): a map
 * merges key by key, so a key that `next` does not have stays. An explicit `undefined` replaces the old value. Thus
 * each key of a `stored` map that the same map in `next` does not have gets `undefined`. The dashboard JSON drops it.
 * A list replaces the old list, so it gets no `undefined`.
 */
export function configUpdate(stored: unknown, next: unknown): unknown {
  if (!isMap(stored) || !isMap(next)) {
    return next;
  }
  // fromEntries makes own keys: a `__proto__` key in the YAML stays a key
  return Object.fromEntries([
    ...Object.keys(stored)
      .filter((key) => !Object.hasOwn(next, key))
      .map((key) => [key, undefined]),
    ...Object.entries(next).map(([key, value]) => [
      key,
      configUpdate(Object.hasOwn(stored, key) ? stored[key] : undefined, value),
    ]),
  ]);
}
