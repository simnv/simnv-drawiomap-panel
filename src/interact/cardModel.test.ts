import { describe, expect, it, vi } from 'vitest';
import { createTheme, DisplayValue, Field, FieldType, LinkModel } from '@grafana/data';
import type { CellPatch, HalfState, SeriesInfo } from '../types';
import { buildCard, buildConfiguredCard, CardContext, sparkDomain, sparkPoints } from './cardModel';
import type { PlanCellPatch } from '../binding/engine';
import type { QueryBinding } from '../model/config';
import { toHistory } from '../query/frames';

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
const tx = mk('A', { job: 'node-isp-a', device: 'pppoe' }, [40e6, 41e6]);
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
  cellId: 'pg-link~isp-a:pppoe->rtr-a:wan1',
  ruleNames: ['links'],
  scope: {
    cell: { 'pg-id': 'isp-a:pppoe->rtr-a:wan1', key: 'isp-a:pppoe->rtr-a:wan1', label: '' },
    from: { node: 'isp-a', port: 'pppoe' },
    to: { node: 'rtr-a', port: 'wan1' },
  },
  urls: [{ title: 'links', url: '/d/rule?job=node-isp-a&from=${__from}' }],
  warnings: [],
  link: { a2b: okHalf(tx, '41 Mb/s · 41%', '#00ff00'), b2a: okHalf(rx, '10 Mb/s · 10%', '#0000ff') },
  card: { reducer: 'last' },
  ...over,
});
const nodePatch = (over: Partial<CellPatch> = {}): CellPatch => ({
  cellId: 'pg-node~rtr-a',
  ruleNames: ['node up', 'router cpu'],
  scope: { cell: { 'pg-id': 'rtr-a', key: 'rtr-a', label: 'rtr-a multi-WAN + PBR' } },
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
    expect(c.title).toBe('isp-a:pppoe->rtr-a:wan1');
    expect(c.rows.map((r) => [r.title, r.text, r.color, r.status])).toEqual([
      ['isp-a → rtr-a', '41 Mb/s · 41%', '#00ff00', 'ok'],
      ['rtr-a → isp-a', '10 Mb/s · 10%', '#0000ff', 'ok'],
    ]);
    expect(c.rows[0].values).toEqual([40e6, 41e6]);
    expect(c.rows[0].times).toEqual([1000, 1010]);
  });
  it('uses the rule url for both rows when link.card.url is not set', () => {
    const c = buildCard(linkPatch(), ctx);
    expect(c.rows.map((r) => r.href)).toEqual(['/d/rule?job=node-isp-a&from=111', '/d/rule?job=node-isp-a&from=111']);
  });
  it('resolves link.card.url per row with the labels of the row series, encoded', () => {
    const c = buildCard(
      linkPatch({ card: { reducer: 'last', url: '/d/if?job=${labels.job}&dev=${labels.device}&x=${cell.pg-id}' } }),
      ctx
    );
    expect(c.rows[0].href).toBe('/d/if?job=node-isp-a&dev=pppoe&x=isp-a%3Apppoe-%3Ertr-a%3Awan1');
    expect(c.rows[1].href).toBe('/d/if?job=node-rtr-a&dev=wan1&x=isp-a%3Apppoe-%3Ertr-a%3Awan1');
  });
  it('drops a row url with a bad scheme', () => {
    const c = buildCard(linkPatch({ card: { reducer: 'last', url: 'javascript:alert(1)' } }), ctx);
    expect(c.rows[0].href).toBeUndefined();
  });
  it('uses link.card.title and the link label text as titles', () => {
    expect(buildCard(linkPatch({ card: { reducer: 'last', title: '${from.node} uplink' } }), ctx).title).toBe(
      'isp-a uplink'
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
    expect(c.rows[0].min).toBeUndefined();
  });
  it('has the footer links: the rule url and the field data links', () => {
    const c = buildCard(linkPatch(), ctx);
    expect(c.links.map((l) => [l.title, l.href])).toEqual([
      ['links', '/d/rule?job=node-isp-a&from=111'],
      ['Field link', '/d/field'],
    ]);
  });
  it('gives a rule url without a title a default title: "Open dashboard" or "Open <card title>"', () => {
    const dash = buildCard(linkPatch({ urls: [{ url: '/d/rule?job=x' }] }), ctx);
    expect(dash.links[0].title).toBe('Open dashboard');
    const other = buildCard(linkPatch({ urls: [{ url: '/explore?x=1' }] }), ctx);
    expect(other.links[0].title).toBe('Open isp-a:pppoe->rtr-a:wan1');
  });
  it('gives each row with a sparkline the min and max of its series', () => {
    const c = buildCard(linkPatch(), ctx);
    expect(c.rows.map((r) => [r.min, r.max])).toEqual([
      ['40000000', '41000000'],
      ['10000000', '10000000'],
    ]);
  });
});

