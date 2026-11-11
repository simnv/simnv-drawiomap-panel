import { act, renderHook } from '@testing-library/react';
import {
  CoreApp,
  createTheme,
  dateTime,
  FieldType,
  LoadingState,
  type DataFrame,
  type DataQueryRequest,
  type PanelData,
  type TimeRange,
} from '@grafana/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import { bindV4 } from '../binding/bindV4';
import { bindContextFor } from '../binding/context';
import { buildCardV4 } from '../interact/cardModel';
import { REPORT_KINDS, type ReportEntry } from '../binding/report';
import { validateConfig } from '../model/validate';
import type { CellEntry, CellIndex } from '../types';
import { reportLine, useBoundDiagram, type BoundDiagramInputs } from './useBoundDiagram';

vi.mock('../binding/bindV4', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../binding/bindV4')>();
  return { ...actual, bindV4: vi.fn(actual.bindV4) };
});
vi.mock('../model/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/validate')>();
  return { ...actual, validateConfig: vi.fn(actual.validateConfig) };
});

const theme = createTheme();
const bindContext = bindContextFor({
  theme,
  replaceVariables: (text) => text,
  timeZone: 'utc',
  linkWidth: { min: 2, max: 10 },
});

/** A cell index as buildCellIndex gives it: the metas after the contract, no DOM. */
function indexOf(): CellIndex {
  const metas = [cellMetaFromAttrs('node-rtr-a', { bind: 'host', key: 'node-rtr-a' }, false)];
  applyContract(metas);
  return new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
}

const sample = (at: number): DataFrame => ({
  refId: 'up',
  length: 1,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: [at] },
    { name: 'Value', type: FieldType.number, config: {}, labels: { job: 'node-rtr-a' }, values: [1] },
  ],
});

/** The data of one query `up` with one sample. A relative range ends at "now"; an absolute range ends at its date. */
function panelData(sampleAt: number, rawTo: TimeRange['raw']['to'] = dateTime(120_000)): PanelData {
  const timeRange: TimeRange = { from: dateTime(0), to: dateTime(120_000), raw: { from: dateTime(0), to: rawTo } };
  const request: DataQueryRequest = {
    requestId: 'demo',
    app: CoreApp.Dashboard,
    startTime: 120_000,
    range: timeRange,
    timezone: 'utc',
    scopedVars: {},
    interval: '1m',
    intervalMs: 60_000,
    targets: [{ refId: 'up' }],
  };
  return { state: LoadingState.Done, series: [sample(sampleAt)], timeRange, request };
}

const hostConfig = () => ({ version: 4, classes: { host: { match: { key: 'job' }, status: 'up' } } });

function inputsOf(over: Partial<BoundDiagramInputs> = {}): BoundDiagramInputs {
  return { index: indexOf(), xml: undefined, config: hostConfig(), data: panelData(60_000), bindContext, ...over };
}

beforeEach(() => {
  vi.mocked(bindV4).mockClear();
  vi.mocked(validateConfig).mockClear();
});

