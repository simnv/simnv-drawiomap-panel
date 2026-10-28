import { FieldType, type DataFrame, type Labels } from '@grafana/data';
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

/** Merge samples of the first numeric field of each frame for one query. */
export function indexSeries(frames: DataFrame[], refId: string): { series: Series[]; report: ReportEntry[] } {
  const report: ReportEntry[] = [];
  const checked = indexFrames(frames).candidates;
  const candidates = new Map<DataFrame, (typeof checked)[number]>();
  for (const candidate of checked) {
    if (!candidates.has(candidate.frame)) {
      candidates.set(candidate.frame, candidate);
    }
  }
  const merged = new Map<string, { series: Series; canonical: string; samples: Map<number, number | null> }>();
  const conflicts = new Set<string>();
  let manyFields = false;
  frames.forEach((frame, frameIndex) => {
    if (frame.refId !== refId) {
      return;
    }
    const fieldIndex = frame.fields.findIndex((field) => field.type === FieldType.number);
    if (fieldIndex < 0) {
      return;
    }
    if (!manyFields && frame.fields.filter((field) => field.type === FieldType.number).length > 1) {
      manyFields = true;
      report.push({ kind: 'many-fields', refId, message: 'Use the first numeric field of each frame.' });
    }
    const field = frame.fields[fieldIndex];
    const labels = field.labels ?? {};
    const canonical = canonicalLabels(labels);
    const key = JSON.stringify([
      Object.keys(labels)
        .sort()
        .map((name) => [name, labels[name]]),
      field.name,
    ]);
    let entry = merged.get(key);
    if (!entry) {
      entry = {
        series: { refId, labels, field, frameIndex, fieldIndex, times: [], values: [] },
        canonical,
        samples: new Map(),
      };
      merged.set(key, entry);
    }
    const candidate = candidates.get(frame)!;
    if (candidate.unsupported) {
      report.push({ kind: 'invalid-series', refId, message: candidate.unsupported });
      return;
    }
    candidate.timeField!.values.forEach((time, i) => {
      const value = field.values[i] as number | null;
      if (entry.samples.has(time) && entry.samples.get(time) !== value && !conflicts.has(key)) {
        conflicts.add(key);
        report.push({ kind: 'duplicate-series', refId, labels });
      }
      entry.samples.set(time, value);
    });
  });
  const ordered = [...merged.values()].sort((a, b) =>
    a.canonical < b.canonical
      ? -1
      : a.canonical > b.canonical
        ? 1
        : a.series.frameIndex - b.series.frameIndex || a.series.fieldIndex - b.series.fieldIndex
  );
  const series = ordered.map(({ series, samples }) => {
    series.times = [...samples.keys()].sort((a, b) => a - b);
    series.values = series.times.map((time) => samples.get(time)!);
    return series;
  });
  return { series, report };
}
