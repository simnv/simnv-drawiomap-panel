import { describe, expect, it } from 'vitest';
import { createTheme, DisplayValue, Field, FieldType, getDisplayProcessor, ThresholdsMode } from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { BindContext, Rule, SeriesInfo } from '../types';
import { bind } from './engine';

const theme = createTheme();
const mk = (refId: string, labels: Record<string, string>, values: number[]): SeriesInfo => ({
  refId,
  name: JSON.stringify(labels),
  labels,
  values,
  times: values.map((_, i) => i),
  field: {} as Field,
  frame: { fields: [], length: values.length },
});
const series = [
  mk('A', { job: 'node-wan1', device: 'pppoe' }, [40e6, 41e6]),
  mk('A', { job: 'node-rtr-a', device: 'wan1' }, [10e6]),
  mk('A', { job: 'node-wan2', device: 'dhcp' }, [90e6]),
  mk('C', { job: 'node-rtr-a' }, [1]),
  mk('C', { job: 'node-lte' }, [0]),
  mk('D', { job: 'node-rtr-a' }, [0.5, 1.5, 1.0]),
];
const cells = [
  cellMetaFromAttrs(
    'pg-link~wan1:pppoe->rtr-a:wan1',
    {
      'pg-kind': 'link',
      'pg-id': 'wan1:pppoe->rtr-a:wan1',
      'pg-from': 'wan1:pppoe',
      'pg-to': 'rtr-a:wan1',
    },
    true
  ),
  cellMetaFromAttrs(
    'pg-link~wan2:dhcp->rtr-a:wan2',
    {
      'pg-kind': 'link',
      'pg-id': 'wan2:dhcp->rtr-a:wan2',
      'pg-from': 'wan2:dhcp',
      'pg-to': 'rtr-a:wan2',
    },
    true
  ),
  cellMetaFromAttrs(
    'pg-link~lte:static->rtr-a:lte',
    { 'pg-kind': 'link', 'pg-id': 'lte:static->rtr-a:lte', 'pg-from': 'lte:static', 'pg-to': 'rtr-a:lte' },
    true
  ),
  cellMetaFromAttrs('pg-node~rtr-a', { 'pg-kind': 'node', 'pg-id': 'rtr-a' }, false, 'rtr-a'),
  cellMetaFromAttrs('pg-node~lte', { 'pg-kind': 'node', 'pg-id': 'lte' }, false, 'lte'),
  cellMetaFromAttrs('pg-port~rtr-a~lte~1', { 'pg-kind': 'port', 'pg-id': 'rtr-a:lte' }, false, 'lte'),
];
const rules: Rule[] = [
  {
    name: 'links',
    select: { kind: 'link' },
    link: {
      a2b: { refId: 'A', match: { job: 'node-${from.node}', device: '${from.port}' } },
      b2a: { refId: 'A', match: { job: 'node-${to.node}', device: '${to.port}' } },
      capacity: 1e9,
    },
    url: '/d/iface?var-job=node-${from.node}&var-device=${from.port}',
  },
  {
    name: 'wan 100M',
    select: { kind: 'link', attrs: { 'pg-to': '/^rtr-a:(wan1|wan2|lte)$/' } },
    link: { capacity: '100000000' },
    thresholds: {
      mode: 'percent',
      steps: [
        [0, 'green'],
        [60, 'yellow'],
        [85, 'red'],
      ],
    },
  },
  {
    name: 'node up',
    select: { kind: 'node' },
    shape: {
      series: { refId: 'C', match: { job: 'node-${cell.pg-id}' } },
      target: 'shape',
      card: [{ title: 'load', refId: 'D', match: { job: 'node-${cell.pg-id}' }, decimals: 1 }],
    },
    thresholds: {
      mode: 'absolute',
      steps: [
        [0, 'red'],
        [1, 'green'],
      ],
    },
  },
];
const ctx: BindContext = {
  theme,
  fieldThresholds: {
    mode: ThresholdsMode.Absolute,
    steps: [
      { value: -Infinity, color: 'green' },
      { value: 60, color: 'yellow' },
      { value: 85, color: 'red' },
    ],
  },
  replaceVariables: (s) => s,
  display: (_s, v): DisplayValue => ({ text: `${v / 1e6}`, suffix: ' Mb/s', numeric: v, color: '#abcdef' }),
  linkWidth: { min: 2, max: 10 },
};

