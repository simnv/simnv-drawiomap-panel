import { primaryOf, resolveLinks } from '../interact/links';
import { describe, expect, it, vi } from 'vitest';
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
  formattedValueToString,
  getFieldColorMode,
  ThresholdsMode,
  toDataFrame,
} from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { BindContext, CellMeta } from '../types';
import {
  bindPlan,
  collectBindingDemands,
  historySeries,
  resolveBinding,
  targetOf,
  widgetDiagnostics,
} from './engine';
import { resolvePatterns } from './patterns';
import { displayBindings, type DiagramConfig, type DisplayConfig, type QueryBinding } from '../model/config';
import { fieldDisplay, toHistory } from '../query/frames';

const queryBinding: QueryBinding = { queryId: 'health', match: {}, reducer: 'last' };
const v2Config = (display: DiagramConfig['patterns'][number]['display']): DiagramConfig => ({
  version: 3,
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
const theme = createTheme();
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
  it('colours the shape target by the field display and writes the formatted value into the label', () => {
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
      shape: { target: 'shape', text: 'rtr-a 99%', value: 99, color: '#ff0000', status: 'ok' },
      statusView: { state: 'normal', reason: 'Healthy' },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.summaries).toEqual([]);
  });
  it('keeps traffic magnitude colors independent of explicit device health and diagnoses incomplete link coverage', () => {
    const config = v2Config({
      link: { a2b: { binding: queryBinding }, b2a: { binding: { ...queryBinding, queryId: 'rx' } }, capacity: 100 },
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
      expect.objectContaining({ code: 'unmatched-metric', path: `cells.${cells[0].id}.link.b2a.binding` })
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
  it('demands each binding of a combined up/down row with its path in the row', () => {
    const tx = { ...queryBinding, queryId: 'tx' };
    const rx = { ...queryBinding, queryId: 'rx' };
    const config = v2Config({
      hover: {
        rows: [
          {
            kind: 'combined',
            label: 'Traffic',
            series: [
              { binding: tx, direction: 'up', capacityBinding: { ...queryBinding, queryId: 'speed' } },
              { binding: rx, direction: 'down' },
            ],
          },
        ],
      },
    });
    for (const id of ['tx', 'rx', 'speed']) {
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
        .map((d) => [d.binding.queryId, d.rowIndex, d.path])
    ).toEqual([
      ['tx', 0, 'series[0].binding'],
      ['rx', 0, 'series[1].binding'],
      ['speed', 0, 'series[0].capacityBinding'],
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
      link: { a2b: { binding: queryBinding }, capacityBinding: capacity },
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
  type Link = NonNullable<DisplayConfig['link']>;
  /** the link with its two value bindings; `extra` adds the capacity sources of a direction or of the link */
  const withBindings = (extra: Link): Link => ({
    ...extra,
    a2b: { binding: bind$('ua'), ...extra.a2b },
    b2a: { binding: bind$('ub'), ...extra.b2a },
  });
  const run = (
    extra: Link,
    values: Record<string, number> = {},
    fieldMax: Record<string, number> = {},
    units: Record<string, string> = {}
  ): ReturnType<typeof bindPlan> => {
    const config = v2Config({ link: withBindings(extra) });
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
      link: withBindings({
        a2b: { capacityBinding: bind$('ca') },
        b2a: { capacityBinding: bind$('cb') },
        capacityBinding: bind$('cap'),
      }),
    });
    config.queries.push(...ids.map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
    const plan = resolvePatterns([link], config);
    expect(plan.diagnostics).toEqual([]);
    expect(collectBindingDemands(plan).map((d) => [d.binding.queryId, d.role])).toEqual([
      ['ua', 'visible'],
      ['ca', 'visible'],
      ['ub', 'visible'],
      ['cb', 'visible'],
      ['cap', 'visible'],
    ]);
  });

  it('gives each direction its own capacity from a number or a template', () => {
    const r = run({ a2b: { capacity: '${cell.capacity_a2b_bps}' }, b2a: { capacity: 200 } });
    expect(halves(r)).toEqual([
      [800, 'attr', 5],
      [200, 'number', 5],
    ]);
  });

  it('reads a directional binding like capacityBinding, through the field unit', () => {
    const r = run(
      { a2b: { capacityBinding: bind$('ca') }, b2a: { capacityBinding: bind$('cb') } },
      { ca: 1000, cb: 500 }
    );
    expect(halves(r)).toEqual([
      [1000, 'series', 4],
      [500, 'series', 2],
    ]);
  });

  it('converts the value of a directional binding by the unit of its field', () => {
    // 100 Mbit/s and 10 MB/s (80 Mbit/s)
    const r = run(
      { a2b: { capacityBinding: bind$('ca') }, b2a: { capacityBinding: bind$('cb') } },
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
    const all: Link = {
      a2b: { capacityBinding: bind$('ca'), capacity: '${cell.capacity_a2b_bps}' },
      capacityBinding: bind$('cap'),
      capacity: 200,
    };
    const values = { ca: 1000, cap: 500 };
    const a2b = (r: ReturnType<typeof bindPlan>) => halves(r)[0];
    const own = (direction: Link['a2b']): Link => ({ ...all, a2b: direction });
    it('directional binding first', () => {
      expect(a2b(run(all, values))).toEqual([1000, 'series', 4]);
    });
    it('then the directional number or template', () => {
      expect(a2b(run(all, { ...values, ca: 0 }))).toEqual([800, 'attr', 5]);
      expect(a2b(run(own({ capacityBinding: bind$('ca'), capacity: 700 }), { ...values, ca: 0 }))).toEqual([
        700,
        'number',
        (40 / 700) * 100,
      ]);
      // the binding has no data
      expect(a2b(run(all, { cap: 500 }))).toEqual([800, 'attr', 5]);
    });
    it('then capacityBinding', () => {
      const bad = own({ capacityBinding: bind$('ca'), capacity: '${cell.capacity_bad}' });
      expect(a2b(run(bad, { ...values, ca: -1 }))).toEqual([500, 'series', 8]);
      const missing = own({ capacityBinding: bind$('ca'), capacity: '${cell.missing}' });
      expect(a2b(run(missing, { ...values, ca: 0 }))).toEqual([500, 'series', 8]);
    });
    it('then capacity', () => {
      expect(a2b(run(own({ capacityBinding: bind$('ca') }), { ca: 0, cap: 0 }))).toEqual([200, 'number', 20]);
    });
    it('then the field Max, then none', () => {
      const only: Link = { a2b: { capacityBinding: bind$('ca') }, capacityBinding: bind$('cap') };
      expect(a2b(run(only, { ca: 0, cap: 0 }, { ua: 100 }))).toEqual([100, 'fieldMax', 40]);
      expect(a2b(run(only, { ca: 0, cap: 0 }))).toEqual([undefined, 'none', undefined]);
    });
    it('leaves the other direction on the shared sources', () => {
      expect(halves(run(all, values))[1]).toEqual([500, 'series', 2]);
      expect(halves(run({ ...all, b2a: { capacity: 100 } }, values))[1]).toEqual([100, 'number', 10]);
    });
    it('reads a shared capacity series once for both directions and reports its problem once', () => {
      const seen: string[] = [];
      const config = v2Config({ link: withBindings({ capacityBinding: bind$('cap') }) });
      config.queries.push(...ids.map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
      const plan = resolvePatterns([link], config);
      const r = bindPlan(
        plan,
        (_, b) => {
          seen.push(b.queryId);
          return b.queryId === 'cap' ? { state: 'empty', fetchedAt: 1, fromCache: false } : historyValue(40);
        },
        ctx,
        1000
      );
      expect(seen.filter((id) => id === 'cap')).toHaveLength(1);
      expect(r.diagnostics.filter((d) => d.code === 'unmatched-metric')).toHaveLength(1);
    });
  });

  it('adds a diagnostic for a directional template that gives no number, and falls through', () => {
    const r = run({ a2b: { capacity: '${cell.missing}' }, b2a: { capacity: '${cell.capacity_bad}' }, capacity: 200 });
    expect(halves(r)).toEqual([
      [200, 'number', 20],
      [200, 'number', 5],
    ]);
    // the fixture field has the unit percent: each half also reports that it is not a data rate
    expect(r.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['unresolved-metadata', `cells.${link.id}.link.a2b.capacity`],
      ['unit-not-rate', `cells.${link.id}.link.a2b.binding`],
      ['unresolved-metadata', `cells.${link.id}.link.b2a.capacity`],
      ['unit-not-rate', `cells.${link.id}.link.b2a.binding`],
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

  it('a pattern series wins over an override number when it is ready, the number when it is not', () => {
    const config = v2Config({ link: withBindings({ capacityBinding: bind$('cap') }) });
    config.queries.push(...ids.map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
    config.overrides.push({ cellId: link.id, display: { link: { capacity: 200 } } });
    const plan = resolvePatterns([link], config);
    expect(plan.diagnostics).toEqual([]);
    const bind = (cap: number | undefined) =>
      halves(
        bindPlan(
          plan,
          (_, b) =>
            b.queryId === 'cap'
              ? cap === undefined
                ? { state: 'loading' }
                : historyValue(cap)
              : historyValue(b.queryId === 'ua' ? 40 : 10),
          ctx,
          1000
        )
      )[0];
    expect(bind(500)).toEqual([500, 'series', 8]);
    expect(bind(undefined)).toEqual([200, 'number', 20]);
  });
});

describe('an unavailable cell and an unavailable direction', () => {
  const link = cells[0];
  const ids = ['ua', 'ub'];
  const bind$ = (id: string): QueryBinding => ({ ...queryBinding, queryId: id });
  const two = () => {
    const config = v2Config({ link: { a2b: { binding: bind$('ua') }, b2a: { binding: bind$('ub') } } });
    config.queries.push(...ids.map((id) => ({ id, name: id, source: { kind: 'panel' as const, refId: id } })));
    return config;
  };
  it('a valid a2b plus a b2a with an unknown query gives two halves, the b2a one unbound and grey, coverage 1/2', () => {
    const config = two();
    config.queries = config.queries.filter((q) => q.id !== 'ub');
    const plan = resolvePatterns([link], config);
    expect(plan.cells[link.id].bindings).toEqual([bind$('ua')]);
    expect(plan.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['unknown-query', 'patterns[0].display.link.b2a.binding.queryId'],
      ['unknown-query', `cells.${link.id}.link.b2a.binding.queryId`],
    ]);
    const result = bindPlan(plan, () => historyValue(40), ctx, 1000);
    const patch = result.patches.get(link.id)!;
    expect(patch.link?.a2b?.status).toBe('ok');
    expect(patch.link?.b2a).toEqual({
      status: 'unbound',
      color: theme.colors.text.disabled,
      width: ctx.linkWidth.min,
      label: 'unavailable',
      stepIndex: -1,
    });
    expect(patch.statusView).toMatchObject({
      state: 'missing',
      reason: 'Incomplete coverage (1/2 directions available)',
      coverage: { available: 1, expected: 2 },
    });
  });
  it('an unavailable cell gives a patch with the reason, the no-data colour and a missing status view, and binds nothing', () => {
    const config = two();
    config.patterns.push({ id: 'broken', name: 'Broken', select: {}, display: { link: { capacity: 0 } } });
    const plan = resolvePatterns([link], config);
    expect(plan.cells[link.id]).toMatchObject({ unavailable: 'Pattern Broken is not applied', bindings: [] });
    const resolve = vi.fn(() => historyValue(40));
    const result = bindPlan(plan, resolve, ctx, 1000);
    expect(resolve).not.toHaveBeenCalled();
    const patch = result.patches.get(link.id)!;
    expect(patch.unavailable).toEqual({ reason: 'Pattern Broken is not applied', color: theme.colors.text.disabled });
    expect(patch.link).toBeUndefined();
    expect(patch.statusView).toMatchObject({ state: 'missing', reason: 'Pattern Broken is not applied' });
    expect(result.summaries.map((s) => [s.state, s.reason, s.cellIds])).toEqual([
      ['missing', 'Pattern Broken is not applied', [link.id]],
    ]);
  });
  it('an unavailable cell stays grey when an override disables it: unavailable wins over enabled false', () => {
    const config = two();
    config.patterns.push({ id: 'broken', name: 'Broken', select: {}, display: { link: { capacity: 0 } } });
    config.overrides.push({ cellId: link.id, display: { enabled: false } });
    const plan = resolvePatterns([link], config);
    const patch = bindPlan(plan, () => historyValue(40), ctx, 1000).patches.get(link.id)!;
    expect(patch.unavailable).toEqual({ reason: 'Pattern Broken is not applied', color: theme.colors.text.disabled });
    expect(patch.statusView).toMatchObject({ state: 'missing', reason: 'Pattern Broken is not applied' });
  });
  it('a shape binding with an unknown query gives an unbound grey shape and a missing status with the reason', () => {
    const node = cells[3];
    const config = v2Config({ shape: { binding: bind$('ua'), target: 'shape', text: true } });
    const plan = resolvePatterns([node], config);
    expect(plan.cells[node.id].bindings).toEqual([]);
    const resolve = vi.fn(() => historyValue(40));
    const result = bindPlan(plan, resolve, ctx, 1000);
    expect(resolve).not.toHaveBeenCalled();
    const patch = result.patches.get(node.id)!;
    expect(patch.shape).toEqual({
      status: 'unbound',
      color: theme.colors.text.disabled,
      target: 'shape',
      stepIndex: -1,
      text: 'unavailable',
    });
    expect(patch.statusView).toMatchObject({
      state: 'missing',
      reason: 'Query ua does not exist. Choose a named query or restore its definition.',
      queryIds: ['ua'],
    });
    expect(result.summaries.map((s) => [s.state, s.cellIds])).toEqual([['missing', [node.id]]]);
  });
  it('a status binding with an unknown query gives the missing state with the reason', () => {
    const node = cells[3];
    const config = v2Config({
      status: {
        kind: 'mapping',
        binding: bind$('ua'),
        default: { state: 'normal', reason: 'Healthy' },
        mappings: [{ state: 'critical', reason: 'Down', value: 0 }],
      },
    });
    const plan = resolvePatterns([node], config);
    const result = bindPlan(plan, () => historyValue(1), ctx, 1000);
    expect(result.patches.get(node.id)!.statusView).toMatchObject({
      state: 'missing',
      reason: 'Query ua does not exist. Choose a named query or restore its definition.',
      queryIds: ['ua'],
    });
  });
});

describe('widgetDiagnostics', () => {
  const binding: QueryBinding = { queryId: 'q', match: {}, reducer: 'last' };
  const config: DiagramConfig = {
    version: 3,
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

/* ---------- the shared half, capacity, colour, shape and url logic, through bindPlan ---------- */

const qb = (queryId: string, match: Record<string, string> = {}): QueryBinding => ({ queryId, match, reducer: 'last' });
/** A panel frame with one numeric field, as Grafana gives it to the panel. */
const frame = (refId: string, labels: Record<string, string>, values: number[], config: Field['config'] = {}) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'Time', type: FieldType.time, values: values.map((_, i) => 1000 + i) },
      { name: 'Value', type: FieldType.number, values, labels, config },
    ],
  });
/** Binds one pattern over the cells, with the frames as the panel data of their refId queries. */
function run(display: DisplayConfig, frames: DataFrame[], cellList: CellMeta[] = cells, context: BindContext = ctx) {
  const ids = [...new Set(displayBindings(display).map(({ binding }) => binding.queryId))];
  const config: DiagramConfig = {
    version: 3,
    queries: ids.map((id) => ({ id, name: id, source: { kind: 'panel', refId: id } })),
    patterns: [{ id: 'p', name: 'P', select: {}, display }],
    overrides: [],
    widgets: [],
  };
  const plan = resolvePatterns(cellList, config);
  expect(plan.diagnostics).toEqual([]);
  return bindPlan(
    plan,
    (cellId, b) =>
      resolveBinding(
        { state: 'ready', fetchedAt: 1000, fromCache: false, frames: frames.filter((f) => f.refId === b.queryId) },
        b,
        plan.cells[cellId].scope
      ),
    context,
    1000
  );
}
const linkDisplay: DisplayConfig = {
  link: {
    a2b: { binding: qb('A', { job: 'node-${from.node}', device: '${from.port}' }) },
    b2a: { binding: qb('A', { job: 'node-${to.node}', device: '${to.port}' }) },
    capacity: 1e8,
  },
  url: '/d/iface?var-job=node-${from.node}&var-device=${from.port}',
};
const traffic = [
  frame('A', { job: 'node-isp-a', device: 'pppoe' }, [40e6, 41e6], { unit: 'bps' }),
  frame('A', { job: 'node-rtr-a', device: 'wan1' }, [10e6], { unit: 'bps' }),
  frame('A', { job: 'node-radio', device: 'dhcp' }, [90e6], { unit: 'bps' }),
];
/** The up series has its own thresholds in the field config (an override in Grafana). */
const upThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'red' },
    { value: 1, color: 'green' },
  ],
};
const upFrames = [
  frame('C', { job: 'node-rtr-a' }, [1], { thresholds: upThresholds }),
  frame('C', { job: 'node-lte' }, [0], { thresholds: upThresholds }),
];
const upShape: DisplayConfig = { shape: { binding: qb('C', { job: 'node-${cell.pg-id}' }), target: 'icon' } };

describe('link halves', () => {
  const r = run(linkDisplay, traffic);
  it('colours both halves of a link against the capacity and gives the card text', () => {
    const p = r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(p.ruleNames).toEqual(['p']);
    expect(p.link?.a2b).toMatchObject({ status: 'ok', value: 41e6, capacity: 1e8, capacitySource: 'number' });
    expect(p.link?.a2b?.percent).toBeCloseTo(41);
    expect(p.link?.a2b?.stepIndex).toBe(0);
    expect(p.link?.a2b?.label).toMatch(/^41(\.0)? Mb\/s · 41% of 100 Mb\/s$/);
    expect(p.link?.a2b?.width).toBeCloseTo(2 + 8 * 0.41);
    expect(p.link?.b2a?.percent).toBeCloseTo(10);
  });
  it('red at 90 percent', () => {
    expect(r.patches.get('pg-link~radio:dhcp->rtr-a:wan2')!.link?.a2b?.stepIndex).toBe(2);
  });
  it('grey no data when the series is missing, with a diagnostic', () => {
    const h = r.patches.get('pg-link~lte:static->rtr-a:wan3')!.link!.a2b!;
    expect(h).toMatchObject({ status: 'nodata', stepIndex: -1, color: theme.colors.text.disabled, label: 'no data' });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unmatched-metric',
        path: 'cells.pg-link~lte:static->rtr-a:wan3.link.a2b.binding',
      })
    );
  });
  it('resolves the display url with the cell scope', () => {
    expect(r.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!.urls).toEqual([
      { url: '/d/iface?var-job=node-isp-a&var-device=pppoe' },
    ]);
  });
  it('a link with one binding keeps the other half undefined and shows the value without a percent', () => {
    const one = run({ link: { a2b: { binding: qb('A', { device: 'pppoe' }) } } }, traffic);
    const p = one.patches.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(p.link?.a2b?.status).toBe('ok');
    expect(p.link?.b2a).toBeUndefined();
    expect(p.link?.a2b?.percent).toBeUndefined();
    expect(p.link?.a2b?.label).toMatch(/^41(\.0)? Mb\/s$/);
  });
});

describe('capacity sources', () => {
  const linkCell = cellMetaFromAttrs(
    'pg-link~a:eth0->b:eth1',
    { 'pg-kind': 'link', 'pg-id': 'a:eth0->b:eth1', 'pg-from': 'a:eth0', 'pg-to': 'b:eth1', capacity: '200000000' },
    true
  );
  const t = (config: Field['config'] = { unit: 'bps' }, v = 4e7) =>
    frame('T', { job: 'node-a', device: 'eth0' }, [v], config);
  // node_network_speed_bytes: 12.5 MB/s = 100 Mb/s
  const speed = (v = 12.5e6, unit = 'Bps') => frame('S', { job: 'node-a', device: 'eth0' }, [v / 2, v], { unit });
  const a2b = (link: NonNullable<DisplayConfig['link']>, frames: DataFrame[]) => {
    const res = run({ link: { a2b: { binding: qb('T') }, ...link } }, frames, [linkCell]);
    return { h: res.patches.get(linkCell.id)!.link!.a2b!, diagnostics: res.diagnostics };
  };
  const seriesCap = qb('S', { job: 'node-${from.node}', device: '${from.port}' });

  it('series: converts the capacity series to bit/s with its unit', () => {
    const { h, diagnostics } = a2b({ capacityBinding: seriesCap }, [t(), speed()]);
    expect(h).toMatchObject({ capacitySource: 'series', capacity: 1e8 });
    expect(h.percent).toBeCloseTo(40);
    expect(h.label).toMatch(/^40(\.0)? Mb\/s · 40% of 100 Mb\/s$/);
    expect(diagnostics).toEqual([]);
  });
  it('series: uses the reducer of the capacity binding', () => {
    expect(a2b({ capacityBinding: { ...seriesCap, reducer: 'min' } }, [t(), speed()]).h.capacity).toBe(5e7);
  });
  it('series: a missing capacity series falls back to the field Max and reports the metric', () => {
    const { h, diagnostics } = a2b({ capacityBinding: seriesCap }, [t({ unit: 'bps', max: 5e7 })]);
    expect(h).toMatchObject({ capacitySource: 'fieldMax', capacity: 5e7 });
    expect(diagnostics.map((d) => d.code)).toEqual(['unmatched-metric']);
  });
  it('series wins over the field Max', () => {
    expect(a2b({ capacityBinding: seriesCap }, [t({ unit: 'bps', max: 5e7 }), speed()]).h.capacitySource).toBe(
      'series'
    );
  });
  it('attr: a cell attribute template', () => {
    const { h } = a2b({ capacity: '${cell.capacity}' }, [t({ unit: 'bps', max: 5e7 })]);
    expect(h).toMatchObject({ capacitySource: 'attr', capacity: 2e8 });
    expect(h.percent).toBeCloseTo(20);
  });
  it('attr: a template that does not resolve gives a diagnostic and the half falls to the field Max', () => {
    const { h, diagnostics } = a2b({ capacity: '${cell.nope}' }, [t({ unit: 'bps', max: 5e7 })]);
    expect(h.capacitySource).toBe('fieldMax');
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'unresolved-metadata', path: `cells.${linkCell.id}.link.capacity` }),
    ]);
  });
  it('number: a positive number, in bit/s', () => {
    expect(a2b({ capacity: 1e9 }, [t()]).h).toMatchObject({ capacitySource: 'number', capacity: 1e9 });
  });
  it('fieldMax: the Max of the field config, in the field unit', () => {
    // 12.5 MB/s = 100 Mb/s; the traffic is 5 MB/s = 40 Mb/s
    const { h } = a2b({}, [t({ unit: 'Bps', max: 12.5e6 }, 5e6)]);
    expect(h).toMatchObject({ capacitySource: 'fieldMax', capacity: 1e8 });
    expect(h.percent).toBeCloseTo(40);
    expect(h.width).toBeCloseTo(2 + 8 * 0.4);
  });
  it('none: no capacity, no percent, the colour of the raw value', () => {
    const { h } = a2b({}, [t()]);
    expect(h).toMatchObject({ capacitySource: 'none', capacity: undefined, percent: undefined });
    expect(h.label).toMatch(/^40(\.0)? Mb\/s$/);
  });

  const pctFor = (unit: string | undefined, value: number) =>
    a2b({ capacity: 1e8 }, [t(unit ? { unit } : {}, value)]).h.percent;
  it('byte-rate units convert to bit/s before the capacity percent', () => {
    expect(pctFor('Bps', 5e6)).toBeCloseTo(40);
    expect(pctFor('KBs', 5e3)).toBeCloseTo(40);
    expect(pctFor('MBs', 5)).toBeCloseTo(40);
    expect(pctFor('GBs', 0.005)).toBeCloseTo(40);
    expect(pctFor('binBps', 5e6)).toBeCloseTo(40);
    expect(pctFor('KiBs', 1000)).toBeCloseTo((1000 * 1024 * 8 * 100) / 1e8);
    expect(pctFor('MiBs', 1)).toBeCloseTo((1024 ** 2 * 8 * 100) / 1e8);
    expect(pctFor('GiBs', 0.01)).toBeCloseTo((0.01 * 1024 ** 3 * 8 * 100) / 1e8);
  });
  it('bit-rate units scale to bit/s', () => {
    expect(pctFor('bps', 4e7)).toBeCloseTo(40);
    expect(pctFor('binbps', 4e7)).toBeCloseTo(40);
    expect(pctFor('Kbits', 4e4)).toBeCloseTo(40);
    expect(pctFor('Mbits', 40)).toBeCloseTo(40);
    expect(pctFor('Gbits', 0.04)).toBeCloseTo(40);
    expect(pctFor('Mibits', 1)).toBeCloseTo((1024 ** 2 * 100) / 1e8);
    expect(pctFor(undefined, 4e7)).toBeCloseTo(40);
  });
  it('an unknown unit uses the raw value and gives a diagnostic', () => {
    const { h, diagnostics } = a2b({ capacity: 1e8 }, [t({ unit: 'percent' }, 4e7)]);
    expect(h.percent).toBeCloseTo(40);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'unit-not-rate', message: expect.stringContaining('unit "percent"') }),
    ]);
  });
});

