/**
 * The golden record of the inferred identity plan (spec 2026-11-11-inferred-identity-design.md, step S0).
 *
 * BASELINE: the record was made on commit a915fcd449b1d352715b259050ee59dc91419f37 of `main`, before any change in
 * `src/` for the plan. Step S9 measures that commit.
 *
 * The record is the safety net of steps S1 to S9. Cases 1 to 7 are compatibility cases: they must not change in any
 * step (AC4). Case 8 is the one case that changes on purpose, in step S4b (AC26, change C6). Each case binds a config
 * with the cells in the form that a generator or an author writes today, and keeps for each cell: the uses and their
 * series, the status, the text, the halves of a link, the URLs, the rows and the card; and the match report.
 * `patch.scope` is not in the record.
 *
 * To read the snapshot: `src/binding/__snapshots__/identity.golden.test.ts.snap`. Each case is one entry. Do not
 * update a snapshot to make a test pass. A change of a case 1–7 snapshot is a failure of the step.
 */
import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  type DataFrame,
  type DataQueryRequest,
  type FieldConfig,
  type Labels,
  type PanelData,
  type TimeRange,
} from '@grafana/data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import { boilerPilot, netL2Pilot } from '../fixtures/pilots-v4';
import { demoConfigV4 } from '../fixtures/demo-config';
import { buildCardV4, chartRowV4, type CardContextV4, type CardRowV4 } from '../interact/cardModel';
import type { ChartV4 } from '../model/v4';
import { validateConfig } from '../model/validate';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import type { CellEntry, CellIndex, CellMeta, HalfState } from '../types';
import { bindV4, type BindResultV4 } from './bindV4';
import { bindContextFor } from './context';

const theme = createTheme();
const bindCtx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
const T = [0, 60_000, 120_000];

// ---- cells and frames ----

type Cell = [id: string, attrs: Record<string, string>, isEdge?: boolean];

/** A cell index as buildCellIndex gives it: the metas after the contract, no DOM. */
function indexOf(cells: Cell[]): CellIndex {
  const metas: CellMeta[] = cells.map(([id, attrs, isEdge]) => cellMetaFromAttrs(id, attrs, isEdge ?? false));
  applyContract(metas);
  return new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
}

const ROOT: Cell = ['0', { 'pg-schema': '1' }];
const node = (id: string, attrs: Record<string, string> = {}): Cell => [
  `pg-node~${id}`,
  { 'pg-kind': 'node', 'pg-id': id, ...attrs },
];
const portCell = (nodeId: string, port: string, attrs: Record<string, string> = {}): Cell => [
  `pg-port~${nodeId}~${port}~1`,
  { 'pg-kind': 'port', 'pg-id': `${nodeId}:${port}`, 'pg-node': nodeId, 'pg-port': port, ...attrs },
];
const link = (id: string, from: string, to: string, attrs: Record<string, string> = {}): Cell => [
  id,
  { 'pg-kind': 'link', 'pg-id': id, 'pg-from': from, 'pg-to': to, ...attrs },
  true,
];

function frame(refId: string, labels: Labels, values: number[], config: FieldConfig = {}): DataFrame {
  return {
    refId,
    length: values.length,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: T.slice(T.length - values.length) },
      { name: 'Value', type: FieldType.number, config, labels, values },
    ],
  };
}

const range: TimeRange = {
  from: dateTime(0),
  to: dateTime(120_000),
  raw: { from: dateTime(0), to: dateTime(120_000) },
};

function panelData(series: DataFrame[], refIds: string[]): PanelData {
  const request: DataQueryRequest = {
    requestId: 'golden',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range,
    timezone: 'utc',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: refIds.map((refId) => ({ refId })),
  };
  return { state: LoadingState.Done, series, timeRange: range, request };
}

// ---- the frames of a case, made from the uses of its config ----

