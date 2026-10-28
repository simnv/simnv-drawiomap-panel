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
import { authoringConfig } from './authoring-config';
import { authoringConfigV4 } from './authoring-config.v4';
import { demoL3Config, handDrawnConfig } from './demo-config';
import { demoConfigV4, handDrawnConfigV4 } from './demo-config.v4';

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
    ['demo-l3', demoL3Config(), demoConfigV4],
    ['hand-drawn', handDrawnConfig(), handDrawnConfigV4],
    ['authoring', authoringConfig('demo-prometheus', 'demo-testdata'), authoringConfigV4],
  ])('keeps a class for every v3 %s pattern and chart region', (_name, v3, v4) => {
    const { classes } = validateConfig(v4);
    for (const pattern of v3.patterns) {
      expect(classes.has(pattern.id)).toBe(true);
      expect(classes.get(pattern.id)?.abstract).toBe(false);
    }
    for (const widget of v3.widgets) {
      expect(classes.get(widget.id)?.chart).toBeDefined();
    }
  });

  it('keeps separate link halves and one traffic row for each demo link class', () => {
    const { classes } = validateConfig(demoConfigV4);
    for (const [name, up, down] of [
      ['links', 'lan_tx', 'lan_rx'],
      ['lan-speed', 'lan_tx', 'lan_tx'],
      ['wan', 'wan_tx', 'wan_rx'],
      ['tunnels', 'lan_tx', 'lan_rx'],
    ]) {
      const cls = classes.get(name)!;
      expect(cls).toMatchObject({ up, down, linkLabel: 'none' });
      expect(cls.rows).toEqual([{ kind: 'updown', label: 'Traffic', up, down, origin: expect.any(String) }]);
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
  ] as const)('keeps both v3 LAN halves and target-end speed for %s', (key, tx, rx, speed, capacity) => {
    // The generator has equal transmit rates at both LAN ends, but a different receive rate.
    const attrs = { key, port: 'br-lan', at: 'target' };
    const data = [
      sample('lan_tx', { job: key, device: 'br-lan' }, tx),
      sample('lan_rx', { job: key, device: 'br-lan' }, rx),
      sample('speed', { job: key, device: 'br-lan' }, speed, { unit: 'Bps' }),
    ];
    const cls = validateConfig(demoConfigV4).classes.get('lan-speed')!;
    const read = (refId: string | undefined) =>
      data.find((s) => s.refId === refId && matches(cls.match, attrs, s.labels));
    // at=target maps up to b2a and down to a2b. Both were the endpoint transmit rate in v3.
    expect(read(cls.up)?.values).toEqual([tx]);
    expect(read(cls.down)?.values).toEqual([tx]);
    const row = cls.rows[0];
    expect(row.kind).toBe('updown');
    if (row.kind === 'updown') {
      expect(read(row.up)?.values).toEqual([tx]);
      expect(read(row.down)?.values).toEqual([tx]);
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
});
