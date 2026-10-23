import { describe, expect, it } from 'vitest';
import {
  applyFieldOverrides,
  createTheme,
  DataFrame,
  DisplayValue,
  Field,
  FieldColorModeId,
  FieldConfigOptionsRegistry,
  FieldMatcherID,
  FieldType,
  getDisplayProcessor,
  getFieldColorMode,
  ThresholdsMode,
} from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { BindContext, LinkRule, Rule, SeriesInfo } from '../types';
import { bind, bindPlan, collectBindingDemands, resolveBinding, widgetDiagnostics } from './engine';
import { resolvePatterns } from './patterns';
import type { DiagramConfigV2, QueryBinding } from '../model/config';
import { toHistory } from '../query/frames';

const queryBinding: QueryBinding = { queryId: 'health', match: {}, reducer: 'last' };
const v2Config = (display: DiagramConfigV2['patterns'][number]['display']): DiagramConfigV2 => ({
  version: 2,
  queries: [{ id: 'health', name: 'Health', source: { kind: 'panel', refId: 'A' } }],
  patterns: [{ id: 'p', name: 'Devices', select: {}, display }],
  overrides: [],
  widgets: [],
});
const historyValue = (value: number, sampleAt = 1000) =>
  toHistory(
    {
      state: 'ready',
      fetchedAt: 100000,
      fromCache: true,
      frames: [
        {
          length: 1,
          fields: [
            { name: 'Time', type: FieldType.time, config: {}, values: [sampleAt] },
            {
              name: 'Value',
              type: FieldType.number,
              config: { unit: 'percent' },
              values: [value],
              display: (v) => ({ numeric: Number(v), text: String(v), suffix: '%', color: '#ff0000' }),
            },
          ],
        },
      ],
    },
    queryBinding
  );
