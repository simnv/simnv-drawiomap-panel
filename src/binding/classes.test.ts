import { describe, expect, it } from 'vitest';

import { boilerPilot, netL2Pilot } from '../fixtures/pilots-v4';
import { parseConfig } from '../model/v4';
import { effectiveClass, resolveClasses } from './classes';

const resolve = (classes: Record<string, unknown>) => {
  const parsed = parseConfig({ version: 4, classes });
  return { parsed, resolved: resolveClasses(parsed) };
};

describe('resolveClasses (S2.3, S3.2 step 2)', () => {
  it('appends the rows parent first and keeps the origin of each row', () => {
    const resolved = resolveClasses(parseConfig(netL2Pilot()));
    const host = resolved.get('host');
    expect(host?.chain).toEqual(['device', 'host']);
    expect(host?.rows.map((r) => r.origin)).toEqual([
      'classes.device.rows[0]',
      'classes.host.rows[0]',
      'classes.host.rows[1]',
      'classes.host.rows[2]',
      'classes.host.rows[3]',
    ]);
    expect(host?.rows[0]).toEqual({
      kind: 'metadata',
      label: 'Role',
      text: '${object_class}',
      origin: 'classes.device.rows[0]',
    });
    expect(host?.match).toEqual({ key: 'job' });
    expect(host?.name).toBe('host');
  });

  it('keeps the origin through a chain of three', () => {
    const { resolved } = resolve({
      base: { rows: [{ kind: 'metadata', label: 'A', text: 'a' }] },
      mid: { extends: 'base' },
      leaf: { extends: 'mid', match: { key: 'job' }, rows: [{ kind: 'value', query: 'q' }] },
    });
    const leaf = resolved.get('leaf');
    expect(leaf?.chain).toEqual(['base', 'mid', 'leaf']);
    expect(leaf?.rows.map((r) => r.origin)).toEqual(['classes.base.rows[0]', 'classes.leaf.rows[0]']);
  });

  it('replaces match, chart and capacity each as one field', () => {
    const { resolved } = resolve({
      base: {
        match: { key: 'name', port: 'port_num' },
        chart: { kind: 'history', query: 'cpu', min: 0, label: 'CPU' },
        capacity: { a2b: 'up_cap', b2a: 'down_cap' },
        status: 'up',
        url: '/d/base',
      },
      child: {
        extends: 'base',
        match: { key: 'job' },
        chart: { kind: 'value', query: 'mem' },
        capacity: 'speed',
      },
    });
    const child = resolved.get('child');
    expect(child?.match).toEqual({ key: 'job' });
    expect(child?.chart).toEqual({ kind: 'value', query: 'mem' });
    expect(child?.capacity).toBe('speed');
    expect(child?.status).toBe('up');
    expect(child?.url).toBe('/d/base');
    expect(child?.extends).toBe('base');
  });

  it('keeps a field of the parent that the child does not set', () => {
    const { resolved } = resolve({
      base: { match: { key: 'job' }, freshness: '5m', missing: 'down', linkLabel: 'value' },
      child: { extends: 'base', freshness: '1m' },
    });
    expect(resolved.get('child')).toMatchObject({
      match: { key: 'job' },
      freshness: '1m',
      missing: 'down',
      linkLabel: 'value',
    });
  });

  it('gives class-cycle for each class in a cycle and for the classes below it', () => {
    const { parsed, resolved } = resolve({
      a: { extends: 'c', match: { key: 'job' } },
      b: { extends: 'a' },
      c: { extends: 'b' },
      d: { extends: 'a' },
      self: { extends: 'self', match: { key: 'job' } },
      ok: { match: { key: 'job' } },
    });
    expect(parsed.report).toEqual([
      { kind: 'class-cycle', cls: 'a' },
      { kind: 'class-cycle', cls: 'b' },
      { kind: 'class-cycle', cls: 'c' },
      { kind: 'class-cycle', cls: 'd' },
      { kind: 'class-cycle', cls: 'self' },
    ]);
    expect(parsed.invalidClasses.get('b')).toEqual([{ kind: 'class-cycle', cls: 'b' }]);
    expect([...resolved.keys()]).toEqual(['ok']);
  });

  it('gives class-unknown-parent for a class with an unknown parent and for the classes below it', () => {
    const { parsed, resolved } = resolve({
      orphan: { extends: 'nothing', match: { key: 'job' } },
      below: { extends: 'orphan' },
    });
    expect(parsed.report).toEqual([
      { kind: 'class-unknown-parent', cls: 'orphan' },
      { kind: 'class-unknown-parent', cls: 'below' },
    ]);
    expect(resolved.size).toBe(0);
  });

  it('gives class-invalid-parent for each class below a parent that did not parse', () => {
    const { parsed, resolved } = resolve({
      broken: { match: { key: 'job' }, colour: 'red' },
      child: { extends: 'broken' },
      grandchild: { extends: 'child' },
      other: { match: { key: 'job' } },
    });
    expect(parsed.report).toEqual([
      { kind: 'schema', path: 'classes.broken.colour', message: expect.any(String) },
      { kind: 'class-invalid-parent', cls: 'child' },
      { kind: 'class-invalid-parent', cls: 'grandchild' },
    ]);
    expect(parsed.invalidClasses.get('grandchild')).toEqual([{ kind: 'class-invalid-parent', cls: 'grandchild' }]);
    expect([...resolved.keys()]).toEqual(['other']);
  });

  it('marks a class with no match after extends as abstract (A7)', () => {
    const resolved = resolveClasses(parseConfig(netL2Pilot()));
    expect(resolved.get('device')?.abstract).toBe(true);
    expect(resolved.get('host')?.abstract).toBe(false);
    const { resolved: inherited } = resolve({ base: { match: { key: 'job' } }, child: { extends: 'base' } });
    expect(inherited.get('child')?.abstract).toBe(false);
  });

  it('keeps the row match of the boiler pilot apart from the class match', () => {
    const resolved = resolveClasses(parseConfig(boilerPilot()));
    const mains = resolved.get('mains-monitor');
    expect(mains?.match).toEqual({ key: 'entity=~"binary_sensor[.]wb_mrwm2_${key}_urms_normal_k[12]"' });
    expect(mains?.rows[0]).toMatchObject({ match: { key: 'entity=~"sensor[.]wb_mrwm2_${key}_urms_l[12]"' } });
  });

  it('gives an empty map when the config did not parse', () => {
    expect(resolveClasses(parseConfig({ version: 3 })).size).toBe(0);
  });

  it('does not change the parsed config', () => {
    const parsed = parseConfig(netL2Pilot());
    const copy = structuredClone(parsed);
    resolveClasses(parsed);
    expect(parsed).toEqual(copy);
  });
});