/** FNV-1a, to give each (cell, query) pair its own value: a wrong read of the series shows in the record. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  return h;
}

/** The labels that a series must have to match one cell through one match block (the forms the cases use). */
function labelSets(meta: CellMeta, match: Record<string, string>): Labels[] | undefined {
  const attr = (name: string) => (name === 'id' ? meta.id : meta.attrs[name]);
  let sets: Labels[] = [{}];
  for (const [name, matcher] of Object.entries(match)) {
    const own = attr(name);
    const fill = (text: string) => text.replace(/\$\{(\w+)\}/g, (_, n: string) => attr(n) ?? '');
    const ident = /^[A-Za-z_]\w*$/.exec(matcher);
    const equal = /^([A-Za-z_]\w*)="(.*)"$/.exec(matcher);
    const regex = /^([A-Za-z_]\w*)=~"(.*)"$/.exec(matcher);
    let additions: Labels[];
    if (ident) {
      if (own === undefined) {
        return undefined;
      }
      additions = [{ [matcher]: own }];
    } else if (equal) {
      additions = [{ [equal[1]]: fill(equal[2]) }];
    } else if (regex) {
      const text = fill(regex[2]).replace(/\[\.\]/g, '.');
      additions = text.includes('[12]')
        ? ['1', '2'].map((n) => ({ [regex[1]]: text.replace('[12]', n) }))
        : [{ [regex[1]]: text }];
    } else {
      throw new Error(`the golden record cannot make a series for the matcher ${matcher}`);
    }
    sets = sets.flatMap((set) => additions.map((add) => ({ ...set, ...add })));
  }
  return sets;
}

interface FrameOptions {
  /** the unit of the field of a refId */
  units?: Record<string, string>;
  /** the value of the last sample of a series; the default depends on the cell and the refId */
  value?: (cellId: string, refId: string) => number | undefined;
  /** a use that gets no series */
  skip?: (cellId: string, refId: string) => boolean;
}

/**
 * One series for each use of each cell, from the uses of a bind with no frames. The values differ for each pair of a
 * cell and a refId, so an `up` and a `down` series of one cell never have the same value.
 */
function framesFor(index: CellIndex, uses: BindResultV4['uses'], options: FrameOptions = {}): DataFrame[] {
  const refIds = [...new Set([...uses.values()].flatMap((list) => list.map((u) => u.refId)))].sort();
  const frames = new Map<string, DataFrame>();
  for (const [cellId, list] of uses) {
    const meta = index.get(cellId)!.meta;
    for (const use of list) {
      if (options.skip?.(cellId, use.refId)) {
        continue;
      }
      const sets = labelSets(meta, use.match as Record<string, string>);
      for (const labels of sets ?? []) {
        const key = JSON.stringify([use.refId, Object.entries(labels).sort()]);
        if (frames.has(key)) {
          continue;
        }
        const last =
          options.value?.(cellId, use.refId) ??
          1_000_000 * (1 + (hash(cellId + use.refId) % 50)) + 1234 * refIds.indexOf(use.refId);
        const unit = options.units?.[use.refId];
        frames.set(key, frame(use.refId, labels, [last * 0.9, last * 0.95, last], unit ? { unit } : {}));
      }
    }
  }
  return [...frames.values()];
}

// ---- the record ----

interface Env {
  index: CellIndex;
  validated: ReturnType<typeof validateConfig>;
  data: PanelData;
  result: BindResultV4;
}

const number = (x: number | undefined) => (x === undefined ? undefined : Number(x.toPrecision(10)));

const half = (h: HalfState | undefined) =>
  h && {
    status: h.status,
    value: number(h.value),
    percent: number(h.percent),
    percentDisplay: h.percentDisplay,
    capacity: number(h.capacity),
    capacitySource: h.capacitySource,
    label: h.label,
    color: h.color,
  };

const labelText = (labels: Labels) =>
  `{${Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')}}`;

const cardRow = (row: CardRowV4 | undefined) =>
  row && {
    key: row.key,
    kind: row.kind,
    status: row.status,
    title: row.title,
    text: row.text,
    state: row.state,
    stale: row.stale,
    directions: row.directions?.map((d) => ({
      direction: d.direction,
      label: d.label,
      text: d.text,
      mirrored: d.mirrored,
      history: d.history.state,
      times: d.history.state === 'ready' ? [...d.history.timestamps] : undefined,
      values: d.history.state === 'ready' ? d.history.values.map((v) => (v === null ? null : number(v))) : undefined,
    })),
    lines: row.lines?.map((l) => ({
      label: l.label,
      times: l.times,
      values: l.values.map((v) => (v === null ? null : number(v))),
    })),
    more: row.more,
    domain: row.domain?.map(number),
  };