import { extractSeries } from './series';

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
/** The up series has its own thresholds in the field config (an override in Grafana). */
const upThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'red' },
    { value: 1, color: 'green' },
  ],
};
const up = (labels: Record<string, string>, values: number[]): SeriesInfo => ({
  ...mk('C', labels, values),
  field: { name: 'up', type: FieldType.number, config: { thresholds: upThresholds }, values } as Field,
});
const series = [
  mk('A', { job: 'node-isp-a', device: 'pppoe' }, [40e6, 41e6]),
  mk('A', { job: 'node-rtr-a', device: 'wan1' }, [10e6]),
  mk('A', { job: 'node-radio', device: 'dhcp' }, [90e6]),
  up({ job: 'node-rtr-a' }, [1]),
  up({ job: 'node-lte' }, [0]),
  mk('D', { job: 'node-rtr-a' }, [0.5, 1.5, 1.0]),
];
const cells = [
  cellMetaFromAttrs(
    'pg-link~isp-a:pppoe->rtr-a:wan1',
    {
      'pg-kind': 'link',
      'pg-id': 'isp-a:pppoe->rtr-a:wan1',
      'pg-from': 'isp-a:pppoe',
      'pg-to': 'rtr-a:wan1',
    },
    true
  ),
  cellMetaFromAttrs(
    'pg-link~radio:dhcp->rtr-a:wan2',
    {
      'pg-kind': 'link',
      'pg-id': 'radio:dhcp->rtr-a:wan2',
      'pg-from': 'radio:dhcp',
      'pg-to': 'rtr-a:wan2',
    },
    true
  ),
  cellMetaFromAttrs(
    'pg-link~lte:static->rtr-a:wan3',
    { 'pg-kind': 'link', 'pg-id': 'lte:static->rtr-a:wan3', 'pg-from': 'lte:static', 'pg-to': 'rtr-a:wan3' },
    true
  ),
  cellMetaFromAttrs('pg-node~rtr-a', { 'pg-kind': 'node', 'pg-id': 'rtr-a' }, false, 'rtr-a'),
  cellMetaFromAttrs('pg-node~lte', { 'pg-kind': 'node', 'pg-id': 'lte' }, false, 'lte'),
  cellMetaFromAttrs('pg-port~rtr-a~wan3~1', { 'pg-kind': 'port', 'pg-id': 'rtr-a:wan3' }, false, 'wan3'),
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
    select: { kind: 'link', attrs: { 'pg-to': '/^rtr-a:(wan1|wan2|wan3)$/' } },
    link: { capacity: '100000000' },
  },
  {
    name: 'node up',
    select: { kind: 'node' },
    shape: {
      series: { refId: 'C', match: { job: 'node-${cell.pg-id}' } },
      target: 'shape',
      card: [{ title: 'load', refId: 'D', match: { job: 'node-${cell.pg-id}' }, decimals: 1 }],
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

describe('bindPlan', () => {
  it('keeps normal devices neutral even with a red numeric field and preserves the formatted value', () => {
    const plan = resolvePatterns(
      [cells[3]],
      v2Config({
        shape: { binding: queryBinding, text: true, target: 'shape' },
        label: '${cell.key} ${value}',
        status: {
          kind: 'mapping',
          binding: queryBinding,
          default: { state: 'normal', reason: 'Healthy' },
          mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
        },
      })
    );
    expect(plan.diagnostics).toEqual([]);
    const result = bindPlan(plan, () => historyValue(99), ctx, 100000);
    expect(result.patches.get(cells[3].id)).toMatchObject({
      shape: { target: 'none', text: 'rtr-a 99%', value: 99 },
      statusView: { state: 'normal', reason: 'Healthy' },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.summaries).toEqual([]);
  });
  it('keeps traffic magnitude colors independent of explicit device health and diagnoses incomplete link coverage', () => {
    const config = v2Config({
      link: { a2bBinding: queryBinding, b2aBinding: { ...queryBinding, queryId: 'rx' }, capacity: 100 },
      status: {
        kind: 'mapping',
        binding: { ...queryBinding, queryId: 'up' },
        default: { state: 'normal', reason: 'Healthy' },
        mappings: [{ value: 0, state: 'down', reason: 'Device down' }],
      },
    });
    config.queries.push(...['rx', 'up'].map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
    const plan = resolvePatterns([cells[0]], config);
    expect(plan.diagnostics).toEqual([]);
    const result = bindPlan(
      plan,
      (_, b) =>
        b.queryId === 'rx'
          ? { state: 'empty', fetchedAt: 100000, fromCache: false }
          : historyValue(b.queryId === 'up' ? 1 : 0),
      ctx,
      100000
    );
    const patch = result.patches.get(cells[0].id)!;
    expect(patch.link?.a2b).toMatchObject({ status: 'ok', value: 0, percent: 0 });
    expect(patch.link?.a2b?.color).not.toBe(theme.colors.text.secondary);
    expect(patch.link?.b2a?.status).toBe('nodata');
    expect(patch.statusView).toMatchObject({
      state: 'missing',
      reason: 'Incomplete coverage (1/2 directions available)',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unmatched-metric', path: `cells.${cells[0].id}.link.b2aBinding` })
    );
  });
  it('demands only visible bindings until the configured card opens, including hover-only scalar values', () => {
    const extra = { ...queryBinding, queryId: 'extra' };
    const config = v2Config({
      shape: { binding: queryBinding },
      hover: {
        rows: [
          { kind: 'value', label: 'Extra', binding: extra },
          { kind: 'history', label: 'Trend', binding: extra },
          { kind: 'metadata', label: 'Device', path: 'cell.key' },
          { kind: 'drilldown', label: 'Open', url: '/d/device' },
        ],
      },
    });
    config.queries.push({
      id: 'extra',
      name: 'Extra',
      source: { kind: 'datasource', datasource: { uid: 'prom' }, target: { refId: 'X' }, parameters: {} },
    });
    const plan = resolvePatterns([cells[3], cells[4]], config);
    expect(plan.diagnostics).toEqual([]);
    expect(collectBindingDemands(plan).map((d) => [d.cellId, d.binding.queryId, d.role])).toEqual([
      [cells[3].id, 'health', 'visible'],
      [cells[4].id, 'health', 'visible'],
    ]);
    expect(
      collectBindingDemands(plan, cells[3].id)
        .filter((d) => d.role === 'hover')
        .map((d) => [d.cellId, d.binding.queryId, d.rowIndex])
    ).toEqual([
      [cells[3].id, 'extra', 0],
      [cells[3].id, 'extra', 1],
    ]);
    const result = bindPlan(
      plan,
      (_, b) => {
        if (b.queryId === 'extra') {
          throw new Error('Closed hover must not resolve values');
        }
        return historyValue(1);
      },
      ctx,
      1000
    );
    expect(result.patches.get(cells[3].id)?.hover?.rows).toHaveLength(4);
    expect(result.patches.get(cells[3].id)?.shape?.target).toBe('none');
  });
  it('demands each binding of a combined up/down row with its series index', () => {
    const tx = { ...queryBinding, queryId: 'tx' };
    const rx = { ...queryBinding, queryId: 'rx' };
    const config = v2Config({
      hover: {
        rows: [
          {
            kind: 'history',
            label: 'Traffic',
            series: [
              { binding: tx, direction: 'up' },
              { binding: rx, direction: 'down' },
            ],
          },
        ],
      },
    });
    for (const id of ['tx', 'rx']) {
      config.queries.push({
        id,
        name: id,
        source: { kind: 'datasource', datasource: { uid: 'prom' }, target: { refId: id }, parameters: {} },
      });
    }
    const plan = resolvePatterns([cells[3]], config);
    expect(plan.diagnostics).toEqual([]);
    expect(
      collectBindingDemands(plan, cells[3].id)
        .filter((d) => d.role === 'hover')
        .map((d) => [d.binding.queryId, d.rowIndex, d.seriesIndex])
    ).toEqual([
      ['tx', 0, 0],
      ['rx', 0, 1],
    ]);
    const result = bindPlan(plan, () => historyValue(1), ctx, 1000);
    expect(result.patches.get(cells[3].id)?.unavailableHoverRows).toEqual([]);
  });
  it('resolves metadata matchers and reports ambiguous or unmatched metrics for editor previews', () => {
    const binding = { ...queryBinding, match: { instance: '${cell.key}' } };
    const config = v2Config({ shape: { binding, text: true } });
    const plan = resolvePatterns([cells[3]], config);
    const snapshot = {
      state: 'ready' as const,
      fetchedAt: 9000,
      fromCache: false,
      frames: [
        {
          length: 1,
          fields: [
            { name: 'Time', type: FieldType.time, config: {}, values: [1000] },
            { name: 'Value', type: FieldType.number, config: {}, labels: { instance: 'rtr-a' }, values: [10] },
            { name: 'Other', type: FieldType.number, config: {}, labels: { instance: 'rtr-a' }, values: [20] },
          ],
        },
      ],
    };
    const result = bindPlan(plan, (_, b) => resolveBinding(snapshot, b, plan.cells[cells[3].id].scope), ctx, 9000);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ambiguous-metric', path: `cells.${cells[3].id}.shape.binding` })
    );
    expect(resolveBinding(snapshot, { ...binding, field: 'Value' }, plan.cells[cells[3].id].scope)).toMatchObject({
      state: 'ready',
      latestValue: 10,
    });
    expect(resolveBinding(snapshot, binding, { cell: {} })).toMatchObject({
      state: 'unsupported',
      message: expect.stringContaining('cell.key'),
    });
    expect(result.patches.get(cells[3].id)?.statusView?.state).toBe('missing');
    expect(result.patches.get(cells[3].id)?.shape).toMatchObject({ status: 'nodata', text: 'no data', target: 'none' });
  });
  it('uses configured capacity bindings and explicit down health without changing the traffic colors', () => {
    const capacity = { ...queryBinding, queryId: 'capacity' };
    const config = v2Config({
      link: { a2bBinding: queryBinding, capacityBinding: capacity },
      status: {
        kind: 'mapping',
        binding: { ...queryBinding, queryId: 'up' },
        default: { state: 'normal', reason: 'Healthy' },
        mappings: [{ value: 0, state: 'down', reason: 'Device down' }],
      },
    });
    config.queries.push(
      ...['capacity', 'up'].map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } }))
    );
    const plan = resolvePatterns([cells[0]], config);
    const result = bindPlan(
      plan,
      (_, b) => historyValue(b.queryId === 'health' ? 40 : b.queryId === 'capacity' ? 100 : 0),
      ctx,
      1000
    );
    expect(result.patches.get(cells[0].id)?.link?.a2b).toMatchObject({
      value: 40,
      capacity: 100,
      capacitySource: 'series',
      percent: 40,
    });
    expect(result.patches.get(cells[0].id)?.statusView).toMatchObject({ state: 'down', reason: 'Device down' });
  });
  it('compares sample age to configured cadence regardless of chart resolution and fresh cache retrieval', () => {
    const plan = resolvePatterns(
      [cells[3]],
      v2Config({
        status: {
          kind: 'mapping',
          binding: queryBinding,
          default: { state: 'normal', reason: 'Healthy' },
          mappings: [{ value: 0, state: 'down', reason: 'Down' }],
          freshness: { expectedIntervalMs: 15000, staleAfterMs: 45000 },
        },
      })
    );
    for (const intervalMs of [1, 3600000]) {
      const context = { ...ctx, intervalMs };
      expect(
        bindPlan(plan, () => historyValue(1, 1000), context, 100000).patches.get(cells[3].id)?.statusView?.state
      ).toBe('stale');
      expect(
        bindPlan(plan, () => historyValue(1, 60000), context, 100000).patches.get(cells[3].id)?.statusView?.state
      ).toBe('normal');
    }
  });
  it('preserves validated rule URLs, field links and unresolved label diagnostics', () => {
    const plan = resolvePatterns(
      [cells[3]],
      v2Config({
        shape: { binding: queryBinding, text: true },
        label: '${labels.missing}',
        url: '/d/device?host=${labels.host}',
        urlTitle: 'Open ${cell.key}',
      })
    );
    const model = historyValue(42);
    if (model.state !== 'ready') {
      throw new Error('Expected fixture to be ready');
    }
    model.field.labels = { host: 'a&b' };
    const result = bindPlan(plan, () => model, ctx, 1000);
    expect(result.patches.get(cells[3].id)?.urls).toEqual([{ title: 'Open rtr-a', url: '/d/device?host=a%26b' }]);
    expect(result.patches.get(cells[3].id)?.shape).toMatchObject({
      status: 'unbound',
      text: 'unbound',
      series: { labels: { host: 'a&b' } },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unresolved-metadata', path: `cells.${cells[3].id}.label` })
    );
    plan.cells[cells[3].id].display.url = 'javascript:alert(1)';
    expect(bindPlan(plan, () => model, ctx, 1000).patches.get(cells[3].id)?.urls).toEqual([]);
  });
  it('does not demand or resolve disabled sections or bindings whose metadata parameters are missing', () => {
    const config = v2Config({
      shape: { enabled: false, binding: queryBinding },
      hover: { rows: [{ kind: 'value', label: 'Unavailable', binding: queryBinding }] },
    });
    config.queries[0].source = {
      kind: 'datasource',
      datasource: { uid: 'prom' },
      target: { refId: 'A' },
      parameters: { dm_device: 'cell.device' },
    };
    const plan = resolvePatterns([cells[3]], config);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-parameter-path' }));
    expect(collectBindingDemands(plan, cells[3].id)).toEqual([]);
    const result = bindPlan(
      plan,
      () => {
        throw new Error('Suppressed binding was resolved');
      },
      ctx,
      1000
    );
    expect(result.patches.get(cells[3].id)?.unavailableHoverRows).toEqual([0]);
    expect(result.patches.get(cells[3].id)?.shape).toBeUndefined();
  });
});

describe('bind', () => {
  const { patches, warnings } = bind(rules, cells, series, ctx);

  it('colours both halves of a link and merges capacity from a later rule', () => {
    const p = patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(p.ruleNames).toEqual(['links', 'wan 100M']);
    expect(p.link?.a2b?.status).toBe('ok');
    expect(p.link?.a2b?.value).toBe(41e6);
    expect(p.link?.a2b?.percent).toBeCloseTo(41);
    expect(p.link?.a2b?.stepIndex).toBe(0);
    expect(p.link?.a2b?.label).toBe('41 Mb/s · 41% of 100 Mb/s');
    expect(p.link?.a2b?.capacity).toBe(1e8);
    expect(p.link?.a2b?.capacitySource).toBe('number');
    expect(p.link?.b2a?.percent).toBeCloseTo(10);
    expect(p.link?.a2b?.width).toBeCloseTo(2 + 8 * 0.41);
  });
  it('red at 90 percent', () => {
    expect(patches.get('pg-link~radio:dhcp->rtr-a:wan2')!.link?.a2b?.stepIndex).toBe(2);
  });
  it('grey no data when the series is missing', () => {
    const h = patches.get('pg-link~lte:static->rtr-a:wan3')!.link!.a2b!;
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
    expect(r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!.card).toEqual({
      reducer: 'last',
      url: '/d/if?d=${from.port}',
      title: '${from.node}',
    });
    expect(patches.get('pg-link~lte:static->rtr-a:wan3')!.card).toEqual({ reducer: 'last' });
  });
  it('resolves rule urls', () => {
    expect(patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!.urls).toEqual([
      { url: '/d/iface?var-job=node-isp-a&var-device=pppoe' },
    ]);
  });
  it('skips unmatched cells', () => {
    expect(patches.has('pg-port~rtr-a~wan3~1')).toBe(false);
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
    const p = r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(p.link?.a2b?.status).toBe('unbound');
    expect(p.link?.b2a?.status).toBe('unbound');
    expect(p.link?.a2b?.color).toBe(theme.colors.text.disabled);
    expect(p.link?.a2b?.label).toBe('unbound');
    expect(r.warnings[0]).toMatch(/cap.*cell\.capacity/);
  });
  it('uses the field display colour for shapes', () => {
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
    expect(sh.stepIndex).toBe(1); // 1 against the up thresholds of the field (-Inf, 1)
  });
  it('formats labels with a real display processor (unit, decimals, suffix)', () => {
    const field: Field = { name: 'v', type: FieldType.number, config: { unit: 'bps', decimals: 1 }, values: [] };
    const proc = getDisplayProcessor({ field, theme });
    const r = bind(rules, cells, series, { ...ctx, display: (_s, v) => proc(v) });
    expect(r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!.link!.a2b!.label).toBe('41.0 Mb/s · 41% of 100 Mb/s');
    expect(r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!.link!.b2a!.label).toBe('10.0 Mb/s · 10% of 100 Mb/s');
  });
  it('a link with one series keeps the other half undefined', () => {
    const r = bind(
      [
        {
          name: 'one',
          select: { ids: ['pg-link~isp-a:pppoe->rtr-a:wan1'] },
          link: { a2b: { refId: 'A', match: { device: 'pppoe' } } },
        },
      ],
      cells,
      series,
      ctx
    );
    const p = r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(p.link?.a2b?.status).toBe('ok');
    expect(p.link?.b2a).toBeUndefined();
    expect(p.link?.a2b?.percent).toBeUndefined();
    expect(p.link?.a2b?.label).toBe('41 Mb/s');
  });
});

describe('bind review fixes', () => {
  const withUnit = (unit: string | undefined, value: number): SeriesInfo => ({
    ...mk('U', { job: 'node-isp-a', device: 'pppoe' }, [value]),
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
    expect(h.label).toBe('40 Mb/s · 40% of 100 Mb/s');
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
    expect(p!.urls).toEqual([{ url: '/d/x' }]);
  });
  it('resolves urlTitle as a template; a title that does not resolve gives the default', () => {
    const titleOf = (urlTitle: string) =>
      bind([{ name: 'u', select: { ids: ['h1'] }, url: '/d/x', urlTitle }], [hostCell], [], ctx).patches.get('h1')!
        .urls[0];
    expect(titleOf('Host ${cell.host}')).toEqual({ title: 'Host a&b=c d/e', url: '/d/x' });
    expect(titleOf('Host ${cell.nope}')).toEqual({ url: '/d/x' });
  });
  it('urlTitle goes with the url of the same rule; a later rule can set only the title', () => {
    const r = (rules: Rule[]) => bind(rules, [hostCell], [], ctx).patches.get('h1')!.urls;
    const sel = { ids: ['h1'] };
    expect(
      r([
        { name: 'a', select: sel, url: '/d/a', urlTitle: 'A' },
        { name: 'b', select: sel, url: '/d/b' },
      ])
    ).toEqual([{ url: '/d/b' }]);
    expect(
      r([
        { name: 'a', select: sel, url: '/d/a' },
        { name: 'b', select: sel, urlTitle: 'B' },
      ])
    ).toEqual([{ title: 'B', url: '/d/a' }]);
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

describe('capacity sources', () => {
  const linkCell = cellMetaFromAttrs(
    'pg-link~a:eth0->b:eth1',
    { 'pg-kind': 'link', 'pg-id': 'a:eth0->b:eth1', 'pg-from': 'a:eth0', 'pg-to': 'b:eth1', capacity: '200000000' },
    true
  );
  const traffic = (config: Field['config'] = { unit: 'bps' }, v = 4e7): SeriesInfo => ({
    ...mk('T', { job: 'node-a', device: 'eth0' }, [v]),
    field: { name: 'rx', type: FieldType.number, config, values: [v] } as Field,
  });
  // node_network_speed_bytes: 12.5 MB/s = 100 Mb/s
  const speed = (v = 12.5e6, unit = 'Bps'): SeriesInfo => ({
    ...mk('S', { job: 'node-a', device: 'eth0' }, [v / 2, v]),
    field: { name: 'speed', type: FieldType.number, config: { unit }, values: [v / 2, v] } as Field,
  });
  const rule = (capacity?: LinkRule['capacity']): Rule => ({
    name: 'cap',
    select: { kind: 'link' },
    link: { a2b: { refId: 'T' }, ...(capacity !== undefined ? { capacity } : {}) },
  });
  const a2b = (r: Rule, s: SeriesInfo[]) => {
    const res = bind([r], [linkCell], s, ctx);
    return { h: res.patches.get(linkCell.id)!.link!.a2b!, warnings: res.warnings };
  };
  const seriesCap = { refId: 'S', match: { job: 'node-${from.node}', device: '${from.port}' } };

  it('series: converts the capacity series to bit/s with its unit', () => {
    const { h, warnings } = a2b(rule(seriesCap), [traffic(), speed()]);
    expect(h.capacitySource).toBe('series');
    expect(h.capacity).toBe(1e8);
    expect(h.percent).toBeCloseTo(40);
    expect(h.label).toBe('40 Mb/s · 40% of 100 Mb/s');
    expect(warnings).toEqual([]);
  });
  it('series: uses the reducer of the capacity selector', () => {
    const { h } = a2b(rule({ ...seriesCap, reducer: 'min' }), [traffic(), speed()]);
    expect(h.capacity).toBe(5e7);
  });
  it('series: an unresolved template makes the link unbound', () => {
    const { h, warnings } = a2b(rule({ refId: 'S', match: { device: '${cell.nope}' } }), [traffic(), speed()]);
    expect(h.status).toBe('unbound');
    expect(warnings.join(' ')).toMatch(/cell\.nope/);
  });
  it('series: a missing capacity series falls back to the field Max and gives a note', () => {
    const { h, warnings } = a2b(rule(seriesCap), [traffic({ unit: 'bps', max: 5e7 })]);
    expect(h.capacitySource).toBe('fieldMax');
    expect(h.capacity).toBe(5e7);
    expect(warnings.join(' ')).toMatch(/capacity series not found/);
  });
  it('series wins over the field Max', () => {
    expect(a2b(rule(seriesCap), [traffic({ unit: 'bps', max: 5e7 }), speed()]).h.capacitySource).toBe('series');
  });
  it('attr: a cell attribute template', () => {
    const { h } = a2b(rule('${cell.capacity}'), [traffic({ unit: 'bps', max: 5e7 })]);
    expect(h.capacitySource).toBe('attr');
    expect(h.capacity).toBe(2e8);
    expect(h.percent).toBeCloseTo(20);
  });
  it('number: a number or a number in a string', () => {
    expect(a2b(rule(1e9), [traffic()]).h.capacitySource).toBe('number');
    expect(a2b(rule('1e9'), [traffic()]).h.capacity).toBe(1e9);
  });
  it('fieldMax: the Max of the field config, in the field unit', () => {
    // 12.5 MB/s = 100 Mb/s; the traffic is 5 MB/s = 40 Mb/s
    const { h } = a2b(rule(), [traffic({ unit: 'Bps', max: 12.5e6 }, 5e6)]);
    expect(h.capacitySource).toBe('fieldMax');
    expect(h.capacity).toBe(1e8);
    expect(h.percent).toBeCloseTo(40);
    expect(h.width).toBeCloseTo(2 + 8 * 0.4);
  });
  it('none: no capacity, no percent, the display colour', () => {
    const { h } = a2b(rule(), [traffic()]);
    expect(h.capacitySource).toBe('none');
    expect(h.capacity).toBeUndefined();
    expect(h.percent).toBeUndefined();
    expect(h.color).toBe('#abcdef');
    expect(h.label).toBe('40 Mb/s');
  });
});

describe('colours from the Grafana field config', () => {
  const linkCell = cellMetaFromAttrs(
    'pg-link~a:eth0->b:eth1',
    { 'pg-kind': 'link', 'pg-id': 'a:eth0->b:eth1', 'pg-from': 'a:eth0', 'pg-to': 'b:eth1' },
    true
  );
  const frame = (refId: string, value: number): DataFrame => ({
    refId,
    length: 1,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: [0] },
      { name: 'Value', type: FieldType.number, config: {}, values: [value], labels: { device: 'eth0' } },
    ],
  });
  const steps = {
    mode: ThresholdsMode.Absolute,
    steps: [
      { value: -Infinity, color: 'green' },
      { value: 60, color: 'yellow' },
      { value: 85, color: 'red' },
    ],
  };
  // the standard options of Grafana core that the overrides below use
  const registry = new FieldConfigOptionsRegistry(() =>
    ['unit', 'color', 'thresholds', 'max'].map(
      (id) =>
        ({ id, path: id, name: id, process: (v: unknown) => v, shouldApply: () => true, override: () => null }) as never
    )
  );
  // WAN (A): continuous GrYlRd and Max 100 Mb/s by an override; LAN (B): thresholds, capacity from the rule
  const frames = applyFieldOverrides({
    data: [frame('A', 5e7), frame('B', 7e8)],
    fieldConfig: {
      defaults: { unit: 'bps', color: { mode: FieldColorModeId.Thresholds }, thresholds: steps },
      overrides: [
        {
          matcher: { id: FieldMatcherID.byFrameRefID, options: 'A' },
          properties: [
            { id: 'color', value: { mode: FieldColorModeId.ContinuousGrYlRd } },
            { id: 'max', value: 1e8 },
          ],
        },
      ],
    },
    fieldConfigRegistry: registry,
    replaceVariables: (s) => s,
    theme,
  });
  const live = extractSeries(frames);
  // no panel thresholds: the colours come from the field config only
  const gctx: BindContext = { ...ctx, fieldThresholds: undefined, display: (s, v) => s.field.display!(v) };
  const half = (r: Rule) => bind([r], [linkCell], live, gctx).patches.get(linkCell.id)!.link!.a2b!;

  it('colours a WAN half by the continuous scheme of its override at the percent of the field Max', () => {
    const h = half({ name: 'wan', select: { kind: 'link' }, link: { a2b: { refId: 'A' } } });
    expect(h.capacitySource).toBe('fieldMax');
    expect(h.percent).toBeCloseTo(50);
    const calc = getFieldColorMode(FieldColorModeId.ContinuousGrYlRd).getCalculator(live[0].field, theme);
    expect(h.color).toBe(calc(0, 0.5));
  });
  it('colours a LAN half by the thresholds in percent of the rule capacity', () => {
    const h = half({ name: 'lan', select: { kind: 'link' }, link: { a2b: { refId: 'B' }, capacity: 1e9 } });
    expect(h.percent).toBeCloseTo(70);
    expect(h.color).toBe(theme.visualization.getColorByName('yellow'));
    expect(h.stepIndex).toBe(1);
  });
  it('colours a half without capacity by the display colour of the raw value', () => {
    const h = half({ name: 'raw', select: { kind: 'link' }, link: { a2b: { refId: 'B' } } });
    expect(h.capacitySource).toBe('none');
    // 7e8 against the absolute steps: red
    expect(h.color).toBe(theme.visualization.getColorByName('red'));
  });
  it('ignores the removed rule thresholds and gives a warning', () => {
    const r = bind(
      [
        {
          name: 'old',
          select: { kind: 'link' },
          link: { a2b: { refId: 'B' }, capacity: 1e9 },
          thresholds: { mode: 'percent', steps: [[0, 'blue']] },
        },
      ],
      [linkCell],
      live,
      gctx
    );
    expect(r.patches.get(linkCell.id)!.link!.a2b!.color).toBe(theme.visualization.getColorByName('yellow'));
    expect(r.warnings).toEqual([
      'old: thresholds is removed and ignored. Set Thresholds and Color scheme in the field config of the panel',
    ]);
  });
});

describe('one capacity per direction', () => {
  const link = cellMetaFromAttrs(
    'pg-link~a:p1->b:p2',
    {
      'pg-kind': 'link',
      'pg-id': 'a:p1->b:p2',
      'pg-from': 'a:p1',
      'pg-to': 'b:p2',
      capacity_a2b_bps: '800',
      capacity_b2a_bps: '400',
      capacity_bad: 'fast',
    },
    true
  );
  const ids = ['ua', 'ub', 'ca', 'cb', 'cap'];
  const bind$ = (id: string): QueryBinding => ({ ...queryBinding, queryId: id });
  const base: NonNullable<DiagramConfigV2['patterns'][number]['display']['link']> = {
    a2bBinding: bind$('ua'),
    b2aBinding: bind$('ub'),
  };
  const run = (
    extra: typeof base,
    values: Record<string, number> = {},
    fieldMax: Record<string, number> = {},
    units: Record<string, string> = {}
  ): ReturnType<typeof bindPlan> => {
    const config = v2Config({ link: { ...base, ...extra } });
    config.queries.push(...ids.map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
    const plan = resolvePatterns([link], config);
    expect(plan.diagnostics).toEqual([]);
    return bindPlan(
      plan,
      (_, b) => {
        const v = { ua: 40, ub: 10, ...values }[b.queryId];
        if (v === undefined) {
          return { state: 'empty', fetchedAt: 100000, fromCache: false };
        }
        const model = historyValue(v);
        if (model.state === 'ready' && fieldMax[b.queryId] !== undefined) {
          model.field.config.max = fieldMax[b.queryId];
        }
        if (model.state === 'ready' && units[b.queryId] !== undefined) {
          model.field.config.unit = units[b.queryId];
        }
        return model;
      },
      ctx,
      1000
    );
  };
  const halves = (r: ReturnType<typeof bindPlan>) => {
    const l = r.patches.get(link.id)!.link!;
    return [l.a2b, l.b2a].map((h) => h && [h.capacity, h.capacitySource, h.percent]);
  };

  it('lists the directional capacity bindings as visible demands', () => {
    const config = v2Config({
      link: {
        ...base,
        capacityA2bBinding: bind$('ca'),
        capacityB2aBinding: bind$('cb'),
        capacityBinding: bind$('cap'),
      },
    });
    config.queries.push(...ids.map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
    const plan = resolvePatterns([link], config);
    expect(plan.diagnostics).toEqual([]);
    expect(collectBindingDemands(plan).map((d) => [d.binding.queryId, d.role])).toEqual([
      ['ua', 'visible'],
      ['ub', 'visible'],
      ['cap', 'visible'],
      ['ca', 'visible'],
      ['cb', 'visible'],
    ]);
  });

  it('gives each direction its own capacity from a number or a template', () => {
    const r = run({ capacityA2b: '${cell.capacity_a2b_bps}', capacityB2a: 200 });
    expect(halves(r)).toEqual([
      [800, 'attr', 5],
      [200, 'number', 5],
    ]);
  });

  it('reads a directional binding like capacityBinding, through the field unit', () => {
    const r = run({ capacityA2bBinding: bind$('ca'), capacityB2aBinding: bind$('cb') }, { ca: 1000, cb: 500 });
    expect(halves(r)).toEqual([
      [1000, 'series', 4],
      [500, 'series', 2],
    ]);
  });

  it('converts the value of a directional binding by the unit of its field', () => {
    // 100 Mbit/s and 10 MB/s (80 Mbit/s)
    const r = run(
      { capacityA2bBinding: bind$('ca'), capacityB2aBinding: bind$('cb') },
      { ca: 100, cb: 10 },
      {},
      { ca: 'Mbits', cb: 'MBs' }
    );
    expect(halves(r).map((h) => h && h.slice(0, 2))).toEqual([
      [100e6, 'series'],
      [80e6, 'series'],
    ]);
  });

  describe('precedence of one half', () => {
    // a2b is 40; every source has its own capacity
    const all = {
      capacityA2bBinding: bind$('ca'),
      capacityA2b: '${cell.capacity_a2b_bps}',
      capacityBinding: bind$('cap'),
      capacity: 200,
    };
    const values = { ca: 1000, cap: 500 };
    const a2b = (r: ReturnType<typeof bindPlan>) => halves(r)[0];
    it('directional binding first', () => {
      expect(a2b(run(all, values))).toEqual([1000, 'series', 4]);
    });
    it('then the directional number or template', () => {
      expect(a2b(run(all, { ...values, ca: 0 }))).toEqual([800, 'attr', 5]);
      expect(a2b(run({ ...all, capacityA2b: 700 }, { ...values, ca: 0 }))).toEqual([700, 'number', (40 / 700) * 100]);
      // the binding has no data
      expect(a2b(run(all, { cap: 500 }))).toEqual([800, 'attr', 5]);
    });
    it('then capacityBinding', () => {
      expect(a2b(run({ ...all, capacityA2b: -5 }, { ...values, ca: 0 }))).toEqual([500, 'series', 8]);
      expect(a2b(run({ ...all, capacityA2b: '${cell.capacity_bad}' }, { ...values, ca: -1 }))).toEqual([
        500,
        'series',
        8,
      ]);
      expect(a2b(run({ ...all, capacityA2b: '${cell.missing}' }, { ...values, ca: 0 }))).toEqual([500, 'series', 8]);
    });
    it('then capacity', () => {
      expect(a2b(run({ ...all, capacityA2b: 0 }, { ca: 0, cap: 0 }))).toEqual([200, 'number', 20]);
    });
    it('then the field Max, then none', () => {
      const only = { ...all, capacity: undefined };
      expect(a2b(run({ ...only, capacityA2b: 0 }, { ca: 0, cap: 0 }, { ua: 100 }))).toEqual([100, 'fieldMax', 40]);
      expect(a2b(run({ ...only, capacityA2b: 0 }, { ca: 0, cap: 0 }))).toEqual([undefined, 'none', undefined]);
    });
    it('leaves the other direction on the shared sources', () => {
      expect(halves(run(all, values))[1]).toEqual([500, 'series', 2]);
      expect(halves(run({ ...all, capacityB2a: 100 }, values))[1]).toEqual([100, 'number', 10]);
    });
  });

  it('adds a diagnostic for a directional template that gives no number, and falls through', () => {
    const r = run({ capacityA2b: '${cell.missing}', capacityB2a: '${cell.capacity_bad}', capacity: 200 });
    expect(halves(r)).toEqual([
      [200, 'number', 20],
      [200, 'number', 5],
    ]);
    expect(r.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['unresolved-metadata', `cells.${link.id}.link.capacityA2b`],
      ['unresolved-metadata', `cells.${link.id}.link.capacityB2a`],
    ]);
  });

  it('keeps the symmetric capacity and the capacity binding as they were', () => {
    expect(halves(run({ capacity: '${cell.capacity_a2b_bps}' }))).toEqual([
      [800, 'attr', 5],
      [800, 'attr', 1.25],
    ]);
    expect(halves(run({ capacity: 200, capacityBinding: bind$('cap') }, { cap: 500 }))).toEqual([
      [500, 'series', 8],
      [500, 'series', 2],
    ]);
  });
});

describe('widgetDiagnostics', () => {
  const binding: QueryBinding = { queryId: 'q', match: {}, reducer: 'last' };
  const config: DiagramConfigV2 = {
    version: 2,
    queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
    patterns: [],
    overrides: [],
    widgets: [
      { id: 'gone', anchorCellId: 'missing', kind: 'bar', label: 'Gone', binding },
      { id: 'w', anchorCellId: 'a', kind: 'sparkline', label: 'Load', binding },
    ],
  };
  const plan = resolvePatterns([cellMetaFromAttrs('a', {}, false)], config);
  it('resolves each widget at its anchor and reports a missing metric under the widget index', () => {
    const seen: Array<[string, string]> = [];
    const out = widgetDiagnostics(plan, (cellId, b) => {
      seen.push([cellId, b.queryId]);
      return { state: 'empty' } as never;
    });
    expect(seen).toEqual([['a', 'q']]);
    expect(out).toEqual([
      { code: 'unmatched-metric', path: 'widgets[1].binding', message: 'No metric matches query q.' },
    ]);
  });
  it('reports a failed or ambiguous query and nothing for a resolved or pending one', () => {
    const state = (s: object) => widgetDiagnostics(plan, () => s as never).map((d) => d.code);
    expect(state({ state: 'error', message: 'Ambiguous match' })).toEqual(['ambiguous-metric']);
    expect(state({ state: 'unsupported', message: 'no' })).toEqual(['unsupported-metric']);
    expect(state({ state: 'loading' })).toEqual([]);
    expect(state({ state: 'ready' })).toEqual([]);
  });
});