describe('useBoundDiagram', () => {
  it('updates the card title when the XML ends change with the same index', () => {
    const metas = [
      cellMetaFromAttrs('0', { 'pg-schema': '1' }, false),
      ...['a', 'b', 'c'].map((id) =>
        cellMetaFromAttrs(id, { 'pg-kind': 'node', 'pg-id': id, label: id.toUpperCase() }, false)
      ),
      cellMetaFromAttrs(
        'l',
        { 'pg-kind': 'link', 'pg-id': 'l', 'pg-from': 'a', 'pg-to': 'b', bind: 'lan', key: 'node-rtr-a', cap: '1G' },
        true
      ),
    ];
    applyContract(metas);
    const index: CellIndex = new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
    const xml = (target: string) =>
      `<mxGraphModel><root><mxCell id="l" edge="1" source="a" target="${target}"/></root></mxGraphModel>`;
    const fixed = inputsOf({
      index,
      xml: xml('b'),
      config: { version: 4, classes: { lan: { match: { key: 'job' }, up: 'up' } } },
    });
    const { result, rerender } = renderHook((inputs: BoundDiagramInputs) => useBoundDiagram(inputs), {
      initialProps: fixed,
    });
    expect(buildCardV4('l', result.current.bound, result.current.cardContext).title).toBe('A ↔ B');
    rerender({ ...fixed, xml: xml('c') });
    expect(buildCardV4('l', result.current.bound, result.current.cardContext).title).toBe('A ↔ C');
  });

  it('binds a cell of a valid config and gives a patch with a status view', () => {
    const inputs = inputsOf();
    const { result } = renderHook(() => useBoundDiagram(inputs));
    expect(result.current.validated.report).toEqual([]);
    expect(result.current.bound.report).toEqual([]);
    expect([...result.current.patches.keys()]).toEqual(['node-rtr-a']);
    expect(result.current.patches.get('node-rtr-a')?.statusView).toMatchObject({ state: 'normal' });
    expect(result.current.cardContext.index).toBeDefined();
  });

  it('runs the bind once for equal inputs, and again for a new config object', () => {
    const fixed = inputsOf();
    const { result, rerender } = renderHook((inputs: BoundDiagramInputs) => useBoundDiagram(inputs), {
      initialProps: fixed,
    });
    expect(bindV4).toHaveBeenCalledTimes(1);
    expect(validateConfig).toHaveBeenCalledTimes(1);
    const first = result.current;

    rerender({ ...fixed });
    expect(bindV4).toHaveBeenCalledTimes(1);
    expect(validateConfig).toHaveBeenCalledTimes(1);
    expect(result.current.bound).toBe(first.bound);
    expect(result.current.patches).toBe(first.patches);

    rerender({ ...fixed, config: hostConfig() });
    expect(validateConfig).toHaveBeenCalledTimes(2);
    expect(bindV4).toHaveBeenCalledTimes(2);
    expect(result.current.bound).not.toBe(first.bound);
  });

  describe('on a relative time range', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('turns a status stale after its deadline with no new bind', () => {
      // the sample is at 0 and the interval is 60 s: the "3x" deadline is 180 s
      const inputs = inputsOf({ data: panelData(0, 'now') });
      const { result } = renderHook(() => useBoundDiagram(inputs));
      expect(result.current.bound.deadlines).toEqual([180_000]);
      expect(result.current.patches.get('node-rtr-a')?.statusView).toMatchObject({ state: 'normal' });
      const before = result.current.bound;

      act(() => {
        vi.advanceTimersByTime(100_000);
      });
      const patch = result.current.patches.get('node-rtr-a');
      expect(patch?.statusView).toMatchObject({ state: 'stale' });
      expect(patch?.statusV4).toMatchObject({ state: 'stale' });
      // the bind patch stays as it was
      expect(result.current.bound).toBe(before);
      expect(result.current.bound.patches.get('node-rtr-a')?.statusView).toMatchObject({ state: 'normal' });
      expect(bindV4).toHaveBeenCalledTimes(1);
    });
  });

  it('gives one outdated-config entry and no patch for a config of version 3', () => {
    const inputs = inputsOf({ config: { version: 3, queries: [] } });
    const { result } = renderHook(() => useBoundDiagram(inputs));
    expect(result.current.validated.report).toEqual([{ kind: 'outdated-config', version: 3 }]);
    expect(result.current.bound.report.filter((entry) => entry.kind === 'outdated-config')).toHaveLength(1);
    expect(result.current.patches.size).toBe(0);
  });
});

