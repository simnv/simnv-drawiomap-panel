import { createTheme } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { benchV3Config, buildBenchFixture } from '../fixtures/benchBind';
import { fieldDisplay } from '../query/frames';
import { buildCellIndex, cellMetas, mountSvg } from '../render/svgStage';
import type { BindContext } from '../types';
import { bindPlan } from './engine';
import { resolvePatterns } from './patterns';
import { resolverFrom } from './resolve';

describe('the v3 bind bench', () => {
  it('binds 300 cells against 1000 series and prints the median of 20 refreshes', () => {
    const fixture = buildBenchFixture({ cells: 300, series: 1000, seed: 42 });
    const root = mountSvg(document.createElement('div'), fixture.svg);
    const plan = resolvePatterns(cellMetas(buildCellIndex(root)), benchV3Config(fixture));
    expect(plan.diagnostics).toEqual([]);
    expect(Object.keys(plan.cells)).toEqual(fixture.cellIds);
    const theme = createTheme();
    const format = { theme, timeZone: 'utc' };
    const context: BindContext = {
      theme,
      replaceVariables: (text) => text,
      display: (series, value) => fieldDisplay(series.field, theme)(value),
      linkWidth: { min: 2, max: 10 },
    };
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      // Each refresh has a new data identity, so no snapshot or history model is reused.
      const data = { ...fixture.data };
      const resolve = resolverFrom([], new Map(), plan, data, format);
      const start = performance.now();
      const result = bindPlan(plan, resolve, context);
      times.push(performance.now() - start);
      expect(result.diagnostics).toEqual([]);
      expect([...result.patches.keys()]).toEqual(fixture.cellIds);
      for (const [i, id] of fixture.cellIds.entries()) {
        expect(result.patches.get(id)?.shape).toMatchObject({
          status: 'ok',
          value: fixture.data.series[i].fields[1].values[0],
        });
      }
    }
    times.sort((a, b) => a - b);
    const median = (times[9] + times[10]) / 2;
    console.log(`v3 bindPlan: 300 cells x 1000 series, 20 runs; median ${median.toFixed(3)} ms`);
  });
});
