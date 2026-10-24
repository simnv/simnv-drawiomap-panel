import { type DataFrame, FieldType, getFieldDisplayName } from '@grafana/data';
import type { SeriesInfo } from '../types';

export function extractSeries(frames: DataFrame[]): SeriesInfo[] {
  const out: SeriesInfo[] = [];
  for (const frame of frames) {
    const timeField = frame.fields.find((f) => f.type === FieldType.time);
    const times = timeField ? (timeField.values as number[]) : undefined;
    for (const field of frame.fields) {
      if (field.type !== FieldType.number) {
        continue;
      }
      out.push({
        refId: frame.refId,
        name: getFieldDisplayName(field, frame, frames),
        labels: field.labels ?? {},
        values: field.values as number[],
        times,
        field,
        frame,
      });
    }
  }
  return out;
}
