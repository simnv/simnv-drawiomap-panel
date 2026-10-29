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
import { cellsForPath } from './cellsForPath';

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

/** The bind result and the resolved classes of a config, cells and frames, as the split editor holds them. */
function bound(config: unknown, cells: Cell[], frames: DataFrame[], refs: string[]) {
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
  return { result: bindV4({ index, validated, data, ctx }), classes: validated.classes };
}

/**
 * `device` is abstract with a status and a row; `host` and `switch` extend it, `edge-sw` extends `switch`; `link` is
 * a link-only class with an `updown` chart. `s1` has an override row.
 */
const CONFIG = {
  version: 4,
  classes: {
    device: { status: 'up', rows: [{ kind: 'value', query: 'cpu' }] },
    host: { extends: 'device', match: { key: 'job' }, rows: [{ kind: 'value', query: 'mem' }] },
    switch: { extends: 'device', match: { key: 'name' }, status: 'health', url: '/d/sw' },
    'edge-sw': { extends: 'switch' },
    link: { match: { key: 'name' }, up: 'tx', down: 'rx', chart: { kind: 'updown', up: 'tx', down: 'rx' } },
  },
  overrides: { s1: { rows: [{ kind: 'value', query: 'health' }] } },
};

const CELLS: Cell[] = [
  ['d1', { bind: 'device' }],
  ['h1', { bind: 'host', key: 'a' }],
  ['h2', { bind: 'host', key: 'b' }],
  ['s1', { bind: 'switch', key: 's1' }],
  ['e1', { bind: 'edge-sw', key: 'e1' }],
  ['l1', { bind: 'link', key: 'l1' }, true],
  ['x', {}],
];

const FRAMES = [
  frame('up', { job: 'a' }),
  frame('up', { job: 'b', i: '1' }),
  frame('up', { job: 'b', i: '2' }),
  frame('cpu', { job: 'a' }),
  frame('cpu', { name: 's1' }),
  frame('health', { name: 's1' }),
  frame('tx', { name: 'l1' }),
];

const { result, classes } = bound(CONFIG, CELLS, FRAMES, ['up', 'cpu', 'mem', 'health', 'tx', 'rx']);

/** The cell set with sorted lists and the badges as a plain object, so that the order of the map does not count. */
function setAt(path: string) {
  const set = cellsForPath(path, result, classes);
  return {
    cells: [...set.cells].sort(),
    lighter: [...set.lighter].sort(),
    badges: Object.fromEntries([...set.badges].sort(([a], [b]) => a.localeCompare(b))),
  };
}

const ok = (count: number) => ({ count, red: false });
const RED = { count: 0, red: true };

