import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  type DataFrame,
  type DataQueryRequest,
  type FieldConfig,
  type Labels,
  type PanelData,
  type TimeRange,
} from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import { bindContextFor } from '../binding/context';
import { bindV4 } from '../binding/bindV4';
import { validateConfig } from '../model/validate';
import type { CellEntry, CellIndex, CellMeta } from '../types';
import { buildCardV4, lineTooltipV4, MAX_LINES, type CardContextV4, type HistoryRowV4 } from './cardModel';

const theme = createTheme();
const bindCtx = bindContextFor({ theme, replaceVariables: (s) => s, timeZone: 'utc', linkWidth: { min: 2, max: 10 } });
const T = [0, 60_000, 120_000];
const palette = (i: number) => theme.visualization.getColorByName(theme.visualization.palette[i]);

type Cell = [id: string, attrs: Record<string, string>, isEdge?: boolean];

function indexOf(cells: Cell[]): CellIndex {
  const metas: CellMeta[] = cells.map(([id, attrs, isEdge]) => cellMetaFromAttrs(id, attrs, isEdge ?? false));
  applyContract(metas);
  return new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
}

function frame(
  refId: string,
  labels: Labels,
  values: Array<number | null> = [1],
  config: FieldConfig = {},
  times = T.slice(T.length - values.length)
): DataFrame {
  return {
    refId,
    length: values.length,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: times },
      { name: 'Value', type: FieldType.number, config, labels, values },
    ],
  };
}

const range = (rawTo: TimeRange['raw']['to'] = dateTime(120_000)): TimeRange => ({
  from: dateTime(0),
  to: dateTime(120_000),
  raw: { from: dateTime(0), to: rawTo },
});

function panelData(series: DataFrame[], timeRange = range()): PanelData {
  const refIds = [...new Set(series.map((f) => f.refId!))];
  const request: DataQueryRequest = {
    requestId: 'demo',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range: timeRange,
    timezone: 'utc',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: refIds.map((refId) => ({ refId })),
  };
  return { state: LoadingState.Done, series, timeRange, request };
}

/** Bind the config and build the card of the cell `ap`. */
function card(classes: Record<string, unknown>, frames: DataFrame[], timeRange?: TimeRange) {
  const index = indexOf([['ap', { bind: 'ap', key: 'ap-1', label: 'AP 1' }]]);
  const validated = validateConfig({ version: 4, classes });
  const data = panelData(frames, timeRange);
  const bound = bindV4({ index, validated, data, ctx: bindCtx });
  const ctx: CardContextV4 = { theme, replaceVariables: (s) => s, index, validated, data };
  return buildCardV4('ap', bound, ctx);
}

const historyRow = (model: ReturnType<typeof card>, i = 0) => {
  const row = model.rows.filter((r) => r.kind === 'history')[i];
  expect(row).toBeDefined();
  return row as HistoryRowV4;
};

const clients = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  ap: { match: { key: 'job' }, rows, ...extra },
});
const ssidFrames = (n: number, values: (i: number) => Array<number | null> = (i) => [i, i + 1, i + 2]) =>
  Array.from({ length: n }, (_, i) => frame('clients', { job: 'ap-1', ssid: `s${i}` }, values(i)));

