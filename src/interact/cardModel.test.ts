import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  ThresholdsMode,
  type DataFrame,
  type DataQueryRequest,
  type FieldConfig,
  type Field,
  type Labels,
  type LinkModel,
  type PanelData,
} from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import { bindContextFor } from '../binding/context';
import { bindV4 } from '../binding/bindV4';
import { validateConfig } from '../model/validate';
import type { CellEntry, CellIndex, CellMeta, CellPatch } from '../types';
import type { Series } from '../query/snapshot';
import {
  buildCardV4,
  chartHeight,
  opensCard,
  SPARK_HEIGHT,
  staleDeadline,
  type CardContextV4,
  type ConfiguredCardRow,
  type DirectionRowModel,
} from './cardModel';

const theme = createTheme();
const color = (name: string) => theme.visualization.getColorByName(name);
const bindCtx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
const T = [0, 60_000, 120_000];

function indexOf(): CellIndex {
  const metas: CellMeta[] = [cellMetaFromAttrs('rtr', { bind: 'rtr', key: 'node-rtr-a', label: 'Router A' }, false)];
  applyContract(metas);
  return new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
}

function frame(refId: string, labels: Labels, values: Array<number | null>, config: FieldConfig = {}): DataFrame {
  return {
    refId,
    length: values.length,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: T.slice(T.length - values.length) },
      { name: 'Value', type: FieldType.number, config, labels, values },
    ],
  };
}

function panelData(series: DataFrame[]): PanelData {
  const timeRange = { from: dateTime(0), to: dateTime(120_000), raw: { from: dateTime(0), to: dateTime(120_000) } };
  const request: DataQueryRequest = {
    requestId: 'demo',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range: timeRange,
    timezone: 'utc',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: [...new Set(series.map((f) => f.refId!))].map((refId) => ({ refId })),
  };
  return { state: LoadingState.Done, series, timeRange, request };
}

/** Bind the class `rtr` to the frames and build the card of the cell. */
function card(cls: Record<string, unknown>, frames: DataFrame[], over: Partial<CardContextV4> = {}) {
  const index = indexOf();
  const validated = validateConfig({ version: 4, classes: { rtr: { match: { key: 'job' }, ...cls } } });
  const data = panelData(frames);
  const bound = bindV4({ index, validated, data, ctx: bindCtx });
  const ctx: CardContextV4 = { theme, replaceVariables: (s) => s, index, validated, data, ...over };
  return buildCardV4('rtr', bound, ctx);
}

const job = { job: 'node-rtr-a' };
const thresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 5, color: 'red' },
  ],
};

describe('status row of a card', () => {
  const rows = [
    { kind: 'metadata', label: 'Key', text: '${key}' },
    { kind: 'drilldown', label: 'Open', url: '/d/rtr?var-key=${key}' },
    { kind: 'value', query: 'cpu' },
  ];
  const frames = (up: number) => [frame('up', job, [up], { thresholds }), frame('cpu', job, [40], { unit: 'percent' })];
  it('shows a state that is not normal first, before the rows, with its text', () => {
    const model = card({ status: 'up', rows }, frames(9));
    expect(model.rows[0]).toMatchObject({ key: 'status', kind: 'status', status: 'critical', text: '9' });
    // the drilldown row is a footer link, not a row, but it keeps its place in the row keys
    expect(model.rows.slice(1).map((r) => r.key)).toEqual(['row-0', 'row-2']);
  });
  it('adds no status row for a normal state when the card has rows', () => {
    const model = card({ status: 'up', rows }, frames(1));
    expect(model.rows.map((r) => r.kind)).toEqual(['metadata', 'value']);
  });
  it('shows the one status row for a normal state when the card has no rows', () => {
    const model = card({ status: 'up' }, frames(1));
    expect(model.rows.map((r) => [r.kind, r.title])).toEqual([['status', 'normal']]);
  });
  it('shows the reason of a cell that is down, with no value', () => {
    const model = card({ status: 'up', missing: 'down' }, [frame('up', { job: 'other' }, [1])]);
    expect(model.rows.map((r) => [r.kind, r.title, r.text])).toEqual([['status', 'down', 'No data']]);
  });
});

