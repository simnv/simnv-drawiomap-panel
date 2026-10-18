import {
  FieldType,
  createTheme,
  getDisplayProcessor,
  getFieldDisplayName,
  type DisplayValue,
  type Field,
  type GrafanaTheme2,
} from '@grafana/data';
import { compileMatcher } from '../binding/select';
import { reduceValues } from '../binding/reduce';
import type { QueryBinding } from '../model/config';
import type { QuerySnapshot } from './types';

export type HistoryModel =
  | Exclude<QuerySnapshot, { state: 'ready' }>
  | {
      state: 'ready';
      field: Field<number | null>;
      timeField: Field<number>;
      timestamps: number[];
      values: Array<number | null>;
      latestValue?: number;
      latestDisplayValue?: DisplayValue;
      sampleAt?: number;
      fetchedAt: number;
      fromCache: boolean;
    };
export interface HistoryFormat {
  theme?: GrafanaTheme2;
  timeZone?: string;
  unit?: string;
  decimals?: number;
}

/** Direct execution does not apply dashboard transformations or overrides. Callers can supply explicit formatting. */
export function toHistory(snapshot: QuerySnapshot, binding: QueryBinding, format: HistoryFormat = {}): HistoryModel {
  if (snapshot.state !== 'ready') {
    return snapshot;
  }
  const empty = (): HistoryModel => ({ state: 'empty', fetchedAt: snapshot.fetchedAt, fromCache: snapshot.fromCache });
  const unsupported = (message: string): HistoryModel => ({ state: 'unsupported', message });
  if (!snapshot.frames.length) {
    return empty();
  }
  const candidates: Array<{ field: Field; frame: (typeof snapshot.frames)[number] }> = [];
  try {
    const tests = Object.entries(binding.match).map(([key, pattern]) => [key, compileMatcher(pattern)] as const);
    for (const frame of snapshot.frames) {
      for (const field of frame.fields) {
        if (
          field.type === FieldType.number &&
          (!binding.field ||
            field.name === binding.field ||
            getFieldDisplayName(field, frame, snapshot.frames) === binding.field) &&
          tests.every(([key, test]) => field.labels?.[key] !== undefined && test(field.labels[key]))
        ) {
          candidates.push({ field, frame });
        }
      }
    }
  } catch {
    return unsupported('The history field matcher is invalid.');
  }
  if (!candidates.length) {
    return snapshot.frames.some((f) => f.fields.some((field) => field.type === FieldType.number))
      ? empty()
      : unsupported('History requires a numeric field and a time field.');
  }
  if (candidates.length !== 1) {
    return unsupported('History field selection is ambiguous. Select one field and series.');
  }
  const { field: original, frame } = candidates[0];
  const times = frame.fields.filter((f) => f.type === FieldType.time);
  if (times.length !== 1) {
    return unsupported('History requires exactly one numeric time field.');
  }
  const timeField = times[0];
  const timestamps: number[] = [...timeField.values];
  const values: Array<number | null> = [...original.values];
  if (timestamps.length !== values.length || frame.length !== values.length) {
    return unsupported('History time and value lengths differ.');
  }
  if (timestamps.some((t, i) => typeof t !== 'number' || !Number.isFinite(t) || (i > 0 && t < timestamps[i - 1]))) {
    return unsupported('History timestamps must be finite milliseconds in time order.');
  }
  if (values.some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) {
    return unsupported('History values must be finite numbers or null gaps.');
  }
  if (!values.length || values.every((v) => v === null)) {
    return empty();
  }
  const numeric = values.filter((v): v is number => v !== null);
  const latestValue = reduceValues(numeric, binding.reducer);
  let lastNumeric = values.length - 1;
  while (lastNumeric >= 0 && values[lastNumeric] === null) {
    lastNumeric--;
  }
  const hasOverride = format.unit !== undefined || format.decimals !== undefined;
  const field = hasOverride
    ? {
        ...original,
        config: {
          ...original.config,
          ...(format.unit !== undefined ? { unit: format.unit } : {}),
          ...(format.decimals !== undefined ? { decimals: format.decimals } : {}),
        },
      }
    : original;
  const display =
    !hasOverride && field.display
      ? field.display
      : getDisplayProcessor({ field, theme: format.theme ?? createTheme(), timeZone: format.timeZone });
  return {
    state: 'ready',
    field,
    timeField,
    timestamps,
    values,
    latestValue,
    latestDisplayValue: latestValue === undefined ? undefined : display(latestValue),
    sampleAt: timestamps[lastNumeric],
    fetchedAt: snapshot.fetchedAt,
    fromCache: snapshot.fromCache,
  };
}