describe('colours from the Grafana field config', () => {
  const linkCell = cellMetaFromAttrs(
    'pg-link~a:eth0->b:eth1',
    { 'pg-kind': 'link', 'pg-id': 'a:eth0->b:eth1', 'pg-from': 'a:eth0', 'pg-to': 'b:eth1' },
    true
  );
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
  // WAN (A): continuous GrYlRd and Max 100 Mb/s by an override; LAN (B): thresholds, capacity from the display
  const frames = applyFieldOverrides({
    data: [frame('A', { device: 'eth0' }, [5e7]), frame('B', { device: 'eth0' }, [7e8])],
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
  // no panel thresholds: the colours come from the field config only
  const gctx: BindContext = { ...ctx, fieldThresholds: undefined };
  const half = (link: NonNullable<DisplayConfig['link']>) =>
    run({ link }, frames, [linkCell], gctx).patches.get(linkCell.id)!.link!.a2b!;

  it('colours a WAN half by the continuous scheme of its override at the percent of the field Max', () => {
    const h = half({ a2b: { binding: qb('A') } });
    expect(h.capacitySource).toBe('fieldMax');
    expect(h.percent).toBeCloseTo(50);
    const calc = getFieldColorMode(FieldColorModeId.ContinuousGrYlRd).getCalculator(frames[0].fields[1], theme);
    expect(h.color).toBe(calc(0, 0.5));
  });
  it('colours a LAN half by the thresholds in percent of the display capacity', () => {
    const h = half({ a2b: { binding: qb('B') }, capacity: 1e9 });
    expect(h.percent).toBeCloseTo(70);
    expect(h.color).toBe(theme.visualization.getColorByName('yellow'));
    expect(h.stepIndex).toBe(1);
  });
  it('colours a half without capacity by the display colour of the raw value', () => {
    const h = half({ a2b: { binding: qb('B') } });
    expect(h.capacitySource).toBe('none');
    // 7e8 against the absolute steps: red
    expect(h.color).toBe(theme.visualization.getColorByName('red'));
  });
});

describe('shape colour and target', () => {
  it('colours a node by the thresholds of its field and keeps the series for the card', () => {
    const r = run(upShape, upFrames);
    const up = r.patches.get('pg-node~rtr-a')!.shape!;
    expect(up).toMatchObject({ status: 'ok', stepIndex: 1, target: 'icon', value: 1 });
    expect(up.color).toBe(theme.visualization.getColorByName('green'));
    expect(up.series?.labels).toEqual({ job: 'node-rtr-a' });
    expect(r.patches.get('pg-node~lte')!.shape).toMatchObject({ stepIndex: 0, text: undefined });
  });
  it('colours nothing without an explicit target, so that saved dashboards keep their look', () => {
    expect(targetOf({})).toBe('none');
    expect(targetOf({ target: 'stroke' })).toBe('stroke');
    expect(targetOf({ target: 'icon' })).toBe('icon');
    const shape = (s: DisplayConfig['shape']) =>
      run({ shape: { binding: upShape.shape!.binding, ...s } }, upFrames).patches.get('pg-node~rtr-a')!.shape!;
    expect(shape({ target: 'shape' }).target).toBe('shape');
    expect(shape({ text: true }).target).toBe('none');
    // the value, the status and the series still reach the card and the legend
    expect(shape({})).toMatchObject({ target: 'none', status: 'ok', value: 1 });
  });
  it('a text-only shape shows "no data" in grey when the series is missing', () => {
    const r = run({ shape: { binding: qb('Z'), text: true } }, upFrames);
    expect(r.patches.get('pg-node~rtr-a')!.shape).toMatchObject({
      status: 'nodata',
      text: 'no data',
      color: theme.colors.text.disabled,
      target: 'none',
    });
  });
  it('writes the label template into the text, with the value formatted by the field', () => {
    const r = run(
      { shape: { ...upShape.shape, text: true, target: 'icon' }, label: '${cell.pg-id}: ${value}' },
      upFrames
    );
    expect(r.patches.get('pg-node~rtr-a')!.shape).toMatchObject({ status: 'ok', target: 'icon', text: 'rtr-a: 1' });
  });
  it('a pattern without a binding leaves the cell without a shape state', () => {
    const r = run({ shape: { target: 'shape' } }, upFrames);
    expect(r.patches.get('pg-node~rtr-a')!.shape).toBeUndefined();
  });
});

describe('display url', () => {
  const hostCell = cellMetaFromAttrs(
    'h1',
    { host: 'a&b=c d/e', evil: 'javascript:alert(1)', 'pg-kind': 'node', 'pg-id': 'h1' },
    false,
    'Host'
  );
  const urlOf = (url: string, urlTitle?: string) => run({ url, urlTitle }, [], [hostCell]);
  it('percent-encodes the template values', () => {
    expect(urlOf('/d/x?var-host=${cell.host}').patches.get('h1')!.urls[0].url).toBe('/d/x?var-host=a%26b%3Dc%20d%2Fe');
    expect(urlOf('https://g/d/${cell.host}?x=${__url_time_range}').patches.get('h1')!.urls[0].url).toBe(
      'https://g/d/a%26b%3Dc%20d%2Fe?x=${__url_time_range}'
    );
    expect(urlOf('${cell.evil}').patches.get('h1')!.urls[0].url).toBe('javascript%3Aalert(1)');
  });
  it('drops a url with a scheme other than http or https, with a diagnostic', () => {
    for (const bad of [
      'javascript:alert(${cell.pg-id})',
      ' JavaScript:alert(1)',
      'java\tscript:x',
      'data:text/html,x',
    ]) {
      const r = urlOf(bad);
      expect(r.patches.get('h1')!.urls).toEqual([]);
      expect(r.diagnostics).toEqual([expect.objectContaining({ code: 'invalid-url', path: 'cells.h1.url' })]);
    }
    for (const ok of ['http://a/b', 'HTTPS://a/b', '/d/x', 'd/x', '?a=1', '//host/x']) {
      expect(urlOf(ok).patches.get('h1')!.urls[0].url).toBe(ok);
    }
  });
  it('resolves urlTitle as a template; a title that does not resolve gives the default', () => {
    expect(urlOf('/d/x', 'Host ${cell.host}').patches.get('h1')!.urls[0]).toEqual({
      title: 'Host a&b=c d/e',
      url: '/d/x',
    });
    expect(urlOf('/d/x', 'Host ${cell.nope}').patches.get('h1')!.urls[0]).toEqual({ url: '/d/x' });
  });
  it('does not expand a dashboard variable that a metadata value brings into urlTitle', () => {
    const dollar = cellMetaFromAttrs('d1', { host: 'Switch ${env}', 'pg-kind': 'node', 'pg-id': 'd1' }, false, 'D');
    const patch = run({ url: '/d/x', urlTitle: '${cell.host} in ${env}' }, [], [dollar]).patches.get('d1')!;
    const links = resolveLinks(patch, primaryOf(patch), (t) => t.replace(/\$\{env\}/g, 'production'), 'D');
    // the variable of the author template expands once; the value of the cell stays as it is
    expect(links[0].title).toBe('Switch ${env} in production');
  });
});

describe('the capacity text in the unit of the field', () => {
  // the display processor of the field, as the panel has it
  const real: BindContext = { ...ctx, display: (series, value) => fieldDisplay(series.field, theme)(value) };
  const linkCell = cellMetaFromAttrs(
    'pg-link~a:eth0->b:eth1',
    { 'pg-kind': 'link', 'pg-id': 'a:eth0->b:eth1', 'pg-from': 'a:eth0', 'pg-to': 'b:eth1' },
    true
  );
  const one = (config: Field['config'], value: number, capacity: number) => {
    const frames = [frame('T', { job: 'node-a', device: 'eth0' }, [value], config)];
    return run({ link: { a2b: { binding: qb('T') }, capacity } }, frames, [linkCell], real).patches.get(linkCell.id)!
      .link!.a2b!;
  };
  it('bps: "41 Mb/s · 41% of 100 Mb/s", the capacity formatted once', () => {
    const h = one({ unit: 'bps' }, 41e6, 1e8);
    expect(h.label).toMatch(/^41(\.0)? Mb\/s · 41% of 100 Mb\/s$/);
    expect(formattedValueToString(h.capacityDisplay!)).toBe('100 Mb/s');
  });
  it('the capacity takes automatic decimals, not the decimals of the value field', () => {
    const h = one({ unit: 'bps', decimals: 1 }, 41e6, 1e8);
    expect(h.label).toBe('41.0 Mb/s · 41% of 100 Mb/s');
    expect(formattedValueToString(h.capacityDisplay!)).toBe('100 Mb/s');
    const cubic = one({ unit: 'm3', decimals: 3 }, 2.05, 4.1);
    expect(cubic.label).toBe('2.050 m³ · 50% of 4.1 m³');
  });
  it('Bps: a capacity of 1 Gb/s shows as 125 MB/s; the percent does not change', () => {
    const h = one({ unit: 'Bps' }, 12.5e6, 1e9);
    expect(h.percent).toBeCloseTo(10);
    expect(h.label).toMatch(/of 125 MB\/s$/);
  });
  it('a unit that is not a data rate: the raw value against the raw capacity, shown in that unit', () => {
    const h = one({ unit: 'm3' }, 2.05, 4.1);
    expect(h.percent).toBeCloseTo(50);
    expect(h.label).toMatch(/of 4\.1\d* m³$/);
  });
  it('no data stays grey without a percent; no capacity gives no percent and no capacity text', () => {
    const nodata = run({ link: { a2b: { binding: qb('T') }, capacity: 1e8 } }, [], [linkCell], real).patches.get(
      linkCell.id
    )!.link!.a2b!;
    expect(nodata).toMatchObject({ status: 'nodata', label: 'no data', capacity: 1e8 });
    expect(nodata.percent).toBeUndefined();
    expect(nodata.capacityDisplay).toBeUndefined();
    const frames = [frame('T', { job: 'node-a', device: 'eth0' }, [41e6], { unit: 'bps' })];
    const free = run({ link: { a2b: { binding: qb('T') } } }, frames, [linkCell], real).patches.get(linkCell.id)!.link!
      .a2b!;
    expect(free).toMatchObject({ status: 'ok', capacitySource: 'none' });
    expect(free.percent).toBeUndefined();
    expect(free.capacityDisplay).toBeUndefined();
    expect(free.label).toMatch(/^41(\.0)? Mb\/s$/);
  });
});

describe('historySeries', () => {
  const model = () => {
    const value = toHistory(
      {
        state: 'ready',
        fetchedAt: 0,
        fromCache: false,
        frames: [
          {
            length: 4,
            fields: [
              { name: 'Time', type: FieldType.time, config: {}, values: [1000, 2000, 3000, 4000] },
              { name: 'Value', type: FieldType.number, config: {}, labels: { job: 'a' }, values: [1, null, 3, 4] },
            ],
          },
        ],
      },
      queryBinding
    );
    if (value.state !== 'ready') {
      throw new Error('expected ready');
    }
    return value;
  };
  it('gives the same SeriesInfo object twice for one model and one query', () => {
    const m = model();
    const first = historySeries(m, queryBinding);
    expect(historySeries(m, queryBinding)).toBe(first);
    expect(historySeries(m, { ...queryBinding, queryId: 'other' })).not.toBe(first);
    expect(historySeries(model(), queryBinding)).not.toBe(first);
  });
  it('leaves a null gap out of the values and the times', () => {
    const series = historySeries(model(), queryBinding);
    expect(series.values).toEqual([1, 3, 4]);
    expect(series.times).toEqual([1000, 3000, 4000]);
    expect(series).toMatchObject({ refId: 'health', name: 'Value', labels: { job: 'a' } });
    expect(series.frame.length).toBe(4);
  });
});
