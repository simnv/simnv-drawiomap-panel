import { createTheme, dateTime, FieldType, LoadingState, type DataFrame, type PanelData } from '@grafana/data';
import { afterEach, expect, it, vi } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import { validateConfig } from '../model/validate';
import type { CellEntry } from '../types';
import { bindV4, type PatchV4 } from './bindV4';
import { bindContextFor } from './context';
import * as freshness from './freshness';

const ctx = bindContextFor({
  theme: createTheme(),
  replaceVariables: (s) => s,
  timeZone: 'utc',
  linkWidth: { min: 2, max: 10 },
});

const frame = (job: string, times: number[]): DataFrame => ({
  refId: 'up',
  length: times.length,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: times },
    { name: 'Value', type: FieldType.number, config: {}, labels: { job }, values: times.map(() => 1) },
  ],
});

/** Data with no request: no step, so the cadence is the median step of the samples. */
function bindWithoutRequest(frames: DataFrame[]) {
  const metas = frames.map((f) =>
    cellMetaFromAttrs(f.fields[1].labels!.job, { bind: 'host', key: f.fields[1].labels!.job }, false)
  );
  applyContract(metas);
  const index = new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
  const timeRange = { from: dateTime(0), to: dateTime(120_000), raw: { from: dateTime(0), to: dateTime(120_000) } };
  const data: PanelData = { state: LoadingState.Done, series: frames, timeRange };
  const validated = validateConfig({
    version: 4,
    classes: { host: { match: { key: 'job' }, status: 'up', freshness: '1x' } },
  });
  return bindV4({ index, validated, data, ctx });
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('finds the cadence of a query once per bind, not once per cell', () => {
  const frames = [...Array.from({ length: 20 }, (_, i) => frame(`h${i}`, [0, 60_000, 120_000])), frame('old', [0])];
  // The test files of the logic project share one module cache, so the spy replaces the export instead of mocking it.
  const spy = vi.spyOn(freshness, 'cadenceOf');
  const r = bindWithoutRequest(frames);
  expect(spy).toHaveBeenCalledTimes(1);
  // the median step is 60 s, so one factor of the cadence is 60 s: only the cell with the sample at 0 is stale
  expect((r.patches.get('h0') as PatchV4).statusView).toMatchObject({ state: 'normal' });
  expect((r.patches.get('old') as PatchV4).statusView).toMatchObject({ state: 'stale' });
});
