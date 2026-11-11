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

/** Build links whose identity comes from one port and its node. Alternate the measured end. */
export function buildInferredBenchFixture(opts: { links: number; series: number; seed: number }): BenchFixture {
  const own = buildBenchFixture({ cells: opts.links, series: opts.series, seed: opts.seed });
  const groups = ['<g data-cell-id="0" data-meta-pg-schema="1"></g>'];
  const cellIds: string[] = [];
  for (const [i, node] of own.cellIds.entries()) {
    const peer = own.cellIds[(i + 1) % opts.links];
    const id = `demo-link-${i}`;
    const ends = [`${node}:measured`, `${peer}:peer`];
    if (i % 2 !== 0) {
      ends.reverse();
    }
    groups.push(
      `<g data-cell-id="pg-node~${node}" data-meta-pg-kind="node" data-meta-pg-id="${node}" data-meta-key="${node}"><rect width="40" height="20"/></g>`,
      `<g data-cell-id="pg-port~${node}~measured~1" data-meta-pg-kind="port" data-meta-pg-id="${node}:measured" data-meta-pg-node="${node}" data-meta-pg-port="measured" data-meta-port="if-${i}"><rect width="10" height="10"/></g>`,
      `<g data-cell-id="pg-port~${node}~peer~1" data-meta-pg-kind="port" data-meta-pg-id="${node}:peer" data-meta-pg-node="${node}" data-meta-pg-port="peer"><rect width="10" height="10"/></g>`,
      `<g data-cell-id="${id}" data-meta-pg-kind="link" data-meta-pg-id="${id}" data-meta-pg-from="${ends[0]}" data-meta-pg-to="${ends[1]}" data-meta-bind="link"><path d="M 0 0 L 50 0" fill="none" pointer-events="stroke"/></g>`
    );
    cellIds.push(id);
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${groups.join('')}</svg>`,
    cellIds,
    data: {
      ...own.data,
      series: own.data.series.map((frame, i) => ({
        ...frame,
        fields: frame.fields.map((field) =>
          field.type === FieldType.number ? { ...field, labels: { ...field.labels, device: `if-${i}` } } : field
        ),
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
