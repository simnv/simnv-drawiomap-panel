import type { DataFrame } from '@grafana/data';

/** Canonical JSON for persisted query objects and resolved context, never datasource instances. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((k) => [k, item[k]])
        )
      : item
  );
}

/**
 * The boundary copy. Grafana keeps the value arrays of a field by reference, and a streaming datasource appends to
 * them in place. One copy per result, before the listeners: every consumer, model and series shares it read-only.
 */
export function copyFrames(frames: DataFrame[]): DataFrame[] {
  return frames.map((frame) => ({
    ...frame,
    fields: frame.fields.map((field) => ({ ...field, values: Array.from(field.values) })),
  }));
}
