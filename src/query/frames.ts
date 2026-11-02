import {
  FieldType,
  createTheme,
  getDisplayProcessor,
  type DataFrame,
  type DisplayProcessor,
  type DisplayValue,
  type Field,
  type GrafanaTheme2,
} from '@grafana/data';
import type { QuerySnapshot } from './snapshot';

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
 * A field with a changed unit or decimals must have no `display` (see shownField), so it is rebuilt from the config.
 */
export function fieldDisplay(field: Field, theme: GrafanaTheme2 = createTheme(), timeZone?: string): DisplayProcessor {
  return field.display ?? getDisplayProcessor({ field, theme, timeZone });
}

/** One numeric field of a result, with what the matchers and the model read from it, checked once. */
interface Candidate {
  field: Field;
  frame: DataFrame;
  /** the one time field of the frame; undefined when the frame has none or several */
  timeField?: Field<number>;
  /** why the field cannot be a history, from the checks that run once per field */
  unsupported?: string;
  /** the index of the last value that is not null; -1 when every value is null */
  lastNumeric: number;
}
/** The index of a result: each numeric field once. */
interface FrameIndex {
  candidates: Candidate[];
  /** the result has at least one numeric field */
  numeric: boolean;
  /** the result has no frame, or only empty fieldless frames */
  empty: boolean;
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
  };
  indexes.set(frames, index);
  return index;
}

/** The largest time in ms that a Date can hold. A time field in ns or µs gives larger values. */
const MAX_DATE_MS = 8.64e15;

/**
 * The newest time of all time fields of all frames: the time of the last data of the panel. Undefined: no time.
 * A value that is not a time in ms (not finite, or out of the Date range) does not count.
 */
export function lastSampleTime(frames: DataFrame[]): number | undefined {
  let last: number | undefined;
  for (const frame of frames) {
    for (const field of frame.fields) {
      if (field.type !== FieldType.time) {
        continue;
      }
      for (const time of field.values) {
        if (typeof time === 'number' && Math.abs(time) <= MAX_DATE_MS && (last === undefined || time > last)) {
          last = time;
        }
      }
    }
  }
  return last;
}
