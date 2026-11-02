import { FieldType, type DataFrame, type Field, type Labels } from '@grafana/data';
import type { ReportEntry } from '../binding/report';
import { indexFrames } from './frames';

import type { Series } from './snapshot';
export type { Series } from './snapshot';

/** Encode label values in matcher order. An absent label equals an empty label. */
export function equalityKey(labels: Labels, names: string[]): string {
  return JSON.stringify(
    names.map((name) => (Object.prototype.hasOwnProperty.call(labels, name) ? (labels[name] ?? '') : ''))
  );
}

function canonicalLabels(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${JSON.stringify(labels[name])}`)
    .join(',');
}

interface Pending {
  frame: DataFrame;
  frameIndex: number;
  fieldIndex: number;
  field: Field;
  labels: Labels;
  canonical: string;
  key: string;
}

interface Entry {
  series: Series;
  canonical: string;
  /** The merged samples of a key with several frames. Undefined: the series is final as built. */
  samples?: Map<number, number | null>;
}

/** The times rise without a repeat. check() lets a repeat pass, and a repeat must go through the merge. */
function strictlyRising(times: readonly number[]): boolean {
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) {
      return false;
    }
  }
  return true;
}

/**
 * Index the first numeric field of each frame for one query.
 * A key with one frame uses the arrays of the frame as they are: check() has verified length and order, and the
 * controller has copied them at the boundary. A key with several frames merges the samples by time.
 */
export function indexSeries(frames: DataFrame[], refId: string): { series: Series[]; report: ReportEntry[] } {
  const report: ReportEntry[] = [];
  const checked = indexFrames(frames).candidates;
  const candidates = new Map<DataFrame, (typeof checked)[number]>();
  for (const candidate of checked) {
    if (!candidates.has(candidate.frame)) {
      candidates.set(candidate.frame, candidate);
    }
  }
  const pending: Pending[] = [];
  const framesOfKey = new Map<string, number>();
  frames.forEach((frame, frameIndex) => {
    if (frame.refId !== refId) {
      return;
    }
    const fieldIndex = frame.fields.findIndex((field) => field.type === FieldType.number);
    if (fieldIndex < 0) {
      return;
    }
    const field = frame.fields[fieldIndex];
    const labels = field.labels ?? {};
    const key = JSON.stringify([
      Object.keys(labels)
        .sort()
        .map((name) => [name, labels[name]]),
      field.name,
    ]);
    framesOfKey.set(key, (framesOfKey.get(key) ?? 0) + 1);
    pending.push({ frame, frameIndex, fieldIndex, field, labels, canonical: canonicalLabels(labels), key });
  });
  const entries = new Map<string, Entry>();
  const conflicts = new Set<string>();
  let manyFields = false;
  for (const { frame, frameIndex, fieldIndex, field, labels, canonical, key } of pending) {
    if (!manyFields && frame.fields.filter((item) => item.type === FieldType.number).length > 1) {
      manyFields = true;
      report.push({ kind: 'many-fields', refId, message: 'Use the first numeric field of each frame.' });
    }
    const candidate = candidates.get(frame)!;
    if (framesOfKey.get(key) === 1 && !candidate.unsupported) {
      const times = candidate.timeField!.values;
      if (strictlyRising(times)) {
        entries.set(key, {
          series: { refId, labels, field, frameIndex, fieldIndex, times, values: field.values as Array<number | null> },
          canonical,
        });
        continue;
      }
    }
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        series: { refId, labels, field, frameIndex, fieldIndex, times: [], values: [] },
        canonical,
        samples: new Map(),
      };
      entries.set(key, entry);
    }
    if (candidate.unsupported) {
      report.push({ kind: 'invalid-series', refId, message: candidate.unsupported });
      continue;
    }
    const samples = entry.samples!;
    candidate.timeField!.values.forEach((time, i) => {
      const value = field.values[i] as number | null;
      if (samples.has(time) && samples.get(time) !== value && !conflicts.has(key)) {
        conflicts.add(key);
        report.push({ kind: 'duplicate-series', refId, labels });
      }
      samples.set(time, value);
    });
  }
  const ordered = [...entries.values()].sort((a, b) =>
    a.canonical < b.canonical
      ? -1
      : a.canonical > b.canonical
        ? 1
        : a.series.frameIndex - b.series.frameIndex || a.series.fieldIndex - b.series.fieldIndex
  );
  const series = ordered.map(({ series, samples }) => {
    if (samples) {
      series.times = [...samples.keys()].sort((a, b) => a - b);
      series.values = series.times.map((time) => samples.get(time)!);
    }
    return series;
  });
  return { series, report };
}