/** The record of one bind: one entry for each cell, then the report. */
function record({ index, validated, data, result }: Env) {
  const cardCtx: CardContextV4 = { theme, replaceVariables: (s) => s, index, validated, data };
  const cells: Record<string, unknown> = {};
  for (const id of [...result.patches.keys()].sort()) {
    const patch = result.patches.get(id)!;
    const uses = result.uses.get(id) ?? [];
    const card = buildCardV4(id, result, cardCtx);
    const chartUse = uses.find((u) => u.kind === 'chart');
    const chart = chartUse
      ? cardRow(
          chartRowV4(
            { cellId: id, path: chartUse.path.replace(/\.(a2b|b2a)$/, ''), chart: chartUse.row as ChartV4 },
            result,
            cardCtx
          )
        )
      : undefined;
    cells[id] = {
      uses: uses.map((u) => ({ path: u.path, refId: u.refId })),
      series: Object.fromEntries(
        [...(result.series.get(id) ?? [])].map(([path, list]) => [path, list.map((s) => labelText(s.labels)).sort()])
      ),
      status: patch.statusV4 && { state: patch.statusV4.state, text: patch.statusV4.text },
      text: patch.shape && { status: patch.shape.status, text: patch.shape.text },
      unavailable: patch.unavailable?.reason,
      link: patch.link && { a2b: half(patch.link.a2b), b2a: half(patch.link.b2a), labelMode: patch.link.labelMode },
      urls: patch.urls.map((u) => ({ url: u.url, title: u.title })),
      rows: patch.rowsV4?.map((r) => ({ path: r.path, kind: r.kind, label: r.label, text: r.text, url: r.url })),
      card: {
        title: card.title,
        links: card.links.map((l) => ({ title: l.title, href: l.href })),
        rows: card.rows.map(cardRow),
      },
      chart,
    };
  }
  return JSON.parse(
    JSON.stringify({ classes: Object.fromEntries(result.cells), cells, report: result.report })
  ) as Record<string, unknown>;
}

interface CaseSpec {
  config: unknown;
  /** the cells, or an index that the caller made */
  cells?: Cell[];
  index?: CellIndex;
  xml?: string;
  /** the frames; by default one series for each use of each cell */
  frames?: DataFrame[] | ((uses: BindResultV4['uses'], index: CellIndex) => DataFrame[]);
  options?: FrameOptions;
}

function bindCase(spec: CaseSpec): Env {
  const index = spec.index ?? indexOf(spec.cells!);
  const validated = validateConfig(spec.config);
  const first = bindV4({
    index,
    xml: spec.xml,
    validated,
    data: { series: [], state: LoadingState.Done, timeRange: range },
    ctx: bindCtx,
  });
  const frames =
    typeof spec.frames === 'function'
      ? spec.frames(first.uses, index)
      : (spec.frames ?? framesFor(index, first.uses, spec.options));
  const refIds = [...new Set([...first.uses.values()].flatMap((list) => list.map((u) => u.refId)))];
  const data = panelData(frames, refIds);
  const result = bindV4({ index, xml: spec.xml, validated, data, ctx: bindCtx });
  return { index, validated, data, result };
}

const pretty = (entries: unknown) => JSON.stringify(entries, null, 1);

/** The report of a compatibility case is empty (S0). */
function expectEmptyReport(env: Env) {
  expect(pretty(env.result.report)).toBe('[]');
}

/** Every bound cell has the uses and the series that its class gives: a case with no series proves nothing. */
function expectSeriesBound(env: Env) {
  for (const [id, byPath] of env.result.series) {
    for (const [path, list] of byPath) {
      expect(list.length, `${id} ${path}`).toBeGreaterThan(0);
    }
  }
}

// ---- case 1: the pilot netL2Pilot, the whole config, on cells in the generated form ----

