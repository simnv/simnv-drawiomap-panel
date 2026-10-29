import { describe, expect, it } from 'vitest';
import {
  createTheme,
  type Field,
  FieldColorModeId,
  type FieldConfig,
  FieldType,
  MappingType,
  ThresholdsMode,
} from '@grafana/data';
import { noDataColor, statusColor } from '../binding/color';
import type { StatusView } from '../binding/status';
import type { CellPatch, HalfState, PatchMap, SeriesInfo, StatusV4Fields } from '../types';
import { buildLegendV4, type LegendContext } from './model';

const theme = createTheme();
const named = (c: string) => theme.visualization.getColorByName(c);
const ctx: LegendContext = { theme };
const thresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 80, color: 'red' },
  ],
};
const mappings = [
  {
    type: MappingType.ValueToText as const,
    options: { '0': { text: 'Offline', color: 'magenta' }, '1': { text: 'Online', color: 'transparent' } },
  },
];
const field = (config: FieldConfig): Field => ({ name: 'Value', type: FieldType.number, values: [], config });
const fields = new Map<string, Field>([
  ['scrape_up', field({ mappings, thresholds })],
  ['cpu', field({ displayName: 'CPU busy', unit: 'percent', thresholds })],
]);

type Status = StatusView & StatusV4Fields;
const status = (refId: string, state: StatusView['state'], color?: string, text = '–'): Status => ({
  state,
  severity: state,
  reason: state === 'missing' ? 'Query failed' : '',
  queryIds: [],
  conditionKey: '',
  coverage: { available: 1, expected: 1 },
  refId,
  color,
  text,
});
const cell = (cellId: string, statusView?: Status, link?: CellPatch['link']): [string, CellPatch] => [
  cellId,
  { cellId, scope: { cell: {} }, urls: [], statusView, link },
];
const offline = (id: string) => cell(id, status('scrape_up', 'normal', named('magenta'), 'Offline'));
const online = (id: string) => cell(id, status('scrape_up', 'normal', named('transparent'), 'Online'));

