import { describe, expect, it } from 'vitest';

import { METADATA_VARIABLE_MESSAGE } from '../binding/template';
import { boilerPilot, netL2Pilot } from '../fixtures/pilots-v4';
import { validateConfig } from './validate';

const config = (classes: Record<string, unknown>, overrides?: Record<string, unknown>) => ({
  version: 4,
  classes,
  ...(overrides ? { overrides } : {}),
});

describe('validateConfig (S2.5 steps 1-4)', () => {
  it.each([
    ['demo-network', netL2Pilot],
    ['demo-enclosure', boilerPilot],
  ])('validates the pilot %s with an empty report', (_name, pilot) => {
    const raw = pilot();
    const { parsed, classes, report } = validateConfig(raw);
    expect(report).toEqual([]);
    expect(parsed.invalidClasses.size).toBe(0);
    expect(parsed.invalidOverrides.size).toBe(0);
    expect([...classes.keys()].sort()).toEqual(Object.keys(raw.classes).sort());
  });

  it('gives a bad matcher a schema entry at its YAML path and makes only its class invalid', () => {
    const { parsed, classes, report } = validateConfig(
      config({
        host: { match: { key: 'job' }, status: 'up' },
        bad: { match: { key: 'job="\\d"' }, status: 'up' },
      })
    );
    expect(report).toEqual([{ kind: 'schema', path: 'classes.bad.match.key', message: expect.any(String) }]);
    expect(parsed.invalidClasses.get('bad')).toEqual(report);
    expect([...classes.keys()]).toEqual(['host']);
  });

  it.each([
    ['a row', { rows: [{ kind: 'value', query: 'b', match: { key: 'name="${value}"' } }] }, 'rows[0].match.key'],
    ['the text', { text: { query: 'b', match: { key: 'name="${labels.x}"' } } }, 'text.match.key'],
    ['the chart', { chart: { kind: 'history', query: 'b', match: { key: 'name="${job:csv}"' } } }, 'chart.match.key'],
    [
      'a block that reads no cell attribute',
      { rows: [{ kind: 'value', query: 'b', match: { key: 'job!=""' } }] },
      'rows[0].match',
    ],
  ])('checks the match block of %s', (_name, fields, path) => {
    const { classes, report } = validateConfig(config({ host: { match: { key: 'job' }, ...fields } }));
    expect(report).toEqual([{ kind: 'schema', path: `classes.host.${path}`, message: expect.any(String) }]);
    expect(classes.has('host')).toBe(false);
  });

  it('makes each descendant of a class with a bad matcher invalid with class-invalid-parent', () => {
    const { parsed, classes, report } = validateConfig(
      config({
        base: { match: { key: 'job="\\d"' } },
        child: { extends: 'base', status: 'up' },
        grandchild: { extends: 'child' },
        other: { match: { key: 'job' } },
      })
    );
    expect(report).toEqual([
      { kind: 'schema', path: 'classes.base.match.key', message: expect.any(String) },
      { kind: 'class-invalid-parent', cls: 'child' },
      { kind: 'class-invalid-parent', cls: 'grandchild' },
    ]);
    expect(parsed.invalidClasses.get('grandchild')).toEqual([{ kind: 'class-invalid-parent', cls: 'grandchild' }]);
    expect([...classes.keys()]).toEqual(['other']);
  });

  it('keeps the steps in order: all schema entries come before the chain entries', () => {
    const { report } = validateConfig(
      config({
        orphan: { extends: 'nothing', match: { key: 'job' } },
        bad: { match: { key: 'job="\\d"' } },
      })
    );
    expect(report.map((e) => e.kind)).toEqual(['schema', 'class-unknown-parent']);
  });

  it('gives a class with a chain error and a bad matcher both entries', () => {
    const { parsed } = validateConfig(config({ orphan: { extends: 'nothing', match: { key: 'job="\\d"' } } }));
    expect(
      parsed.invalidClasses
        .get('orphan')
        ?.map((e) => e.kind)
        .sort()
    ).toEqual(['class-unknown-parent', 'schema']);
  });

  it('makes an invalid override invalid alone and keeps its class valid', () => {
    const { parsed, classes, report } = validateConfig(
      config(
        { host: { match: { key: 'job' }, status: 'up' } },
        {
          'cell-1': { match: { key: 'job="\\d"' } },
          'cell-2': { url: '/d/x?a=${}' },
          'cell-3': { rows: [{ kind: 'metadata', label: 'Note', text: 'spare' }] },
        }
      )
    );
    expect(report).toEqual([
      { kind: 'schema', path: 'overrides.cell-1.match.key', message: expect.any(String) },
      { kind: 'schema', path: 'overrides.cell-2.url', message: expect.any(String) },
    ]);
    expect([...parsed.invalidOverrides.keys()]).toEqual(['cell-1', 'cell-2']);
    expect(Object.keys(parsed.config?.overrides ?? {})).toEqual(['cell-3']);
    expect(classes.has('host')).toBe(true);
    expect(parsed.invalidClasses.size).toBe(0);
  });

  it('gives ${job:csv} in a metadata text a schema entry', () => {
    const { classes, report } = validateConfig(
      config({ host: { match: { key: 'job' }, rows: [{ kind: 'metadata', label: 'Jobs', text: '${job:csv}' }] } })
    );
    expect(report).toEqual([{ kind: 'schema', path: 'classes.host.rows[0].text', message: METADATA_VARIABLE_MESSAGE }]);
    expect(classes.has('host')).toBe(false);
  });

  it('checks the URL and title templates and lets dashboard variables pass there', () => {
    const { report } = validateConfig(
      config({
        ok: {
          match: { key: 'job' },
          url: '/d/x?${job:queryparam}&var-h=${key}&$site',
          urlTitle: 'Open ${job:csv}',
          rows: [{ kind: 'drilldown', label: 'Open ${job:text}', url: '/d/y?${job:csv}' }],
        },
        bad: {
          match: { key: 'job' },
          urlTitle: 'Open ${}',
          rows: [{ kind: 'drilldown', label: 'Open ${a.b:x}', url: '/d/y?x=${key' }],
        },
      })
    );
    expect(report.map((e) => (e.kind === 'schema' ? e.path : e.kind))).toEqual([
      'classes.bad.urlTitle',
      'classes.bad.rows[0].label',
      'classes.bad.rows[0].url',
    ]);
  });

  it('allows an abstract class with no match', () => {
    const { classes, report } = validateConfig(config({ device: { rows: [{ kind: 'value', query: 'a' }] } }));
    expect(report).toEqual([]);
    expect(classes.get('device')?.abstract).toBe(true);
  });

  it('gives one outdated-config entry for a version 3 config and resolves no class', () => {
    const { parsed, classes, report } = validateConfig({
      version: 3,
      queries: [],
      patterns: [],
      overrides: [],
      widgets: [],
    });
    expect(report).toEqual([{ kind: 'outdated-config', version: 3 }]);
    expect(parsed.config).toBeNull();
    expect(classes.size).toBe(0);
  });

  it('gives the envelope schema entries and no class when the envelope fails', () => {
    const { parsed, classes, report } = validateConfig({ version: 4 });
    expect(report).toEqual([{ kind: 'schema', path: 'classes', message: expect.any(String) }]);
    expect(parsed.config).toBeNull();
    expect(classes.size).toBe(0);
  });

  it('does not change the input', () => {
    const raw = config({ bad: { match: { key: 'job="\\d"' } } }, { c: { url: '${}' } });
    const copy = structuredClone(raw);
    validateConfig(raw);
    expect(raw).toEqual(copy);
  });
});
