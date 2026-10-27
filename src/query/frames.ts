import {
  FieldType,
  createTheme,
  getDisplayProcessor,
  getFieldDisplayName,
  type DataFrame,
  type DisplayProcessor,
  type DisplayValue,
  type Field,
  type GrafanaTheme2,
} from '@grafana/data';
import { compileMatcher } from '../model/matcher';
import { reduceValues } from '../binding/reduce';
import type { QueryBinding } from '../model/config';
import { stable } from './boundary';
import type { QuerySnapshot } from './types';

export type HistoryModel =
  | Exclude<QuerySnapshot, { state: 'ready' }>
  | {
      state: 'ready';
      field: Field<number | null>;
      timeField: Field<number>;
      /** The arrays of the result (the boundary copy of the controller), shared by every model: nobody writes to them. */
      timestamps: readonly number[];
      values: ReadonlyArray<number | null>;
      latestValue?: number;
      latestDisplayValue?: DisplayValue;
      sampleAt?: number;
      fetchedAt: number;
      fromCache: boolean;
    };
/**
 * The one display processor of a field: the row text and the chart tooltip both use it.
 * A field with a changed unit or decimals must have no `display` (see historyOf), so it is rebuilt from the config.
 */
export function fieldDisplay(field: Field, theme: GrafanaTheme2 = createTheme(), timeZone?: string): DisplayProcessor {
  return field.display ?? getDisplayProcessor({ field, theme, timeZone });
}

export interface HistoryFormat {
  theme?: GrafanaTheme2;
  timeZone?: string;
  unit?: string;
  decimals?: number;
}

/** One numeric field of a result, with what the matchers and the model read from it, checked once. */
interface Candidate {
  field: Field;
  frame: DataFrame;
  displayName: string;
  /** the one time field of the frame; undefined when the frame has none or several */
  timeField?: Field<number>;
  /** why the field cannot be a history, from the checks that run once per field */
  unsupported?: string;
  /** the index of the last value that is not null; -1 when every value is null */
  lastNumeric: number;
}
type Selection = Candidate | 'none' | 'ambiguous' | 'invalid';
/** The index of a result: each numeric field once, and the selections by match key. */
interface FrameIndex {
  candidates: Candidate[];
  /** the result has at least one numeric field */
  numeric: boolean;
  /** the result has no frame, or only empty fieldless frames */
  empty: boolean;
  byMatch: Map<string, Selection>;
}

const indexes = new WeakMap<DataFrame[], FrameIndex>();

/** The checks of a field, once per result: equal lengths, finite ordered timestamps, finite or null values. */
function check(frame: DataFrame, field: Field, timeField: Field<number> | undefined): string | undefined {
  if (!timeField) {
    return 'History requires exactly one numeric time field.';
  }
  const timestamps = timeField.values;
  const values = field.values;
  if (timestamps.length !== values.length || frame.length !== values.length) {
    return 'History time and value lengths differ.';
  }
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    if (typeof t !== 'number' || !Number.isFinite(t) || (i > 0 && t < timestamps[i - 1])) {
      return 'History timestamps must be finite milliseconds in time order.';
    }
  }
  for (const v of values) {
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
      return 'History values must be finite numbers or null gaps.';
    }
  }
  return undefined;
}

/** The index of a result, built once per frames array. */
export function indexFrames(frames: DataFrame[]): FrameIndex {
  let index = indexes.get(frames);
  if (index) {
    return index;
  }
  const candidates: Candidate[] = [];
  for (const frame of frames) {
    const times = frame.fields.filter((f) => f.type === FieldType.time);
    const timeField = times.length === 1 ? (times[0] as Field<number>) : undefined;
    for (const field of frame.fields) {
      if (field.type !== FieldType.number) {
        continue;
      }
      let lastNumeric = field.values.length - 1;
      while (lastNumeric >= 0 && field.values[lastNumeric] === null) {
        lastNumeric--;
      }
      candidates.push({
        field,
        frame,
        displayName: getFieldDisplayName(field, frame, frames),
        timeField,
        unsupported: check(frame, field, timeField),
        lastNumeric,
      });
    }
  }
  index = {
    candidates,
    numeric: candidates.length > 0,
    empty: !frames.length || frames.every((frame) => frame.length === 0 && frame.fields.length === 0),
    byMatch: new Map(),
  };
  indexes.set(frames, index);
  return index;
}

