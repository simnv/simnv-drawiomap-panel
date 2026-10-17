import { describe, expect, it, vi } from 'vitest';
import { createTheme, DisplayValue, Field, FieldType, LinkModel } from '@grafana/data';
import type { CellPatch, HalfState, SeriesInfo } from '../types';
import { buildCard, CardContext, sparkPoints } from './cardModel';

const theme = createTheme();
const fieldLink: LinkModel<Field> = { href: '/d/field', title: 'Field link', target: '_blank', origin: {} as Field };
const mk = (refId: string, labels: Record<string, string>, values: number[], unit?: string): SeriesInfo => ({
  refId,
  name: `${labels.job ?? ''}`,
  labels,
  values,
  times: values.map((_, i) => 1000 + i * 10),
  field: {
    name: 'Value',
    type: FieldType.number,
    config: unit ? { unit } : {},
    values,
    getLinks: vi.fn(() => [fieldLink]),
  } as unknown as Field,
  frame: { fields: [], length: values.length },
});
const tx = mk('A', { job: 'node-wan1', device: 'pppoe' }, [40e6, 41e6]);
const rx = mk('A', { job: 'node-rtr-a', device: 'wan1' }, [10e6]);
const cpu = mk('E', { job: 'node-rtr-a' }, [20, 35.25]);
const up = mk('C', { job: 'node-rtr-a' }, [1, 1]);

const ctx: CardContext = {
  series: [tx, rx, cpu, up],
  theme,
  display: (s, v, o): DisplayValue => ({
    text: o?.decimals !== undefined ? v.toFixed(o.decimals) : String(v),
    suffix: o?.unit === 'percent' ? '%' : s.field.config?.unit === 'bps' ? ' b/s' : '',
    numeric: v,
    color: '#123456',
  }),
  replaceVariables: (s) => s.replace('${__from}', '111'),
};

const okHalf = (series: SeriesInfo, label: string, color: string): HalfState => ({
  status: 'ok',
  color,
  width: 3,
  label,
  stepIndex: 0,
  value: series.values[series.values.length - 1],
  display: { text: label, numeric: 0 },
  series,
});
const linkPatch = (over: Partial<CellPatch> = {}): CellPatch => ({
  cellId: 'pg-link~wan1:pppoe->rtr-a:wan1',
  ruleNames: ['links'],
  scope: {
    cell: { 'pg-id': 'wan1:pppoe->rtr-a:wan1', key: 'wan1:pppoe->rtr-a:wan1', label: '' },
    from: { node: 'wan1', port: 'pppoe' },
    to: { node: 'rtr-a', port: 'wan1' },
  },
  urls: [{ title: 'links', url: '/d/rule?job=node-wan1&from=${__from}' }],
  warnings: [],
  link: { a2b: okHalf(tx, '41 Mb/s · 41%', '#00ff00'), b2a: okHalf(rx, '10 Mb/s · 10%', '#0000ff') },
  card: { reducer: 'last' },
  ...over,
});
const nodePatch = (over: Partial<CellPatch> = {}): CellPatch => ({
  cellId: 'pg-node~rtr-a',
  ruleNames: ['node up', 'router cpu'],
  scope: { cell: { 'pg-id': 'rtr-a', key: 'rtr-a', label: 'rtr-a mwan3 + PBR' } },
  urls: [{ title: 'node up', url: '/d/node?job=node-rtr-a' }],
  warnings: [],
  shape: {
    status: 'ok',
    color: '#00ff00',
    target: 'icon',
    stepIndex: 1,
    value: 1,
    series: up,
    display: { text: '1', numeric: 1 },
  },
  card: {
    reducer: 'last',
    rows: [
      {
        title: 'CPU ${cell.pg-id}',
        refId: 'E',
        match: { job: 'node-${cell.pg-id}' },
        unit: 'percent',
        decimals: 1,
        url: '/d/cpu?host=${labels.job}&from=${__from}',
      },
    ],
  },
  ...over,
});

describe('buildCard for a link', () => {
  it('has the a2b and b2a rows with the half text, colour and series', () => {
    const c = buildCard(linkPatch(), ctx);
    expect(c.title).toBe('wan1:pppoe->rtr-a:wan1');
    expect(c.rows.map((r) => [r.title, r.text, r.color, r.status])).toEqual([
      ['wan1 → rtr-a', '41 Mb/s · 41%', '#00ff00', 'ok'],
      ['rtr-a → wan1', '10 Mb/s · 10%', '#0000ff', 'ok'],
    ]);
    expect(c.rows[0].values).toEqual([40e6, 41e6]);
    expect(c.rows[0].times).toEqual([1000, 1010]);
  });
  it('uses the rule url for both rows when link.card.url is not set', () => {
    const c = buildCard(linkPatch(), ctx);
    expect(c.rows.map((r) => r.href)).toEqual([
      '/d/rule?job=node-wan1&from=111',
      '/d/rule?job=node-wan1&from=111',
    ]);
  });
  it('resolves link.card.url per row with the labels of the row series, encoded', () => {
    const c = buildCard(
      linkPatch({ card: { reducer: 'last', url: '/d/if?job=${labels.job}&dev=${labels.device}&x=${cell.pg-id}' } }),
      ctx
    );
    expect(c.rows[0].href).toBe('/d/if?job=node-wan1&dev=pppoe&x=wan1%3Apppoe-%3Ertr-a%3Awan1');
    expect(c.rows[1].href).toBe('/d/if?job=node-rtr-a&dev=wan1&x=wan1%3Apppoe-%3Ertr-a%3Awan1');
  });
  it('drops a row url with a bad scheme', () => {
    const c = buildCard(linkPatch({ card: { reducer: 'last', url: 'javascript:alert(1)' } }), ctx);
    expect(c.rows[0].href).toBeUndefined();
  });
  it('uses link.card.title and the link label text as titles', () => {
    expect(buildCard(linkPatch({ card: { reducer: 'last', title: '${from.node} uplink' } }), ctx).title).toBe(
      'wan1 uplink'
    );
    const labelled = linkPatch();
    labelled.scope.cell.label = 'pppoe 100M';
    expect(buildCard(labelled, ctx).title).toBe('pppoe 100M');
  });
  it('shows no data rows in grey without a sparkline', () => {
    const p = linkPatch({
      link: { a2b: { status: 'nodata', color: '#999', width: 2, label: 'no data', stepIndex: -1 } },
    });
    const c = buildCard(p, ctx);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ text: 'no data', status: 'nodata', values: [] });
  });
  it('has the footer links: the rule url and the field data links', () => {
    const c = buildCard(linkPatch(), ctx);
    expect(c.links.map((l) => [l.title, l.href])).toEqual([
      ['links', '/d/rule?job=node-wan1&from=111'],
      ['Field link', '/d/field'],
    ]);
  });
});