describe('buildLegendV4', () => {
  it('gives the block of a refId its mappings and then its threshold steps, each with its exact colour and cells', () => {
    const patches: PatchMap = new Map([offline('n1'), offline('n2'), online('n3')]);
    const [block, ...rest] = buildLegendV4(patches, fields, ctx);
    expect(rest).toEqual([]);
    expect(block.title).toBe('scrape_up');
    expect(block.entries.map((e) => [e.label, e.color, e.cellIds])).toEqual([
      ['Offline', named('magenta'), ['n1', 'n2']],
      ['Online', named('transparent'), ['n3']],
      ['< 80', named('green'), []],
      ['≥ 80', named('red'), []],
    ]);
    expect(block.cellIds).toEqual(['n1', 'n2', 'n3']);
  });

  it('makes one block per status refId in use, with the display name of the field as the title', () => {
    const patches: PatchMap = new Map([
      offline('n1'),
      cell('n2', status('cpu', 'critical', named('red'), '93%')),
      cell('n3', status('cpu', 'normal', named('green'), '12%')),
    ]);
    const blocks = buildLegendV4(patches, fields, ctx);
    expect(blocks.map((b) => b.title)).toEqual(['scrape_up', 'CPU busy']);
    expect(blocks[1].entries.map((e) => [e.label, e.cellIds])).toEqual([
      ['< 80%', ['n3']],
      ['≥ 80%', ['n2']],
    ]);
  });

  it('gives the query name as the title when the field has no display name', () => {
    const blocks = buildLegendV4(new Map([offline('n1')]), fields, { theme, queryName: () => 'Exporter up' });
    expect(blocks[0].title).toBe('Exporter up');
  });

  it('adds a stale and a missing entry only when cells have them', () => {
    expect(buildLegendV4(new Map([offline('n1')]), fields, ctx).map((b) => b.key)).toEqual(['status:scrape_up']);
    const patches: PatchMap = new Map([
      offline('n1'),
      cell('n2', status('scrape_up', 'stale', undefined, 'Offline')),
      cell('n3', status('cpu', 'missing')),
    ]);
    const blocks = buildLegendV4(patches, fields, ctx);
    expect(blocks.map((b) => b.key)).toEqual(['status:scrape_up', 'state']);
    expect(blocks[1].entries.map((e) => [e.key, e.color, e.cellIds])).toEqual([
      ['stale', statusColor({ state: 'stale' }, theme), ['n2']],
      ['missing', noDataColor(theme), ['n3']],
    ]);
    const onlyStale = buildLegendV4(new Map([cell('n2', status('scrape_up', 'stale'))]), fields, ctx);
    expect(onlyStale.at(-1)?.entries.map((e) => e.key)).toEqual(['stale']);
  });

  it('puts the link load scale last, and a link half with no data into the missing entry', () => {
    const s: SeriesInfo = {
      refId: 'tx',
      name: 'Value',
      labels: {},
      values: [],
      field: field({ thresholds }),
      frame: { fields: [], length: 0 },
    };
    const half = (over: Partial<HalfState>): HalfState => ({
      status: 'ok',
      color: named('green'),
      width: 2,
      label: '',
      stepIndex: 0,
      series: s,
      ...over,
    });
    const patches: PatchMap = new Map([
      offline('n1'),
      cell('e1', undefined, {
        a2b: half({ percent: 90, color: named('red'), stepIndex: 1 }),
        b2a: half({ percent: 5 }),
      }),
      cell('e2', undefined, { a2b: half({ status: 'nodata', color: noDataColor(theme), stepIndex: -1 }) }),
    ]);
    const blocks = buildLegendV4(patches, fields, ctx);
    expect(blocks.map((b) => b.title ?? b.key)).toEqual(['scrape_up', 'State', 'Link load %']);
    expect(blocks[1].entries.map((e) => [e.key, e.cellIds])).toEqual([['missing', ['e2']]]);
    expect(blocks[2].entries.map((e) => [e.label, e.cellIds])).toEqual([
      ['< 80%', ['e1']],
      ['≥ 80%', ['e1']],
    ]);
  });

  it('does not count a missing status of a link with halves: each half shows its own state', () => {
    const patches: PatchMap = new Map([cell('e1', status('scrape_up', 'missing'), { a2b: undefined })]);
    expect(buildLegendV4(patches, fields, ctx).map((b) => b.key)).toEqual(['state']);
    const s = {
      refId: 'tx',
      name: 'V',
      labels: {},
      values: [],
      field: field({ thresholds }),
      frame: { fields: [], length: 0 },
    };
    const a2b: HalfState = { status: 'ok', color: named('green'), width: 2, label: '', stepIndex: 0, series: s };
    const withHalves: PatchMap = new Map([cell('e1', status('scrape_up', 'missing'), { a2b })]);
    expect(buildLegendV4(withHalves, fields, ctx).map((b) => b.key)).not.toContain('state');
  });

  it('puts a value of a colour-only mapping on the mapping, not on a step of the same colour', () => {
    const red = [{ type: MappingType.ValueToText as const, options: { '0': { color: 'red' } } }];
    const own = new Map([['cpu', field({ unit: 'percent', mappings: red, thresholds })]]);
    const patches: PatchMap = new Map([
      cell('n1', { ...status('cpu', 'critical', named('red'), '93%'), value: 93 }),
      cell('n2', { ...status('cpu', 'critical', named('red'), '0%'), value: 0 }),
    ]);
    expect(buildLegendV4(patches, own, ctx)[0].entries.map((e) => [e.label, e.cellIds])).toEqual([
      ['0', ['n2']],
      ['< 80%', []],
      ['≥ 80%', ['n1']],
    ]);
  });

  it('puts a value with a step colour on the step, not on a mapping of the same colour', () => {
    const red = [{ type: MappingType.ValueToText as const, options: { '0': { text: 'Offline', color: 'red' } } }];
    const own = new Map([['cpu', field({ unit: 'percent', mappings: red, thresholds })]]);
    const patches: PatchMap = new Map([
      cell('n1', status('cpu', 'critical', named('red'), '93%')),
      cell('n2', status('cpu', 'critical', named('red'), 'Offline')),
    ]);
    expect(buildLegendV4(patches, own, ctx)[0].entries.map((e) => [e.label, e.cellIds])).toEqual([
      ['Offline', ['n2']],
      ['< 80%', []],
      ['≥ 80%', ['n1']],
    ]);
  });

  it('adds a down entry for a down status with no value, in the theme red that the painter uses', () => {
    const down: Status = { ...status('scrape_up', 'down'), reason: 'No data' };
    const patches: PatchMap = new Map([offline('n1'), cell('n2', down), cell('n3', status('cpu', 'stale'))]);
    const blocks = buildLegendV4(patches, fields, ctx);
    expect(blocks.map((b) => b.key)).toEqual(['status:scrape_up', 'state']);
    expect(blocks[0].cellIds).toEqual(['n1']);
    expect(blocks[1].entries.map((e) => [e.key, e.label, e.color, e.cellIds])).toEqual([
      ['down', 'Down, no data', statusColor({ state: 'down' }, theme), ['n2']],
      ['stale', 'Stale', statusColor({ state: 'stale' }, theme), ['n3']],
    ]);
  });

  it('gives the state block a title', () => {
    const blocks = buildLegendV4(new Map([cell('n1', status('cpu', 'stale'))]), fields, ctx);
    expect(blocks.map((b) => [b.key, b.title])).toEqual([['state', 'State']]);
  });

  it('gives the display name from the data source as the title when the config has no display name', () => {
    const own = new Map([['cpu', field({ displayNameFromDS: 'CPU from DS', thresholds })]]);
    const patches: PatchMap = new Map([cell('n1', status('cpu', 'normal', named('green'), '12'))]);
    expect(buildLegendV4(patches, own, { theme, queryName: () => 'Query' })[0].title).toBe('CPU from DS');
  });

  it('gives a refId with a continuous colour scheme a gradient over its range', () => {
    const own = new Map([
      ['temp', field({ color: { mode: FieldColorModeId.ContinuousGrYlRd }, min: 0, max: 100, unit: 'percent' })],
    ]);
    const patches: PatchMap = new Map([cell('n1', status('temp', 'normal', named('green'), '12%'))]);
    const [block] = buildLegendV4(patches, own, ctx);
    expect(block.gradient).toMatchObject({ min: '0%', max: '100%' });
    expect(block.cellIds).toEqual(['n1']);
  });

  it('gives a continuous colour scheme with no min and max the range of the field values', () => {
    const own = new Map([
      ['temp', { ...field({ color: { mode: FieldColorModeId.ContinuousGrYlRd }, unit: 'percent' }), values: [10, 50] }],
    ]);
    const patches: PatchMap = new Map([cell('n1', status('temp', 'normal', named('green'), '12%'))]);
    expect(buildLegendV4(patches, own, ctx)[0].gradient).toMatchObject({ min: '10%', max: '50%' });
  });

  it('ignores a v3 status and a refId with no field', () => {
    const v3: Status = { ...status('scrape_up', 'critical'), severity: undefined };
    const patches: PatchMap = new Map([cell('n1', v3), cell('n2', status('nope', 'normal', named('green'), '1'))]);
    expect(buildLegendV4(patches, fields, ctx)).toEqual([]);
  });
});