/** The candidates of a binding by its matchers and field name, once per match key of the result. */
export function selectField(index: FrameIndex, match: Record<string, string>, field: string | undefined): Selection {
  const key = `${stable(match)}\n${field ?? ''}`;
  const seen = index.byMatch.get(key);
  if (seen) {
    return seen;
  }
  let selection: Selection;
  try {
    const tests = Object.entries(match).map(([label, pattern]) => [label, compileMatcher(pattern)] as const);
    const found = index.candidates.filter(
      (c) =>
        (!field || c.field.name === field || c.displayName === field) &&
        tests.every(([label, test]) => c.field.labels?.[label] !== undefined && test(c.field.labels[label]))
    );
    selection = found.length === 1 ? found[0] : found.length ? 'ambiguous' : 'none';
  } catch {
    selection = 'invalid';
  }
  index.byMatch.set(key, selection);
  return selection;
}

const models = new WeakMap<QuerySnapshot, Map<string, HistoryModel>>();
const themeIds = new WeakMap<GrafanaTheme2, number>();
let nextThemeId = 1;
const themeId = (theme: GrafanaTheme2 | undefined): number => {
  if (!theme) {
    return 0;
  }
  let id = themeIds.get(theme);
  if (id === undefined) {
    id = nextThemeId++;
    themeIds.set(theme, id);
  }
  return id;
};

/**
 * The model of a binding over a result, built once per snapshot object, match, field, reducer and format. Direct
 * execution does not apply dashboard transformations or overrides. Callers can supply explicit formatting.
 */
export function historyOf(snapshot: QuerySnapshot, binding: QueryBinding, format: HistoryFormat = {}): HistoryModel {
  if (snapshot.state !== 'ready') {
    return snapshot;
  }
  let cache = models.get(snapshot);
  if (!cache) {
    cache = new Map();
    models.set(snapshot, cache);
  }
  const key = [
    stable(binding.match),
    binding.field ?? '',
    binding.reducer,
    format.unit ?? '',
    format.decimals ?? '',
    format.timeZone ?? '',
    themeId(format.theme),
  ].join('|');
  const seen = cache.get(key);
  if (seen) {
    return seen;
  }
  const model = buildHistory(snapshot, binding, format);
  cache.set(key, model);
  return model;
}

function buildHistory(
  snapshot: Extract<QuerySnapshot, { state: 'ready' }>,
  binding: QueryBinding,
  format: HistoryFormat
): HistoryModel {
  const empty = (): HistoryModel => ({ state: 'empty', fetchedAt: snapshot.fetchedAt, fromCache: snapshot.fromCache });
  const unsupported = (message: string): HistoryModel => ({ state: 'unsupported', message });
  const index = indexFrames(snapshot.frames);
  if (index.empty) {
    return empty();
  }
  const selected = selectField(index, binding.match, binding.field);
  if (selected === 'invalid') {
    return unsupported('The history field matcher is invalid.');
  }
  if (selected === 'none') {
    return index.numeric ? empty() : unsupported('History requires a numeric field and a time field.');
  }
  if (selected === 'ambiguous') {
    return unsupported('History field selection is ambiguous. Select one field and series.');
  }
  if (selected.unsupported !== undefined) {
    return unsupported(selected.unsupported);
  }
  const original = selected.field as Field<number | null>;
  const values = original.values;
  if (!values.length || selected.lastNumeric < 0) {
    return empty();
  }
  const latestValue = reduceValues(values, binding.reducer);
  const hasOverride = format.unit !== undefined || format.decimals !== undefined;
  const field = hasOverride
    ? {
        ...original,
        // the display processor of the original field has the old unit and decimals
        display: undefined,
        config: {
          ...original.config,
          ...(format.unit !== undefined ? { unit: format.unit } : {}),
          ...(format.decimals !== undefined ? { decimals: format.decimals } : {}),
        },
      }
    : original;
  const display = fieldDisplay(field, format.theme, format.timeZone);
  return {
    state: 'ready',
    field,
    timeField: selected.timeField!,
    timestamps: selected.timeField!.values,
    values,
    latestValue,
    latestDisplayValue: latestValue === undefined ? undefined : display(latestValue),
    sampleAt: selected.timeField!.values[selected.lastNumeric],
    fetchedAt: snapshot.fetchedAt,
    fromCache: snapshot.fromCache,
  };
}
