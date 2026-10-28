import { dateTime, FieldType, LoadingState, type PanelData } from '@grafana/data';

export interface BenchFixture {
  svg: string;
  data: PanelData;
  cellIds: string[];
}

/** Build the same demo cells and samples for each seed, without a binding model. */
export function buildBenchFixture(opts: { cells: number; series: number; seed: number }): BenchFixture {
  let state = opts.seed >>> 0;
  const sample = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % 101;
  };
  const name = (i: number) => `${i % 2 === 0 ? 'node' : 'sw'}-${i}`;
  const at = 1_700_000_000_000;
  const from = dateTime(at - 60_000);
  const to = dateTime(at);
  const cellIds = Array.from({ length: opts.cells }, (_, i) => name(i));
  const groups = cellIds.map(
    (id, i) =>
      `<g data-cell-id="${id}" data-meta-bind="device" data-meta-key="${id}"><rect x="${(i % 20) * 50}" y="${Math.floor(i / 20) * 30}" width="40" height="20"/><text>${id}</text></g>`
  );
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${Math.ceil(opts.cells / 20) * 30}">${groups.join('')}</svg>`,
    cellIds,
    data: {
      state: LoadingState.Done,
      timeRange: { from, to, raw: { from, to } },
      series: Array.from({ length: opts.series }, (_, i) => ({
        refId: 'status',
        name: name(i),
        length: 1,
        fields: [
          { name: 'Time', type: FieldType.time, config: {}, values: [at] },
          {
            name: 'Value',
            type: FieldType.number,
            config: { unit: 'percent' },
            labels: { job: name(i) },
            values: [sample()],
          },
        ],
      })),
    },
  };
}

/** Keep the v3 adapter separate from the fixture that later models reuse. */
export function benchV3Config(fixture: BenchFixture): unknown {
  return {
    version: 3,
    queries: [{ id: 'status', name: 'Status', source: { kind: 'panel', refId: 'status' } }],
    patterns: fixture.cellIds.map((id) => ({
      id,
      name: id,
      select: { ids: [id] },
      display: {
        shape: {
          binding: { queryId: 'status', match: { job: id }, reducer: 'last' },
          target: 'shape',
          text: true,
        },
      },
    })),
    overrides: [],
    widgets: [],
  };
}
