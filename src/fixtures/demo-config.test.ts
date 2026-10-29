import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTheme, FieldType, MappingType, type FieldConfig } from '@grafana/data';

import { effectiveClass } from '../binding/classes';
import { createRegexCache, parseMatchBlock, resolveBlock } from '../binding/matcher';
import { statusOfUse } from '../binding/statusV4';
import { toBitsPerSecond } from '../binding/units';
import { resolveUrlV4 } from '../interact/links';
import type { ConfigV4, MatchV4 } from '../model/v4';
import { validateConfig } from '../model/validate';
import type { Series } from '../query/snapshot';
import { authoringConfigV4 } from './authoring-config';
import { demoConfigV4, handDrawnConfigV4 } from './demo-config';

const fixtures: Array<[string, ConfigV4]> = [
  ['demo-l3', demoConfigV4],
  ['hand-drawn', handDrawnConfigV4],
  ['authoring', authoringConfigV4],
];

const sample = (
  refId: string,
  labels: Record<string, string>,
  value: number,
  config: FieldConfig = { unit: 'bps' }
): Series => ({
  refId,
  labels,
  frameIndex: 0,
  fieldIndex: 1,
  times: [1000],
  values: [value],
  field: { name: 'Value', type: FieldType.number, config, values: [value] },
});

function matches(match: MatchV4 | undefined, attrs: Record<string, string>, labels: Record<string, string>) {
  expect(match).toBeDefined();
  const parsed = parseMatchBlock(match!, 'match');
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    return false;
  }
  const resolved = resolveBlock(parsed.block, (name) => attrs[name], createRegexCache());
  expect(resolved.ok).toBe(true);
  return resolved.ok && resolved.test(labels);
}