describe('buildCard for a node', () => {
  it('resolves card rows lazily: series, reducer, unit, decimals, title template and url', () => {
    const c = buildCard(nodePatch(), ctx);
    expect(c.title).toBe('rtr-a multi-WAN + PBR');
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({
      title: 'CPU rtr-a',
      text: '35.3%',
      status: 'ok',
      color: '#123456',
      values: [20, 35.25],
      href: '/d/cpu?host=node-rtr-a&from=111',
      min: '20.0%',
      max: '35.3%',
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

describe('configured cards', () => {
  const binding: QueryBinding = { queryId: 'cpu', match: {}, reducer: 'last' };
  const patch = (): PlanCellPatch => ({
    ...nodePatch(),
    hover: {
      rows: [
        { kind: 'metadata', label: 'Device', path: 'cell.key' },
        { kind: 'value', label: 'CPU', binding, url: '/d/cpu?device=${cell.key}' },
        { kind: 'history', label: 'Trend', binding },
        { kind: 'drilldown', label: 'Dashboard', url: '/d/device?device=${cell.key}' },
      ],
    },
  });
  it('resolves no values and describes no demand for a closed card', () => {
    const card = buildConfiguredCard(
      patch(),
      () => {
        throw new Error('Closed card read extra data');
      },
      ctx,
      false
    );
    expect(card).toMatchObject({ rows: [], links: [], demands: [] });
  });
  it('explains unavailable metadata without resolving the suppressed hover rows', () => {
    const p = { ...patch(), unavailableHoverRows: [1, 2] };
    const card = buildConfiguredCard(
      p,
      () => {
        throw new Error('Suppressed hover was resolved');
      },
      ctx
    );
    expect(card.rows.slice(1, 3).map((r) => [r.state, r.text])).toEqual([
      ['unsupported', 'Binding metadata is unavailable'],
      ['unsupported', 'Binding metadata is unavailable'],
    ]);
    expect(card.demands).toEqual([]);
  });
  it('uses configured rows, preserves formatted affixes and null gaps, and limits histories to explicit history rows', () => {
    const model = toHistory(
      {
        state: 'ready',
        fetchedAt: 9000,
        fromCache: true,
        frames: [
          {
            length: 3,
            fields: [
              { name: 'Time', type: FieldType.time, config: {}, values: [1000, 2000, 3000] },
              {
                name: 'CPU',
                type: FieldType.number,
                config: {},
                values: [20, null, 35.25],
                display: (v) => ({ text: String(v), numeric: Number(v), prefix: '~', suffix: ' load' }),
              },
            ],
          },
        ],
      },
      binding
    );
    const card = buildConfiguredCard(patch(), () => model, ctx);
    expect(card.rows.map((r) => [r.kind, r.title, r.text])).toEqual([
      ['metadata', 'Device', 'rtr-a'],
      ['value', 'CPU', '~35.25 load'],
      ['history', 'Trend', '~35.25 load'],
      ['drilldown', 'Dashboard', 'Dashboard'],
    ]);
    expect(card.rows[1].history).toBeUndefined();
    expect(card.rows[2].history).toMatchObject({
      state: 'ready',
      values: [20, null, 35.25],
      timestamps: [1000, 2000, 3000],
    });
    expect(card.rows[1].href).toBe('/d/cpu?device=rtr-a');
    expect(card.demands.map((d) => d.rowIndex)).toEqual([1, 2]);
  });
  it('applies the configured unit and checks templated and dashboard-variable URLs after substitution', () => {
    const p: PlanCellPatch = {
      ...nodePatch(),
      scope: { cell: { key: 'a&b' } },
      hover: {
        rows: [
          { kind: 'value', label: 'CPU', binding, unit: 'percent', url: '/d/cpu?name=${cell.key}&job=${labels.job}' },
          { kind: 'drilldown', label: 'Unsafe variable', url: '${bad:raw}' },
          { kind: 'drilldown', label: 'Unsafe scheme', url: 'javascript:alert(1)' },
        ],
      },
    };
    const model = toHistory(
      {
        state: 'ready',
        fetchedAt: 9000,
        fromCache: false,
        frames: [
          {
            length: 1,
            fields: [
              { name: 'Time', type: FieldType.time, config: {}, values: [1000] },
              { name: 'CPU', type: FieldType.number, config: { decimals: 1 }, labels: { job: 'x/y' }, values: [35.25] },
            ],
          },
        ],
      },
      binding
    );
    const card = buildConfiguredCard(p, () => model, {
      ...ctx,
      replaceVariables: (v) => (v === '${bad:raw}' ? 'javascript:alert(1)' : v),
    });
    expect(card.rows[0].text).toBe('35.3%');
    expect(card.rows[0].href).toBe('/d/cpu?name=a%26b&job=x%2Fy');
    expect(card.rows.slice(1).map((r) => r.href)).toEqual([undefined, undefined]);
  });
  it('reports unavailable and ambiguous hover metrics to the editor without blank rows', () => {
    let i = 0;
    const card = buildConfiguredCard(
      patch(),
      () =>
        i++ === 0
          ? { state: 'empty', fetchedAt: 9000, fromCache: false }
          : { state: 'unsupported', message: 'History field selection is ambiguous. Select one field and series.' },
      ctx
    );
    expect(card.rows.slice(1, 3).map((r) => r.text)).toEqual([
      'No data',
      'History field selection is ambiguous. Select one field and series.',
    ]);
    expect(card.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['unmatched-metric', `cells.${patch().cellId}.hover.rows[1].binding`],
      ['ambiguous-metric', `cells.${patch().cellId}.hover.rows[2].binding`],
    ]);
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
  it('fills the width: the x axis is the part of the range that has data', () => {
    // data only in the last half of the range: the line still goes from edge to edge
    expect(sparkPoints([0, 10, 5], [50, 75, 100], { from: 0, to: 100 }, 200, 36)).toBe('0,35 100,1 200,18');
    expect(sparkPoints([0, 10, 5], [0, 25, 50], { from: 0, to: 100 }, 200, 36)).toBe('0,35 100,1 200,18');
    // samples outside the range stay on the edge
    expect(sparkPoints([0, 10, 5], [-50, 50, 150], { from: 0, to: 100 }, 200, 36)).toBe('0,35 100,1 200,18');
  });
  it('uses the index without times and skips values that are not finite', () => {
    expect(sparkPoints([1, NaN, 3], undefined, undefined, 100, 10)).toBe('0,6.3 100,1');
  });
  it('draws a constant series as a flat line and nothing for one point', () => {
    // the domain starts at 0, so a constant value is on the top and zeros are on the bottom
    expect(sparkPoints([2, 2], [0, 1], { from: 0, to: 1 }, 10, 10)).toBe('0,1 10,1');
    expect(sparkPoints([0, 0], [0, 1], { from: 0, to: 1 }, 10, 10)).toBe('0,9 10,9');
    expect(sparkPoints([2], [0], { from: 0, to: 1 }, 10, 10)).toBe('');
  });
});

describe('sparkDomain', () => {
  it('starts a non-negative series at zero, so a flat series stays flat', () => {
    expect(sparkDomain([41, 41.2, 41])).toEqual([0, 41.2]);
    expect(sparkDomain([3, 9, 5])).toEqual([0, 9]);
  });
  it('uses 0 to 100 for percent and 0 to 1 for percentunit', () => {
    expect(sparkDomain([40, 41], { unit: 'percent' })).toEqual([0, 100]);
    expect(sparkDomain([0.4, 0.41], { unit: 'percentunit' })).toEqual([0, 1]);
    // a value above the scale still fits
    expect(sparkDomain([40, 120], { unit: 'percent' })).toEqual([0, 120]);
  });
  it('reaches up to the capacity of the row', () => {
    expect(sparkDomain([10, 20], { capacity: 100 })).toEqual([0, 100]);
    // a value above the capacity still fits
    expect(sparkDomain([10, 150], { capacity: 100 })).toEqual([0, 150]);
    expect(sparkDomain([10, 20], { capacity: 0 })).toEqual([0, 20]);
  });
  it('uses min to max for a series with negative values', () => {
    expect(sparkDomain([-10, 20, 5])).toEqual([-10, 20]);
  });
  it('keeps a minimum span of 10% of |max|, centred on the data', () => {
    const [lo, hi] = sparkDomain([-100.5, -100]);
    expect(hi - lo).toBeCloseTo(10);
    expect((lo + hi) / 2).toBeCloseTo(-100.25);
    // max is 0: the span is at least 1
    const [lo0, hi0] = sparkDomain([-0.1, 0]);
    expect(hi0 - lo0).toBeCloseTo(1);
    expect((lo0 + hi0) / 2).toBeCloseTo(-0.05);
  });
  it('gives a usable domain for all zeros, one point and no finite value', () => {
    expect(sparkDomain([0, 0, 0])).toEqual([0, 1]);
    expect(sparkDomain([5])).toEqual([0, 5]);
    expect(sparkDomain([NaN])).toEqual([0, 1]);
    expect(sparkDomain([])).toEqual([0, 1]);
  });
});

describe('sparkPoints domain', () => {
  it('draws a nearly flat series as a flat line near the top', () => {
    expect(sparkPoints([41, 41.2, 41], undefined, undefined, 100, 10)).toBe('0,1 50,1 100,1');
  });
  it('uses the given domain', () => {
    expect(sparkPoints([10, 20], undefined, undefined, 100, 10, [0, 100])).toBe('0,8.2 100,7.4');
  });
});

describe('card row domain', () => {
  it('gives a link half the capacity in the unit of the series', () => {
    // 40 Mb/s is 40% of the link, so the capacity is 100 Mb/s
    const s = mk('A', { job: 'x' }, [10, 40], 'Mbits');
    const half: HalfState = { ...okHalf(s, '40 Mb/s · 40%', '#0f0'), value: 40, percent: 40 };
    const c = buildCard(linkPatch({ link: { a2b: half } }), ctx);
    expect(c.rows[0].domain).toEqual([0, 100]);
  });
  it('gives a link half without capacity the range 0 to max', () => {
    expect(buildCard(linkPatch(), ctx).rows.map((r) => r.domain)).toEqual([
      [0, 41e6],
      [0, 10e6],
    ]);
  });
  it('uses 0 to 100 for a row with the percent unit', () => {
    const c = buildCard(nodePatch(), ctx);
    expect(c.rows[0].domain).toEqual([0, 100]);
  });
});
