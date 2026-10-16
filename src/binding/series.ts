import { type DataFrame, FieldType, getFieldDisplayName } from '@grafana/data';
import type { SeriesInfo, SeriesSelector, TemplateScope } from '../types';
import { compileMatcher } from './select';
import { resolveTemplate } from './template';

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

export interface FindResult {
  series?: SeriesInfo;
  unresolved: string[];
}

/** First series that satisfies refId, name and every label matcher. Templates resolve against scope first. */
export function findSeries(sel: SeriesSelector, series: SeriesInfo[], scope: TemplateScope): FindResult {
  const unresolved: string[] = [];
  const labelTests: Array<[string, (v: string) => boolean]> = [];
  for (const [k, tpl] of Object.entries(sel.match ?? {})) {
    const r = resolveTemplate(tpl, scope);
    unresolved.push(...r.unresolved);
    labelTests.push([k, compileMatcher(r.text)]);
  }
  let nameTest: ((v: string) => boolean) | undefined;
  if (sel.name) {
    const r = resolveTemplate(sel.name, scope);
    unresolved.push(...r.unresolved);
    nameTest = compileMatcher(r.text);
  }
  if (unresolved.length) {
    return { unresolved };
  }
  const hit = series.find((s) => {
    if (sel.refId && s.refId !== sel.refId) {
      return false;
    }
    if (nameTest && !nameTest(s.name)) {
      return false;
    }
    return labelTests.every(([k, test]) => s.labels[k] !== undefined && test(s.labels[k]));
  });
  return { series: hit, unresolved };
}
