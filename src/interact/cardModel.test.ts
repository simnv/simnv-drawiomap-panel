import { describe, expect, it, vi } from 'vitest';
import { createTheme, Field, FieldType, LinkModel, ThresholdsMode } from '@grafana/data';
import type { CellPatch, SeriesInfo } from '../types';
import { buildConfiguredCard, CardContext, chartHeight, opensCard, SPARK_HEIGHT } from './cardModel';
import type { PlanCellPatch } from '../binding/engine';
import type { QueryBinding } from '../model/config';
import { type HistoryModel, toHistory } from '../query/frames';
import type { StatusView } from '../binding/status';

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
const up = mk('C', { job: 'node-rtr-a' }, [1, 1]);

const ctx: CardContext = {
  theme,
  replaceVariables: (s) => s.replace('${__from}', '111'),
};

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
  ...over,
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
    titled.scope.cellTitle = 'Switch-A p9';
    const read = () => {
      throw new Error('unused');
    };
    expect(buildConfiguredCard(titled, read, ctx, false).title).toBe('Switch-A p9');
    expect(buildConfiguredCard({ ...titled, hover: { title: 'Port ${cellTitle}', rows: [] } }, read, ctx).title).toBe(
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
  it('shows the status state and its reason first, before the hover rows, only when the state is not normal', () => {
    const status = (state: StatusView['state'], reason: string): StatusView => ({
      state,
      reason,
      conditionKey: 'k',
      queryIds: ['health'],
      coverage: { available: 1, expected: 1 },
    });
    const read = () => ({ state: 'empty' }) as HistoryModel;
    const down = buildConfiguredCard({ ...patch(), statusView: status('warning', 'probe delay ≥ 400 ms') }, read, ctx);
    expect(down.rows[0]).toMatchObject({ key: 'status', kind: 'status', title: 'warning', text: 'probe delay ≥ 400 ms' });
    // the hover rows follow (the drilldown row is a footer link, not a row)
    expect(down.rows.slice(1).map((r) => r.key)).toEqual(['row-0', 'row-1', 'row-2']);
    for (const state of ['down', 'critical', 'warning', 'stale', 'missing'] as const) {
      const card = buildConfiguredCard({ ...patch(), statusView: status(state, 'why') }, read, ctx);
      expect(card.rows[0]).toMatchObject({ kind: 'status', title: state, text: 'why' });
    }
    // a normal status adds no row to a card with hover rows
    const normal = buildConfiguredCard({ ...patch(), statusView: status('normal', 'Healthy') }, read, ctx);
    expect(normal.rows.map((r) => r.key)).toEqual(buildConfiguredCard(patch(), read, ctx).rows.map((r) => r.key));
    expect(normal.rows.some((r) => r.kind === 'status')).toBe(false);
    // a normal status on a cell with no hover rows: the one status row, as before
    const normalOnly = buildConfiguredCard({ ...nodePatch(), statusView: status('normal', 'Healthy') }, read, ctx);
    expect(normalOnly.rows.map((r) => [r.kind, r.title, r.text])).toEqual([['status', 'normal', 'Healthy']]);
    expect(buildConfiguredCard(patch(), read, ctx).rows.some((r) => r.kind === 'status')).toBe(false);
    // a status-only cell: the one row, as before
    const only = buildConfiguredCard({ ...nodePatch(), statusView: status('down', 'Device down') }, read, ctx);
    expect(only.rows.map((r) => [r.kind, r.title, r.text])).toEqual([['status', 'down', 'Device down']]);
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
      { ...nodePatch(), hover: { rows: [{ kind: 'combined', label: 'Traffic', series: both, ...row } as any] } },
      (_, b) => models[b.queryId] ?? { state: 'loading' },
      ctx
    );
  const models = () => ({ tx: history('tx', [5e6, 8.2e6]), rx: history('rx', [2e6, 1.1e6]) });

  it('shows both current values and draws down mirrored below zero in a symmetric domain', () => {
    const c = card({}, models());
    expect(c.rows).toHaveLength(1);
    const row = c.rows[0];
    expect(row).toMatchObject({ kind: 'combined', title: 'Traffic', state: 'ready' });
    // the largest value of both directions with 10% headroom
    expect(row.domain![0]).toBeCloseTo(-9.02e6);
    expect(row.domain![1]).toBeCloseTo(9.02e6);
    expect(row.text).toBe('↑ 8.20 Mb/s  ↓ 1.10 Mb/s');
    expect(row.directions!.map((d) => [d.direction, d.label, d.mirrored, d.text])).toEqual([
      ['up', '↑', false, '8.20 Mb/s'],
      ['down', '↓', true, '1.10 Mb/s'],
    ]);
    expect(row.history).toBeUndefined();
    expect(c.demands.map((d) => [d.binding.queryId, d.rowIndex, d.path])).toEqual([
      ['tx', 0, 'series[0].binding'],
      ['rx', 0, 'series[1].binding'],
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
    expect(row.text).toBe('↑ 8.20 Mb/s · 8% of 100 Mb/s  ↓ 1.10 Mb/s · 1% of 100 Mb/s');
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
    expect(row.text).toBe('↑ 8.20 Mb/s · 82% of 10 Mb/s  ↓ 1.10 Mb/s');
    expect(row.domain).toEqual([-10e6, 10e6]);
  });
  it('uses the row capacity, not the field config Max, when the row has one', () => {
    const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 1e9 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
    const row = card({ capacity: 100e6, max: 'capacity' }, m).rows[0];
    expect(row.text).toBe('↑ 8.20 Mb/s · 8% of 100 Mb/s  ↓ 1.10 Mb/s · 1% of 100 Mb/s');
    expect(row.domain).toEqual([-100e6, 100e6]);
  });
  describe('template capacity (FR-1)', () => {
    const tpl = (attrs: Record<string, string>, row: Record<string, unknown>, m: ReturnType<typeof models>) =>
      buildConfiguredCard(
        {
          ...nodePatch({ scope: { cell: { key: 'rtr-a', ...attrs } } }),
          hover: { rows: [{ kind: 'combined', label: 'Traffic', series: both, ...row } as any] },
        },
        (_, b) => m[b.queryId as 'tx' | 'rx'],
        ctx
      );
    it('resolves a template against the cell scope, in bit/s', () => {
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}' }, models());
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 8% of 100 Mb/s  ↓ 1.10 Mb/s · 1% of 100 Mb/s');
      expect(c.diagnostics).toEqual([]);
    });
    it('converts the bit/s of a template to the unit of the values', () => {
      // 100 Mb/s are 12.5 MB/s; 1.25 MB/s is 10%
      const m = { tx: history('tx', [1.25e6], { unit: 'Bps' }), rx: history('rx', [0.125e6], { unit: 'Bps' }) };
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}', max: 'capacity' }, m);
      expect(c.rows[0].directions!.map((d) => d.text.split(' · ')[1])).toEqual(['10% of 12.5 MB/s', '1% of 12.5 MB/s']);
      expect(c.rows[0].domain).toEqual([-12.5e6, 12.5e6]);
    });
    it('prefers the resolved template to the field config Max', () => {
      const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 10e6 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
      const c = tpl({ capacity_bps: '100000000' }, { capacity: '${cell.capacity_bps}', max: 'capacity' }, m);
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 8% of 100 Mb/s  ↓ 1.10 Mb/s · 1% of 100 Mb/s');
      expect(c.rows[0].domain).toEqual([-100e6, 100e6]);
    });
    it('falls to the field Max and adds a diagnostic when the template does not resolve', () => {
      // the chain of a link half: a failed source reports and the next source applies
      const m = { tx: history('tx', [8.2e6], { unit: 'bps', max: 10e6 }), rx: history('rx', [1.1e6], { unit: 'bps' }) };
      const c = tpl({}, { capacity: '${cell.capacity_bps}' }, m);
      expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 82% of 10 Mb/s  ↓ 1.10 Mb/s');
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
                kind: 'combined',
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
      expect(c.rows[0].text).toBe('↑ 8 Mb/s · 8% of 100 Mb/s  ↓ 8 Mb/s · 80% of 10 Mb/s');
      expect(c.rows[0].directions!.map((d) => d.color)).toEqual([
        theme.visualization.getColorByName('green'),
        theme.visualization.getColorByName('red'),
      ]);
      expect(c.diagnostics).toEqual([]);
    });
    it('takes a number in the unit of the values', () => {
      expect(perDirection([100e6, 10e6]).rows[0].text).toBe('↑ 8 Mb/s · 8% of 100 Mb/s  ↓ 8 Mb/s · 80% of 10 Mb/s');
    });
    it('prefers the capacity of the direction to the capacity of the row', () => {
      expect(perDirection([undefined, '${cell.cap_b2a}'], { capacity: 100e6 }).rows[0].text).toBe(
        '↑ 8 Mb/s · 8% of 100 Mb/s  ↓ 8 Mb/s · 80% of 10 Mb/s'
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
      expect(c.rows[0].text).toBe('↑ 8 Mb/s · 8% of 100 Mb/s  ↓ 8 Mb/s');
      expect(c.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ['unresolved-metadata', `cells.${nodePatch().cellId}.hover.rows[0].series[1].capacity`],
      ]);
    });
    it('falls to the row capacity for a direction whose own capacity fails, and reports the failed source', () => {
      const c = perDirection([undefined, '${cell.nothing}'], { capacity: 100e6 });
      expect(c.rows[0].text).toBe('↑ 8 Mb/s · 8% of 100 Mb/s  ↓ 8 Mb/s · 8% of 100 Mb/s');
      expect(c.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ['unresolved-metadata', `cells.${nodePatch().cellId}.hover.rows[0].series[1].capacity`],
      ]);
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
        hover: { rows: [{ kind: 'combined', label: 'Traffic', series: both, capacity: 100e6 }] },
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
        hover: { rows: [{ kind: 'combined', label: 'Traffic', series: both }] },
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
  it('a numeric row capacity keeps the unit of the values: 12.5 MB/s of Bps values', () => {
    const m = { tx: history('tx', [1.25e6], { unit: 'Bps' }), rx: history('rx', [0.125e6], { unit: 'Bps' }) };
    const row = card({ capacity: 12.5e6, max: 'capacity' }, m).rows[0];
    expect(row.directions!.map((d) => d.text.split(' · ')[1])).toEqual(['10% of 12.5 MB/s', '1% of 12.5 MB/s']);
    expect(row.domain).toEqual([-12.5e6, 12.5e6]);
  });
  it('a capacity series on the row or on a direction wins over the row number; it is read once and demanded', () => {
    const capB = { queryId: 'cap', match: {}, reducer: 'last' as const };
    const m = { ...models(), cap: history('cap', [50e6]) };
    const c = card({ capacity: 100e6, capacityBinding: capB }, m);
    expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 16% of 50 Mb/s  ↓ 1.10 Mb/s · 2% of 50 Mb/s');
    // its own consumer: the place in the row tells the value and the capacity of one row apart
    expect(c.demands.filter((d) => d.binding.queryId === 'cap').map((d) => [d.rowIndex, d.path])).toEqual([
      [0, 'capacityBinding'],
    ]);
    expect(c.diagnostics).toEqual([]);
    const own = card({ capacity: 100e6, series: [{ ...both[0], capacityBinding: capB }, both[1]] }, m);
    expect(own.rows[0].text).toBe('↑ 8.20 Mb/s · 16% of 50 Mb/s  ↓ 1.10 Mb/s · 1% of 100 Mb/s');
  });
  it('a capacity series that is not usable for the cell falls to the row number without a second report', () => {
    const capB = { queryId: 'cap', match: {}, reducer: 'last' as const };
    const c = buildConfiguredCard(
      {
        ...nodePatch(),
        bindings: [txB, rxB],
        hover: { rows: [{ kind: 'combined', label: 'Traffic', series: both, capacity: 100e6, capacityBinding: capB }] },
      },
      (_, b) => models()[b.queryId as 'tx' | 'rx'],
      ctx
    );
    expect(c.rows[0].text).toBe('↑ 8.20 Mb/s · 8% of 100 Mb/s  ↓ 1.10 Mb/s · 1% of 100 Mb/s');
    // the plan reported the unusable query at hover.rows[0].capacityBinding.queryId when it left it out of the bindings
    expect(c.diagnostics).toEqual([]);
    expect(c.demands.map((d) => d.binding.queryId)).toEqual(['tx', 'rx']);
  });
  it('a row with an invalid range or freshness is unsupported with the text and demands nothing', () => {
    const bounds = card({ min: 10, max: 1 }, models());
    expect(bounds.rows[0]).toMatchObject({ state: 'unsupported', text: 'Invalid range' });
    expect(bounds.demands).toEqual([]);
    const fresh = card({ freshness: { expectedIntervalMs: 1000, staleAfterMs: 10 } }, models());
    expect(fresh.rows[0]).toMatchObject({ state: 'unsupported', text: 'Invalid freshness policy' });
    expect(fresh.demands).toEqual([]);
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
    expect(opensCard(bare({ hover: { rows: [{ kind: 'metadata', label: 'Device', path: 'cell.key' }] } }), ctx)).toBe(
      true
    );
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
        ctx
      )
    ).toBe(true);
    expect(opensCard(bare({ urls: [{ url: '/d/x' }] }), ctx)).toBe(true);
  });
  it('is false for a configured cell that only colours, has no rows or turns the card off', () => {
    expect(opensCard(bare({ shape: state }), ctx)).toBe(false);
    expect(opensCard(bare({ hover: { rows: [] } }), ctx)).toBe(false);
    expect(
      opensCard(
        bare({
          urls: [{ url: '/d/x' }],
          hover: { enabled: false, rows: [{ kind: 'metadata', label: 'D', path: 'cell.key' }] },
        }),
        ctx
      )
    ).toBe(false);
  });
  it('ignores a drilldown row whose url is not allowed', () => {
    expect(
      opensCard(bare({ hover: { rows: [{ kind: 'drilldown', label: 'Go', url: 'javascript:alert(1)' }] } }), ctx)
    ).toBe(false);
    expect(opensCard(bare({ hover: { rows: [{ kind: 'drilldown', label: 'Go', url: '/d/${cell.key}' }] } }), ctx)).toBe(
      true
    );
  });
  it('resolves a drilldown url with the labels of the series that the cell shows', () => {
    const labelled = { ...up, labels: { host: 'router' }, field: { ...up.field, getLinks: undefined } };
    const row = { kind: 'drilldown' as const, label: 'Go', url: '/d/x?host=${labels.host}' };
    expect(opensCard(bare({ hover: { rows: [row] }, shape: { ...state, series: labelled } }), ctx)).toBe(true);
  });
  it('is true for a cell whose series has data links', () => {
    expect(opensCard(bare({ shape: { ...state, series: up } }), ctx)).toBe(true);
  });
});
