import {
  createTheme,
  dateTime,
  type DataFrame,
  type Field,
  FieldType,
  getDisplayProcessor,
  LoadingState,
  type PanelData,
} from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { buildBenchFixture, buildInferredBenchFixture } from '../fixtures/benchBind';
import { validateConfig } from '../model/validate';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { bindV4 } from './bindV4';
import { bindContextFor } from './context';

describe('the v4 bind bench', () => {
  const fixture = buildBenchFixture({ cells: 300, series: 1000, seed: 42 });
  const index = buildCellIndex(mountSvg(document.createElement('div'), fixture.svg));
  const ctx = bindContextFor({
    theme: createTheme(),
    replaceVariables: (s) => s,
    timeZone: 'utc',
    linkWidth: { min: 2, max: 10 },
  });

  it('binds the baseline fixture and prints the median of 20 refreshes', () => {
    const validated = validateConfig({ version: 4, classes: { device: { match: { key: 'job' }, status: 'status' } } });
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const data = { ...fixture.data };
      const start = performance.now();
      const result = bindV4({ index, validated, data, ctx });
      times.push(performance.now() - start);
      expect(result.report.map((entry) => entry.kind)).toEqual(['orphan-series']);
      expect([...result.patches.keys()]).toEqual(fixture.cellIds);
      for (const [i, id] of fixture.cellIds.entries()) {
        expect(result.series.get(id)?.get('classes.device.status')?.[0].field.values[0]).toBe(
          fixture.data.series[i].fields[1].values[0]
        );
      }
    }
    times.sort((a, b) => a - b);
    console.log(`v4 bind: 300 cells x 1000 series, 20 runs; median ${((times[9] + times[10]) / 2).toFixed(3)} ms`);
  });

  it('binds the inferred fixture and prints the median of 20 refreshes', () => {
    const inferred = buildInferredBenchFixture({ links: 300, series: 1000, seed: 42 });
    const inferredIndex = buildCellIndex(mountSvg(document.createElement('div'), inferred.svg));
    const metas = [...inferredIndex.values()].map((cell) => cell.meta);
    expect(metas.filter((meta) => meta.kind === 'node')).toHaveLength(300);
    expect(metas.filter((meta) => meta.kind === 'port')).toHaveLength(600);
    expect(metas.filter((meta) => Object.hasOwn(meta.attrs, 'key'))).toHaveLength(300);
    expect(metas.filter((meta) => Object.hasOwn(meta.attrs, 'port'))).toHaveLength(300);
    const links = metas.filter((meta) => meta.isEdge);
    expect(links).toHaveLength(300);
    for (const meta of links) {
      expect(Object.keys(meta.attrs).filter((name) => !name.startsWith('pg-'))).toEqual(['bind']);
    }
    const validated = validateConfig({
      version: 4,
      classes: { link: { match: { key: 'job', port: 'device' }, status: 'status' } },
    });
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const data = { ...inferred.data };
      const start = performance.now();
      const result = bindV4({ index: inferredIndex, validated, data, ctx });
      times.push(performance.now() - start);
      expect(result.report.map((entry) => entry.kind)).toEqual(['orphan-series']);
      expect([...result.patches.keys()]).toEqual(inferred.cellIds);
      for (const [i, id] of inferred.cellIds.entries()) {
        expect(result.series.get(id)?.get('classes.link.status')?.[0].field.values[0]).toBe(
          inferred.data.series[i].fields[1].values[0]
        );
        expect(result.measured.get(id)).toMatchObject({ end: i % 2 === 0 ? 'source' : 'target', reason: 'only' });
      }
    }
    times.sort((a, b) => a - b);
    console.log(
      `v4 inferred bind: 300 links x 1000 series, 20 runs; median ${((times[9] + times[10]) / 2).toFixed(3)} ms`
    );
  });

  it.each([
    ['distinct regexes', 'job=~"${key}"'],
    ['malformed matchers', 'job=~"${key}\\\\z"'],
  ])('finishes and reports for %s', (_, matcher) => {
    const validated = validateConfig({
      version: 4,
      classes: { device: { match: { key: matcher }, status: 'status' } },
    });
    const result = bindV4({ index, validated, data: { ...fixture.data }, ctx });
    expect(result.patches.size).toBe(300);
    if (matcher.includes('z')) {
      expect(result.report.some((entry) => entry.kind === 'matcher-error')).toBe(true);
    } else {
      expect(result.report.map((entry) => entry.kind)).toEqual(['orphan-series']);
    }
  });
});

describe('the v4 link-half bench', () => {
  const links = 565;
  const points = 600;
  const theme = createTheme();
  const ctx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
  const groups = ['<g data-cell-id="0" data-meta-pg-schema="1"></g>'];
  for (let i = 0; i < links; i++) {
    groups.push(
      `<g data-cell-id="l${i}" data-meta-pg-kind="link" data-meta-pg-id="l${i}" data-meta-bind="lan" data-meta-key="sw-${i}" data-meta-cap="${i % 3 === 0 ? '10G' : '1G'}"><path d="M 0 0 L 50 0" fill="none" pointer-events="stroke"/></g>`
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${groups.join('')}</svg>`;
  const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
  const at = 1_700_000_000_000;
  const from = dateTime(at - points * 1000);
  const to = dateTime(at);
  const frame = (refId: string, i: number): DataFrame => {
    const field = {
      name: 'Value',
      type: FieldType.number,
      config: { unit: 'bps' },
      labels: { name: `sw-${i}` },
      values: Array.from({ length: points }, (_, k) => ((i * 7 + k * 13) % 1000) * 1e5),
    } as Field;
    field.display = getDisplayProcessor({ field, theme, timeZone: 'utc' });
    const times = Array.from({ length: points }, (_, k) => from.valueOf() + k * 1000);
    return {
      refId,
      name: refId,
      length: points,
      fields: [{ name: 'Time', type: FieldType.time, config: {}, values: times }, field],
    };
  };
  const data: PanelData = {
    state: LoadingState.Done,
    timeRange: { from, to, raw: { from, to } },
    series: Array.from({ length: links }, (_, i) => [frame('tx', i), frame('rx', i)]).flat(),
  };
  const validated = validateConfig({
    version: 4,
    classes: { lan: { match: { key: 'name' }, up: 'tx', down: 'rx' } },
  });

  it('binds 565 links with two halves and 600 points, prints the median of 20 refreshes', () => {
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const start = performance.now();
      const result = bindV4({ index, validated, data: { ...data }, ctx });
      times.push(performance.now() - start);
      expect(result.patches.get('l0')?.link?.a2b).toMatchObject({ status: 'ok', capacity: 1e10 });
    }
    times.sort((a, b) => a - b);
    const median = ((times[9] + times[10]) / 2).toFixed(3);
    console.log(`v4 link halves: ${links} links x 2 halves x ${points} points; median ${median} ms`);
  });
});