describe('effectiveClass (S2.3 overrides, D6)', () => {
  const lan = () => resolveClasses(parseConfig(netL2Pilot())).get('lan')!;

  it('returns the class when there is no override', () => {
    expect(effectiveClass(lan(), undefined, 'c1')).toEqual(lan());
  });

  it('appends the override rows with their override path', () => {
    const cls = lan();
    const eff = effectiveClass(
      cls,
      { rows: [{ kind: 'metadata', label: 'Note', text: 'second uplink' }] },
      'pg-link~p-a1-15'
    );
    expect(eff.rows.map((r) => r.origin)).toEqual([
      'classes.lan.rows[0]',
      'classes.lan.rows[1]',
      'overrides.pg-link~p-a1-15.rows[0]',
    ]);
    expect(eff.rows[2]).toMatchObject({ kind: 'metadata', label: 'Note', text: 'second uplink' });
    expect(cls.rows).toHaveLength(2);
  });

  it('replaces the other fields as a whole', () => {
    const eff = effectiveClass(lan(), { match: { key: 'name' }, capacity: { a2b: 'x', b2a: 'y' }, status: 's' }, 'c1');
    expect(eff.match).toEqual({ key: 'name' });
    expect(eff.capacity).toEqual({ a2b: 'x', b2a: 'y' });
    expect(eff.status).toBe('s');
    expect(eff.up).toBe('lan_tx');
    expect(eff.name).toBe('lan');
    expect(eff.chain).toEqual(['lan']);
  });

  it('makes an abstract class concrete when the override sets a match', () => {
    const device = resolveClasses(parseConfig(netL2Pilot())).get('device')!;
    expect(effectiveClass(device, { match: { key: 'job' } }, 'c1').abstract).toBe(false);
    expect(effectiveClass(device, { url: '/d/x' }, 'c1').abstract).toBe(true);
  });
});