describe('bind', () => {
  const { patches, warnings } = bind(rules, cells, series, ctx);

  it('colours both halves of a link and merges capacity from a later rule', () => {
    const p = patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!;
    expect(p.ruleNames).toEqual(['links', 'wan 100M']);
    expect(p.link?.a2b?.status).toBe('ok');
    expect(p.link?.a2b?.value).toBe(41e6);
    expect(p.link?.a2b?.percent).toBeCloseTo(41);
    expect(p.link?.a2b?.stepIndex).toBe(0);
    expect(p.link?.a2b?.label).toBe('41 Mb/s · 41%');
    expect(p.link?.b2a?.percent).toBeCloseTo(10);
    expect(p.link?.a2b?.width).toBeCloseTo(2 + 8 * 0.41);
  });
  it('red at 90 percent', () => {
    expect(patches.get('pg-link~wan2:dhcp->rtr-a:wan2')!.link?.a2b?.stepIndex).toBe(2);
  });
  it('grey no data when the series is missing', () => {
    const h = patches.get('pg-link~lte:static->rtr-a:lte')!.link!.a2b!;
    expect(h.status).toBe('nodata');
    expect(h.stepIndex).toBe(-1);
    expect(h.color).toBe(theme.colors.text.disabled);
    expect(h.label).toBe('no data');
  });
  it('colours nodes by up and keeps the card rows for the hover card', () => {
    const up = patches.get('pg-node~rtr-a')!;
    expect(up.shape?.status).toBe('ok');
    expect(up.shape?.stepIndex).toBe(1);
    expect(up.shape?.target).toBe('shape');
    expect(up.card).toEqual({
      reducer: 'last',
      rows: [{ title: 'load', refId: 'D', match: { job: 'node-${cell.pg-id}' }, decimals: 1 }],
    });
    const down = patches.get('pg-node~lte')!;
    expect(down.shape?.stepIndex).toBe(0);
  });
  it('gives every link patch a card spec with the link.card url and title', () => {
    const r = bind(
      [{ ...rules[0], link: { ...rules[0].link, card: { url: '/d/if?d=${from.port}', title: '${from.node}' } } }],
      cells,
      series,
      ctx
    );
    expect(r.patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!.card).toEqual({
      reducer: 'last',
      url: '/d/if?d=${from.port}',
      title: '${from.node}',
    });
    expect(patches.get('pg-link~lte:static->rtr-a:lte')!.card).toEqual({ reducer: 'last' });
  });
  it('resolves rule urls', () => {
    expect(patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!.urls).toEqual([
      { title: 'links', url: '/d/iface?var-job=node-wan1&var-device=pppoe' },
    ]);
  });
  it('skips unmatched cells', () => {
    expect(patches.has('pg-port~rtr-a~lte~1')).toBe(false);
    expect(warnings).toEqual([]);
  });
  it('marks unbound when a template cannot resolve', () => {
    const r = bind(
      [{ name: 'x', select: { kind: 'node' }, shape: { series: { refId: 'C', match: { job: '${cell.nope}' } } } }],
      cells,
      series,
      ctx
    );
    expect(r.patches.get('pg-node~rtr-a')!.shape?.status).toBe('unbound');
    expect(r.warnings[0]).toMatch(/x.*pg-node~rtr-a.*cell\.nope/);
  });
  it('marks both halves unbound when the capacity template cannot resolve', () => {
    const r = bind(
      [
        {
          name: 'cap',
          select: { kind: 'link' },
          link: { a2b: rules[0].link!.a2b, b2a: rules[0].link!.b2a, capacity: '${cell.capacity}' },
        },
      ],
      cells,
      series,
      ctx
    );
    const p = r.patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!;
    expect(p.link?.a2b?.status).toBe('unbound');
    expect(p.link?.b2a?.status).toBe('unbound');
    expect(p.link?.a2b?.color).toBe(theme.colors.text.disabled);
    expect(p.link?.a2b?.label).toBe('unbound');
    expect(r.warnings[0]).toMatch(/cap.*cell\.capacity/);
  });
  it('uses the field display colour for shapes without rule thresholds', () => {
    const r = bind(
      [
        {
          name: 'disp',
          select: { kind: 'node' },
          shape: { series: { refId: 'C', match: { job: 'node-${cell.pg-id}' } } },
        },
      ],
      cells,
      series,
      ctx
    );
    const sh = r.patches.get('pg-node~rtr-a')!.shape!;
    expect(sh.color).toBe('#abcdef');
    expect(sh.stepIndex).toBe(0); // 1 against the ctx field thresholds (-Inf, 60, 85)
  });
  it('formats labels with a real display processor (unit, decimals, suffix)', () => {
    const field: Field = { name: 'v', type: FieldType.number, config: { unit: 'bps', decimals: 1 }, values: [] };
    const proc = getDisplayProcessor({ field, theme });
    const r = bind(rules, cells, series, { ...ctx, display: (_s, v) => proc(v) });
    expect(r.patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!.link!.a2b!.label).toBe('41.0 Mb/s · 41%');
    expect(r.patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!.link!.b2a!.label).toBe('10.0 Mb/s · 10%');
  });
  it('a link with one series keeps the other half undefined', () => {
    const r = bind(
      [
        {
          name: 'one',
          select: { ids: ['pg-link~wan1:pppoe->rtr-a:wan1'] },
          link: { a2b: { refId: 'A', match: { device: 'pppoe' } } },
        },
      ],
      cells,
      series,
      ctx
    );
    const p = r.patches.get('pg-link~wan1:pppoe->rtr-a:wan1')!;
    expect(p.link?.a2b?.status).toBe('ok');
    expect(p.link?.b2a).toBeUndefined();
    expect(p.link?.a2b?.percent).toBeUndefined();
    expect(p.link?.a2b?.label).toBe('41 Mb/s');
  });
});