describe('golden record: compatibility cases (AC4)', () => {
  it('case 1: netL2Pilot with the cells of a generator', () => {
    const cells: Cell[] = [
      ROOT,
      node('rtr-a', { bind: 'host', key: 'rtr-a', object_class: 'router' }),
      node('sw-a1', { bind: 'unifi-switch', key: 'sw-a1', object_class: 'switch' }),
      node('sw-a2', { bind: 'unifi-switch', key: 'sw-a2', object_class: 'switch' }),
      node('ap-a', { bind: 'unifi-client', key: 'ap-a' }),
      node('cam-1', { bind: 'camera', key: 'cam-1' }),
      // the port cells have no `bind`. The far end of a link carries the port of another link (the trap).
      portCell('sw-a1', 'p3', { port: '3' }),
      portCell('sw-a2', 'p16', { port: '16' }),
      portCell('sw-a1', 'p4', { port: '3' }),
      portCell('sw-a2', 'p15', { port: '15' }),
      portCell('rtr-a', 'eth1', { port: '15' }),
      portCell('sw-a1', 'p5', { port: '5' }),
      link('pg-link~l1', 'sw-a1:p3', 'sw-a2:p16', {
        bind: 'lan',
        key: 'sw-a1',
        port: '3',
        at: 'source',
        path_role: 'uplink',
      }),
      link('pg-link~l2', 'sw-a1:p4', 'sw-a2:p15', {
        bind: 'lan',
        key: 'sw-a2',
        port: '15',
        at: 'target',
        path_role: 'uplink',
      }),
      link('pg-link~p-a1-15', 'sw-a2:p16', 'rtr-a:eth1', {
        bind: 'lan',
        key: 'sw-a2',
        port: '16',
        at: 'source',
        path_role: 'core',
      }),
      link('pg-link~l4', 'sw-a1:p5', 'cam-1', {
        bind: 'lan',
        key: 'sw-a1',
        port: '5',
        at: 'source',
        path_role: 'access',
      }),
    ];
    // lan_tx and lan_rx unit bps; a link reads the series of its own `key` and `port`
    const env = bindCase({
      config: netL2Pilot(),
      cells,
      options: {
        units: { lan_tx: 'bps', lan_rx: 'bps', unifi_port_speed: 'bps' },
        // a port speed of 1 Gb/s; the loads are of a few Mb/s
        value: (_, refId) => (refId === 'unifi_port_speed' ? 1e9 : undefined),
      },
    });
    expectEmptyReport(env);
    expectSeriesBound(env);
    expect([...env.result.cells.keys()].sort()).toEqual(['camera', 'host', 'lan', 'unifi-client', 'unifi-switch']);
    expect(env.result.series.get('pg-link~l1')?.get('classes.lan.up')).toHaveLength(1);
    expect(env.result.series.get('pg-link~l1')?.get('classes.lan.up')?.[0].labels).toEqual({
      name: 'sw-a1',
      port_num: '3',
    });
    expect(record(env)).toMatchSnapshot();
  });

  // ---- case 2: the pilot boilerPilot ----

  it('case 2: boilerPilot with a container that has another key', () => {
    const xml =
      '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="mod1" vertex="1" parent="1"/><mxCell id="mod2" vertex="1" parent="1"/>' +
      '<mxCell id="out1" vertex="1" parent="mod2"/><mxCell id="out2" vertex="1" parent="mod1"/>' +
      '<mxCell id="ctl" vertex="1" parent="1"/><mxCell id="mon1" vertex="1" parent="1"/>' +
      '<mxCell id="boiler1" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>';
    const cells: Cell[] = [
      ['ctl', { bind: 'controller', key: 'wb7' }],
      ['mod1', { bind: 'relay-module', key: 'm1' }],
      ['mod2', { bind: 'relay-module', key: 'm2' }],
      // out1 is inside mod2 (key m2) and out2 is inside mod1 (key m1): the container is the trap
      ['out1', { bind: 'relay-output', key: 'm1', port: '1' }],
      ['out2', { bind: 'relay-output', key: 'm2', port: '2' }],
      ['mon1', { bind: 'mains-monitor', key: 'mon1' }],
      ['boiler1', { bind: 'boiler', key: 'b1' }],
    ];
    const env = bindCase({ config: boilerPilot(), cells, xml, options: { units: { volt: 'volt' } } });
    expectEmptyReport(env);
    expectSeriesBound(env);
    expect(env.result.series.get('out1')?.get('classes.relay-output.text')?.[0].labels).toEqual({
      entity: 'switch.wb_mr6cu_m1_k1',
    });
    expect(record(env)).toMatchSnapshot();
  });

  // ---- case 3: demo L3 of today ----

  it('case 3: demo L3 as it is today (the copy in src/fixtures/golden)', () => {
    const dir = resolve(__dirname, '../fixtures/golden');
    const svg = readFileSync(resolve(dir, 'demo-l3-2026-11-11.svg'), 'utf8');
    const xml = readFileSync(resolve(dir, 'demo-l3-2026-11-11.drawio'), 'utf8');
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    // the series of stack/metrics-gen/gen.py, through the targets of demo/dashboard.template.json
    const bps = (bytes: number) => bytes * 8;
    const unit = { unit: 'bps' };
    const lan = [
      ['node-rtr-a', 'br-lan', 60_000_000, 12_000_000],
      ['node-rtr-b', 'br-lan', 2_500_000, 1_000_000],
      ['node-rtr-a', 'ts0', 400_000, 300_000],
      ['node-rtr-a', 'tun0', 200_000, 100_000],
      ['node-rtr-b', 'tun0', 150_000, 90_000],
      ['node-proxy-a', 'relay-out', 50_000, 20_000],
    ] as const;
    const wan = [
      ['node-isp-a', 'pppoe', 5_125_000, 1_250_000],
      ['node-radio', 'dhcp', 11_250_000, 2_000_000],
      ['node-isp-b', 'pppoe', 3_000_000, 500_000],
    ] as const;
    const up: Record<string, number> = {
      'node-net-a': 1,
      'node-net-b': 1,
      'node-rtr-a': 1,
      'node-rtr-b': 1,
      'node-isp-a': 1,
      'node-radio': 1,
      'node-lte': 0,
      'node-isp-b': 1,
      'node-proxy-a': 1,
      'node-proxy-b': 1,
    };
    const jobs = Object.keys(up);
    const sample = (refId: string, labels: Labels, last: number, config: FieldConfig = {}) =>
      frame(refId, labels, [last * 0.9, last * 0.95, last], config);
    const frames: DataFrame[] = [
      ...lan.map(([job, device, tx]) => sample('lan_tx', { job, device }, bps(tx), unit)),
      ...lan.map(([job, device, , rx]) => sample('lan_rx', { job, device }, bps(rx), unit)),
      ...wan.map(([job, device, tx]) => sample('wan_tx', { job, device }, bps(tx), unit)),
      ...wan.map(([job, device, , rx]) => sample('wan_rx', { job, device }, bps(rx), unit)),
      sample('speed', { job: 'node-rtr-a', device: 'br-lan' }, 125_000_000, { unit: 'Bps' }),
      sample('speed', { job: 'node-rtr-b', device: 'br-lan' }, 12_500_000, { unit: 'Bps' }),
      ...jobs.map((job) => sample('up', { job }, up[job])),
      ...jobs.map((job, i) => sample('load', { job }, 1 + 0.1 * i)),
      sample('cpu', { job: 'node-rtr-a' }, 42, unit),
      sample('cpu', { job: 'node-rtr-b' }, 23, unit),
      ...['node-rtr-a', 'node-rtr-b'].flatMap((job) =>
        [0, 1, 2].map((i) => sample('v4_samples', { job, line: `line-${i}` }, 20 * (i + 1), { unit: 'none' }))
      ),
      ...['node-rtr-a', 'node-rtr-b'].flatMap((job) =>
        Array.from({ length: 9 }, (_, i) =>
          sample('v4_nine', { job, line: `line-${i}` }, (i + 1) * 10 + (i % 5), { unit: 'none' })
        )
      ),
    ];
    // the refIds come from the config: bind once with no frames and read the uses
    const probe = bindCase({ config: demoConfigV4, index, xml, frames: [] });
    const refIds = [...new Set([...probe.result.uses.values()].flatMap((list) => list.map((u) => u.refId)))].sort();
    expect(refIds).toEqual(
      ['cpu', 'lan_rx', 'lan_tx', 'load', 'speed', 'up', 'v4_nine', 'v4_samples', 'wan_rx', 'wan_tx'].sort()
    );
    expect([...new Set(frames.map((f) => f.refId!))].sort()).toEqual(refIds);
    const env = bindCase({ config: demoConfigV4, index, xml, frames });
    // the LTE link has no `bind`, so it is not bound; every other cell and link end has a series
    expectEmptyReport(env);
    expectSeriesBound(env);
    expect(record(env)).toMatchSnapshot();
  });

  // ---- cases 4 to 6: hand-authored forms that have no `missing-attr` on main (reviews R1, R2) ----

  const r1Config = () => ({
    version: 4,
    classes: {
      r1: {
        match: { key: 'job' },
        text: { query: 'txt', match: { id: 'edge' } },
        rows: [{ kind: 'updown', up: 'tx', down: 'rx', label: 'Traffic', match: { id: 'edge' } }],
        chart: { kind: 'value', query: 'gauge', match: { id: 'edge' } },
        url: '/d/demo?edge=${id}',
      },
    },
  });

  it.each([
    ['no end gives key', {}],
    ['the target port has a node that gives key', { key: 'trap-node' }],
  ])('case 4 (R1, AC21): row, text and chart on the cell id; %s', (_, targetNode) => {
    const cells: Cell[] = [
      ROOT,
      node('src', { object_class: 'router' }),
      node('dst', targetNode),
      portCell('dst', 'p1'),
      link('link-1', 'src', 'dst:p1', { bind: 'r1' }),
    ];
    const env = bindCase({ config: r1Config(), cells, options: { units: { tx: 'bps', rx: 'bps' } } });
    expectEmptyReport(env);
    expectSeriesBound(env);
    expect(record(env)).toMatchSnapshot();
  });

  it('case 5 (R2, AC22): updown row on the cell id, own cap 50M/10M, a target that gives key', () => {
    const config = {
      version: 4,
      classes: {
        r2: {
          match: { key: 'job' },
          rows: [{ kind: 'updown', up: 'tx', down: 'rx', label: 'Traffic', match: { id: 'edge' } }],
        },
      },
    };
    const cells: Cell[] = [
      ROOT,
      node('src'),
      node('dst', { key: 'trap-node' }),
      portCell('dst', 'p1', { port: '9' }),
      link('link-2', 'src', 'dst:p1', { bind: 'r2', cap: '50M/10M' }),
    ];
    const env = bindCase({
      config,
      cells,
      options: {
        units: { tx: 'bps', rx: 'bps' },
        value: (_, refId) => (refId === 'tx' ? 7_000_000 : 2_000_000),
      },
    });
    expectEmptyReport(env);
    expectSeriesBound(env);
    const row = buildCardV4('link-2', env.result, {
      theme,
      replaceVariables: (s) => s,
      index: env.index,
      validated: env.validated,
      data: env.data,
    }).rows[0];
    expect(row.directions?.[0].text).toContain('14%');
    expect(record(env)).toMatchSnapshot();
  });

  it('case 6: extends, a replaced class match, an override row with its own match', () => {
    const config = {
      version: 4,
      classes: {
        base: { rows: [{ kind: 'updown', up: 'btx', down: 'brx', label: 'Base', match: { id: 'edge' } }] },
        child: { extends: 'base', match: { key: 'job' } },
        'ovr-match': {
          match: { key: 'job' },
          status: 'st',
          up: 'ltx',
          down: 'lrx',
          rows: [{ kind: 'value', query: 'val' }],
        },
        'ovr-row': {
          match: { key: 'job' },
          rows: [{ kind: 'metadata', label: 'Note', text: 'plain' }],
        },
      },
      overrides: {
        'link-c': { match: { id: 'edge' } },
        'link-d': { rows: [{ kind: 'updown', up: 'otx', down: 'orx', label: 'Own', match: { id: 'edge' } }] },
      },
    };
    const cells: Cell[] = [
      ROOT,
      node('src'),
      node('dst', { key: 'trap-node' }),
      portCell('dst', 'p1', { port: '9' }),
      link('link-a', 'src', 'dst:p1', { bind: 'child' }),
      link('link-b', 'src', 'dst:p1', { bind: 'child', at: 'target' }),
      link('link-c', 'src', 'dst:p1', { bind: 'ovr-match' }),
      link('link-d', 'src', 'dst:p1', { bind: 'ovr-row' }),
    ];
    const units = Object.fromEntries(['btx', 'brx', 'ltx', 'lrx', 'otx', 'orx'].map((refId) => [refId, 'bps']));
    const env = bindCase({ config, cells, options: { units } });
    expectEmptyReport(env);
    expectSeriesBound(env);
    expect(record(env)).toMatchSnapshot();
  });

  // ---- case 7: vertices (N2) ----

  it('case 7 (N2): a port cell and a plain vertex with own key, at=target, an updown row and an updown chart', () => {
    const config = {
      version: 4,
      classes: {
        vtx: {
          match: { key: 'job' },
          rows: [{ kind: 'updown', up: 'tx', down: 'rx', label: 'Traffic' }],
          chart: { kind: 'updown', up: 'tx', down: 'rx' },
        },
      },
    };
    const cells: Cell[] = [
      ROOT,
      node('n7', { key: 'node-key' }),
      portCell('n7', 'p1', { bind: 'vtx', key: 'port-key', at: 'target' }),
      ['vertex-1', { bind: 'vtx', key: 'vertex-key', at: 'target' }],
    ];
    const env = bindCase({
      config,
      cells,
      options: {
        units: { tx: 'bps', rx: 'bps' },
        value: (_, refId) => (refId === 'tx' ? 7_000_000 : 2_000_000),
      },
    });
    expectEmptyReport(env);
    expectSeriesBound(env);
    // at=target flips the feeds: the a2b half of the row reads rx
    expect(env.result.uses.get('vertex-1')?.map((u) => [u.path.slice(-4), u.refId])).toEqual([
      ['.a2b', 'rx'],
      ['.b2a', 'tx'],
      ['.a2b', 'rx'],
      ['.b2a', 'tx'],
    ]);
    const recorded = record(env) as { cells: Record<string, { chart?: unknown }> };
    expect(recorded.cells['vertex-1'].chart).toBeDefined();
    expect(recorded.cells['pg-port~n7~p1~1'].chart).toBeDefined();
    expect(recorded).toMatchSnapshot();
  });
});