describe('buildCard for a node', () => {
  it('resolves card rows lazily: series, reducer, unit, decimals, title template and url', () => {
    const c = buildCard(nodePatch(), ctx);
    expect(c.title).toBe('rtr-a mwan3 + PBR');
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({
      title: 'CPU rtr-a',
      text: '35.3%',
      status: 'ok',
      color: '#123456',
      values: [20, 35.25],
      href: '/d/cpu?host=node-rtr-a&from=111',
    });
  });
  it('uses the rule url when the row has no url, and the mean reducer when the rule says so', () => {
    const p = nodePatch();
    p.card = { reducer: 'mean', rows: [{ refId: 'E', match: { job: 'node-rtr-a' } }] };
    const c = buildCard(p, ctx);
    expect(c.rows[0].text).toBe('27.625');
    expect(c.rows[0].title).toBe('node-rtr-a');
    expect(c.rows[0].href).toBe('/d/node?job=node-rtr-a');
  });
  it('shows no data and unbound rows', () => {
    const p = nodePatch();
    p.card = {
      reducer: 'last',
      rows: [
        { title: 'gone', refId: 'Z' },
        { title: 'bad', match: { job: '${cell.nope}' } },
      ],
    };
    const c = buildCard(p, ctx);
    expect(c.rows.map((r) => [r.title, r.text, r.status, r.href])).toEqual([
      ['gone', 'no data', 'nodata', '/d/node?job=node-rtr-a'],
      ['bad', 'unbound', 'unbound', '/d/node?job=node-rtr-a'],
    ]);
  });
  it('without card rows, shows one row for the shape series', () => {
    const c = buildCard(nodePatch({ card: { reducer: 'last' } }), ctx);
    expect(c.rows.map((r) => [r.title, r.text, r.color])).toEqual([['node-rtr-a', '1', '#00ff00']]);
  });
  it('falls back to the key, then the cell id, for the title', () => {
    const p = nodePatch();
    p.scope.cell.label = '';
    expect(buildCard(p, ctx).title).toBe('rtr-a');
  });
});

describe('buildCard url checks', () => {
  it('drops a row url and a footer url that a dashboard variable turns into another scheme', () => {
    const c = buildCard(nodePatch({ urls: [{ title: 'r', url: '${v:raw}' }] }), {
      ...ctx,
      replaceVariables: (s) => (s === '${v:raw}' ? 'javascript:alert(1)' : s),
    });
    expect(c.rows[0].href).toBe('/d/cpu?host=node-rtr-a&from=${__from}');
    const p = nodePatch({ urls: [{ title: 'r', url: '${v:raw}' }] });
    p.card = { reducer: 'last', rows: [{ refId: 'E' }] };
    const c2 = buildCard(p, { ...ctx, replaceVariables: () => 'javascript:alert(1)' });
    expect(c2.rows[0].href).toBeUndefined();
    expect(c2.links.map((l) => l.title)).toEqual(['Field link']);
  });
});

describe('sparkPoints', () => {
  it('handles a long series without a stack overflow and keeps the last point', () => {
    const values = Array.from({ length: 300_000 }, (_, i) => i);
    const pts = sparkPoints(values, undefined, undefined, 200, 36).split(' ');
    expect(pts.length).toBeLessThanOrEqual(402);
    expect(pts[pts.length - 1]).toBe('200,1');
  });
  it('maps times over the dashboard range and values over min..max', () => {
    expect(sparkPoints([0, 10, 5], [0, 50, 100], { from: 0, to: 100 }, 200, 36)).toBe('0,35 100,1 200,18');
  });
  it('uses the index without times and skips values that are not finite', () => {
    expect(sparkPoints([1, NaN, 3], undefined, undefined, 100, 10)).toBe('0,9 100,1');
  });
  it('draws a flat line for a constant series and nothing for one point', () => {
    expect(sparkPoints([2, 2], [0, 1], { from: 0, to: 1 }, 10, 10)).toBe('0,5 10,5');
    expect(sparkPoints([2], [0], { from: 0, to: 1 }, 10, 10)).toBe('');
  });
});
