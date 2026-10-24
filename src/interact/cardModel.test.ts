import { describe, expect, it, vi } from 'vitest';
import { createTheme, DisplayValue, Field, FieldType, LinkModel, ThresholdsMode } from '@grafana/data';
import type { CellPatch, HalfState, SeriesInfo } from '../types';
import {
  buildCard,
  buildConfiguredCard,
  CardContext,
  chartHeight,
  opensCard,
  SPARK_HEIGHT,
  sparkPoints,
} from './cardModel';
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
  it('uses the readable cell title, and a title template of the pattern over it', () => {
    const titled = linkPatch();
    titled.scope.cell.title = 'Switch-A p9 ↔ AP-1';
    expect(buildCard(titled, ctx).title).toBe('Switch-A p9 ↔ AP-1');
    expect(buildCard({ ...titled, card: { reducer: 'last', title: '${cell.title} (uplink)' } }, ctx).title).toBe(
      'Switch-A p9 ↔ AP-1 (uplink)'
    );
    // an unresolved template falls back to the readable title
    expect(buildCard({ ...titled, card: { reducer: 'last', title: '${cell.nope}' } }, ctx).title).toBe(
      'Switch-A p9 ↔ AP-1'
    );
  });
  it('shows a readable form of a cell id when the cell has no label and no title', () => {
    const bare = linkPatch();
    bare.scope.cell.key = 'pg-group~core';
    expect(buildCard(bare, ctx).title).toBe('core');
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
        {
          kind: 'value',
          label: 'CPU',
          binding,
          url: '/d/cpu?device=${cell.key}',
          freshness: { expectedIntervalMs: 1000, staleAfterMs: 5000 },
        },
        { kind: 'history', label: 'Trend', binding, height: 64 },
        { kind: 'drilldown', label: 'Dashboard', url: '/d/device?device=${cell.key}' },
      ],
    },
  });
  it('titles the card with the cell title, or with hover.title when the pattern sets it', () => {
    const titled = patch();
    titled.scope.cell.title = 'Switch-A p9';
    const read = () => {
      throw new Error('unused');
    };
    expect(buildConfiguredCard(titled, read, ctx, false).title).toBe('Switch-A p9');
    expect(buildConfiguredCard({ ...titled, hover: { title: 'Port ${cell.title}', rows: [] } }, read, ctx).title).toBe(
      'Port Switch-A p9'
    );
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
    ]);
    expect(card.links.filter((l) => l.title === 'Dashboard').map((l) => l.href)).toEqual(['/d/device?device=rtr-a']);
    expect(card.rows[1].history).toBeUndefined();
    expect(card.rows[1].height).toBeUndefined();
    expect(chartHeight(card.rows[2])).toBe(64);
    expect(card.rows[1]).toMatchObject({ sampleAt: 3000, freshness: { expectedIntervalMs: 1000, staleAfterMs: 5000 } });
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
    expect(card.rows).toHaveLength(1);
    expect(card.links.filter((l) => l.title.startsWith('Unsafe'))).toEqual([]);
    expect(card.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['invalid-url', `cells.${p.cellId}.hover.rows[1].url`],
      ['invalid-url', `cells.${p.cellId}.hover.rows[2].url`],
    ]);
  });
  it('shows a drilldown once, as a footer link, and not again when the cell url has the same target', () => {
    const p: PlanCellPatch = {
      ...nodePatch(),
      urls: [{ url: '/d/vpn' }],
      hover: {
        rows: [
          { kind: 'metadata', label: 'Role', path: 'cell.key' },
          { kind: 'drilldown', label: 'Open dashboard', url: '/d/vpn' },
        ],
      },
    };
    const card = buildConfiguredCard(p, () => ({ state: 'idle' }), ctx);
    expect(card.rows.map((r) => [r.title, r.text])).toEqual([['Role', 'rtr-a']]);
    expect(card.links.filter((l) => l.href === '/d/vpn').map((l) => [l.title, l.target])).toEqual([
      ['Open dashboard', '_blank'],
    ]);
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

describe('combined up/down row', () => {
  const txB: QueryBinding = { queryId: 'tx', match: {}, reducer: 'last' };
  const rxB: QueryBinding = { queryId: 'rx', match: {}, reducer: 'last' };
  const history = (name: string, values: number[], config: Field['config'] = { unit: 'bps' }) =>
    toHistory(
      {
        state: 'ready',
        fetchedAt: 9000,
        fromCache: false,
        frames: [
          {
            length: values.length,
            fields: [
              { name: 'Time', type: FieldType.time, config: {}, values: values.map((_, i) => 1000 + i * 1000) },
              { name, type: FieldType.number, config, values },
            ],
          },
        ],
      },
      { queryId: name, match: {}, reducer: 'last' },
      { theme }
    );
  const both = [
    { binding: txB, direction: 'up' as const, label: '↑' },
    { binding: rxB, direction: 'down' as const, label: '↓' },
  ];
  const card = (row: Record<string, unknown>, models: Record<string, ReturnType<typeof history>>) =>
    buildConfiguredCard(
      { ...nodePatch(), hover: { rows: [{ kind: 'history', label: 'Traffic', series: both, ...row } as any] } },
      (_, b) => models[b.queryId] ?? { state: 'loading' },
      ctx
    );
  const models = () => ({ tx: history('tx', [5e6, 8.2e6]), rx: history('rx', [2e6, 1.1e6]) });

  it('shows both current values and draws down mirrored below zero in a symmetric domain', () => {
    const c = card({}, models());
    expect(c.rows).toHaveLength(1);
    const row = c.rows[0];
    expect(row).toMatchObject({ kind: 'history', title: 'Traffic', state: 'ready' });
    // the largest value of both directions with 10% headroom
    expect(row.domain![0]).toBeCloseTo(-9.02e6);
    expect(row.domain![1]).toBeCloseTo(9.02e6);
    expect(row.text).toBe('↑ 8.20 Mb/s  ↓ 1.10 Mb/s');
    expect(row.directions!.map((d) => [d.direction, d.label, d.mirrored, d.text])).toEqual([
      ['up', '↑', false, '8.20 Mb/s'],
      ['down', '↓', true, '1.10 Mb/s'],
    ]);
    expect(row.history).toBeUndefined();
    expect(c.demands.map((d) => [d.binding.queryId, d.rowIndex, d.seriesIndex])).toEqual([
      ['tx', 0, 0],
      ['rx', 0, 1],
    ]);
  });
  it('is twice as tall as a single sparkline by default, so each half is as tall as one', () => {
    const row = card({}, models()).rows[0];
    expect(row.height).toBeUndefined();
    expect(chartHeight(row)).toBe(2 * SPARK_HEIGHT);
  });
  it('takes the row option "height" over the default', () => {
    const row = card({ height: 120 }, models()).rows[0];
    expect(row.height).toBe(120);
    expect(chartHeight(row)).toBe(120);
  });
  it.each([0, 1])('a combined row with only direction %s is as tall as a single sparkline', (index) => {
    const row = card({ series: [both[index]] }, models()).rows[0];
    expect(chartHeight(row)).toBe(SPARK_HEIGHT);
  });
  it('appends the capacity percent and keeps the capacity out of the domain', () => {
    const row = card({ capacity: 100e6 }, models()).rows[0];
    expect(row.text).toBe('↑ 8.20 Mb/s · 8%  ↓ 1.10 Mb/s · 1%');
    expect(row.domain![1]).toBeCloseTo(9.02e6);
  });
  it('fills about 90% of the half height with 12 Mb/s on a 1 Gb/s link', () => {
    const m = { tx: history('tx', [11e6, 12e6]), rx: history('rx', [3e6, 4e6]) };
    const [lo, hi] = card({ capacity: 1e9 }, m).rows[0].domain!;
    expect(lo).toBe(-hi);
    expect(12e6 / hi).toBeGreaterThan(0.89);
    expect(12e6 / hi).toBeLessThan(0.92);
  });
  it('max "capacity" puts the capacity back into the domain', () => {
    expect(card({ capacity: 100e6, max: 'capacity' }, models()).rows[0].domain).toEqual([-100e6, 100e6]);
  });
  it('all zeros: the half range is 1% of the capacity', () => {
    const m = { tx: history('tx', [0, 0]), rx: history('rx', [0]) };
    expect(card({ capacity: 1e9 }, m).rows[0].domain).toEqual([-1e7, 1e7]);
    expect(card({}, m).rows[0].domain).toEqual([-1, 1]);
  });
  it('uses the field config Max as the capacity when the row has none', () => {
    const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 10e6 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
    const row = card({ max: 'capacity' }, m).rows[0];
    expect(row.text).toBe('↑ 8.20 Mb/s · 82%  ↓ 1.10 Mb/s');
    expect(row.domain).toEqual([-10e6, 10e6]);
  });
  it('uses the row capacity, not the field config Max, when the row has one', () => {
    const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 1e9 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
    const row = card({ capacity: 100e6, max: 'capacity' }, m).rows[0];
    expect(row.text).toBe('↑ 8.20 Mb/s · 8%  ↓ 1.10 Mb/s · 1%');
    expect(row.domain).toEqual([-100e6, 100e6]);
  });
  describe('template capacity (FR-1)', () => {
    const tpl = (attrs: Record<string, string>, row: Record<string, unknown>, m: ReturnType<typeof models>) =>
      buildConfiguredCard(
        {
          ...nodePatch({ scope: { cell: { key: 'rtr-a', ...attrs } } }),
          hover: { rows: [{ kind: 'history', label: 'Traffic', series: both, ...row } as any] },
        },
        (_, b) => m[b.queryId as 'tx' | 'rx'],
        ctx
      );
    it('resolves a template against the cell scope, in bit/s', () => {
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}' }, models());
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 8%  ↓ 1.10 Mb/s · 1%');
      expect(c.diagnostics).toEqual([]);
    });
    it('converts the bit/s of a template to the unit of the values', () => {
      // 100 Mb/s are 12.5 MB/s; 1.25 MB/s is 10%
      const m = { tx: history('tx', [1.25e6], { unit: 'Bps' }), rx: history('rx', [0.125e6], { unit: 'Bps' }) };
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}', max: 'capacity' }, m);
      expect(c.rows[0].directions!.map((d) => d.text.split(' · ')[1])).toEqual(['10%', '1%']);
      expect(c.rows[0].domain).toEqual([-12.5e6, 12.5e6]);
    });
    it('prefers the resolved template to the field config Max', () => {
      const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 10e6 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}', max: 'capacity' }, m);
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 8%  ↓ 1.10 Mb/s · 1%');
      expect(c.rows[0].domain).toEqual([-100e6, 100e6]);
    });
    it('shows no percent and adds a diagnostic when the template does not resolve', () => {
      // the field Max does not rescue a capacity that the author set
      const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 10e6 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
      const c = tpl({}, { capacity: '${cell.capacity_bps}' }, m);
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s  ↓ 1.10 Mb/s');
      expect(c.diagnostics).toEqual([
        expect.objectContaining({
          code: 'unresolved-metadata',
          path: `cells.${nodePatch().cellId}.hover.rows[0].capacity`,
        }),
      ]);
    });
    it.each(['abc', '0', '-5', 'Infinity', ''])('treats the resolved text "%s" as invalid', (text) => {
      const c = tpl({ capacity_bps: text }, { capacity: '${cell.capacity_bps}' }, models());
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s  ↓ 1.10 Mb/s');
      expect(c.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ['unresolved-metadata', `cells.${nodePatch().cellId}.hover.rows[0].capacity`],
      ]);
    });
    it('converts the template for max "capacity" when one direction has no data', () => {
      const m = { tx: history('tx', [1.25e6], { unit: 'Bps' }), rx: { state: 'loading' as const } };
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}', max: 'capacity' }, m as any);
      expect(c.rows[0].domain).toEqual([-12.5e6, 12.5e6]);
    });
    it('reads max "capacity" as "auto" when the template is unusable', () => {
      const c = tpl({}, { capacity: '${cell.capacity_bps}', max: 'capacity' }, models());
      expect(c.rows[0].domain![1]).toBeCloseTo(9.02e6);
    });
  });
  describe('capacity of each direction (FR-2)', () => {
    const thresholds = {
      mode: ThresholdsMode.Absolute,
      steps: [
        { value: -Infinity, color: 'green' },
        { value: 50, color: 'red' },
      ],
    };
    const perDirection = (caps: [unknown, unknown], row: Record<string, unknown> = {}, scope = {}) =>
      buildConfiguredCard(
        {
          ...nodePatch({ scope: { cell: { key: 'rtr-a', cap_a2b: '100000000', cap_b2a: '10000000', ...scope } } }),
          hover: {
            rows: [
              {
                kind: 'history',
                label: 'Traffic',
                series: both.map((s, j) => ({ ...s, ...(caps[j] === undefined ? {} : { capacity: caps[j] }) })),
                ...row,
              } as any,
            ],
          },
        },
        (_, b) =>
          ({
            tx: history('tx', [8e6], { unit: 'bps', thresholds }),
            rx: history('rx', [8e6], { unit: 'bps', thresholds }),
          })[b.queryId as 'tx' | 'rx'],
        { ...ctx, fieldThresholds: thresholds }
      );
    it('gives each direction the percent and the colour of its own capacity', () => {
      // the same 8 Mb/s: 8% of 100 Mb/s is green, 80% of 10 Mb/s is red
      const c = perDirection(['${cell.cap_a2b}', '${cell.cap_b2a}']);
      expect(c.rows[0].text).toBe('↑ 8 Mb/s · 8%  ↓ 8 Mb/s · 80%');
      expect(c.rows[0].directions!.map((d) => d.color)).toEqual([
        theme.visualization.getColorByName('green'),
        theme.visualization.getColorByName('red'),
      ]);
      expect(c.diagnostics).toEqual([]);
    });
    it('takes a number in the unit of the values', () => {
      expect(perDirection([100e6, 10e6]).rows[0].text).toBe('↑ 8 Mb/s · 8%  ↓ 8 Mb/s · 80%');
    });
    it('prefers the capacity of the direction to the capacity of the row', () => {
      expect(perDirection([undefined, '${cell.cap_b2a}'], { capacity: 100e6 }).rows[0].text).toBe(
        '↑ 8 Mb/s · 8%  ↓ 8 Mb/s · 80%'
      );
    });
    it('uses the larger capacity for max "capacity"', () => {
      expect(perDirection(['${cell.cap_a2b}', '${cell.cap_b2a}'], { max: 'capacity' }).rows[0].domain).toEqual([
        -100e6, 100e6,
      ]);
      expect(perDirection([5e6, 20e6], { max: 'capacity' }).rows[0].domain).toEqual([-20e6, 20e6]);
    });
    it('shows no percent for a direction whose template does not resolve, and reports its path', () => {
      const c = perDirection(['${cell.cap_a2b}', '${cell.nothing}']);
      expect(c.rows[0].text).toBe('↑ 8 Mb/s · 8%  ↓ 8 Mb/s');
      expect(c.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ['unresolved-metadata', `cells.${nodePatch().cellId}.hover.rows[0].series[1].capacity`],
      ]);
    });
    it('does not use the row capacity or the field Max for a direction whose capacity fails', () => {
      const c = perDirection([undefined, '${cell.nothing}'], { capacity: 100e6 });
      expect(c.rows[0].text).toBe('↑ 8 Mb/s · 8%  ↓ 8 Mb/s');
    });
    it('uses the capacity of the one direction for max "capacity" when the other fails', () => {
      expect(perDirection(['${cell.cap_a2b}', '${cell.nothing}'], { max: 'capacity' }).rows[0].domain).toEqual([
        -100e6, 100e6,
      ]);
    });
  });
  it('uses the row max for the half range of the symmetric domain', () => {
    expect(card({ max: 50e6 }, models()).rows[0].domain).toEqual([-50e6, 50e6]);
  });
  it('keeps a single direction positive, with the zero baseline', () => {
    const row = card({ series: [{ binding: rxB, direction: 'down' }] }, models()).rows[0];
    expect(row.text).toBe('↓ 1.10 Mb/s');
    expect(row.directions!.map((d) => d.mirrored)).toEqual([false]);
    expect(row.domain![0]).toBe(0);
    expect(row.domain![1]).toBeCloseTo(2.2e6);
  });
  it('uses the default labels ↑ and ↓', () => {
    const row = card({ series: both.map(({ label: _l, ...s }) => s) }, models()).rows[0];
    expect(row.text).toBe('↑ 8.20 Mb/s  ↓ 1.10 Mb/s');
  });
  it('colours each direction from the thresholds of its own value', () => {
    const thresholds = {
      mode: ThresholdsMode.Absolute,
      steps: [
        { value: -Infinity, color: 'green' },
        { value: 5e6, color: 'red' },
      ],
    };
    const m = {
      tx: history('tx', [8.2e6], { unit: 'bps', thresholds }),
      rx: history('rx', [1.1e6], { unit: 'bps', thresholds }),
    };
    const [upDir, downDir] = card({}, m).rows[0].directions!;
    expect(upDir.color).toBe(theme.visualization.getColorByName('red'));
    expect(downDir.color).toBe(theme.visualization.getColorByName('green'));
  });
  it('uses the panel thresholds as percent steps when the field has none and the row has a capacity', () => {
    const fieldThresholds = {
      mode: ThresholdsMode.Absolute,
      steps: [
        { value: -Infinity, color: 'green' },
        { value: 5, color: 'red' },
      ],
    };
    const c = buildConfiguredCard(
      {
        ...nodePatch(),
        hover: { rows: [{ kind: 'history', label: 'Traffic', series: both, capacity: 100e6 }] },
      },
      (_, b) => models()[b.queryId as 'tx' | 'rx'],
      { ...ctx, fieldThresholds }
    );
    expect(c.rows[0].directions!.map((d) => d.color)).toEqual([
      theme.visualization.getColorByName('red'),
      theme.visualization.getColorByName('green'),
    ]);
  });
  it('keeps the row when one direction has no data and reports it', () => {
    const m = { tx: history('tx', [8.2e6]), rx: { state: 'empty' as const, fetchedAt: 1, fromCache: false } };
    const c = card({}, m as any);
    expect(c.rows[0]).toMatchObject({ state: 'ready', text: '↑ 8.20 Mb/s  ↓ No data' });
    expect(c.rows[0].directions![1].color).toBe(theme.colors.text.disabled);
    expect(c.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['unmatched-metric', `cells.${nodePatch().cellId}.hover.rows[0].series[1].binding`],
    ]);
  });
  it('shows the loading state until a direction has data, and opens the row url', () => {
    const c = card({ url: '/d/traffic?device=${cell.key}' }, {});
    expect(c.rows[0]).toMatchObject({ state: 'loading', text: '↑ Loading data  ↓ Loading data' });
    expect(c.rows[0].href).toBe('/d/traffic?device=rtr-a');
  });
  it('marks a combined row unavailable when a series binding has no metadata', () => {
    const c = buildConfiguredCard(
      {
        ...nodePatch(),
        hover: { rows: [{ kind: 'history', label: 'Traffic', series: both }] },
        unavailableHoverRows: [0],
      },
      () => {
        throw new Error('unavailable row was resolved');
      },
      ctx
    );
    expect(c.rows[0]).toMatchObject({ state: 'unsupported', text: 'Binding metadata is unavailable' });
    expect(c.demands).toEqual([]);
  });
});