// ---- case 8: the one case that changes on purpose (S4b, C6, AC26) ----

describe('golden record: the case that changes in S4b', () => {
  it('case 8 (C6, AC26): the capacity use lacks key on main; the row shows 14% of the own cap', () => {
    const config = {
      version: 4,
      classes: {
        link: {
          match: { key: 'job' },
          capacity: 'speed',
          rows: [{ kind: 'updown', up: 'tx', down: 'rx', label: 'Traffic', match: { id: 'edge' } }],
        },
      },
    };
    const cells: Cell[] = [
      ROOT,
      node('src'),
      node('dst', { key: 'tgt' }),
      portCell('dst', 'p1'),
      link('link-8', 'src', 'dst:p1', { bind: 'link', cap: '50M/10M' }),
    ];
    const unit = { unit: 'bps' };
    const frames = [
      frame('tx', { edge: 'link-8' }, [6_300_000, 6_650_000, 7_000_000], unit),
      frame('rx', { edge: 'link-8' }, [1_800_000, 1_900_000, 2_000_000], unit),
      frame('speed', { job: 'tgt' }, [1e9, 1e9, 1e9], unit),
    ];
    const env = bindCase({ config, cells, frames });
    // main: the capacity use has `missing-attr`; the series of `speed` has no cell
    expect(env.result.report.map((e) => e.kind).sort()).toEqual(['missing-attr', 'orphan-series']);
    expect(env.result.report.find((e) => e.kind === 'missing-attr')).toMatchObject({
      path: 'classes.link.capacity',
      attr: 'key',
    });
    const row = buildCardV4('link-8', env.result, {
      theme,
      replaceVariables: (s) => s,
      index: env.index,
      validated: env.validated,
      data: env.data,
    }).rows[0];
    expect(row.directions?.[0].text).toContain('14%');
    expect(record(env)).toMatchSnapshot();
  });
});
