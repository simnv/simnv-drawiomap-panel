import { FieldType } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { buildBenchFixture } from './benchBind';

describe('the bind bench fixture', () => {
  const opts = { cells: 300, series: 1000, seed: 42 };

  it('gives 300 distinct cells and 1000 distinct series with demo names', () => {
    const fixture = buildBenchFixture(opts);
    const svg = new DOMParser().parseFromString(fixture.svg, 'image/svg+xml');
    const cells = [...svg.querySelectorAll('[data-cell-id]')];
    expect(cells).toHaveLength(300);
    expect(cells.map((cell) => cell.getAttribute('data-cell-id'))).toEqual(fixture.cellIds);
    expect(new Set(fixture.cellIds).size).toBe(300);
    expect(fixture.data.series).toHaveLength(1000);
    const jobs = fixture.data.series.map((frame) => {
      const field = frame.fields.find((field) => field.type === FieldType.number)!;
      expect(field.values).toHaveLength(frame.length);
      return field.labels?.job;
    });
    expect(new Set(jobs).size).toBe(1000);
    expect(jobs.every((job) => /^(node|sw)-\d+$/.test(job ?? ''))).toBe(true);
    expect(cells.map((cell) => cell.getAttribute('data-meta-key'))).toEqual(jobs.slice(0, 300));
  });

  it('gives the same SVG, ids, frames and time range for one seed', () => {
    expect(buildBenchFixture(opts)).toEqual(buildBenchFixture(opts));
  });

  it('changes the sample values with the seed', () => {
    const other = buildBenchFixture({ ...opts, seed: 43 });
    expect(other.data.series).not.toEqual(buildBenchFixture(opts).data.series);
  });

  it('uses the requested cell and series counts', () => {
    const fixture = buildBenchFixture({ cells: 2, series: 5, seed: 1 });
    expect(fixture.cellIds).toEqual(['node-0', 'sw-1']);
    expect(fixture.data.series).toHaveLength(5);
  });
});
