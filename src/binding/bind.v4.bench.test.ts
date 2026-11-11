import { createTheme } from '@grafana/data';
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