describe('card links', () => {
  it('shows a drilldown once, as a footer link, and not again when the cell url has the same target', () => {
    const model = card(
      {
        url: '/d/vpn',
        rows: [
          { kind: 'metadata', label: 'Role', text: '${key}' },
          { kind: 'drilldown', label: 'Open dashboard', url: '/d/vpn' },
        ],
      },
      [frame('cpu', job, [1])]
    );
    expect(model.rows.map((r) => [r.title, r.text])).toEqual([['Role', 'node-rtr-a']]);
    expect(model.links.filter((l) => l.href === '/d/vpn')).toHaveLength(1);
    expect(model.links[0].target).toBe('_blank');
  });
  it('drops a drilldown whose url is not allowed after substitution', () => {
    const model = card({ rows: [{ kind: 'drilldown', label: 'Go', url: 'javascript:alert(1)' }] }, [
      frame('cpu', job, [1]),
    ]);
    expect(model.links).toEqual([]);
  });
});

describe('field data links', () => {
  /** A frame whose number field has the data links of its Grafana field config. */
  function linked(refId: string, values: Array<number | null>, links: Array<Pick<LinkModel, 'title' | 'href'>>) {
    const f = frame(refId, job, values, { links: links.map((l) => ({ title: l.title, url: l.href })) });
    const getLinks = vi.fn(() => links.map((l): LinkModel<Field> => ({ ...l, target: '_blank', origin: f.fields[1] })));
    f.fields[1].getLinks = getLinks;
    return { frame: f, getLinks };
  }
  const host = { title: 'Host overview', href: '/d/host?var-job=node-rtr-a' };
  it('adds the data links of the series of the cell to a card with no class url, once each', () => {
    const up = linked('up', [1, 1, null], [host]);
    const cpu = linked('cpu', [40], [host, { title: 'CPU', href: '/d/cpu' }]);
    const model = card({ status: 'up', rows: [{ kind: 'value', query: 'cpu' }] }, [up.frame, cpu.frame]);
    expect(model.links.map((l) => [l.title, l.href])).toEqual([
      ['Host overview', '/d/host?var-job=node-rtr-a'],
      ['CPU', '/d/cpu'],
    ]);
    // the row of the last value in the frame gives the link context (${__value.text})
    expect(up.getLinks).toHaveBeenCalledWith({ valueRowIndex: 1 });
  });
  it('puts the data links after the class url and before the drilldowns', () => {
    const cpu = linked('cpu', [40], [{ title: 'CPU', href: '/d/cpu' }]);
    const model = card(
      { url: '/d/rtr', urlTitle: 'Router', rows: [{ kind: 'drilldown', label: 'Logs', url: '/d/logs' }] },
      [cpu.frame]
    );
    // the class does not use cpu: its data links are not for this cell
    expect(model.links.map((l) => l.title)).toEqual(['Router', 'Logs']);
    const withRow = card(
      {
        url: '/d/rtr',
        urlTitle: 'Router',
        rows: [
          { kind: 'value', query: 'cpu' },
          { kind: 'drilldown', label: 'Logs', url: '/d/logs' },
        ],
      },
      [cpu.frame]
    );
    expect(withRow.links.map((l) => l.title)).toEqual(['Router', 'CPU', 'Logs']);
  });
});

describe('updown row', () => {
  const traffic = { kind: 'updown', label: 'Traffic', up: 'tx', down: 'rx' };
  const frames = (tx: Array<number | null>, rx: Array<number | null>, config: FieldConfig = { unit: 'bps' }) => [
    frame('tx', job, tx, config),
    frame('rx', job, rx, config),
  ];
  const directions = (model: ReturnType<typeof card>): DirectionRowModel[] => model.rows[0].directions!;

  it('shows both current values and draws down mirrored below zero in a symmetric domain', () => {
    const model = card({ rows: [traffic] }, frames([5e6, 8.2e6], [2e6, 1.1e6]));
    expect(model.rows).toHaveLength(1);
    const row = model.rows[0];
    expect(row).toMatchObject({ kind: 'updown', title: 'Traffic', state: 'ready' });
    // the largest value of both directions with 10% headroom
    expect(row.domain![0]).toBeCloseTo(-9.02e6);
    expect(row.domain![1]).toBeCloseTo(9.02e6);
    expect(row.text).toBe('↑ 8.20 Mb/s  ↓ 1.10 Mb/s');
    expect(directions(model).map((d) => [d.direction, d.label, d.mirrored, d.text])).toEqual([
      ['up', '↑', false, '8.20 Mb/s'],
      ['down', '↓', true, '1.10 Mb/s'],
    ]);
  });
  it('is twice as tall as a single sparkline, so each half is as tall as one', () => {
    const row = card({ rows: [traffic] }, frames([5e6], [2e6])).rows[0];
    expect(chartHeight(row)).toBe(2 * SPARK_HEIGHT);
  });
  it('colours each direction from the thresholds of its own value', () => {
    const config = {
      unit: 'bps',
      thresholds: {
        mode: ThresholdsMode.Absolute,
        steps: [
          { value: -Infinity, color: 'green' },
          { value: 5e6, color: 'red' },
        ],
      },
    };
    const [up, down] = directions(card({ rows: [traffic] }, frames([8.2e6], [1.1e6], config)));
    expect(up.color).toBe(color('red'));
    expect(down.color).toBe(color('green'));
  });
  it('keeps the row when one direction has no data, with the colour of no data', () => {
    const model = card({ rows: [traffic] }, [
      frame('tx', job, [8.2e6], { unit: 'bps' }),
      frame('rx', { job: 'x' }, [1]),
    ]);
    expect(model.rows[0]).toMatchObject({ state: 'ready', text: '↑ 8.20 Mb/s  ↓ No data' });
    expect(directions(model)[1].color).toBe(theme.colors.text.disabled);
  });
  it('shows the state of the first direction when no direction has data', () => {
    const model = card({ rows: [traffic] }, [frame('tx', { job: 'x' }, [1]), frame('rx', { job: 'x' }, [1])]);
    expect(model.rows[0]).toMatchObject({ state: 'empty', text: '↑ No data  ↓ No data' });
  });
});