describe('v4 demo configs', () => {
  it.each(fixtures)('validates %s with an empty report', (_name, config) => {
    const { parsed, classes, report } = validateConfig(config);
    expect(report).toEqual([]);
    expect(parsed.config).toEqual(config);
    expect(parsed.invalidClasses.size).toBe(0);
    expect(parsed.invalidOverrides.size).toBe(0);
    expect([...classes.keys()].sort()).toEqual(Object.keys(config.classes).sort());
  });

  it.each([
    ['demo-l3', ['lan-speed', 'links', 'node-up', 'router-cpu', 'tunnels', 'wan'], ['links']],
    ['hand-drawn', ['hand-links'], []],
    ['authoring', ['directional-link', 'routers', 'trend-region'], []],
  ])('has the classes of the %s demo; only a base class is abstract', (_name, names, abstract) => {
    const config = fixtures.find(([name]) => name === _name)![1];
    const { classes } = validateConfig(config);
    expect([...classes.keys()].sort()).toEqual(names);
    expect([...classes.values()].filter((cls) => cls.abstract).map((cls) => cls.name)).toEqual(abstract);
  });

  it('keeps separate link halves and one traffic row for each demo link class', () => {
    const { classes } = validateConfig(demoConfigV4);
    for (const [name, up, down] of [
      ['links', 'lan_tx', 'lan_rx'],
      ['lan-speed', 'lan_tx', 'lan_rx'],
      ['wan', 'wan_tx', 'wan_rx'],
      ['tunnels', 'lan_tx', 'lan_rx'],
    ]) {
      const cls = classes.get(name)!;
      expect(cls).toMatchObject({ up, down, linkLabel: 'none' });
      expect(cls.rows).toEqual([{ kind: 'updown', label: 'Traffic', up, down, origin: expect.any(String) }]);
      if (cls.abstract) {
        // the base class has no match; its subclasses add it
        continue;
      }
      expect(matches(cls.match, { key: 'node-rtr-a', port: 'wan1' }, { job: 'node-rtr-a', device: 'wan1' })).toBe(true);
      expect(matches(cls.match, { key: 'node-rtr-a', port: 'wan1' }, { job: 'node-rtr-b', device: 'wan1' })).toBe(
        false
      );
    }
    expect(classes.get('lan-speed')?.capacity).toBe('speed');
  });

  it.each([
    ['node-rtr-a', 480_000_000, 96_000_000, 125_000_000, 1_000_000_000],
    ['node-rtr-b', 20_000_000, 8_000_000, 12_500_000, 100_000_000],
  ] as const)('reads the LAN halves and the port speed at the router end of %s', (key, tx, rx, speed, capacity) => {
    const attrs = { key, port: 'br-lan', at: 'target' };
    const data = [
      sample('lan_tx', { job: key, device: 'br-lan' }, tx),
      sample('lan_rx', { job: key, device: 'br-lan' }, rx),
      sample('speed', { job: key, device: 'br-lan' }, speed, { unit: 'Bps' }),
    ];
    const cls = validateConfig(demoConfigV4).classes.get('lan-speed')!;
    const read = (refId: string | undefined) =>
      data.find((s) => s.refId === refId && matches(cls.match, attrs, s.labels));
    // at=target: the key names the router end, so a→b is its receive rate (down) and b→a its transmit rate (up)
    expect(read(cls.up)?.values).toEqual([tx]);
    expect(read(cls.down)?.values).toEqual([rx]);
    const row = cls.rows[0];
    expect(row.kind).toBe('updown');
    if (row.kind === 'updown') {
      expect(read(row.up)?.values).toEqual([tx]);
      expect(read(row.down)?.values).toEqual([rx]);
    }
    expect(cls.capacity).toBe('speed');
    const selected = read('speed')!;
    expect(toBitsPerSecond(selected.values[0]!, selected.field.config.unit).bits).toBe(capacity);
  });

  it('makes proxy-b no data while LTE stays down with the generated up series', () => {
    const data = [
      ['net-a', 1],
      ['net-b', 1],
      ['rtr-a', 1],
      ['rtr-b', 1],
      ['isp-a', 1],
      ['radio', 1],
      ['lte', 0],
      ['isp-b', 1],
      ['proxy-a', 1],
      ['proxy-b', 1],
    ].map(([name, value]) =>
      sample('up', { job: `node-${name}` }, Number(value), {
        mappings: [
          {
            type: MappingType.ValueToText,
            options: {
              '0': { text: 'down', color: 'red' },
              '1': { text: 'up', color: 'green' },
            },
          },
        ],
      })
    );
    const cls = validateConfig(demoConfigV4).classes.get('node-up')!;
    const status = (name: string) => {
      const id = `pg-node~${name}`;
      const effective = effectiveClass(cls, demoConfigV4.overrides[id], id);
      const selected = data.filter(
        (s) => s.refId === effective.status && matches(effective.match, { key: `node-${name}` }, s.labels)
      );
      return statusOfUse({ state: 'ready', frames: [], fetchedAt: 1000, fromCache: false }, selected, {
        refId: effective.status!,
        missing: effective.missing ?? 'nodata',
        theme: createTheme(),
      });
    };
    expect(status('proxy-b')).toMatchObject({ state: 'missing', reason: 'No data' });
    expect(status('lte')).toMatchObject({ state: 'down' });
    expect(status('proxy-a')).toMatchObject({ state: 'normal' });
  });

  it('keeps the CPU dashboard destination as a drilldown beside its history', () => {
    const rows = validateConfig(demoConfigV4).classes.get('router-cpu')!.rows;
    const drilldown = rows.find((row) => row.kind === 'drilldown');
    expect(drilldown).toBeDefined();
    if (drilldown?.kind === 'drilldown') {
      expect(
        resolveUrlV4(drilldown.url, { attr: (name) => (name === 'key' ? 'node-rtr-a' : undefined) }, (text) => text)
      ).toBe('/d/drawiomap-demo?var-job=node-rtr-a&var-metric=cpu');
    }
  });

  it('keeps node health, grey no-data policy and the history rows', () => {
    const { classes } = validateConfig(demoConfigV4);
    const node = classes.get('node-up')!;
    expect(node.status).toBe('up');
    expect(node.missing ?? 'nodata').toBe('nodata');
    expect(matches(node.match, { key: 'node-lte' }, { job: 'node-lte' })).toBe(true);
    expect(node.rows).toMatchObject([
      { kind: 'history', query: 'up', label: 'state' },
      { kind: 'history', query: 'load', label: 'load 1m' },
    ]);
    expect(classes.get('router-cpu')?.rows).toEqual(
      expect.arrayContaining([
        { kind: 'history', query: 'cpu', label: 'CPU', unit: 'percent', origin: expect.any(String) },
      ])
    );
  });

  it('keeps hand-drawn traffic and the cell URL', () => {
    const cls = validateConfig(handDrawnConfigV4).classes.get('hand-links')!;
    expect(cls).toMatchObject({ up: 'wan_tx', down: 'wan_rx', url: '/d/drawiomap-demo?cell=${id}' });
    expect(cls.rows).toMatchObject([{ kind: 'updown', up: 'wan_tx', down: 'wan_rx' }]);
  });

  it('keeps the authoring detail history, asymmetric traffic and chart region', () => {
    const { classes } = validateConfig(authoringConfigV4);
    const routers = classes.get('routers')!;
    expect(routers.status).toBe('health');
    expect(matches(routers.match, { key: 'router-1' }, { device: 'router-1' })).toBe(true);
    expect(routers.rows).toMatchObject([
      { kind: 'value', query: 'detail', label: 'Detail value' },
      { kind: 'history', query: 'detail', label: 'Detail history' },
    ]);
    expect(classes.get('directional-link')).toMatchObject({
      up: 'tx',
      down: 'rx',
      rows: [{ kind: 'updown', up: 'tx', down: 'rx', label: 'Traffic', unit: 'bps' }],
    });
    const trend = classes.get('trend-region')!;
    expect(trend.chart).toMatchObject({ kind: 'history', query: 'trend', label: 'Standalone trend' });
    expect(matches(trend.match, { key: 'trend' }, { device: 'trend' })).toBe(true);
  });

  it.each(fixtures)('uses only demo routes and attribute-based identities in %s', (_name, config) => {
    const visit = (value: unknown, key = '') => {
      if (typeof value === 'string' && key === 'url') {
        expect(value).toMatch(/^\/d\/drawiomap-demo\?/);
      } else if (key === 'match') {
        // All identities come from the demo cells, including the deliberate no-data suffix.
        expect(Object.values(value as MatchV4).flat()).toEqual(expect.arrayContaining([expect.any(String)]));
        for (const matcher of Object.values(value as MatchV4).flat()) {
          expect(['job', 'device', 'job="${key}-no-data"']).toContain(matcher);
        }
      } else if (value && typeof value === 'object') {
        for (const [childKey, child] of Object.entries(value)) {
          visit(child, childKey);
        }
      }
    };
    visit(config);
  });

  const cellAttrs = (file: string, attr: string): string[] =>
    [...readFileSync(resolve(__dirname, file), 'utf8').matchAll(new RegExp(`data-meta-${attr}="([^"]*)"`, 'g'))].map(
      (m) => m[1]
    );

  it.each([
    ['demo-l3', '../../fixtures/demo/svg/demo-l3.svg', '../../fixtures/demo/demo-l3.drawio', demoConfigV4],
    [
      'hand-drawn',
      '../../fixtures/demo/svg/hand-drawn.svg',
      '../../fixtures/hand/hand-drawn.drawio',
      handDrawnConfigV4,
    ],
    ['authoring', './authoring.svg', './authoring.drawio', authoringConfigV4],
  ] as const)(
    'binds each concrete class of %s to cells of its diagram, in the SVG and the XML',
    (_n, svg, xml, config) => {
      const { classes } = validateConfig(config);
      const binds = cellAttrs(svg, 'bind');
      expect(new Set(binds)).toEqual(new Set([...classes.values()].filter((c) => !c.abstract).map((c) => c.name)));
      // the export path writes each attribute of the XML cell as a data-meta attribute of the SVG cell
      const xmlBinds = [...readFileSync(resolve(__dirname, xml), 'utf8').matchAll(/ bind="([^"]*)"/g)].map((m) => m[1]);
      expect(xmlBinds.sort()).toEqual([...binds].sort());
    }
  );

  it('gives each demo target refId a target of its demo panel', () => {
    const dashboard = JSON.parse(readFileSync(resolve(__dirname, '../../provisioning/dashboards/demo.json'), 'utf8'));
    const refIds = (id: number) =>
      new Set<string>(
        dashboard.panels.find((p: { id: number }) => p.id === id).targets.map((t: { refId: string }) => t.refId)
      );
    const used = (config: ConfigV4) => {
      const out = new Set<string>();
      const visit = (value: unknown, key = '') => {
        if (typeof value === 'string' && ['status', 'up', 'down', 'query', 'capacity'].includes(key)) {
          out.add(value);
        } else if (value && typeof value === 'object') {
          Object.entries(value).forEach(([k, v]) => visit(v, k));
        }
      };
      visit(config.classes);
      return out;
    };
    expect(refIds(1)).toEqual(used(demoConfigV4));
    expect(refIds(2)).toEqual(used(handDrawnConfigV4));
    expect(refIds(3)).toEqual(used(authoringConfigV4));
  });
});