describe('bind review fixes', () => {
  const withUnit = (unit: string | undefined, value: number): SeriesInfo => ({
    ...mk('U', { job: 'node-wan1', device: 'pppoe' }, [value]),
    field: { name: 'v', type: FieldType.number, config: unit ? { unit } : {}, values: [value] } as Field,
  });
  const linkCell = cells[0];
  const capRule = (extra: Partial<Rule> = {}): Rule => ({
    name: 'cap',
    select: { kind: 'link' },
    link: { a2b: { refId: 'U', match: { device: 'pppoe' } }, capacity: 1e8 },
    ...extra,
  });
  const pctFor = (unit: string | undefined, value: number) =>
    bind([capRule()], [linkCell], [withUnit(unit, value)], ctx).patches.get(linkCell.id)!.link!.a2b!.percent;

  it('finding 1: an invalid regex in a selector does not crash bind and gives a warning', () => {
    const r = bind([{ name: 'bad', select: { label: '/[/' }, shape: { fill: true } }], cells, series, ctx);
    expect(r.patches.size).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/bad.*invalid regex \/\[\//);
  });
  it('finding 3: byte-rate units convert to bit/s before the capacity percent', () => {
    expect(pctFor('Bps', 5e6)).toBeCloseTo(40);
    expect(pctFor('KBs', 5e3)).toBeCloseTo(40);
    expect(pctFor('MBs', 5)).toBeCloseTo(40);
    expect(pctFor('GBs', 0.005)).toBeCloseTo(40);
    expect(pctFor('binBps', 5e6)).toBeCloseTo(40);
    expect(pctFor('KiBs', 1000)).toBeCloseTo((1000 * 1024 * 8 * 100) / 1e8);
    expect(pctFor('MiBs', 1)).toBeCloseTo((1024 ** 2 * 8 * 100) / 1e8);
    expect(pctFor('GiBs', 0.01)).toBeCloseTo((0.01 * 1024 ** 3 * 8 * 100) / 1e8);
  });
  it('finding 3: bit-rate units scale to bit/s', () => {
    expect(pctFor('bps', 4e7)).toBeCloseTo(40);
    expect(pctFor('binbps', 4e7)).toBeCloseTo(40);
    expect(pctFor('Kbits', 4e4)).toBeCloseTo(40);
    expect(pctFor('Mbits', 40)).toBeCloseTo(40);
    expect(pctFor('Gbits', 0.04)).toBeCloseTo(40);
    expect(pctFor('Mibits', 1)).toBeCloseTo((1024 ** 2 * 100) / 1e8);
    expect(pctFor(undefined, 4e7)).toBeCloseTo(40);
  });
  it('finding 3: an unknown unit uses the raw value and gives a warning', () => {
    const r = bind([capRule()], [linkCell], [withUnit('percent', 4e7)], ctx);
    expect(r.patches.get(linkCell.id)!.link!.a2b!.percent).toBeCloseTo(40);
    expect(r.warnings.join(' ')).toMatch(/cap.*unit "percent"/);
  });
  it('finding 5: a text-only shape shows "no data" in grey when the series is missing', () => {
    const r = bind(
      [{ name: 't', select: { kind: 'node' }, shape: { series: { refId: 'Z' }, text: true } }],
      cells,
      series,
      ctx
    );
    const sh = r.patches.get('pg-node~rtr-a')!.shape!;
    expect(sh.status).toBe('nodata');
    expect(sh.text).toBe('no data');
    expect(sh.color).toBe(theme.colors.text.disabled);
    expect(sh.target).toBe('none');
  });
  it('finding 5: a text-only shape shows "unbound" in grey when the series template is unbound', () => {
    const r = bind(
      [{ name: 't', select: { kind: 'node' }, shape: { series: { match: { job: '${cell.nope}' } }, text: true } }],
      cells,
      series,
      ctx
    );
    const sh = r.patches.get('pg-node~rtr-a')!.shape!;
    expect(sh.status).toBe('unbound');
    expect(sh.text).toBe('unbound');
    expect(sh.color).toBe(theme.colors.text.disabled);
  });
  it('links ignore the label template (no canvas labels) and give one warning per rule', () => {
    const r = bind([capRule({ label: '${value} ${labels.nope}' })], [linkCell, cells[1]], [withUnit('bps', 4e7)], ctx);
    const h = r.patches.get(linkCell.id)!.link!.a2b!;
    expect(h.status).toBe('ok');
    expect(h.label).toBe('40 Mb/s · 40%');
    expect(r.warnings).toEqual(['cap: label is ignored for links, the hover card shows the values']);
  });
  it('finding 6: an unresolved shape text placeholder makes the shape unbound', () => {
    const r = bind(
      [
        {
          name: 'st',
          select: { kind: 'node' },
          shape: { series: { refId: 'C', match: { job: 'node-${cell.pg-id}' } }, text: true, fill: true },
          label: '${labels.nope}',
        },
      ],
      cells,
      series,
      ctx
    );
    const sh = r.patches.get('pg-node~rtr-a')!.shape!;
    expect(sh.status).toBe('unbound');
    expect(sh.text).toBe('unbound');
    expect(sh.color).toBe(theme.colors.text.disabled);
    expect(sh.stepIndex).toBe(-1);
  });

  it('shape.sparkline is ignored with a warning', () => {
    const r = bind(
      [{ name: 'sp', select: { kind: 'node' }, shape: { target: 'shape', sparkline: { refId: 'D' } } }],
      cells,
      series,
      ctx
    );
    expect(r.warnings).toEqual(['sp: shape.sparkline is removed, use shape.card']);
  });

  const hostCell = cellMetaFromAttrs(
    'h1',
    { host: 'a&b=c d/e', evil: 'javascript:alert(1)', 'pg-kind': 'node', 'pg-id': 'h1' },
    false,
    'Host'
  );
  const urlOf = (url: string) => bind([{ name: 'u', select: { ids: ['h1'] }, url }], [hostCell], [], ctx);
  it('finding 7: url template values are percent-encoded', () => {
    expect(urlOf('/d/x?var-host=${cell.host}').patches.get('h1')!.urls[0].url).toBe('/d/x?var-host=a%26b%3Dc%20d%2Fe');
    expect(urlOf('https://g/d/${cell.host}?x=${__url_time_range}').patches.get('h1')!.urls[0].url).toBe(
      'https://g/d/a%26b%3Dc%20d%2Fe?x=${__url_time_range}'
    );
    expect(urlOf('${cell.evil}').patches.get('h1')!.urls[0].url).toBe('javascript%3Aalert(1)');
  });
  it('finding 7: urls with a scheme other than http or https are dropped with a warning', () => {
    for (const bad of [
      'javascript:alert(${cell.pg-id})',
      ' JavaScript:alert(1)',
      'java\tscript:x',
      'data:text/html,x',
    ]) {
      const r = urlOf(bad);
      expect(r.patches.get('h1')?.urls ?? []).toEqual([]);
      expect(r.warnings.join(' ')).toMatch(/u.*h1.*scheme/);
    }
    for (const ok of ['http://a/b', 'HTTPS://a/b', '/d/x', 'd/x', '?a=1', '//host/x']) {
      expect(urlOf(ok).patches.get('h1')!.urls[0].url).toBe(ok);
    }
  });
  it('finding 8: a rule with only a url keeps its patch', () => {
    const p = urlOf('/d/x').patches.get('h1');
    expect(p).toBeDefined();
    expect(p!.urls).toEqual([{ title: 'u', url: '/d/x' }]);
  });
});

describe('shape target', () => {
  const upRule = (shape: Rule['shape']): Rule[] => [
    {
      name: 't',
      select: { ids: ['pg-node~rtr-a'] },
      shape: { series: { refId: 'C', match: { job: 'node-rtr-a' } }, ...shape },
    },
  ];
  const targetOf = (shape: Rule['shape']) =>
    bind(upRule(shape), cells, series, ctx).patches.get('pg-node~rtr-a')!.shape!.target;
  it('defaults to icon', () => {
    expect(targetOf({})).toBe('icon');
  });
  it('maps the old fill and stroke flags', () => {
    expect(targetOf({ fill: true })).toBe('shape');
    expect(targetOf({ stroke: true })).toBe('stroke');
    expect(targetOf({ fill: true, stroke: true })).toBe('shape');
    expect(targetOf({ text: true })).toBe('none');
    expect(targetOf({ fill: false })).toBe('none');
  });
  it('an explicit target wins over the old flags', () => {
    expect(targetOf({ target: 'stroke', fill: true })).toBe('stroke');
    expect(targetOf({ target: 'icon', text: true })).toBe('icon');
  });
  it('a card-only shape rule makes a patch without a colour state', () => {
    const r = bind(
      [
        {
          name: 'c',
          select: { kind: 'node' },
          shape: { card: [{ refId: 'D', match: { job: 'node-${cell.pg-id}' } }] },
        },
      ],
      cells,
      series,
      ctx
    );
    const p = r.patches.get('pg-node~rtr-a')!;
    expect(p.shape).toBeUndefined();
    expect(p.card?.rows).toHaveLength(1);
  });
  it('validates the matchers of card rows', () => {
    const r = bind(
      [{ name: 'c', select: { kind: 'node' }, shape: { card: [{ match: { job: '/[/' } }] } }],
      cells,
      series,
      ctx
    );
    expect(r.warnings.join(' ')).toMatch(/c: invalid regex/);
  });
});