describe('cellsForPath (spec 5.3 "The cells of a path")', () => {
  it('classes.<c> and its plain fields: the cells of c and, lighter, the cells of the classes that extend c', () => {
    const device = { cells: ['d1'], lighter: ['e1', 'h1', 'h2', 's1'], badges: {} };
    expect(setAt('classes.device')).toEqual(device);
    expect(setAt('classes.switch')).toEqual({ cells: ['s1'], lighter: ['e1'], badges: {} });
    expect(setAt('classes.switch.url')).toEqual({ cells: ['s1'], lighter: ['e1'], badges: {} });
    expect(setAt('classes.edge-sw.extends')).toEqual({ cells: ['e1'], lighter: [], badges: {} });
    expect(setAt('classes.switch.rows')).toEqual({ cells: ['s1'], lighter: ['e1'], badges: {} });
  });

  it('classes.<c>.match: the same cells, with the count of the first use (the status)', () => {
    expect(setAt('classes.host.match')).toEqual({ cells: ['h1', 'h2'], lighter: [], badges: { h1: ok(1), h2: ok(2) } });
    expect(setAt('classes.host.match.key')).toEqual(setAt('classes.host.match'));
    // edge-sw inherits the match of switch: its cells get the badge too
    expect(setAt('classes.switch.match')).toEqual({ cells: ['s1'], lighter: ['e1'], badges: { e1: RED, s1: ok(1) } });
  });

  it('a link-only class has a match badge from up', () => {
    expect(setAt('classes.link.match')).toEqual({ cells: ['l1'], lighter: [], badges: { l1: ok(1) } });
  });

  it('classes.<c>.rows[i]: a row of a base class lights the cells of each child class with its own count', () => {
    const row = {
      cells: ['d1', 'e1', 'h1', 'h2', 's1'],
      lighter: [],
      badges: { e1: RED, h1: ok(1), h2: RED, s1: ok(1) },
    };
    expect(setAt('classes.device.rows[0]')).toEqual(row);
    expect(setAt('classes.device.rows[0].query')).toEqual(row);
    expect(setAt('classes.host.rows[0]')).toEqual({ cells: ['h1', 'h2'], lighter: [], badges: { h1: RED, h2: RED } });
    expect(setAt('classes.host.rows[5]')).toEqual({ cells: [], lighter: [], badges: {} });
  });

  it('the use fields: the cells of the class, with the count of that use where the use comes from the field', () => {
    // switch and edge-sw replace the status of device: their cells light, with no badge
    expect(setAt('classes.device.status')).toEqual({
      cells: ['d1'],
      lighter: ['e1', 'h1', 'h2', 's1'],
      badges: { h1: ok(1), h2: ok(2) },
    });
    expect(setAt('classes.switch.status')).toEqual({ cells: ['s1'], lighter: ['e1'], badges: { e1: RED, s1: ok(1) } });
    expect(setAt('classes.link.up')).toEqual({ cells: ['l1'], lighter: [], badges: { l1: ok(1) } });
    expect(setAt('classes.link.down')).toEqual({ cells: ['l1'], lighter: [], badges: { l1: RED } });
  });

  it('an updown use shows the half with the fewest series', () => {
    expect(setAt('classes.link.chart')).toEqual({ cells: ['l1'], lighter: [], badges: { l1: RED } });
    expect(setAt('classes.link.chart.up')).toEqual(setAt('classes.link.chart'));
  });

  it('overrides.<id>: that one cell, with the count of its first use', () => {
    expect(setAt('overrides.s1')).toEqual({ cells: ['s1'], lighter: [], badges: { s1: ok(1) } });
    expect(setAt('overrides.s1.rows[0].query')).toEqual(setAt('overrides.s1'));
    expect(setAt('overrides.x')).toEqual({ cells: ['x'], lighter: [], badges: {} });
  });

  it('other paths give nothing', () => {
    for (const path of ['', 'version', 'freshness', 'classes', 'overrides', 'classes.nope', 'classes.nope.status']) {
      expect(setAt(path)).toEqual({ cells: [], lighter: [], badges: {} });
    }
  });

  it('classes.<c>.match: a cell with an override match gets no badge, its match is not this block', () => {
    const r = bound(
      {
        version: 4,
        classes: { host: { match: { key: 'job' }, status: 'up' }, sub: { extends: 'host' } },
        overrides: { h2: { match: { key: 'name' } }, s2: { match: { key: 'name' } } },
      },
      [
        ['h1', { bind: 'host', key: 'a' }],
        ['h2', { bind: 'host', key: 'b' }],
        ['s1', { bind: 'sub', key: 'a' }],
        ['s2', { bind: 'sub', key: 'b' }],
      ],
      [frame('up', { job: 'a' }), frame('up', { name: 'b' })],
      ['up']
    );
    const set = cellsForPath('classes.host.match', r.result, r.classes);
    expect([...set.cells].sort()).toEqual(['h1', 'h2']);
    expect([...set.lighter].sort()).toEqual(['s1', 's2']);
    expect([...set.badges.keys()].sort()).toEqual(['h1', 's1']);
  });

  it('a cell with an unknown class is in no cell set', () => {
    const r = bound({ version: 4, classes: { box: { match: { key: 'name' } } } }, [['b', { bind: 'nope' }]], [], []);
    expect(cellsForPath('classes.nope', r.result, r.classes).cells).toEqual([]);
  });

  it('a class with no use gives no match badge', () => {
    const r = bound({ version: 4, classes: { box: { match: { key: 'name' } } } }, [['b', { bind: 'box' }]], [], []);
    const set = cellsForPath('classes.box.match', r.result, r.classes);
    expect(set.cells).toEqual(['b']);
    expect(set.badges.size).toBe(0);
  });
});

describe('cellsForPath: a cell with an invalid override', () => {
  it('stays a cell of its class: the class path lights it', () => {
    const config = { ...CONFIG, overrides: { h2: { bogus: 1 } } };
    const { result: r, classes: c } = bound(config, CELLS, FRAMES, ['up', 'cpu', 'mem', 'health', 'tx', 'rx']);
    expect([...cellsForPath('classes.host', r, c).cells].sort()).toEqual(['h1', 'h2']);
  });
});