describe('chartHeight', () => {
  const row = (directions?: Array<Pick<DirectionRowModel, 'mirrored'>>): Pick<ConfiguredCardRow, 'directions'> => ({
    directions: directions as DirectionRowModel[] | undefined,
  });
  it('is one sparkline for a row with no direction or with no mirrored direction', () => {
    expect(chartHeight(row())).toBe(SPARK_HEIGHT);
    expect(chartHeight(row([{ mirrored: false }]))).toBe(SPARK_HEIGHT);
  });
  it('is two sparklines for a row with a mirrored direction', () => {
    expect(chartHeight(row([{ mirrored: false }, { mirrored: true }]))).toBe(2 * SPARK_HEIGHT);
  });
});

describe('staleDeadline', () => {
  const row: ConfiguredCardRow = { key: 'row-0', kind: 'history', title: 'cpu', text: '', state: 'ready' };
  it('gives the stale deadline of the row, or nothing', () => {
    expect(staleDeadline({ ...row, staleAfter: 60_000 })).toBe(60_000);
    expect(staleDeadline(row)).toBeUndefined();
  });
});

describe('opensCard', () => {
  const bare = (over: Partial<Parameters<typeof opensCard>[0]> = {}): Parameters<typeof opensCard>[0] => ({
    cellId: 'node-rtr-a',
    scope: { cell: { key: 'node-rtr-a' } },
    urls: [],
    ...over,
  });
  const statusView: NonNullable<CellPatch['statusView']> = {
    state: 'down',
    reason: 'Device down',
    conditionKey: 'health',
    queryIds: [],
    coverage: { available: 1, expected: 1 },
  };
  it('is true for a cell with a url, a row of its class or a status', () => {
    expect(opensCard(bare({ urls: [{ url: '/d/x' }] }))).toBe(true);
    expect(
      opensCard(bare({ rowsV4: [{ path: 'rows[0]', kind: 'metadata', label: 'Device', text: 'node-rtr-a' }] }))
    ).toBe(true);
    expect(opensCard(bare({ statusView }))).toBe(true);
  });
  it('is false for a cell that only colours, or has an empty list of rows', () => {
    expect(opensCard(bare())).toBe(false);
    expect(opensCard(bare({ rowsV4: [] }))).toBe(false);
  });
  it('is true for a cell whose series have data links, for example a link with only up and down', () => {
    const series = (config: FieldConfig): Series => {
      const field: Field = { name: 'Value', type: FieldType.number, config, values: [1], getLinks: () => [] };
      return { refId: 'tx', labels: job, field, frameIndex: 0, fieldIndex: 1, times: [0], values: [1] };
    };
    const links = [{ title: 'Interface details', url: '/d/iface' }];
    expect(opensCard(bare(), new Map([['classes.lan.up', [series({ links })]]]))).toBe(true);
    expect(opensCard(bare(), new Map([['classes.lan.up', [series({})]]]))).toBe(false);
    expect(opensCard(bare(), new Map([['classes.lan.up', []]]))).toBe(false);
  });
});
