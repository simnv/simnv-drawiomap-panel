import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  MappingType,
  type DataFrame,
  type DataQueryError,
  type DataQueryRequest,
  type FieldConfig,
  type Labels,
  type PanelData,
  type TimeRange,
  type ValueMapping,
} from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import { netL2Pilot } from '../fixtures/pilots-v4';
import { validateConfig } from '../model/validate';
import type { CellEntry, CellIndex, CellMeta } from '../types';
import { bindV4, type PatchV4 } from './bindV4';
import { bindContextFor } from './context';
import type { ReportEntry } from './report';

const theme = createTheme();
const ctx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
const T = [0, 60_000, 120_000];

type Cell = [id: string, attrs: Record<string, string>, isEdge?: boolean];

/** A cell index as buildCellIndex gives it: the metas after the contract, no DOM. */
function indexOf(cells: Cell[]): CellIndex {
  const metas: CellMeta[] = cells.map(([id, attrs, isEdge]) => cellMetaFromAttrs(id, attrs, isEdge ?? false));
  applyContract(metas);
  return new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
}

function frame(
  refId: string,
  labels: Labels,
  values: Array<number | null> = [1],
  config: FieldConfig = {},
  times = T.slice(T.length - values.length)
): DataFrame {
  return {
    refId,
    length: values.length,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: times },
      { name: 'Value', type: FieldType.number, config, labels, values },
    ],
  };
}

const range = (rawTo: TimeRange['raw']['to'] = dateTime(120_000)): TimeRange => ({
  from: dateTime(0),
  to: dateTime(120_000),
  raw: { from: dateTime(0), to: rawTo },
});

interface DataOptions {
  /** refIds that a target has but that have no frame */
  refs?: string[];
  state?: LoadingState;
  errors?: DataQueryError[];
  timeRange?: TimeRange;
}

function panelData(series: DataFrame[], opts: DataOptions = {}): PanelData {
  const refIds = [...new Set([...series.map((f) => f.refId!), ...(opts.refs ?? [])])];
  const timeRange = opts.timeRange ?? range();
  const request: DataQueryRequest = {
    requestId: 'demo',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range: timeRange,
    timezone: 'utc',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: refIds.map((refId) => ({ refId })),
  };
  return { state: opts.state ?? LoadingState.Done, series, timeRange, request, errors: opts.errors };
}

function run(config: unknown, cells: Cell[], frames: DataFrame[] = [], opts: DataOptions & { xml?: string } = {}) {
  const index = indexOf(cells);
  return bindV4({ index, xml: opts.xml, validated: validateConfig(config), data: panelData(frames, opts), ctx });
}

const entries = <K extends ReportEntry['kind']>(report: ReportEntry[], kind: K) =>
  report.filter((e): e is Extract<ReportEntry, { kind: K }> => e.kind === kind);
const patch = (r: ReturnType<typeof bindV4>, id: string) => r.patches.get(id) as PatchV4;

const HOST = { match: { key: 'job' }, status: 'up' };
const hostConfig = (classes: Record<string, unknown> = { host: HOST }, overrides?: Record<string, unknown>) => ({
  version: 4,
  classes,
  ...(overrides ? { overrides } : {}),
});