describe('opensCard', () => {
  const bare = (over: Partial<PlanCellPatch> = {}): PlanCellPatch => ({
    cellId: 'pg-node~x',
    ruleNames: [],
    scope: { cell: { key: 'x' } },
    urls: [],
    warnings: [],
    ...over,
  });
  // a series without data links
  const state = { ...nodePatch().shape!, series: { ...up, field: { ...up.field, getLinks: undefined } } };
  it('is true for a configured cell with hover rows, a status or a cell url', () => {
    expect(
      opensCard(bare({ hover: { rows: [{ kind: 'metadata', label: 'Device', path: 'cell.key' }] } }), true, ctx)
    ).toBe(true);
    expect(
      opensCard(
        bare({
          statusView: {
            state: 'down',
            reason: 'Device down',
            conditionKey: 'health',
            queryIds: [],
            coverage: { available: 1, expected: 1 },
          },
        }),
        true,
        ctx
      )
    ).toBe(true);
    expect(opensCard(bare({ urls: [{ url: '/d/x' }] }), true, ctx)).toBe(true);
  });
  it('is false for a configured cell that only colours, has no rows or turns the card off', () => {
    expect(opensCard(bare({ shape: state }), true, ctx)).toBe(false);
    expect(opensCard(bare({ hover: { rows: [] } }), true, ctx)).toBe(false);
    expect(
      opensCard(
        bare({
          urls: [{ url: '/d/x' }],
          hover: { enabled: false, rows: [{ kind: 'metadata', label: 'D', path: 'cell.key' }] },
        }),
        true,
        ctx
      )
    ).toBe(false);
  });
  it('ignores a drilldown row whose url is not allowed', () => {
    expect(
      opensCard(bare({ hover: { rows: [{ kind: 'drilldown', label: 'Go', url: 'javascript:alert(1)' }] } }), true, ctx)
    ).toBe(false);
    expect(
      opensCard(bare({ hover: { rows: [{ kind: 'drilldown', label: 'Go', url: '/d/${cell.key}' }] } }), true, ctx)
    ).toBe(true);
  });
  it('resolves a drilldown url with the labels of the series that the cell shows', () => {
    const labelled = { ...up, labels: { host: 'router' }, field: { ...up.field, getLinks: undefined } };
    const row = { kind: 'drilldown' as const, label: 'Go', url: '/d/x?host=${labels.host}' };
    expect(opensCard(bare({ hover: { rows: [row] }, shape: { ...state, series: labelled } }), true, ctx)).toBe(true);
  });
  it('is true for a cell whose series has data links', () => {
    expect(opensCard(bare({ shape: { ...state, series: up } }), true, ctx)).toBe(true);
  });
  it('legacy rules: a shape, a link half or card rows open a card, a bare patch does not', () => {
    expect(opensCard(nodePatch(), false, ctx)).toBe(true);
    expect(opensCard(linkPatch({ urls: [] }), false, ctx)).toBe(true);
    expect(opensCard(bare({ shape: state }), false, ctx)).toBe(true);
    expect(opensCard(bare(), false, ctx)).toBe(false);
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
  it('keeps the capacity of a link half in the range when the current value is 0', () => {
    const s = mk('A', { job: 'x' }, [10, 0], 'Mbits');
    const half: HalfState = { ...okHalf(s, '0 b/s · 0%', '#0f0'), value: 0, percent: 0, capacity: 100e6 };
    expect(buildCard(linkPatch({ link: { a2b: half } }), ctx).rows[0].domain).toEqual([0, 100]);
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
