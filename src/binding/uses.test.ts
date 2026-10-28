import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { netL2Pilot } from '../fixtures/pilots-v4';
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
});
