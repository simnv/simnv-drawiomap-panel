import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { ReportEntry } from '../binding/report';
import { boilerPilot, netL2Pilot } from '../fixtures/pilots-v4';
import { classSchema, envelopeSchema, overrideSchema, parseConfig, type MatchV4, type ParsedConfig } from './v4';

const schemaEntries = (entries: ReportEntry[] | undefined) => (entries ?? []).filter((e) => e.kind === 'schema');

describe('parseConfig (S2.5)', () => {
  it.each([
    ['demo-network', netL2Pilot],
    ['demo-enclosure', boilerPilot],
  ])('parses the pilot %s with no report entry', (_name, pilot) => {
    const raw = pilot();
    const parsed = parseConfig(raw);
    expect(parsed.report).toEqual([]);
    expect(parsed.invalidClasses.size).toBe(0);
    expect(parsed.invalidOverrides.size).toBe(0);
    expect(parsed.config).toEqual({ ...raw, overrides: 'overrides' in raw ? raw.overrides : {} });
  });

  it.each([3, 2, 1])('binds nothing for version %i and gives one outdated-config entry', (version) => {
    const parsed = parseConfig({ version, queries: [], patterns: [], overrides: [], widgets: [] });
    expect(parsed.config).toBeNull();
    expect(parsed.report).toEqual([{ kind: 'outdated-config', version }]);
    expect(parsed.invalidClasses.size).toBe(0);
    expect(parsed.invalidOverrides.size).toBe(0);
  });

  it('reads a key with the value undefined as no key, as the dashboard JSON does', () => {
    // a live options update of Grafana removes a key with an explicit undefined (configUpdate)
    const parsed = parseConfig({
      version: 4,
      freshness: undefined,
      unknown: undefined,
      classes: { lan: { match: { key: 'job', value: undefined }, status: 'up', colour: undefined }, wan: undefined },
      overrides: { 'cell-1': undefined },
    });
    expect(parsed.report).toEqual([]);
    expect(parsed.config).toEqual({
      version: 4,
      freshness: '3x',
      classes: { lan: { match: { key: 'job' }, status: 'up' } },
      overrides: {},
    });
    expect(Object.keys(parsed.config?.classes ?? {})).toEqual(['lan']);
    expect(Object.keys(parsed.config?.classes.lan.match ?? {})).toEqual(['key']);
  });

  it('gives schema entries and no config when the envelope does not parse', () => {
    const parsed = parseConfig({ version: 4, classes: {}, colours: {} });
    expect(parsed.config).toBeNull();
    expect(parsed.report).toEqual([{ kind: 'schema', path: 'colours', message: expect.any(String) }]);
  });

  it('gives a schema entry at the root for a value that is not an object', () => {
    for (const raw of [undefined, null, 'version: 4', 4]) {
      const parsed = parseConfig(raw);
      expect(parsed.config).toBeNull();
      expect(parsed.report).toEqual([{ kind: 'schema', path: '', message: expect.any(String) }]);
    }
  });

  it('makes only the class with an unknown key invalid', () => {
    const raw = netL2Pilot();
    (raw.classes.camera as Record<string, unknown>).colour = 'red';
    const parsed = parseConfig(raw);
    expect(parsed.invalidClasses.get('camera')).toEqual([
      { kind: 'schema', path: 'classes.camera.colour', message: expect.any(String) },
    ]);
    expect(parsed.report).toEqual(parsed.invalidClasses.get('camera'));
    expect(parsed.config?.classes.camera).toBeUndefined();
    expect(Object.keys(parsed.config?.classes ?? {})).toEqual([
      'device',
      'host',
      'unifi-switch',
      'unifi-client',
      'lan',
    ]);
  });

  it('gives the YAML path of a field deep in a class', () => {
    const raw = netL2Pilot();
    (raw.classes.lan.rows[0] as Record<string, unknown>).up = 7;
    const parsed = parseConfig(raw);
    expect(schemaEntries(parsed.invalidClasses.get('lan')).map((e) => e.path)).toEqual(['classes.lan.rows[0].up']);
  });

  it('makes only the invalid override invalid', () => {
    const raw = { ...netL2Pilot(), overrides: { good: { url: '/d/a' }, bad: { extends: 'host' } } };
    const parsed = parseConfig(raw);
    expect([...parsed.invalidOverrides.keys()]).toEqual(['bad']);
    expect(parsed.invalidOverrides.get('bad')).toEqual([
      { kind: 'schema', path: 'overrides.bad.extends', message: expect.any(String) },
    ]);
    expect(parsed.report).toEqual(parsed.invalidOverrides.get('bad'));
    expect(parsed.config?.overrides).toEqual({ good: { url: '/d/a' } });
    expect(parsed.invalidClasses.size).toBe(0);
  });

  it('sets the defaults: freshness 3x and no overrides', () => {
    const parsed = parseConfig({ version: 4, classes: {} });
    expect(parsed.config).toEqual({ version: 4, freshness: '3x', classes: {}, overrides: {} });
  });

  it('rejects a matcher that is not a label or a label, an operator and a quoted string (S2.2)', () => {
    const parsed = parseConfig({ version: 4, classes: { node: { match: { key: 'a b c' } } } });
    expect(parsed.invalidClasses.get('node')).toEqual([
      { kind: 'schema', path: 'classes.node.match.key', message: expect.any(String) },
    ]);
  });

  it('gives the index of a bad matcher in a list (A6)', () => {
    const parsed = parseConfig({ version: 4, classes: { node: { match: { key: ['job', 'a b'] } } } });
    expect(schemaEntries(parsed.invalidClasses.get('node')).map((e) => e.path)).toEqual(['classes.node.match.key[1]']);
  });

  it('rejects an empty match block', () => {
    const parsed = parseConfig({ version: 4, classes: { node: { match: {} } } });
    expect(schemaEntries(parsed.invalidClasses.get('node')).map((e) => e.path)).toEqual(['classes.node.match']);
  });

  it.each(['5m', '180s', '250ms', '2h', '3x', '1.5x'])('accepts the freshness %s', (freshness) => {
    expect(parseConfig({ version: 4, freshness, classes: { a: { freshness } } }).report).toEqual([]);
  });

  it.each(['5', '3y', 'x', '-1m', '1.5m'])('rejects the freshness %s', (freshness) => {
    expect(parseConfig({ version: 4, freshness, classes: {} }).config).toBeNull();
    expect(parseConfig({ version: 4, classes: { a: { freshness } } }).invalidClasses.has('a')).toBe(true);
  });

  it('accepts a capacity per direction and rejects an unknown direction (A4)', () => {
    expect(parseConfig({ version: 4, classes: { a: { capacity: { a2b: 'x', b2a: 'y' } } } }).report).toEqual([]);
    const parsed = parseConfig({ version: 4, classes: { a: { capacity: { up: 'x' } } } });
    expect(parsed.invalidClasses.has('a')).toBe(true);
  });

  it('accepts min auto on a history row and a chart region', () => {
    const raw = {
      version: 4,
      classes: {
        a: {
          rows: [{ kind: 'history', query: 'q', min: 'auto', max: 100 }],
          chart: { kind: 'updown', up: 'u', down: 'd' },
        },
      },
    };
    expect(parseConfig(raw).report).toEqual([]);
  });

  it('rejects the name __proto__, which zod would drop with no issue', () => {
    const classKey = parseConfig(JSON.parse('{"version": 4, "classes": {"__proto__": {}}}'));
    expect(classKey.config).toBeNull();
    expect(classKey.report).toEqual([{ kind: 'schema', path: 'classes.__proto__', message: expect.any(String) }]);
    const overrideKey = parseConfig(JSON.parse('{"version": 4, "classes": {}, "overrides": {"__proto__": {}}}'));
    expect(overrideKey.report).toEqual([{ kind: 'schema', path: 'overrides.__proto__', message: expect.any(String) }]);
    const matchKey = parseConfig(
      JSON.parse('{"version": 4, "classes": {"a": {"match": {"key": "job", "__proto__": "x"}}}}')
    );
    expect(schemaEntries(matchKey.invalidClasses.get('a')).map((e) => e.path)).toEqual(['classes.a.match.__proto__']);
  });

  it('gives records with no prototype, so a prototype key finds nothing', () => {
    const { config } = parseConfig(netL2Pilot());
    expect(config?.classes.constructor).toBeUndefined();
    expect(config?.classes.toString).toBeUndefined();
    expect(config?.overrides.hasOwnProperty).toBeUndefined();
  });

  it('gives the entries in the order of the steps: items, then the chain', () => {
    const parsed = parseConfig({
      version: 4,
      classes: { bad: { colour: 'red' }, child: { extends: 'bad' } },
      overrides: { o: { colour: 'red' } },
    });
    expect(parsed.report).toEqual([
      { kind: 'schema', path: 'classes.bad.colour', message: expect.any(String) },
      { kind: 'schema', path: 'overrides.o.colour', message: expect.any(String) },
      { kind: 'class-invalid-parent', cls: 'child' },
    ]);
  });

  it('does not change its input', () => {
    const raw = netL2Pilot();
    const copy = structuredClone(raw);
    parseConfig(raw);
    expect(raw).toEqual(copy);
  });
});

describe('the schema types', () => {
  it('types the match schema as MatchV4', () => {
    expectTypeOf<z.infer<typeof overrideSchema>['match']>().toEqualTypeOf<MatchV4 | undefined>();
    expectTypeOf<z.infer<typeof classSchema>['match']>().toEqualTypeOf<MatchV4 | undefined>();
  });

  it('gives the default freshness in the envelope', () => {
    expect(envelopeSchema.parse({ version: 4, classes: {} }).freshness).toBe('3x');
  });

  it('keeps the ParsedConfig shape of the plan', () => {
    expectTypeOf<ParsedConfig['invalidClasses']>().toEqualTypeOf<Map<string, ReportEntry[]>>();
    expectTypeOf<ParsedConfig['invalidOverrides']>().toEqualTypeOf<Map<string, ReportEntry[]>>();
    expectTypeOf<ParsedConfig['report']>().toEqualTypeOf<ReportEntry[]>();
  });
});
