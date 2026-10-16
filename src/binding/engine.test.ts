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
      fill: true,
      sparkline: { refId: 'D', match: { job: 'node-${cell.pg-id}' }, position: 'bottom' },
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
  it('fills nodes by up and attaches a sparkline', () => {
    const up = patches.get('pg-node~rtr-a')!;
    expect(up.shape?.status).toBe('ok');
    expect(up.shape?.stepIndex).toBe(1);
    expect(up.shape?.fill).toBe(true);
    expect(up.sparkline?.values).toEqual([0.5, 1.5, 1.0]);
    expect(up.sparkline?.position).toBe('bottom');
    const down = patches.get('pg-node~lte')!;
    expect(down.shape?.stepIndex).toBe(0);
    expect(down.sparkline).toBeUndefined();
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