describe('reportLine', () => {
  const samples: Record<ReportEntry['kind'], ReportEntry> = {
    'unmeasured-link': { kind: 'unmeasured-link', cls: 'link', attrs: ['key', 'port'], cellIds: ['l'] },
    'end-ambiguous': { kind: 'end-ambiguous', cls: 'link', cellIds: ['l'] },
    schema: { kind: 'schema', path: 'classes.host', message: 'Unknown key' },
    yaml: { kind: 'yaml', line: 3, message: 'Bad indent' },
    'outdated-config': { kind: 'outdated-config', version: 3 },
    'class-no-match': { kind: 'class-no-match', cls: 'base', cellIds: ['node-rtr-a'] },
    'class-cycle': { kind: 'class-cycle', cls: 'host' },
    'class-unknown-parent': { kind: 'class-unknown-parent', cls: 'host' },
    'class-invalid-parent': { kind: 'class-invalid-parent', cls: 'host' },
    'unknown-ref': { kind: 'unknown-ref', cls: 'host', path: 'classes.host.status', refId: 'up' },
    'unknown-class': { kind: 'unknown-class', cellIds: ['node-rtr-a'], bind: 'nope' },
    'unknown-override': { kind: 'unknown-override', cellId: 'node-rtr-a' },
    'missing-attr': {
      kind: 'missing-attr',
      cls: 'host',
      path: 'classes.host.match',
      attr: 'job',
      cellIds: ['node-rtr-a'],
    },
    'matcher-error': {
      kind: 'matcher-error',
      cls: 'host',
      path: 'classes.host.match',
      text: '/(/',
      message: 'Bad pattern',
      cellIds: ['node-rtr-a'],
    },
    'template-unresolved': {
      kind: 'template-unresolved',
      cls: 'host',
      path: 'classes.host.url',
      cellIds: ['node-rtr-a'],
    },
    'query-unavailable': { kind: 'query-unavailable', refId: 'up', state: 'error', message: 'Timeout' },
    'no-series': { kind: 'no-series', cls: 'host', use: 'status', cellIds: ['node-rtr-a'] },
    'many-series': { kind: 'many-series', cls: 'host', use: 'status', cells: [{ id: 'node-rtr-a', count: 2 }] },
    'orphan-series': { kind: 'orphan-series', refId: 'up', labels: [{ job: 'wan1' }], more: 0 },
    'many-fields': { kind: 'many-fields', refId: 'up', message: 'Two value fields' },
    'invalid-series': { kind: 'invalid-series', refId: 'up', message: 'No time field' },
    'duplicate-series': { kind: 'duplicate-series', refId: 'up', labels: { job: 'wan1' } },
    'unit-mismatch': {
      kind: 'unit-mismatch',
      cls: 'link',
      use: 'status',
      units: ['bps', 's'],
      cellIds: ['node-rtr-a'],
    },
    'capacity-fallback': { kind: 'capacity-fallback', cls: 'link', reason: 'No unit', cellIds: ['node-rtr-a'] },
    'bad-cap': { kind: 'bad-cap', attr: 'cap', value: 'fast', cellIds: ['node-rtr-a'] },
    'cap-conflict': { kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['node-rtr-a'] },
    'no-edge-ends': { kind: 'no-edge-ends', reason: 'compressed page', cellIds: ['node-rtr-a'] },
    'unused-field': { kind: 'unused-field', cls: 'host', field: 'up', cellIds: ['node-rtr-a'] },
    'class-no-cells': { kind: 'class-no-cells', cls: 'host' },
  };

  it.each(REPORT_KINDS)('gives one non-empty line for the kind %s', (kind) => {
    const line = reportLine(samples[kind]);
    expect(line.trim()).not.toBe('');
    expect(line).not.toContain('\n');
  });

  it('names the attribute that does not parse in bad-cap', () => {
    expect(reportLine({ kind: 'bad-cap', attr: 'capacity', value: 'abc', cellIds: ['l'] })).toBe(
      'capacity "abc" is not a capacity (1 cell)'
    );
    expect(reportLine({ kind: 'bad-cap', attr: 'cap', value: 'abc', cellIds: ['l'] })).toBe(
      'cap "abc" is not a capacity (1 cell)'
    );
  });

  it('words cap-conflict as attribute precedence only, also when a series wins', () => {
    expect(reportLine({ kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['l'] })).toBe(
      'cap "1G" and capacity "2G" differ, cap wins over the attribute capacity (1 cell)'
    );
  });

  it('has a sample for each report kind', () => {
    expect(Object.keys(samples).sort()).toEqual([...REPORT_KINDS].sort());
  });
});