describe('buildCardV4: N lines (spec 3.7)', () => {
  it('draws 8 of 9 series and gives "+1 more"', () => {
    const row = historyRow(card(clients([{ kind: 'history', query: 'clients' }]), ssidFrames(9)));
    expect(MAX_LINES).toBe(8);
    expect(row.lines).toHaveLength(8);
    expect(row.more).toBe(1);
    expect(row.lines.map((l) => l.label)).toEqual(Array.from({ length: 8 }, (_, i) => `{job="ap-1", ssid="s${i}"}`));
    expect(row.lines.map((l) => l.color)).toEqual(Array.from({ length: 8 }, (_, i) => palette(i)));
  });

  it('keeps the colour and the label of each line after a frame reorder', () => {
    const cfg = clients([{ kind: 'history', query: 'clients' }]);
    const frames = ssidFrames(4);
    const a = historyRow(card(cfg, frames));
    const b = historyRow(card(cfg, [...frames].reverse()));
    const pairs = (row: HistoryRowV4) => row.lines.map((l) => [l.label, l.color, l.values]);
    expect(pairs(b)).toEqual(pairs(a));
  });

  it('keeps the slot of a series with no finite value and shows "no data" for it in the tooltip model', () => {
    const frames = [
      frame('clients', { job: 'ap-1', ssid: 'a' }, [1, 2, 3]),
      frame('clients', { job: 'ap-1', ssid: 'b' }, [null, null, null]),
      frame('clients', { job: 'ap-1', ssid: 'c' }, [4, 5, 6]),
    ];
    const row = historyRow(card(clients([{ kind: 'history', query: 'clients' }]), frames));
    expect(row.lines.map((l) => [l.label, l.color, l.noData])).toEqual([
      ['{job="ap-1", ssid="a"}', palette(0), false],
      ['{job="ap-1", ssid="b"}', palette(1), true],
      ['{job="ap-1", ssid="c"}', palette(2), false],
    ]);
    expect(lineTooltipV4(row, 120_000)).toEqual({
      time: 120_000,
      list: [
        { label: '{job="ap-1", ssid="a"}', color: palette(0), value: '3' },
        { label: '{job="ap-1", ssid="b"}', color: palette(1), value: 'no data' },
        { label: '{job="ap-1", ssid="c"}', color: palette(2), value: '6' },
      ],
      more: 0,
    });
  });

  it('shares one Y range: lines at 49 and 51 give [0, 51]; min auto gives [47.45, 52.55] (R8)', () => {
    const frames = [
      frame('clients', { job: 'ap-1', ssid: 'a' }, [49, 49, 49]),
      frame('clients', { job: 'ap-1', ssid: 'b' }, [51, 51, 51]),
    ];
    expect(historyRow(card(clients([{ kind: 'history', query: 'clients' }]), frames)).domain).toEqual([0, 51]);
    const [lo, hi] = historyRow(card(clients([{ kind: 'history', query: 'clients', min: 'auto' }]), frames)).domain;
    expect(lo).toBeCloseTo(47.45);
    expect(hi).toBeCloseTo(52.55);
  });

  it('takes the row max and the field Min and Max into the shared range', () => {
    const frames = [frame('clients', { job: 'ap-1', ssid: 'a' }, [10, 20, 30], { min: 5, max: 60 })];
    expect(historyRow(card(clients([{ kind: 'history', query: 'clients' }]), frames)).domain).toEqual([5, 60]);
    expect(historyRow(card(clients([{ kind: 'history', query: 'clients', max: 80 }]), frames)).domain).toEqual([5, 80]);
  });

  it('a row unit or decimals builds a new display processor', () => {
    const frames = [frame('temp', { job: 'ap-1' }, [40, 41, 42.345], { unit: 'percent' })];
    const plain = card(clients([{ kind: 'value', query: 'temp' }]), frames);
    expect(plain.rows[0].text).toBe('42.3%');
    const shown = card(clients([{ kind: 'value', query: 'temp', unit: 'celsius', decimals: 2 }]), frames);
    expect(shown.rows[0].text).toBe('42.35 °C');
    const history = historyRow(
      card(clients([{ kind: 'history', query: 'temp', unit: 'celsius', decimals: 0 }]), frames)
    );
    expect(history.format?.(42.345)).toBe('42 °C');
    expect(history.text).toBe('42 °C');
  });

  it('reduces a value row across its series, and shows "Mixed units" for units that do not convert', () => {
    const frames = [
      frame('rate', { job: 'ap-1', port: '1' }, [1], { unit: 'Mbits' }),
      frame('rate', { job: 'ap-1', port: '2' }, [500], { unit: 'Kbits' }),
    ];
    expect(card(clients([{ kind: 'value', query: 'rate' }]), frames).rows[0].text).toBe('1.50 Mb/s');
    const mixed = [
      frame('rate', { job: 'ap-1', port: '1' }, [1], { unit: 'celsius' }),
      frame('rate', { job: 'ap-1', port: '2' }, [2], { unit: 'percent' }),
    ];
    expect(card(clients([{ kind: 'value', query: 'rate' }]), mixed).rows[0].text).toBe('Mixed units');
  });

  it('an updown row with N series reduces per timestamp; a missing member is a gap', () => {
    const frames = [
      frame('tx', { job: 'ap-1', port: '1' }, [1, 2, null], { unit: 'bps' }),
      frame('tx', { job: 'ap-1', port: '2' }, [3, 4, 5], { unit: 'bps' }),
      frame('rx', { job: 'ap-1', port: '1' }, [7, 8, 9], { unit: 'bps' }),
    ];
    const model = card(clients([{ kind: 'updown', up: 'tx', down: 'rx' }]), frames);
    const row = model.rows[0];
    expect(row.kind).toBe('updown');
    const [up, down] = row.directions!;
    expect([up.direction, up.mirrored, down.direction, down.mirrored]).toEqual(['up', false, 'down', true]);
    expect(up.history.state === 'ready' && [...up.history.values]).toEqual([4, 6, null]);
    expect(down.history.state === 'ready' && [...down.history.values]).toEqual([7, 8, 9]);
    // one shared scale for both directions
    expect(row.domain![0]).toBeCloseTo(-9.9);
    expect(row.domain![1]).toBeCloseTo(9.9);
  });

  it('the pinned tooltip model lists all drawn lines at the hovered time, then "+N more"', () => {
    const row = historyRow(card(clients([{ kind: 'history', query: 'clients' }]), ssidFrames(10)));
    const tip = lineTooltipV4(row, 61_000)!;
    expect(tip.time).toBe(60_000);
    expect(tip.list.map((r) => r.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(tip.list.map((r) => r.color)).toEqual(row.lines.map((l) => l.color));
    expect(tip.more).toBe(2);
  });

  it('a row whose series are stale shows stale (spec 3.5 step 6)', () => {
    const frames = [frame('clients', { job: 'ap-1', ssid: 'a' }, [5], {}, [0])];
    const cfg = clients(
      [
        { kind: 'history', query: 'clients' },
        { kind: 'value', query: 'clients' },
      ],
      {
        freshness: '1m',
      }
    );
    // an absolute range: the age at the end of the range decides
    const absolute = card(cfg, frames);
    expect(absolute.rows.map((r) => r.stale)).toEqual([true, true]);
    // a relative range: a deadline for the clock of the card, not stale yet
    const relative = card(cfg, frames, range('now'));
    expect(relative.rows.map((r) => [r.stale, r.staleAfter])).toEqual([
      [false, 60_000],
      [false, 60_000],
    ]);
    const fresh = card(cfg, [frame('clients', { job: 'ap-1', ssid: 'a' }, [5, 6, 7])]);
    expect(fresh.rows.map((r) => r.stale)).toEqual([false, false]);
  });

  it('shows "no data" for a row with zero series, and keeps the rows in the order of the class', () => {
    const model = card(
      clients([
        { kind: 'metadata', label: 'Key', text: '${key}' },
        { kind: 'history', query: 'clients' },
        { kind: 'drilldown', label: 'Open', url: '/d/ap?var-ap=${key}' },
      ]),
      [frame('clients', { job: 'other' })]
    );
    expect(model.title).toBe('AP 1');
    expect(model.rows.map((r) => [r.kind, r.title, r.text])).toEqual([
      ['metadata', 'Key', 'ap-1'],
      ['history', 'clients', 'no data'],
    ]);
    expect(historyRow(model).lines).toEqual([]);
    expect(model.links.map((l) => [l.title, l.href])).toEqual([['Open', '/d/ap?var-ap=ap-1']]);
  });

  it('a status that is not normal comes first, with its reason', () => {
    const model = card({ ap: { match: { key: 'job' }, status: 'up', rows: [{ kind: 'value', query: 'up' }] } }, [
      frame('up', { job: 'ap-1' }, [null, null, null]),
    ]);
    expect(model.rows[0]).toMatchObject({ kind: 'status', status: 'missing', text: 'No value' });
  });
});