describe('bindV4: the report kinds of spec 4', () => {
  it('class-no-match: the cells of an abstract class get no data', () => {
    const r = run(
      hostConfig({ base: { status: 'up' }, host: HOST }),
      [
        ['a', { bind: 'base', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [frame('up', { job: 'b' })]
    );
    expect(entries(r.report, 'class-no-match')).toEqual([{ kind: 'class-no-match', cls: 'base', cellIds: ['a'] }]);
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing' });
    expect(r.uses.get('a')).toBeUndefined();
  });

  it('unknown-class: the cells with a bind that names no class', () => {
    const r = run(hostConfig(), [
      ['a', { bind: 'nope' }],
      ['b', { bind: 'nope' }],
      ['c', {}],
    ]);
    expect(entries(r.report, 'unknown-class')).toEqual([{ kind: 'unknown-class', cellIds: ['a', 'b'], bind: 'nope' }]);
    expect(r.patches.has('c')).toBe(false);
  });

  it('unknown-override: an override for a cell id that does not exist', () => {
    const r = run(hostConfig({ host: HOST }, { ghost: { missing: 'down' } }), [['a', { bind: 'host', key: 'a' }]]);
    expect(entries(r.report, 'unknown-override')).toEqual([{ kind: 'unknown-override', cellId: 'ghost' }]);
  });

  it('missing-attr: a cell that lacks an attribute of the match, also from.key of an edge end', () => {
    const r = run(
      hostConfig({
        host: { match: { key: 'job', port: 'port' }, status: 'up' },
        lan: { match: { key: 'name="${from.key}"' }, status: 'up' },
      }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
        ['l', { bind: 'lan', key: 'l' }, true],
      ],
      [frame('up', { job: 'a' })]
    );
    expect(entries(r.report, 'missing-attr')).toEqual([
      { kind: 'missing-attr', cls: 'host', path: 'classes.host.status', attr: 'port', cellIds: ['a', 'b'] },
      { kind: 'missing-attr', cls: 'lan', path: 'classes.lan.status', attr: 'from.key', cellIds: ['l'] },
    ]);
    // an invalid binding is never a proven outage, and it is not "no series"
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing' });
    expect(entries(r.report, 'no-series')).toEqual([]);
  });

  it('matcher-error: a regex outside the PromQL dialect selects no series', () => {
    const r = run(
      hostConfig({ host: { match: { key: 'instance=~"${key}\\\\z"' }, status: 'up' } }),
      [['a', { bind: 'host', key: 'node-a' }]],
      [frame('up', { instance: 'node-a' }), frame('up', { instance: 'node-az' })]
    );
    expect(entries(r.report, 'matcher-error')).toEqual([
      {
        kind: 'matcher-error',
        cls: 'host',
        path: 'classes.host.status',
        text: 'instance=~"node-a\\\\z"',
        message: 'not in the PromQL regex dialect: \\z',
        cellIds: ['a'],
      },
    ]);
    expect(r.series.get('a')?.get('classes.host.status')).toEqual([]);
  });

  it('template-unresolved: ${labels.x} when the status use selects many series', () => {
    const r = run(
      hostConfig({ host: { ...HOST, url: '/d/x?var-i=${labels.instance}' } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a', instance: '1' }), frame('up', { job: 'a', instance: '2' })]
    );
    expect(entries(r.report, 'template-unresolved')).toEqual([
      { kind: 'template-unresolved', cls: 'host', path: 'classes.host.url', cellIds: ['a'] },
    ]);
    expect(patch(r, 'a').urls).toEqual([]);
  });

  it('query-unavailable: a failed refId and a first load', () => {
    const failed = run(hostConfig(), [['a', { bind: 'host', key: 'a' }]], [], {
      refs: ['up'],
      errors: [{ refId: 'up', message: 'boom' }],
    });
    expect(entries(failed.report, 'query-unavailable')).toEqual([
      { kind: 'query-unavailable', refId: 'up', state: 'error', message: 'boom' },
    ]);
    expect(patch(failed, 'a').statusView).toMatchObject({ state: 'missing', reason: 'Query failed' });

    const loading = run(hostConfig(), [['a', { bind: 'host', key: 'a' }]], [], {
      refs: ['up'],
      state: LoadingState.Loading,
    });
    expect(entries(loading.report, 'query-unavailable')).toEqual([
      { kind: 'query-unavailable', refId: 'up', state: 'loading', message: 'Loading data' },
    ]);
  });

  it('unknown-ref: a refId that no target has gives "Unknown query", never down', () => {
    const r = run(hostConfig({ host: { ...HOST, missing: 'down' } }), [['a', { bind: 'host', key: 'a' }]]);
    expect(entries(r.report, 'unknown-ref')).toEqual([
      { kind: 'unknown-ref', cls: 'host', path: 'classes.host.status', refId: 'up' },
    ]);
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: 'Unknown query' });
    expect(entries(r.report, 'no-series')).toEqual([]);
  });

  it('unknown-ref: the path is the field that declares the refId, in the override or the parent class', () => {
    const r = run(
      hostConfig(
        { base: { status: 'gone' }, host: { extends: 'base', match: { key: 'job' } }, sw: HOST },
        { b: { status: 'extra' } }
      ),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'sw', key: 'b' }],
      ],
      [frame('up', { job: 'b' })]
    );
    expect(entries(r.report, 'unknown-ref')).toEqual([
      { kind: 'unknown-ref', cls: 'host', path: 'classes.base.status', refId: 'gone' },
      { kind: 'unknown-ref', cls: 'sw', path: 'overrides.b.status', refId: 'extra' },
    ]);
  });

  it('no-series: the cells whose use selects zero series of a ready query', () => {
    const r = run(
      hostConfig({ host: { ...HOST, missing: 'down' } }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [frame('up', { job: 'b' })]
    );
    expect(entries(r.report, 'no-series')).toEqual([
      { kind: 'no-series', cls: 'host', use: 'classes.host.status', cellIds: ['a'] },
    ]);
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'down' });
  });

  it('many-series: the count per cell where one series is expected', () => {
    const r = run(
      hostConfig({ host: { match: { key: 'job' }, text: { query: 'temp' } } }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [
        frame('temp', { job: 'a', i: '1' }),
        frame('temp', { job: 'a', i: '2' }),
        frame('temp', { job: 'b', i: '1' }),
        frame('temp', { job: 'b', i: '2' }),
        frame('temp', { job: 'b', i: '3' }),
      ]
    );
    expect(entries(r.report, 'many-series')).toEqual([
      {
        kind: 'many-series',
        cls: 'host',
        use: 'classes.host.text',
        cells: [
          { id: 'a', count: 2 },
          { id: 'b', count: 3 },
        ],
      },
    ]);
  });

  it('orphan-series: at most 50 label sets in the order of spec 3.7, then "+N more"', () => {
    const frames = Array.from({ length: 1000 }, (_, i) => frame('up', { job: `n${String(i).padStart(4, '0')}` }));
    const r = run(hostConfig(), [['a', { bind: 'host', key: 'n0003' }]], frames);
    const [orphans, ...rest] = entries(r.report, 'orphan-series');
    expect(rest).toEqual([]);
    expect(orphans.refId).toBe('up');
    expect(orphans.labels).toHaveLength(50);
    expect(orphans.labels.slice(0, 4)).toEqual([
      { job: 'n0000' },
      { job: 'n0001' },
      { job: 'n0002' },
      { job: 'n0004' },
    ]);
    expect(orphans.more).toBe(949);
  });

  it('many-fields, invalid-series and duplicate-series come from the series index, once per refId', () => {
    const twoFields: DataFrame = {
      refId: 'up',
      length: 1,
      fields: [
        { name: 'Time', type: FieldType.time, config: {}, values: [0] },
        { name: 'A', type: FieldType.number, config: {}, labels: { job: 'a' }, values: [1] },
        { name: 'B', type: FieldType.number, config: {}, labels: { job: 'a' }, values: [2] },
      ],
    };
    const noTime: DataFrame = {
      refId: 'up',
      length: 1,
      fields: [{ name: 'Value', type: FieldType.number, config: {}, labels: { job: 'b' }, values: [1] }],
    };
    const r = run(
      hostConfig(),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
        ['c', { bind: 'host', key: 'c' }],
      ],
      [twoFields, noTime, frame('up', { job: 'c' }, [1], {}, [0]), frame('up', { job: 'c' }, [2], {}, [0])]
    );
    expect(entries(r.report, 'many-fields')).toHaveLength(1);
    expect(entries(r.report, 'invalid-series')).toHaveLength(1);
    expect(entries(r.report, 'duplicate-series')).toEqual([
      { kind: 'duplicate-series', refId: 'up', labels: { job: 'c' } },
    ]);
  });

  it('unit-mismatch: units that do not convert make the use missing with "Mixed units"', () => {
    const r = run(
      hostConfig({ host: { match: { key: 'job' }, text: { query: 'temp', reduce: 'sum' } } }),
      [['a', { bind: 'host', key: 'a' }]],
      [
        frame('temp', { job: 'a', i: '1' }, [1], { unit: 'bps' }),
        frame('temp', { job: 'a', i: '2' }, [1], { unit: 'percent' }),
      ]
    );
    expect(entries(r.report, 'unit-mismatch')).toEqual([
      { kind: 'unit-mismatch', cls: 'host', use: 'classes.host.text', units: ['bps', 'percent'], cellIds: ['a'] },
    ]);
    expect(patch(r, 'a').shape).toMatchObject({ status: 'nodata', text: '–' });
  });

  const LINK = { match: { key: 'name' }, up: 'tx', down: 'rx', capacity: 'speed' };
  const link = (attrs: Record<string, string> = {}): Cell => ['l', { bind: 'lan', key: 'sw-a', ...attrs }, true];

  it('capacity-fallback: a speed that is not positive falls through to cap', () => {
    const r = run(
      hostConfig({ lan: LINK }),
      [link({ cap: '1G' })],
      [
        frame('tx', { name: 'sw-a' }, [5e8], { unit: 'bps' }),
        frame('rx', { name: 'sw-a' }, [1e8], { unit: 'bps' }),
        frame('speed', { name: 'sw-a' }, [0], { unit: 'bps' }),
      ]
    );
    expect(entries(r.report, 'capacity-fallback')).toEqual([
      { kind: 'capacity-fallback', cls: 'lan', reason: 'not positive', cellIds: ['l'] },
    ]);
    expect(patch(r, 'l').link?.a2b).toMatchObject({ capacity: 1e9, percent: 50, capacitySource: 'attr' });
  });

  it('no-series: a capacity use per direction that selects zero series; the fallback to cap stays', () => {
    const r = run(
      hostConfig({ lan: { ...LINK, capacity: { a2b: 'up_speed', b2a: 'down_speed' } } }),
      [link({ cap: '1G' })],
      [
        frame('tx', { name: 'sw-a' }, [5e8], { unit: 'bps' }),
        frame('rx', { name: 'sw-a' }, [1e8], { unit: 'bps' }),
        frame('up_speed', { name: 'sw-a' }, [2e9], { unit: 'bps' }),
        frame('down_speed', { name: 'sw-b' }, [2e9], { unit: 'bps' }),
      ]
    );
    expect(entries(r.report, 'no-series')).toEqual([
      { kind: 'no-series', cls: 'lan', use: 'classes.lan.capacity.b2a', cellIds: ['l'] },
    ]);
    expect(entries(r.report, 'capacity-fallback')).toEqual([
      { kind: 'capacity-fallback', cls: 'lan', reason: 'no series', cellIds: ['l'] },
    ]);
    expect(patch(r, 'l').link?.a2b).toMatchObject({ capacity: 2e9, capacitySource: 'series' });
    expect(patch(r, 'l').link?.b2a).toMatchObject({ capacity: 1e9, capacitySource: 'attr' });
  });

  it('bad-cap: a cap that does not parse gives no capacity', () => {
    const r = run(
      hostConfig({ lan: { match: { key: 'name' }, up: 'tx' } }),
      [link({ cap: 'abc' })],
      [frame('tx', { name: 'sw-a' }, [5e8], { unit: 'bps' })]
    );
    expect(entries(r.report, 'bad-cap')).toEqual([{ kind: 'bad-cap', attr: 'cap', value: 'abc', cellIds: ['l'] }]);
    expect(patch(r, 'l').link?.a2b).toMatchObject({ status: 'ok', value: 5e8 });
    expect(patch(r, 'l').link?.a2b?.percent).toBeUndefined();
  });

  it('the attribute capacity is the second name of cap (portograph contract)', () => {
    const cfg = hostConfig({ lan: { match: { key: 'name' }, up: 'tx' } });
    const frames = [frame('tx', { name: 'sw-a' }, [5e8], { unit: 'bps' })];
    const of = (attrs: Record<string, string>) => {
      const r = run(cfg, [link(attrs)], frames);
      return {
        half: patch(r, 'l').link?.a2b,
        report: r.report.filter((e) => e.kind === 'bad-cap' || e.kind === 'cap-conflict'),
      };
    };
    const only = of({ capacity: '1000000000' });
    expect(only.half).toMatchObject({ capacity: 1e9, capacitySource: 'attr', percent: 50 });
    expect(only.report).toEqual([]);
    expect(of({ cap: '1G', capacity: '1000000000' }).report).toEqual([]);
    const differ = of({ cap: '1G', capacity: '2G' });
    expect(differ.half).toMatchObject({ capacity: 1e9 });
    expect(differ.report).toEqual([{ kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['l'] }]);
    expect(of({ capacity: 'abc' }).report).toEqual([
      { kind: 'bad-cap', attr: 'capacity', value: 'abc', cellIds: ['l'] },
    ]);
    const badCap = of({ cap: 'abc', capacity: '1G' });
    expect(badCap.half?.capacity).toBeUndefined();
    expect(badCap.report).toEqual([{ kind: 'bad-cap', attr: 'cap', value: 'abc', cellIds: ['l'] }]);
  });

  it('no-edge-ends: a compressed page gives no ends when a class reads ${from.…}', () => {
    const xml =
      '<mxfile><diagram id="p1" name="Page-1">7ZbBbqMwEIafhqsLGEhyTNJ0u9JWqtTDnh2YgFWDkW2a5O13DCbg</diagram></mxfile>';
    const r = run(
      hostConfig({ lan: { match: { key: 'name="${from.key}"' }, status: 'up' } }),
      [link()],
      [frame('up', { name: 'x' })],
      { xml }
    );
    expect(entries(r.report, 'no-edge-ends')).toEqual([
      { kind: 'no-edge-ends', reason: 'compressed page', cellIds: ['l'] },
    ]);
  });

  it('unused-field: a link field on a class whose cells are not edges', () => {
    const r = run(
      hostConfig({ host: { ...HOST, up: 'tx', linkLabel: 'percent' } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' })],
      { refs: ['tx'] }
    );
    expect(entries(r.report, 'unused-field')).toEqual([
      { kind: 'unused-field', cls: 'host', field: 'up', cellIds: ['a'] },
      { kind: 'unused-field', cls: 'host', field: 'linkLabel', cellIds: ['a'] },
    ]);
  });

  it('class-no-cells: a class with a match and no cell; not for an abstract class', () => {
    const r = run(
      hostConfig({ base: { status: 'up' }, host: HOST, idle: { match: { key: 'job' } } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' })]
    );
    expect(entries(r.report, 'class-no-cells')).toEqual([{ kind: 'class-no-cells', cls: 'idle' }]);
  });

  it.each([
    ['base', false],
    ['middle', false],
    ['middle', true],
  ])('class-no-cells: ancestors of a bound class are used, parent %s, invalid override %s', (parent, invalid) => {
    const r = run(
      hostConfig(
        { base: HOST, middle: { extends: 'base' }, host: { extends: parent } },
        invalid ? { a: { colour: 'red' } } : undefined
      ),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' })]
    );
    expect(entries(r.report, 'class-no-cells')).toEqual(
      parent === 'base' ? [{ kind: 'class-no-cells', cls: 'middle' }] : []
    );
    expect([...r.cells]).toEqual([['host', ['a']]]);
  });

  it('class-no-cells: an unused base chain still reports each concrete class', () => {
    const r = run(
      hostConfig({ base: HOST, middle: { extends: 'base' }, leaf: { extends: 'middle' }, host: HOST }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' })]
    );
    expect(entries(r.report, 'class-no-cells')).toEqual([
      { kind: 'class-no-cells', cls: 'base' },
      { kind: 'class-no-cells', cls: 'middle' },
      { kind: 'class-no-cells', cls: 'leaf' },
    ]);
  });
});

describe('bindV4: the owner chain (spec 4, S3)', () => {
  const xmlOf = (cells: string) =>
    `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}` +
    '</root></mxGraphModel></diagram></mxfile>';
  const PORT = { match: { key: 'job', port: 'device' }, status: 'up' };
  const portCells = (): Cell[] => [
    ['0', { 'pg-schema': '1' }],
    ['n', { 'pg-kind': 'node', 'pg-id': 'rtr-a', key: 'node-rtr-a' }],
    [
      'p',
      { 'pg-kind': 'port', 'pg-id': 'rtr-a:eth1', 'pg-node': 'rtr-a', 'pg-port': 'eth1', bind: 'iface', port: 'eth1' },
    ],
  ];

  it('a port with bind and port reads key from its node and binds', () => {
    const r = run(hostConfig({ iface: PORT }), portCells(), [
      frame('up', { job: 'node-rtr-a', device: 'eth1' }),
      frame('up', { job: 'node-rtr-a', device: 'eth2' }),
    ]);
    expect(entries(r.report, 'missing-attr')).toEqual([]);
    expect(entries(r.report, 'no-series')).toEqual([]);
    const selected = [...r.series.get('p')!.values()].flat();
    expect(selected.map((s) => s.labels.device)).toEqual(['eth1']);
    expect(r.inherited.get('p')?.get('key')).toEqual({ value: 'node-rtr-a', cellId: 'n', via: 'owner' });
    expect(r.inherited.get('p')?.has('port')).toBe(false);
  });

  it('a shape in a container reads key from the container, and the container from its own container', () => {
    const xml = xmlOf('<mxCell id="g1" parent="1"/><mxCell id="g2" parent="g1"/><mxCell id="s" parent="g2"/>');
    const r = run(
      hostConfig({ host: HOST }),
      [
        ['g1', { key: 'outer' }],
        ['g2', {}],
        ['s', { bind: 'host' }],
      ],
      [frame('up', { job: 'outer' })],
      { xml }
    );
    expect(r.report).toEqual([]);
    expect(r.inherited.get('s')?.get('key')).toMatchObject({ value: 'outer', cellId: 'g1', via: 'owner' });
  });

  it('a template ${site} reads the container', () => {
    const xml = xmlOf('<mxCell id="g" parent="1"/><mxCell id="s" parent="g"/>');
    const r = run(
      hostConfig({ host: { ...HOST, url: '/d/x?site=${site}' } }),
      [
        ['g', { site: 'hq', key: 'k' }],
        ['s', { bind: 'host' }],
      ],
      [frame('up', { job: 'k' })],
      { xml }
    );
    expect(patch(r, 's').urls.map((u) => u.url)).toEqual(['/d/x?site=hq']);
    expect(r.inherited.get('s')?.get('site')).toMatchObject({ value: 'hq', cellId: 'g' });
  });

  it('an own-only name is never read from an owner: missing-attr', () => {
    const xml = xmlOf('<mxCell id="g" parent="1"/><mxCell id="s" parent="g"/>');
    const r = run(
      hostConfig({ host: { match: { cap: 'job' }, status: 'up' } }),
      [
        ['g', { cap: '1G' }],
        ['s', { bind: 'host' }],
      ],
      [frame('up', { job: '1G' })],
      { xml }
    );
    expect(entries(r.report, 'missing-attr')).toMatchObject([{ attr: 'cap', cellIds: ['s'] }]);
    expect(r.inherited.get('s')).toBeUndefined();
  });

  it('an own value wins over the owner, and an empty own value counts', () => {
    const cells = portCells();
    cells[2][1].key = '';
    const r = run(hostConfig({ iface: PORT }), cells, [frame('up', { job: '', device: 'eth1' })]);
    expect([...r.series.get('p')!.values()].flat()).toHaveLength(1);
    expect(r.inherited.size).toBe(0);
  });

  it('an edge reads its measured end after S4b', () => {
    const cells: Cell[] = [
      ...portCells(),
      ['l', { 'pg-kind': 'link', 'pg-id': 'l', 'pg-from': 'rtr-a:eth1', 'pg-to': 'rtr-a', bind: 'lan' }, true],
    ];
    const r = run(hostConfig({ lan: { match: { key: 'job' }, status: 'up' } }), cells, [
      frame('up', { job: 'node-rtr-a' }),
    ]);
    expect(entries(r.report, 'missing-attr')).toEqual([]);
    expect(r.inherited.get('l')?.get('key')).toMatchObject({ value: 'node-rtr-a', via: 'end' });
  });

  it('${from.key} of an edge still reads the geometric end', () => {
    const cells: Cell[] = [
      ...portCells(),
      [
        'l',
        { 'pg-kind': 'link', 'pg-id': 'l', 'pg-from': 'rtr-a:eth1', 'pg-to': 'rtr-a', bind: 'lan', key: 'x' },
        true,
      ],
    ];
    const r = run(hostConfig({ iface: PORT, lan: { match: { key: 'name="${from.key}"' }, status: 'up' } }), cells, [
      frame('up', { name: 'node-rtr-a' }),
    ]);
    expect(entries(r.report, 'missing-attr')).toEqual([]);
    expect([...r.series.get('l')!.values()].flat()).toHaveLength(1);
  });

  it('a bind where each cell has its attributes never asks for the ends', () => {
    const compressed =
      '<mxfile><diagram id="p1" name="Page-1">7ZbBbqMwEIafhqsLGEhyTNJ0u9JWqtTDnh2YgFWDkW2a5O13DCbg</diagram></mxfile>';
    const r = run(
      hostConfig({ host: HOST }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['l', { bind: 'host', key: 'b' }, true],
      ],
      [frame('up', { job: 'a' })],
      { xml: compressed }
    );
    expect(entries(r.report, 'no-edge-ends')).toEqual([]);
    expect(r.inherited.size).toBe(0);
  });

  it('a vertex that lacks a name gives no-edge-ends on a compressed page', () => {
    const compressed =
      '<mxfile><diagram id="p1" name="Page-1">7ZbBbqMwEIafhqsLGEhyTNJ0u9JWqtTDnh2YgFWDkW2a5O13DCbg</diagram></mxfile>';
    const r = run(
      hostConfig({ host: HOST }),
      [
        ['a', { bind: 'host' }],
        ['e', {}, true],
      ],
      [frame('up', { job: 'x' })],
      { xml: compressed }
    );
    expect(entries(r.report, 'missing-attr')).toMatchObject([{ attr: 'key', cellIds: ['a'] }]);
    expect(entries(r.report, 'no-edge-ends')).toMatchObject([{ reason: 'compressed page', cellIds: ['e'] }]);
  });
});

describe('bindV4: the engine', () => {
  it('the cells of an invalid class are unavailable with "Binding is not valid"; other classes bind', () => {
    const r = run(
      hostConfig({ broken: { match: { key: 'job' }, colour: 'red' }, host: HOST }),
      [
        ['a', { bind: 'broken', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [frame('up', { job: 'b' })]
    );
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: 'Binding is not valid' });
    expect(patch(r, 'a').unavailable?.reason).toBe('Binding is not valid');
    expect(patch(r, 'b').statusView).toMatchObject({ state: 'normal', refId: 'up' });
    expect(entries(r.report, 'unknown-class')).toEqual([]);
  });

  it('an invalid override makes its cell unavailable; the other cells of its class bind (P1.1)', () => {
    const r = run(
      hostConfig({ host: HOST }, { a: { status: 'up', colour: 'red' } }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [frame('up', { job: 'a' }), frame('up', { job: 'b' })]
    );
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: 'Binding is not valid' });
    expect(patch(r, 'b').statusView).toMatchObject({ state: 'normal' });
  });

  it('a class whose only cell has an invalid override still has cells: no class-no-cells', () => {
    const r = run(
      hostConfig({ host: HOST }, { a: { status: 'up', colour: 'red' } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' })]
    );
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: 'Binding is not valid' });
    expect(entries(r.report, 'class-no-cells')).toEqual([]);
  });

  it('a template of an override field reports its override path', () => {
    const r = run(
      hostConfig({ host: HOST }, { a: { url: '/d/host?var-role=${role}' } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' })]
    );
    expect(entries(r.report, 'missing-attr')).toEqual([
      { kind: 'missing-attr', cls: 'host', path: 'overrides.a.url', attr: 'role', cellIds: ['a'] },
    ]);
  });

  it('an override that adds a query enters the series index (P1.5)', () => {
    const r = run(
      hostConfig({ host: HOST }, { a: { rows: [{ kind: 'history', query: 'extra' }] } }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [frame('up', { job: 'a' }), frame('up', { job: 'b' }), frame('extra', { job: 'a' }), frame('extra', { job: 'b' })]
    );
    expect(
      r.series
        .get('a')
        ?.get('overrides.a.rows[0]')
        ?.map((s) => s.labels)
    ).toEqual([{ job: 'a' }]);
    expect(r.series.get('b')?.has('overrides.a.rows[0]')).toBe(false);
    expect(entries(r.report, 'orphan-series')).toEqual([
      { kind: 'orphan-series', refId: 'extra', labels: [{ job: 'b' }], more: 0 },
    ]);
  });

  it('a row match replaces the class match as a whole block', () => {
    const r = run(
      hostConfig({
        lan: {
          match: { key: 'name', port: 'port_num' },
          status: 'up',
          rows: [{ kind: 'history', query: 'clients', match: { key: 'name' } }],
        },
      }),
      [['a', { bind: 'lan', key: 'sw-a', port: '3' }]],
      [frame('up', { name: 'sw-a', port_num: '3' }), frame('clients', { name: 'sw-a' })]
    );
    expect(r.series.get('a')?.get('classes.lan.rows[0]')).toHaveLength(1);
    expect(r.series.get('a')?.get('classes.lan.status')).toHaveLength(1);
  });

  it('an explicit reduce gives no many-series; the text shows the sum (P1.9)', () => {
    const r = run(
      hostConfig({ host: { match: { key: 'job' }, text: { query: 'rate', reduce: 'sum' } } }),
      [['a', { bind: 'host', key: 'a' }]],
      [
        frame('rate', { job: 'a', i: '1' }, [1e6], { unit: 'bps' }),
        frame('rate', { job: 'a', i: '2' }, [500], { unit: 'Kbits' }),
      ]
    );
    expect(entries(r.report, 'many-series')).toEqual([]);
    expect(patch(r, 'a').shape).toMatchObject({ status: 'ok', value: 1.5e6, target: 'none', text: '1.50 Mb/s' });
  });

  it('a value row with N series and no reduce gives many-series', () => {
    const r = run(
      hostConfig({ host: { match: { key: 'job' }, rows: [{ kind: 'value', query: 'rate' }] } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('rate', { job: 'a', i: '1' }), frame('rate', { job: 'a', i: '2' })]
    );
    expect(entries(r.report, 'many-series')).toEqual([
      { kind: 'many-series', cls: 'host', use: 'classes.host.rows[0]', cells: [{ id: 'a', count: 2 }] },
    ]);
  });

  describe('links (P1.10)', () => {
    const frames = [
      frame('lan_tx', { name: 'sw-a', port_num: '3' }, [4e7], { unit: 'bps' }),
      frame('lan_rx', { name: 'sw-a', port_num: '3' }, [8e6], { unit: 'bps' }),
      frame('lan_state', { name: 'sw-a', port_num: '3' }, [1]),
      frame('unifi_port_speed', { name: 'sw-a', port_num: '3' }, [1e8], { unit: 'bps' }),
    ];
    const cells = (at?: string): Cell[] => [
      ['l', { bind: 'lan', key: 'sw-a', port: '3', ...(at ? { at } : {}) }, true],
    ];

    it('passes the default, inherited and overridden arrow style to the renderer', () => {
      const config = netL2Pilot();
      expect(patch(run(config, cells(), frames), 'l').link?.arrow).toBe('point');
      const inherited = {
        ...config,
        classes: {
          ...config.classes,
          baseArrow: { arrow: 'triangle' },
          lan: { ...config.classes.lan, extends: 'baseArrow' },
        },
      };
      expect(patch(run(inherited, cells(), frames), 'l').link?.arrow).toBe('triangle');
      const overridden = { ...inherited, overrides: { l: { arrow: 'none' } } };
      expect(patch(run(overridden, cells(), frames), 'l').link?.arrow).toBe('none');
    });

    it('a→b takes up, b→a takes down, with the capacity of the speed refId', () => {
      const r = run(netL2Pilot(), cells(), frames);
      const l = patch(r, 'l').link!;
      expect(l.labelMode).toBe('percent');
      expect(l.a2b).toMatchObject({ status: 'ok', value: 4e7, percent: 40, capacitySource: 'series' });
      expect(l.b2a).toMatchObject({ status: 'ok', value: 8e6, percent: 8 });
      expect(r.series.get('l')?.get('classes.lan.rows[0].a2b')?.[0].refId).toBe('lan_tx');
    });

    it('at=target flips the halves, the link label and the card row feed together', () => {
      const r = run(netL2Pilot(), cells('target'), frames);
      const l = patch(r, 'l').link!;
      expect(l.a2b).toMatchObject({ value: 8e6, percent: 8 });
      expect(l.a2b?.label).toContain(' · 8% of ');
      expect(l.b2a).toMatchObject({ value: 4e7, percent: 40 });
      expect(r.series.get('l')?.get('classes.lan.rows[0].a2b')?.[0].refId).toBe('lan_rx');
      expect(r.series.get('l')?.get('classes.lan.rows[0].b2a')?.[0].refId).toBe('lan_tx');
    });

    it('a half with no series is grey "no data"; the other half keeps its value', () => {
      const r = run(
        netL2Pilot(),
        cells(),
        frames.filter((f) => f.refId !== 'lan_rx'),
        { refs: ['lan_rx'] }
      );
      const l = patch(r, 'l').link!;
      expect(l.a2b?.status).toBe('ok');
      expect(l.b2a).toMatchObject({ status: 'nodata', label: 'no data' });
    });
  });

  it('${from.key} on an ordinary draw.io edge reads the end from the XML', () => {
    const xml =
      '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="s" vertex="1" parent="1"/><mxCell id="t" vertex="1" parent="1"/>' +
      '<mxCell id="e" edge="1" source="s" target="t" parent="1"/></root></mxGraphModel></diagram></mxfile>';
    const r = run(
      hostConfig({ wire: { match: { key: 'name="${from.key}"' }, status: 'up' } }),
      [
        ['s', { key: 'sw-a' }],
        ['t', { key: 'sw-b' }],
        ['e', { bind: 'wire', key: 'e' }, true],
      ],
      [frame('up', { name: 'sw-a' }), frame('up', { name: 'sw-b' })],
      { xml }
    );
    expect(
      r.series
        .get('e')
        ?.get('classes.wire.status')
        ?.map((s) => s.labels)
    ).toEqual([{ name: 'sw-a' }]);
    expect(entries(r.report, 'missing-attr')).toEqual([]);
  });

  it('a portograph link with only bind reads its ends through the record key id', () => {
    const r = run(
      {
        version: 4,
        classes: {
          lan: {
            match: { id: ['job="${from.job}"', 'device="${from.device}"'] },
            up: 'lan_tx',
            down: 'lan_rx',
          },
        },
      },
      [
        ['0', { 'pg-schema': '1' }],
        ['n', { 'pg-kind': 'node', 'pg-id': 'sw-a', job: 'sw-a' }],
        ['p', { 'pg-kind': 'port', 'pg-id': 'sw-a:eth1', 'pg-node': 'sw-a', device: 'eth1' }],
        ['m', { 'pg-kind': 'node', 'pg-id': 'sw-b', job: 'sw-b' }],
        ['l', { 'pg-kind': 'link', 'pg-id': 'l', 'pg-from': 'sw-a:eth1', 'pg-to': 'sw-b', bind: 'lan' }, true],
      ],
      [
        frame('lan_tx', { job: 'sw-a', device: 'eth1' }, [5]),
        frame('lan_rx', { job: 'sw-a', device: 'eth1' }, [7]),
        frame('lan_tx', { job: 'sw-b', device: 'eth1' }, [9]),
      ]
    );
    expect(entries(r.report, 'missing-attr')).toEqual([]);
    expect(
      r.series
        .get('l')
        ?.get('classes.lan.up')
        ?.map((s) => s.labels)
    ).toEqual([{ job: 'sw-a', device: 'eth1' }]);
    expect(patch(r, 'l').link?.a2b).toMatchObject({ status: 'ok', value: 5 });
    expect(patch(r, 'l').link?.b2a).toMatchObject({ status: 'ok', value: 7 });
  });

  describe('an end attribute named as an Object.prototype member (gate A1)', () => {
    const xml =
      '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="c" vertex="1" parent="1"/><mxCell id="s" vertex="1" parent="c"/>' +
      '<mxCell id="t" vertex="1" parent="1"/>' +
      '<mxCell id="e" edge="1" source="s" target="t" parent="1"/></root></mxGraphModel></diagram></mxfile>';
    const wire = { match: { key: 'name=~"${from.constructor}|${to.toString}"' }, status: 'up' };

    it('is missing-attr, not an exception, when no end cell has it', () => {
      const r = run(
        hostConfig({ host: HOST, wire }),
        [
          ['c', {}],
          ['s', { key: 'sw-a' }],
          ['t', { key: 'sw-b' }],
          ['e', { bind: 'wire', key: 'e' }, true],
          ['h', { bind: 'host', key: 'h' }],
        ],
        [frame('up', { name: 'sw-a' }), frame('up', { job: 'h' })],
        { xml }
      );
      expect(entries(r.report, 'missing-attr')).toEqual([
        { kind: 'missing-attr', cls: 'wire', path: 'classes.wire.status', attr: 'from.constructor', cellIds: ['e'] },
      ]);
      expect(patch(r, 'h').statusView).toMatchObject({ state: 'normal' });
    });

    it('comes from the container when the container has it as an own attribute', () => {
      const r = run(
        hostConfig({ wire }),
        [
          ['c', { constructor: 'sw-a' }],
          ['s', {}],
          ['t', { toString: 'sw-b' }],
          ['e', { bind: 'wire', key: 'e' }, true],
        ],
        [frame('up', { name: 'sw-a' }), frame('up', { name: 'sw-b' })],
        { xml }
      );
      expect(entries(r.report, 'missing-attr')).toEqual([]);
      expect(
        r.series
          .get('e')
          ?.get('classes.wire.status')
          ?.map((s) => s.labels)
      ).toEqual([{ name: 'sw-a' }, { name: 'sw-b' }]);
    });
  });

  it('a version: 3 config binds nothing and gives one outdated-config (P1.12)', () => {
    const r = run({ version: 3, patterns: [] }, [['a', { bind: 'host', key: 'a' }]], [frame('up', { job: 'a' })]);
    expect(r.report).toEqual([{ kind: 'outdated-config', version: 3 }]);
    expect(r.patches.size).toBe(0);
    expect(r.uses.size).toBe(0);
  });

  it('uses with the same refId and match block share one selection', () => {
    const r = run(
      hostConfig({
        host: { ...HOST, rows: [{ kind: 'history', query: 'up' }], chart: { kind: 'history', query: 'up' } },
      }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('up', { job: 'a' }), frame('up', { job: 'b' })]
    );
    const byPath = r.series.get('a')!;
    expect(byPath.get('classes.host.status')).toHaveLength(1);
    expect(byPath.get('classes.host.rows[0]')).toBe(byPath.get('classes.host.status'));
    expect(byPath.get('classes.host.chart')).toBe(byPath.get('classes.host.status'));
  });

  it('a regex block selects through the regex; an equality block through the label tuple', () => {
    const r = run(
      hostConfig({
        host: { match: { key: 'instance=~"${key}:.*"' }, status: 'up' },
        sw: { match: { key: 'name', port: 'port_num' }, status: 'up' },
      }),
      [
        ['a', { bind: 'host', key: 'node-a' }],
        ['b', { bind: 'sw', key: 'sw-a', port: '3' }],
      ],
      [
        frame('up', { instance: 'node-a:9100' }),
        frame('up', { instance: 'node-ab:9100' }),
        frame('up', { name: 'sw-a', port_num: '3' }),
        frame('up', { name: 'sw-a', port_num: '4' }),
      ]
    );
    expect(
      r.series
        .get('a')
        ?.get('classes.host.status')
        ?.map((s) => s.labels)
    ).toEqual([{ instance: 'node-a:9100' }]);
    expect(
      r.series
        .get('b')
        ?.get('classes.sw.status')
        ?.map((s) => s.labels)
    ).toEqual([{ name: 'sw-a', port_num: '3' }]);
  });

  it('the status carries the exact colour and text of the value mapping', () => {
    const mappings: ValueMapping[] = [
      { type: MappingType.ValueToText, options: { '0': { text: 'Offline', color: 'magenta' } } },
    ];
    const r = run(hostConfig(), [['a', { bind: 'host', key: 'a' }]], [frame('up', { job: 'a' }, [0], { mappings })]);
    expect(patch(r, 'a').statusView).toMatchObject({ text: 'Offline', refId: 'up' });
    expect(patch(r, 'a').statusV4).toMatchObject({ text: 'Offline', refId: 'up' });
    expect(patch(r, 'a').statusView?.color).toBe(theme.visualization.getColorByName('magenta'));
  });

  it('A18: during a refresh a refId with no frame yet is loading, and missing: down does not apply', () => {
    const r = run(
      hostConfig({ host: { ...HOST, missing: 'down', rows: [{ kind: 'history', query: 'cpu' }] } }),
      [['a', { bind: 'host', key: 'a' }]],
      [frame('cpu', { job: 'a' })],
      { refs: ['up'], state: LoadingState.Loading }
    );
    expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: 'Loading data' });
    expect(entries(r.report, 'no-series')).toEqual([]);
  });

  it('a relative range gives the stale deadline; an absolute range checks the age at its end', () => {
    const cells: Cell[] = [['a', { bind: 'host', key: 'a' }]];
    const old = [frame('up', { job: 'a' }, [1], {}, [0])];
    const relative = run(hostConfig(), cells, old, { timeRange: range('now') });
    expect(relative.deadlines).toEqual([180_000]);
    expect(patch(relative, 'a').staleStatusV4).toMatchObject({ after: 180_000, status: { state: 'stale' } });
    expect(patch(relative, 'a').statusView).toMatchObject({ state: 'normal' });

    const absolute = run(hostConfig({ host: { ...HOST, freshness: '1m' } }), cells, old);
    expect(absolute.deadlines).toEqual([]);
    expect(patch(absolute, 'a').statusView).toMatchObject({ state: 'stale' });
  });

  describe('an old series next to an all-null series: stale ranks above missing (gate A2)', () => {
    const cells: Cell[] = [['a', { bind: 'host', key: 'a' }]];
    const mixed = [frame('up', { job: 'a', i: '1' }, [1], {}, [0]), frame('up', { job: 'a', i: '2' }, [null], {}, [0])];

    it('an absolute range makes the cell stale', () => {
      const r = run(hostConfig({ host: { ...HOST, freshness: '1m' } }), cells, mixed);
      expect(patch(r, 'a').statusView).toMatchObject({ state: 'stale' });
      expect(r.deadlines).toEqual([]);
    });

    it('a relative range keeps the coverage reason and gives the clock a stale deadline', () => {
      const r = run(hostConfig(), cells, mixed, { timeRange: range('now') });
      expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: '1 of 2 series have no value' });
      expect(r.deadlines).toEqual([180_000]);
      expect(patch(r, 'a').staleStatusV4).toMatchObject({ after: 180_000, status: { state: 'stale' } });
    });

    it('all-null series and a failed query stay missing with no deadline', () => {
      const allNull = [frame('up', { job: 'a' }, [null], {}, [0])];
      const r = run(hostConfig(), cells, allNull, { timeRange: range('now') });
      expect(patch(r, 'a').statusView).toMatchObject({ state: 'missing', reason: 'No value' });
      expect(r.deadlines).toEqual([]);
      const failed = run(hostConfig(), cells, mixed, {
        timeRange: range('now'),
        state: LoadingState.Error,
        errors: [{ refId: 'up', message: 'boom' }],
      });
      expect(patch(failed, 'a').statusView).toMatchObject({ state: 'missing' });
      expect(failed.deadlines).toEqual([]);
      expect(patch(failed, 'a').staleStatusV4).toBeUndefined();
    });
  });

  it('a cell URL resolves its cell attributes and the labels of its one status series', () => {
    const r = run(
      hostConfig({ host: { ...HOST, url: '/d/host?var-job=${key}&i=${labels.instance}', urlTitle: 'Open ${key}' } }),
      [['a', { bind: 'host', key: 'a b' }]],
      [frame('up', { job: 'a b', instance: 'x' })]
    );
    expect(patch(r, 'a').urls).toEqual([{ url: '/d/host?var-job=a%20b&i=x', title: 'Open a b' }]);
  });

  it('metadata and drilldown rows resolve on the cell; a row whose template does not resolve is hidden', () => {
    const r = run(
      hostConfig({
        host: {
          ...HOST,
          rows: [
            { kind: 'metadata', label: 'Role', text: '${role}' },
            { kind: 'history', query: 'up' },
            { kind: 'drilldown', label: 'Open ${key}', url: '/d/host?var-job=${key}' },
          ],
        },
      }),
      [
        ['a', { bind: 'host', key: 'a', role: 'router' }],
        ['b', { bind: 'host', key: 'b' }],
      ],
      [frame('up', { job: 'a' }), frame('up', { job: 'b' })]
    );
    expect(patch(r, 'a').rowsV4).toEqual([
      { path: 'classes.host.rows[0]', kind: 'metadata', label: 'Role', text: 'router' },
      { path: 'classes.host.rows[1]', kind: 'history' },
      { path: 'classes.host.rows[2]', kind: 'drilldown', label: 'Open a', url: '/d/host?var-job=a' },
    ]);
    expect(patch(r, 'b').rowsV4?.map((row) => row.kind)).toEqual(['history', 'drilldown']);
    expect(entries(r.report, 'missing-attr')).toEqual([
      { kind: 'missing-attr', cls: 'host', path: 'classes.host.rows[0].text', attr: 'role', cellIds: ['b'] },
    ]);
  });

  it('the uses of each bound cell are in the result', () => {
    const r = run(netL2Pilot(), [['h', { bind: 'host', key: 'node-a' }]], [], {
      refs: ['scrape_up', 'host_cpu', 'host_mem', 'host_uptime'],
    });
    expect(r.uses.get('h')?.map((u) => u.path)).toEqual([
      'classes.host.status',
      'classes.host.rows[0]',
      'classes.host.rows[1]',
      'classes.host.rows[2]',
    ]);
  });
});

describe('bindV4: the cells of a class and the origin of the match of a cell', () => {
  it('cells: the ids per class in the order of the index, also a cell with an invalid override; no cell of an unknown class', () => {
    const r = run(
      hostConfig({ base: { status: 'up' }, host: HOST }, { bad: { bogus: 1 } }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['n', { bind: 'nope' }],
        ['bad', { bind: 'host', key: 'bad' }],
        ['b', { bind: 'host', key: 'b' }],
        ['z', { bind: 'base', key: 'z' }],
        ['x', {}],
      ],
      [frame('up', { job: 'a' })]
    );
    expect(r.cells).toEqual(
      new Map([
        ['host', ['a', 'bad', 'b']],
        ['base', ['z']],
      ])
    );
  });

  it('matchOrigins: the YAML path that gives the match of the cell, the override path for an override match', () => {
    const r = run(
      hostConfig({ base: { status: 'up' }, host: HOST }, { b: { match: { key: 'name' } } }),
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
        ['z', { bind: 'base', key: 'z' }],
      ],
      [frame('up', { job: 'a' })]
    );
    expect(r.matchOrigins.get('a')).toBe('classes.host.match');
    expect(r.matchOrigins.get('b')).toBe('overrides.b.match');
    expect(r.matchOrigins.has('z')).toBe(false);
  });
});

describe('bindV4: measured links (S4b)', () => {
  const xml =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="a" parent="1"/><mxCell id="pa" parent="a"/>' +
    '<mxCell id="b" parent="1"/><mxCell id="pb" parent="b"/>' +
    '<mxCell id="l" edge="1" parent="1" source="pa" target="pb"/>' +
    '<mxCell id="l2" edge="1" parent="1" source="pa" target="pb"/></root></mxGraphModel>';
  const cells = (end: 'source' | 'target' | 'both' | 'none', attrs: Record<string, string> = {}): Cell[] => [
    ['a', { key: 'a' }],
    ['b', { key: 'b' }],
    ['pa', { ...(end === 'source' || end === 'both' ? { port: 'eth1' } : {}), 'pg-port': 'p-a' }],
    ['pb', { ...(end === 'target' || end === 'both' ? { port: 'eth1' } : {}), 'pg-port': 'p-b' }],
    ['l', { bind: 'lan', cap: '50M/10M', ...attrs }, true],
  ];
  const lan = {
    match: { key: 'job', port: 'device' },
    up: 'tx',
    down: 'rx',
    linkLabel: 'value',
    rows: [{ kind: 'updown', up: 'tx', down: 'rx' }],
    chart: { kind: 'updown', up: 'tx', down: 'rx' },
    url: '/d/demo?key=${key}&from=${from.key}&to=${to.key}&port=${from.pg-port}',
  };
  const traffic = (job = 'b') => [
    frame('tx', { job, device: 'eth1' }, [7e6], { unit: 'bps' }),
    frame('rx', { job, device: 'eth1' }, [2e6], { unit: 'bps' }),
  ];
  const bind = (
    cls: unknown,
    c: Cell[],
    frames: DataFrame[] = [],
    opts: DataOptions = {},
    overrides?: Record<string, unknown>
  ) => run(hostConfig({ lan: cls }, overrides), c, frames, { ...opts, xml });

  it.each(['source', 'target'] as const)(
    'AC5/8/9: infers %s with the same series, halves, label and URL as explicit identity',
    (end) => {
      const key = end === 'source' ? 'a' : 'b';
      const inferred = bind(lan, cells(end), traffic(key));
      const explicit = bind(lan, cells(end, { key, port: 'eth1', at: end }), traffic(key));
      expect(inferred.report).toEqual([]);
      expect(inferred.measured.get('l')).toMatchObject({ end, reason: 'only', needs: ['key', 'port'] });
      expect(inferred.series.get('l')).toEqual(explicit.series.get('l'));
      expect(patch(inferred, 'l').link).toEqual(patch(explicit, 'l').link);
      expect(patch(inferred, 'l').urls).toEqual([{ url: `/d/demo?key=${key}&from=a&to=b&port=p-a` }]);
      expect(
        inferred.uses
          .get('l')!
          .filter((u) => u.end)
          .every((u) => u.end === end)
      ).toBe(true);
      expect(patch(inferred, 'l').link?.a2b?.value).toBe(end === 'target' ? 2e6 : 7e6);
    }
  );

  it('AC6: drops dependent uses, leaves no patch, and groups by sorted identity names', () => {
    const c = [...cells('none'), ['l2', { bind: 'lan' }, true] as Cell];
    const r = bind({ ...lan, url: undefined }, c, [], {}, { l2: { match: { site: 'site' } } });
    expect(r.uses.get('l')).toEqual([]);
    expect(r.patches.has('l')).toBe(false);
    expect(r.patches.has('l2')).toBe(false);
    expect(r.cells.get('lan')).toEqual(['l', 'l2']);
    expect(r.report).toEqual([
      { kind: 'unmeasured-link', cls: 'lan', attrs: ['key', 'port'], cellIds: ['l'] },
      { kind: 'unmeasured-link', cls: 'lan', attrs: ['site'], cellIds: ['l2'] },
    ]);
  });

  it('AC6: a partial own identity still gives missing-attr', () => {
    const r = bind(lan, cells('none', { key: 'a' }), traffic('a'));
    expect(r.measured.get('l')).toMatchObject({ end: 'source', reason: 'own' });
    expect(entries(r.report, 'missing-attr')).toContainEqual(expect.objectContaining({ attr: 'port' }));
    expect(entries(r.report, 'unmeasured-link')).toEqual([]);
  });

  it.each(['none', 'target'] as const)('AC21: ignores an unread class match with %s identity', (end) => {
    const cls = {
      match: { key: 'job' },
      text: { query: 'tx', match: { id: 'edge' } },
      rows: [{ kind: 'updown', up: 'tx', down: 'rx', match: { id: 'edge' } }],
      chart: { kind: 'value', query: 'tx', match: { id: 'edge' } },
      url: '/d/demo?edge=${id}',
    };
    const r = bind(cls, cells(end), [frame('tx', { edge: 'l' }, [7e6]), frame('rx', { edge: 'l' }, [2e6])]);
    expect(r.report).toEqual([]);
    expect(r.measured.get('l')).toEqual({ end: 'source', reason: 'own', needs: [] });
    expect(r.uses.get('l')!.map((u) => u.refId)).toEqual(['tx', 'tx', 'rx', 'tx']);
    expect(patch(r, 'l').shape?.value).toBe(7e6);
    expect(patch(r, 'l').urls).toEqual([{ url: '/d/demo?edge=l' }]);
  });

  it('AC22: flips dependent halves and keeps the end-free row at source', () => {
    const r = bind(
      { ...lan, url: undefined, rows: [{ kind: 'updown', up: 'tx', down: 'rx', match: { id: 'edge' } }] },
      cells('target'),
      [
        ...traffic(),
        frame('tx', { edge: 'l' }, [7e6], { unit: 'bps' }),
        frame('rx', { edge: 'l' }, [2e6], { unit: 'bps' }),
      ]
    );
    expect(r.report).toEqual([]);
    expect(
      r.uses
        .get('l')!
        .filter((u) => u.kind === 'row')
        .map((u) => [u.refId, u.end])
    ).toEqual([
      ['tx', 'source'],
      ['rx', 'source'],
    ]);
    expect(
      r.uses
        .get('l')!
        .filter((u) => u.kind === 'up' || u.kind === 'down')
        .map((u) => u.end)
    ).toEqual(['target', 'target']);
    expect(patch(r, 'l').link?.a2b?.value).toBe(2e6);
  });

  it.each(['${id}', '${from.id}', '${key}'])('AC23: keeps end-free rows and resolves unmeasured URL %s', (url) => {
    const cls = {
      ...lan,
      url: `/d/demo?key=${url}`,
      rows: [
        { kind: 'value', query: 'own', match: { id: 'edge' } },
        { kind: 'history', query: 'tx' },
        { kind: 'metadata', label: 'Site', text: '${site}' },
      ],
    };
    const r = bind(cls, cells('none'), [frame('own', { edge: 'l' }, [42])]);
    expect(r.uses.get('l')!.map((u) => u.refId)).toEqual(['own']);
    expect(patch(r, 'l').link).toBeUndefined();
    expect(patch(r, 'l').rowsV4).toEqual([{ path: 'classes.lan.rows[0]', kind: 'value' }]);
    expect(patch(r, 'l').urls).toEqual(
      url === '${key}' ? [] : [{ url: `/d/demo?key=${url === '${id}' ? 'l' : 'pa'}` }]
    );
    expect(entries(r.report, 'missing-attr')).toEqual([
      { kind: 'missing-attr', cls: 'lan', path: 'classes.lan.rows[2].text', attr: 'site', cellIds: ['l'] },
    ]);
    expect(entries(r.report, 'no-series')).toEqual([]);
  });

  it.each(['empty', 'ready', 'many', 'loading', 'error', 'missing', 'unknown'] as const)(
    'AC11: ambiguity with dependent query %s',
    (state) => {
      const frames = [frame('own', { edge: 'l' })];
      if (state === 'ready' || state === 'many') {
        frames.push(frame('tx', { job: 'a', device: 'eth1' }));
      }
      if (state === 'many') {
        frames.push(frame('tx', { job: 'a', device: 'eth1', extra: '1' }));
      }
      const cls = {
        match: { key: 'job', port: 'device', ...(state === 'missing' ? { label: 'label' } : {}) },
        status: 'tx',
        rows: [{ kind: 'value', query: 'own', match: { id: 'edge' } }],
      };
      const opts =
        state === 'loading'
          ? { refs: ['tx'], state: LoadingState.Loading }
          : state === 'error'
            ? { refs: ['tx'], state: LoadingState.Error, errors: [{ refId: 'tx', message: 'Failed' }] }
            : state === 'unknown'
              ? {}
              : { refs: ['tx'] };
      const r = bind(cls, cells('both'), frames, opts);
      expect(entries(r.report, 'end-ambiguous')).toEqual(
        state === 'empty' ? [{ kind: 'end-ambiguous', cls: 'lan', cellIds: ['l'] }] : []
      );
    }
  );

  it.each(['only', 'at'] as const)(
    'AC11: reason %s never gives end-ambiguous, also with an empty dependent query',
    (r) => {
      const cls = { match: { key: 'job', port: 'device' }, status: 'tx' };
      const c = r === 'only' ? cells('target') : cells('both', { at: 'target' });
      const result = bind(cls, c, [frame('tx', { job: 'other', device: 'none' })], { refs: ['tx'] });
      expect(result.measured.get('l')?.reason).toBe(r);
      expect(entries(result.report, 'no-series').length).toBe(1);
      expect(entries(result.report, 'end-ambiguous')).toEqual([]);
    }
  );

  it('AC11: a URL without query uses never has an ambiguous end', () => {
    const r = bind({ match: { key: 'job' }, url: '/d/demo?id=${id}' }, cells('both'));
    expect(r.report).toEqual([]);
    expect(r.measured.get('l')?.reason).toBe('own');
  });

  it('AC25: records all shared, directional, unknown and failed use paths', () => {
    const cls = {
      match: { key: 'job' },
      status: 'tx',
      text: { query: 'tx' },
      up: 'tx',
      down: 'rx',
      rows: [
        { kind: 'history', query: 'tx' },
        { kind: 'updown', up: 'tx', down: 'rx' },
        { kind: 'value', query: 'unknown' },
        { kind: 'value', query: 'tx', match: { cap: 'cap' } },
      ],
      chart: { kind: 'history', query: 'tx' },
    };
    const c = cells('target', { cap: '50M/10M' });
    c[0][1] = {};
    const r = bind(cls, c, [frame('tx', { job: 'b' }), frame('rx', { job: 'b' })]);
    const resolved = r.resolved.get('l')!;
    expect([...resolved.keys()]).toEqual(r.uses.get('l')!.map((u) => u.path));
    for (const use of r.uses.get('l')!) {
      expect(resolved.get(use.path)).toEqual({
        matchers: [
          {
            label: use.path.endsWith('rows[3]') ? 'cap' : 'job',
            op: '=',
            value: use.path.endsWith('rows[3]') ? '50M/10M' : 'b',
          },
        ],
      });
    }
    expect(resolved.get('classes.lan.status')).toEqual(resolved.get('classes.lan.text'));
    const failed = bind({ match: { cap: 'cap' }, status: 'tx' }, [['l', { bind: 'lan' }, true]], [], { refs: ['tx'] });
    expect(failed.resolved.get('l')?.get('classes.lan.status')).toEqual({ problem: 'Missing attribute cap' });
  });

  it.each(['none', 'at', 'site'] as const)('AC28: unions dependent names, variant %s', (variant) => {
    const cls = {
      ...lan,
      url: undefined,
      chart: undefined,
      rows: [
        { kind: 'updown', up: 'siteTx', down: 'siteRx', match: { site: 'site' } },
        { kind: 'value', query: 'own', match: { id: 'edge' } },
      ],
    };
    const c = cells('target', variant === 'at' ? { at: 'target' } : variant === 'site' ? { site: 'hq' } : {});
    const r = bind(cls, c, [
      ...traffic(),
      frame('own', { edge: 'l' }),
      frame('siteTx', { site: 'hq' }),
      frame('siteRx', { site: 'hq' }),
    ]);
    if (variant === 'none') {
      expect(r.measured.get('l')).toEqual({ end: 'none', reason: 'none', needs: ['key', 'port', 'site'] });
      expect(entries(r.report, 'unmeasured-link')).toEqual([
        { kind: 'unmeasured-link', cls: 'lan', attrs: ['key', 'port', 'site'], cellIds: ['l'] },
      ]);
      expect(r.uses.get('l')!.map((u) => u.refId)).toEqual(['own']);
      expect(entries(r.report, 'missing-attr')).toEqual([]);
    } else {
      expect(r.measured.get('l')).toMatchObject({ end: 'target', reason: variant === 'at' ? 'at' : 'only' });
      expect(entries(r.report, 'unmeasured-link')).toEqual([]);
      expect(entries(r.report, 'missing-attr').length).toBe(variant === 'at' ? 2 : 0);
      expect(patch(r, 'l').link?.a2b?.value).toBe(2e6);
    }
  });
});

describe('bindV4: capacity from the end (S5, I14, I25)', () => {
  const xml =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="a" parent="1"/><mxCell id="pa" parent="a"/>' +
    '<mxCell id="b" parent="1"/><mxCell id="pb" parent="b"/>' +
    '<mxCell id="l" edge="1" parent="1" source="pa" target="pb"/></root></mxGraphModel>';
  const cells = (b: Record<string, string>, pb: Record<string, string>, l: Record<string, string>, pa = {}): Cell[] => [
    ['a', {}],
    ['b', b],
    ['pa', pa],
    ['pb', pb],
    ['l', { bind: 'link', ...l }, true],
  ];
  const cls = {
    match: { key: 'job' },
    capacity: 'speed',
    rows: [{ kind: 'updown', up: 'tx', down: 'rx', match: { id: 'edge' } }],
  };
  const frames = [
    frame('tx', { edge: 'l' }, [7e6], { unit: 'bps' }),
    frame('rx', { edge: 'l' }, [2e6], { unit: 'bps' }),
  ];
  const bind = (c: Record<string, unknown>, cs: Cell[], f: DataFrame[] = frames) =>
    run(hostConfig({ link: c }), cs, f, { xml });

  it('AC24: a link with only an updown row and a port cap has a capacity with the cell of the port', () => {
    const r = bind({ match: { id: 'id' }, rows: cls.rows }, cells({}, {}, {}, { cap: '50M/10M' }));
    expect(r.patches.get('l')?.link).toBeUndefined();
    expect(r.capacity.get('l')).toEqual({
      a2b: { amount: 50e6, source: 'attr', cellId: 'pa' },
      b2a: { amount: 10e6, source: 'attr', cellId: 'pa' },
    });
    expect(r.report).toEqual([]);
  });

  it('AC10: cap=50M/10M on a port measured at the target maps receive to a→b', () => {
    const r = bind(cls, cells({ key: 'tgt' }, { cap: '50M/10M' }, {}));
    expect(r.measured.get('l')).toMatchObject({ end: 'target', reason: 'only' });
    expect(r.capacity.get('l')?.a2b).toEqual({ amount: 10e6, source: 'attr', cellId: 'pb' });
    expect(r.capacity.get('l')?.b2a).toEqual({ amount: 50e6, source: 'attr', cellId: 'pb' });
  });

  it('AC10: the link cap wins over the end, and a cap of the link that does not parse does not read the end', () => {
    expect(bind(cls, cells({ key: 'tgt' }, { cap: '50M' }, { cap: '5M' })).capacity.get('l')?.a2b).toEqual({
      amount: 5e6,
      source: 'attr',
      cellId: 'l',
    });
    const bad = bind(cls, cells({ key: 'tgt' }, { cap: '50M' }, { cap: 'abc' }));
    expect(bad.capacity.get('l')?.a2b).toEqual({ source: 'none' });
    expect(entries(bad.report, 'bad-cap')).toEqual([{ kind: 'bad-cap', attr: 'cap', value: 'abc', cellIds: ['l'] }]);
  });

  it('AC24: bad-cap and cap-conflict of a port name the port cell', () => {
    const bad = bind(cls, cells({ key: 'tgt' }, { cap: 'x' }, {}));
    expect(entries(bad.report, 'bad-cap')).toEqual([{ kind: 'bad-cap', attr: 'cap', value: 'x', cellIds: ['pb'] }]);
    const conflict = bind(cls, cells({ key: 'tgt' }, { cap: '1G', capacity: '2G' }, {}));
    expect(entries(conflict.report, 'cap-conflict')).toEqual([
      { kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['pb'] },
    ]);
  });

  it('AC10: a capacity series matches through the inferred identity and wins over the end', () => {
    const r = bind(cls, cells({ key: 'tgt' }, { cap: '50M' }, {}), [
      ...frames,
      frame('speed', { job: 'tgt' }, [1e9], { unit: 'bps' }),
    ]);
    expect(r.capacity.get('l')?.a2b).toEqual({ amount: 1e9, source: 'series' });
  });

  it('AC26 (from S5): the inferred capacity query gives 1G with the source series', () => {
    const r = bind(cls, cells({ key: 'tgt' }, {}, { cap: '50M/10M' }), [
      ...frames,
      frame('speed', { job: 'tgt' }, [1e9], { unit: 'bps' }),
    ]);
    expect(r.report).toEqual([]);
    expect(r.capacity.get('l')).toEqual({
      a2b: { amount: 1e9, source: 'series' },
      b2a: { amount: 1e9, source: 'series' },
    });
  });

  it('AC27: an unmeasured link keeps the own cap for the end-free row, with no fallback entry', () => {
    const r = bind(cls, cells({}, {}, { cap: '50M/10M' }), [
      ...frames,
      frame('speed', { job: 'tgt' }, [1e9], { unit: 'bps' }),
    ]);
    expect(r.measured.get('l')).toMatchObject({ end: 'none' });
    expect(r.uses.get('l')!.some((u) => u.kind === 'capacity')).toBe(false);
    expect(r.capacity.get('l')).toEqual({
      a2b: { amount: 50e6, source: 'attr', cellId: 'l' },
      b2a: { amount: 10e6, source: 'attr', cellId: 'l' },
    });
    expect(r.report.map((e) => e.kind)).toEqual(['unmeasured-link']);
  });

  it('an unmeasured link has no end cell: a port cap gives nothing', () => {
    const r = bind(cls, cells({}, { cap: '50M' }, {}, { cap: '50M' }));
    expect(r.capacity.get('l')).toEqual({ a2b: { source: 'none' }, b2a: { source: 'none' } });
  });

  it('AC24: a link whose capacity query gives both directions never reads the ends', () => {
    // A compressed page gives `no-edge-ends` whenever the ends are read. The control case shows that.
    const compressed = '<mxfile><diagram id="d">eJxLy8kvT85ILCpRAAAA</diagram></mxfile>';
    const speed = frame('speed', { job: 'tgt' }, [1e9], { unit: 'bps' });
    const read = run(hostConfig({ link: cls }), cells({}, {}, {}), [...frames, speed], { xml: compressed });
    expect(entries(read.report, 'no-edge-ends').length).toBe(1);
    const all = cells({}, {}, { key: 'tgt' });
    const r = run(hostConfig({ link: cls }), all, [...frames, speed], { xml: compressed });
    expect(r.capacity.get('l')?.a2b).toEqual({ amount: 1e9, source: 'series' });
    expect(entries(r.report, 'no-edge-ends')).toEqual([]);
  });
});
