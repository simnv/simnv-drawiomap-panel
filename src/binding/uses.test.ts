import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { netL2Pilot } from '../fixtures/pilots-v4';
import type { MatchV4 } from '../model/v4';
import { validateConfig } from '../model/validate';
import { effectiveClass } from './classes';
import { listUses } from './uses';

const node = (attrs: Record<string, string>) => cellMetaFromAttrs('n1', attrs, false);
const edge = (attrs: Record<string, string>) => cellMetaFromAttrs('e1', attrs, true);

function classesOf(raw: unknown) {
  const v = validateConfig(raw);
  expect(v.report).toEqual([]);
  return v;
}

describe('listUses', () => {
  const config = {
    version: 4,
    classes: {
      device: { rows: [{ kind: 'history', query: 'cpu' }] },
      host: {
        extends: 'device',
        match: { key: 'job' },
        status: 'up',
        text: { query: 'temp' },
        rows: [
          { kind: 'metadata', label: 'Role', text: '${role}' },
          { kind: 'value', query: 'uptime' },
        ],
        chart: { kind: 'history', query: 'cpu' },
      },
    },
    overrides: { n1: { rows: [{ kind: 'history', query: 'extra', match: { key: 'name' } }] } },
  };

  it('a child class of device lists the inherited row with the path of the class that declares it', () => {
    const { classes } = classesOf(config);
    const uses = listUses(node({ bind: 'host', key: 'a' }), classes.get('host')!);
    expect(uses.map((u) => [u.kind, u.refId, u.path])).toEqual([
      ['status', 'up', 'classes.host.status'],
      ['text', 'temp', 'classes.host.text'],
      ['row', 'cpu', 'classes.device.rows[0]'],
      ['row', 'uptime', 'classes.host.rows[1]'],
      ['chart', 'cpu', 'classes.host.chart'],
    ]);
    // the class match applies to each use with no match of its own
    expect(uses.every((u) => JSON.stringify(u.match) === JSON.stringify({ key: 'job' }))).toBe(true);
    expect(uses[2].row).toMatchObject({ kind: 'history', query: 'cpu' });
  });

  it('an override row has its overrides.<id>.rows[i] path, and its match replaces the class match', () => {
    const { classes, parsed } = classesOf(config);
    const cls = effectiveClass(classes.get('host')!, parsed.config!.overrides.n1, 'n1');
    const uses = listUses(node({ bind: 'host', key: 'a' }), cls);
    const extra = uses.find((u) => u.refId === 'extra')!;
    expect(extra).toMatchObject({ kind: 'row', path: 'overrides.n1.rows[0]', match: { key: 'name' } });
  });

  it('an inherited scalar use has the path of the class that declares the field', () => {
    const { classes } = classesOf({
      version: 4,
      classes: {
        base: {
          status: 'up',
          text: { query: 'temp' },
          chart: { kind: 'history', query: 'cpu' },
          up: 'tx',
          capacity: { a2b: 'up_speed', b2a: 'down_speed' },
        },
        port: { extends: 'base', match: { key: 'name' }, down: 'rx' },
      },
    });
    const uses = listUses(edge({ bind: 'port', key: 'x' }), classes.get('port')!);
    expect(uses.map((u) => [u.kind, u.path])).toEqual([
      ['status', 'classes.base.status'],
      ['text', 'classes.base.text'],
      ['chart', 'classes.base.chart'],
      ['up', 'classes.base.up'],
      ['down', 'classes.port.down'],
      ['capacity', 'classes.base.capacity.a2b'],
      ['capacity', 'classes.base.capacity.b2a'],
    ]);
  });

  it('an override scalar field has its overrides.<id>.<field> path', () => {
    const { classes, parsed } = classesOf({
      version: 4,
      classes: { host: { match: { key: 'job' }, status: 'up', text: { query: 'temp' } } },
      overrides: { n1: { status: 'extra' } },
    });
    const cls = effectiveClass(classes.get('host')!, parsed.config!.overrides.n1, 'n1');
    const uses = listUses(node({ bind: 'host', key: 'a' }), cls);
    expect(uses.map((u) => [u.kind, u.refId, u.path])).toEqual([
      ['status', 'extra', 'overrides.n1.status'],
      ['text', 'temp', 'classes.host.text'],
    ]);
  });

  it('a link class lists the up, down and capacity uses on an edge', () => {
    const { classes } = classesOf(netL2Pilot());
    const uses = listUses(edge({ bind: 'lan', name: 'sw-a', port: '3' }), classes.get('lan')!);
    expect(uses.map((u) => [u.kind, u.refId, u.path])).toEqual([
      ['status', 'lan_state', 'classes.lan.status'],
      ['row', 'lan_tx', 'classes.lan.rows[0].a2b'],
      ['row', 'lan_rx', 'classes.lan.rows[0].b2a'],
      ['up', 'lan_tx', 'classes.lan.up'],
      ['down', 'lan_rx', 'classes.lan.down'],
      ['capacity', 'unifi_port_speed', 'classes.lan.capacity'],
    ]);
  });

  it('a capacity with a refId per direction gives one use per direction', () => {
    const { classes } = classesOf({
      version: 4,
      classes: {
        wan: { match: { key: 'name' }, up: 'tx', down: 'rx', capacity: { a2b: 'up_speed', b2a: 'down_speed' } },
      },
    });
    const uses = listUses(edge({ bind: 'wan', key: 'x' }), classes.get('wan')!);
    expect(uses.filter((u) => u.kind === 'capacity').map((u) => [u.refId, u.path])).toEqual([
      ['up_speed', 'classes.wan.capacity.a2b'],
      ['down_speed', 'classes.wan.capacity.b2a'],
    ]);
  });

  it('at=target flips the feeds of an updown row: its a→b line reads the down refId', () => {
    const { classes } = classesOf(netL2Pilot());
    const uses = listUses(edge({ bind: 'lan', name: 'sw-a', port: '3', at: 'target' }), classes.get('lan')!);
    expect(uses.filter((u) => u.kind === 'row').map((u) => [u.refId, u.path])).toEqual([
      ['lan_rx', 'classes.lan.rows[0].a2b'],
      ['lan_tx', 'classes.lan.rows[0].b2a'],
    ]);
  });

  it('an updown chart gives one use per direction', () => {
    const { classes } = classesOf({
      version: 4,
      classes: { port: { match: { key: 'name' }, chart: { kind: 'updown', up: 'tx', down: 'rx' } } },
    });
    const uses = listUses(node({ bind: 'port', key: 'x' }), classes.get('port')!);
    expect(uses.map((u) => [u.kind, u.refId, u.path])).toEqual([
      ['chart', 'tx', 'classes.port.chart.a2b'],
      ['chart', 'rx', 'classes.port.chart.b2a'],
    ]);
  });

  it('a node cell lists no up, down or capacity use', () => {
    const { classes } = classesOf(netL2Pilot());
    const uses = listUses(node({ bind: 'lan', name: 'sw-a', port: '3' }), classes.get('lan')!);
    expect(uses.map((u) => u.kind)).not.toContain('up');
    expect(uses.map((u) => u.kind)).not.toContain('capacity');
  });

  it('an abstract class lists no use', () => {
    const { classes } = classesOf(netL2Pilot());
    expect(listUses(node({ bind: 'device' }), classes.get('device')!)).toEqual([]);
  });

  const directionalClass = () =>
    classesOf({
      version: 4,
      classes: {
        link: {
          match: { key: 'job' },
          status: 'state',
          text: { query: 'label' },
          rows: [
            { kind: 'value', query: 'value' },
            { kind: 'history', query: 'history' },
            { kind: 'updown', up: 'tx', down: 'rx' },
          ],
          chart: { kind: 'updown', up: 'chart_tx', down: 'chart_rx' },
          up: 'tx',
          down: 'rx',
          capacity: { a2b: 'speed_ab', b2a: 'speed_ba' },
        },
      },
    }).classes.get('link')!;

  it.each([
    [{}, 'source', 'tx', 'rx'],
    [{ at: 'source' }, 'source', 'tx', 'rx'],
    [{ at: 'target' }, 'target', 'rx', 'tx'],
    [{ at: '' }, 'source', 'tx', 'rx'],
    [{ at: 'other' }, 'source', 'tx', 'rx'],
  ] as const)('with no plan, own attributes %j set the end of each directional edge use', (attrs, end, a2b, b2a) => {
    const uses = listUses(edge({ bind: 'link', key: 'rtr-a', ...attrs }), directionalClass());
    expect(uses.map((u) => [u.path, u.refId, u.end])).toEqual([
      ['classes.link.status', 'state', undefined],
      ['classes.link.text', 'label', undefined],
      ['classes.link.rows[0]', 'value', undefined],
      ['classes.link.rows[1]', 'history', undefined],
      ['classes.link.rows[2].a2b', a2b, end],
      ['classes.link.rows[2].b2a', b2a, end],
      ['classes.link.chart.a2b', end === 'target' ? 'chart_rx' : 'chart_tx', end],
      ['classes.link.chart.b2a', end === 'target' ? 'chart_tx' : 'chart_rx', end],
      ['classes.link.up', 'tx', end],
      ['classes.link.down', 'rx', end],
      ['classes.link.capacity.a2b', 'speed_ab', undefined],
      ['classes.link.capacity.b2a', 'speed_ba', undefined],
    ]);
  });

  it.each<Record<string, string>>([{}, { 'pg-kind': 'port', 'pg-node': 'rtr-a' }])(
    'with no plan, a vertex with %j keeps its own at=target feed (N2)',
    (attrs) => {
      const uses = listUses(node({ bind: 'link', key: 'rtr-a', at: 'target', ...attrs }), directionalClass());
      expect(uses.filter((u) => u.row?.kind === 'updown').map((u) => [u.path, u.refId, u.end])).toEqual([
        ['classes.link.rows[2].a2b', 'rx', 'target'],
        ['classes.link.rows[2].b2a', 'tx', 'target'],
        ['classes.link.chart.a2b', 'chart_rx', 'target'],
        ['classes.link.chart.b2a', 'chart_tx', 'target'],
      ]);
      expect(uses.some((u) => ['up', 'down', 'capacity'].includes(u.kind))).toBe(false);
    }
  );

  it.each(['source', 'target', 'drop'] as const)('a %s plan applies to every use of the class match', (end) => {
    const uses = listUses(edge({ bind: 'link', at: 'target' }), directionalClass(), () => end);
    if (end === 'drop') {
      expect(uses).toEqual([]);
      return;
    }
    expect(uses.map((u) => [u.path, u.refId, u.end])).toEqual([
      ['classes.link.status', 'state', undefined],
      ['classes.link.text', 'label', undefined],
      ['classes.link.rows[0]', 'value', undefined],
      ['classes.link.rows[1]', 'history', undefined],
      ['classes.link.rows[2].a2b', end === 'target' ? 'rx' : 'tx', end],
      ['classes.link.rows[2].b2a', end === 'target' ? 'tx' : 'rx', end],
      ['classes.link.chart.a2b', end === 'target' ? 'chart_rx' : 'chart_tx', end],
      ['classes.link.chart.b2a', end === 'target' ? 'chart_tx' : 'chart_rx', end],
      ['classes.link.up', 'tx', end],
      ['classes.link.down', 'rx', end],
      ['classes.link.capacity.a2b', 'speed_ab', undefined],
      ['classes.link.capacity.b2a', 'speed_ba', undefined],
    ]);
  });

  it('uses the plan of each text, row and chart match, while it keeps their paths and order', () => {
    const { classes, parsed } = classesOf({
      version: 4,
      classes: {
        base: {
          match: { key: 'job' },
          status: 'state',
          text: { query: 'label', match: { id: 'edge' } },
          rows: [
            { kind: 'updown', up: 'own_tx', down: 'own_rx', match: { id: 'edge' } },
            { kind: 'history', query: 'site_history', match: { site: 'site' } },
          ],
          up: 'tx',
          down: 'rx',
          capacity: 'speed',
        },
        link: {
          extends: 'base',
          chart: { kind: 'updown', up: 'chart_tx', down: 'chart_rx', match: { port: 'device' } },
        },
      },
      overrides: { e1: { rows: [{ kind: 'value', query: 'extra', match: { id: 'edge' } }] } },
    });
    const cls = effectiveClass(classes.get('link')!, parsed.config!.overrides.e1, 'e1');
    const plan = (match: MatchV4) => ('site' in match ? 'drop' : 'id' in match ? 'source' : 'target');
    const uses = listUses(edge({ bind: 'link' }), cls, plan);
    expect(uses.map((u) => [u.path, u.refId, u.end])).toEqual([
      ['classes.base.status', 'state', undefined],
      ['classes.base.text', 'label', undefined],
      ['classes.base.rows[0].a2b', 'own_tx', 'source'],
      ['classes.base.rows[0].b2a', 'own_rx', 'source'],
      ['overrides.e1.rows[0]', 'extra', undefined],
      ['classes.link.chart.a2b', 'chart_rx', 'target'],
      ['classes.link.chart.b2a', 'chart_tx', 'target'],
      ['classes.base.up', 'tx', 'target'],
      ['classes.base.down', 'rx', 'target'],
      ['classes.base.capacity', 'speed', undefined],
    ]);
  });
});
