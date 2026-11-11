import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  type DataFrame,
  type Labels,
  type PanelData,
} from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../../adapter/portograph';
import { bindV4 } from '../../binding/bindV4';
import { bindContextFor } from '../../binding/context';
import { validateConfig } from '../../model/validate';
import type { CellEntry, CellMeta } from '../../types';
import { reportCounts } from './reportCounts';

const ctx = bindContextFor({
  theme: createTheme(),
  replaceVariables: (s) => s,
  timeZone: 'utc',
  linkWidth: { min: 2, max: 10 },
});

const frame = (refId: string, labels: Labels): DataFrame => ({
  refId,
  length: 1,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: [120_000] },
    { name: 'Value', type: FieldType.number, config: {}, labels, values: [1] },
  ],
});

type Cell = [id: string, attrs: Record<string, string>, isEdge?: boolean];

function counts(config: unknown, cells: Cell[], frames: DataFrame[], refs: string[], xml?: string) {
  const metas: CellMeta[] = cells.map(([id, attrs, isEdge]) => cellMetaFromAttrs(id, attrs, isEdge ?? false));
  applyContract(metas);
  const index = new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
  const range = { from: dateTime(0), to: dateTime(120_000), raw: { from: 'now-2m', to: 'now' } };
  const data: PanelData = {
    state: LoadingState.Done,
    series: frames,
    timeRange: range,
    request: {
      requestId: 'demo',
      app: CoreApp.Dashboard,
      startTime: 120_000,
      range,
      timezone: 'utc',
      scopedVars: {},
      interval: '1m',
      intervalMs: 60_000,
      targets: refs.map((refId) => ({ refId })),
    },
  };
  const validated = validateConfig(config);
  return reportCounts(bindV4({ index, xml, validated, data, ctx }), validated.classes);
}

describe('reportCounts (spec 4 "Counts")', () => {
  it('a class with 3 cells, one with no series and two with 2 series, gives zero: 1, many: 2', () => {
    const r = counts(
      { version: 4, classes: { host: { match: { key: 'job' }, status: 'up' } } },
      [
        ['a', { bind: 'host', key: 'a' }],
        ['b', { bind: 'host', key: 'b' }],
        ['c', { bind: 'host', key: 'c' }],
      ],
      [
        frame('up', { job: 'b', i: '1' }),
        frame('up', { job: 'b', i: '2' }),
        frame('up', { job: 'c', i: '1' }),
        frame('up', { job: 'c', i: '2' }),
      ],
      ['up']
    );
    expect(r.perClass.get('host')).toEqual({ cells: 3, zero: 1, one: 0, many: 2, unmeasured: 0, inherited: 0 });
    expect(r.perUse.get('classes.host.status')).toEqual({ zero: 1, one: 0, many: 2 });
  });

  it('a row of a base class counts the cells of each child class under the base path', () => {
    const r = counts(
      {
        version: 4,
        classes: {
          device: { rows: [{ kind: 'value', query: 'cpu' }] },
          host: { extends: 'device', match: { key: 'job' }, status: 'up' },
          switch: { extends: 'device', match: { key: 'name' } },
        },
      },
      [
        ['d', { bind: 'device' }],
        ['h1', { bind: 'host', key: 'a' }],
        ['h2', { bind: 'host', key: 'b' }],
        ['s1', { bind: 'switch', key: 's1' }],
      ],
      [frame('up', { job: 'a' }), frame('up', { job: 'b' }), frame('cpu', { job: 'a' }), frame('cpu', { name: 's1' })],
      ['up', 'cpu']
    );
    expect(r.perUse.get('classes.device.rows[0]')).toEqual({ zero: 1, one: 2, many: 0 });
    expect(r.perUse.get('classes.host.status')).toEqual({ zero: 0, one: 2, many: 0 });
    // the abstract class has its cell, with no use; the first use of switch is its row
    expect(r.perClass.get('device')).toEqual({ cells: 1, zero: 0, one: 0, many: 0, unmeasured: 0, inherited: 0 });
    expect(r.perClass.get('host')).toEqual({ cells: 2, zero: 0, one: 2, many: 0, unmeasured: 0, inherited: 0 });
    expect(r.perClass.get('switch')).toEqual({ cells: 1, zero: 0, one: 1, many: 0, unmeasured: 0, inherited: 0 });
    expect([...r.perUse.keys()].sort()).toEqual(['classes.device.rows[0]', 'classes.host.status']);
  });

  it('a class with no cells has a row of zeros; a cell of an unknown class counts nowhere', () => {
    const r = counts(
      { version: 4, classes: { host: { match: { key: 'job' }, status: 'up' }, spare: { match: { key: 'job' } } } },
      [['a', { bind: 'nope', key: 'a' }]],
      [],
      ['up']
    );
    expect(r.perClass.get('spare')).toEqual({ cells: 0, zero: 0, one: 0, many: 0, unmeasured: 0, inherited: 0 });
    expect(r.perClass.get('host')).toEqual({ cells: 0, zero: 0, one: 0, many: 0, unmeasured: 0, inherited: 0 });
    expect(r.perClass.has('nope')).toBe(false);
    expect(r.perUse.size).toBe(0);
  });

  it('an updown use counts each direction under its own path', () => {
    const r = counts(
      {
        version: 4,
        classes: {
          link: { match: { key: 'name' }, up: 'tx', down: 'rx', chart: { kind: 'updown', up: 'tx', down: 'rx' } },
        },
      },
      [['l1', { bind: 'link', key: 'l1' }, true]],
      [frame('tx', { name: 'l1' })],
      ['tx', 'rx']
    );
    expect(r.perUse.get('classes.link.chart.a2b')).toEqual({ zero: 0, one: 1, many: 0 });
    expect(r.perUse.get('classes.link.chart.b2a')).toEqual({ zero: 1, one: 0, many: 0 });
    expect(r.perUse.get('classes.link.up')).toEqual({ zero: 0, one: 1, many: 0 });
    expect(r.perUse.get('classes.link.down')).toEqual({ zero: 1, one: 0, many: 0 });
    // the first use of a link-only class is `up`
    expect(r.perClass.get('link')).toEqual({ cells: 1, zero: 0, one: 1, many: 0, unmeasured: 0, inherited: 0 });
  });

  it('counts the unmeasured links and the cells that read an inherited value as their own numbers', () => {
    const xml =
      '<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="n1" parent="1" vertex="1"/><mxCell id="p1" parent="n1" vertex="1"/>' +
      '<mxCell id="n2" parent="1" vertex="1"/><mxCell id="p2" parent="n2" vertex="1"/>' +
      '<mxCell id="l1" parent="1" edge="1" source="p1" target="n2"/>' +
      '<mxCell id="l2" parent="1" edge="1" source="p2" target="n2"/>' +
      '</root></mxGraphModel></diagram></mxfile>';
    const r = counts(
      { version: 4, classes: { link: { match: { key: 'job', port: 'device' }, up: 'tx', down: 'rx' } } },
      [
        ['n1', { key: 'n1' }],
        ['p1', { port: 'eth0' }],
        ['n2', {}],
        ['p2', {}],
        ['l1', { bind: 'link' }, true],
        ['l2', { bind: 'link' }, true],
      ],
      [frame('tx', { job: 'n1', device: 'eth0' })],
      ['tx', 'rx'],
      xml
    );
    // l1 reads key and port from its source end; l2 has no end that gives them: it has no use and no first-use count
    expect(r.perClass.get('link')).toEqual({ cells: 2, zero: 0, one: 1, many: 0, unmeasured: 1, inherited: 1 });
  });
});
