import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame, type PanelData } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewResolver, reportedSnapshot, type QueryPreview } from './preview';
import { createQueryController } from '../query/controller';
import { panelSnapshot } from '../query/panelSnapshot';
import type { BindingPlan } from '../binding/patterns';
import type { NamedQuery } from '../model/config';
import type { QueryContext, QuerySnapshot } from '../query/types';

const timeRange = getDefaultTimeRange();
const frame = toDataFrame({
  refId: 'A',
  fields: [{ name: 'Value', type: FieldType.number, values: [7], config: { unit: 'percent' } }],
});
const query: NamedQuery = { id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } };

describe('the reported result of a run', () => {
  const native: NamedQuery = {
    id: 'q',
    name: 'Native',
    source: { kind: 'datasource', target: { refId: 'A' }, parameters: { key: 'cell.key' } },
  };
  const context: QueryContext = {
    timeRange,
    timeZone: 'utc',
    scopedVars: {},
    intervalMs: 1000,
    refreshMs: 0,
    generation: 2,
    defaultDatasource: { uid: 'current' },
  };
  const success: QuerySnapshot = { state: 'ready', frames: [frame], fetchedAt: 1, fromCache: false };
  const result = (snapshot: QuerySnapshot): QueryPreview => ({ query: native, cellId: 'a', context, snapshot });
  const idle = { state: 'idle' };
  it('matches the default datasource by uid and type, not by the key order of its JSON', () => {
    const saved = { ...context, defaultDatasource: { uid: 'current', type: 'prometheus' } };
    const reported: QueryPreview = { query: native, cellId: 'a', context: saved, snapshot: success };
    const reordered = { defaultDatasource: { type: 'prometheus', uid: 'current' } };
    expect(reportedSnapshot(reported, native, reordered, 'a', 2)).toBe(success);
    const other = { defaultDatasource: { uid: 'current', type: 'loki' } };
    expect(reportedSnapshot(reported, native, other, 'a', 2)).toEqual(idle);
  });
  it('a reference without a uid is the panel default: it matches another one without a uid, never one with a uid', () => {
    const typed = { ...context, defaultDatasource: { type: 'prometheus' } };
    const reported: QueryPreview = { query: native, cellId: 'a', context: typed, snapshot: success };
    expect(reportedSnapshot(reported, native, { defaultDatasource: { type: 'prometheus' } }, 'a', 2)).toBe(success);
    expect(
      reportedSnapshot(reported, native, { defaultDatasource: { uid: 'current', type: 'prometheus' } }, 'a', 2)
    ).toEqual(idle);
    const named = result(success);
    expect(reportedSnapshot(named, native, { defaultDatasource: {} }, 'a', 2)).toEqual(idle);
    expect(reportedSnapshot(named, native, {}, 'a', 2)).toEqual(idle);
  });
  it.each(['generation', 'query', 'parameters', 'cell', 'datasource'] as const)(
    'reports idle for a result of another %s',
    (difference) => {
      const reported = result(success);
      if (difference === 'generation') {
        reported.context = { ...context, generation: 1 };
      }
      if (difference === 'query') {
        reported.query = {
          ...native,
          source: {
            kind: 'datasource',
            target: { refId: 'A', ...{ expr: 'changed' } },
            parameters: { key: 'cell.key' },
          },
        };
      }
      if (difference === 'parameters') {
        reported.query = { ...native, source: { kind: 'datasource', target: { refId: 'A' }, parameters: {} } };
      }
      if (difference === 'cell') {
        reported.cellId = 'b';
      }
      if (difference === 'datasource') {
        reported.context = { ...context, defaultDatasource: { uid: 'old' } };
      }
      expect(reportedSnapshot(reported, native, context, 'a', 2)).toEqual(idle);
    }
  );
  it('a result of a query without parameters is the result at every cell; a generation is only checked when given', () => {
    const plain: NamedQuery = { ...native, source: { kind: 'datasource', target: { refId: 'A' }, parameters: {} } };
    const reported: QueryPreview = { query: plain, cellId: 'a', context, snapshot: success };
    expect(reportedSnapshot(reported, plain, context, 'b', 2)).toBe(success);
    expect(reportedSnapshot(reported, plain, context, 'b')).toBe(success);
    expect(reportedSnapshot(reported, plain, context, 'b', 3)).toEqual(idle);
  });
  it.each(['idle', 'loading', 'error', 'unsupported', 'empty'] as const)(
    'reports a pending or failed outcome as it is: %s',
    (state) => {
      const snapshot: QuerySnapshot =
        state === 'error' || state === 'unsupported'
          ? { state, message: 'Failed' }
          : state === 'empty'
            ? { state, fetchedAt: 1, fromCache: false }
            : { state };
      expect(reportedSnapshot(result(snapshot), native, context, 'a', 2)).toBe(snapshot);
    }
  );
  it('a panel-source query has no reported result', () => {
    const reported: QueryPreview = { query, cellId: 'a', context, snapshot: success };
    expect(reportedSnapshot(reported, query, context, 'a', 2)).toEqual(idle);
  });
  it('the resolver reads the reported result, the panel data for a panel query, and reports an unknown query', () => {
    const series = (value: number) =>
      toDataFrame({
        refId: 'A',
        fields: [
          { name: 'Time', type: FieldType.time, values: [1000] },
          { name: 'Value', type: FieldType.number, values: [value] },
        ],
      });
    const data: PanelData = { state: LoadingState.Done, series: [series(7)], timeRange };
    const plan = {
      cells: { a: { cellId: 'a', scope: { cell: { key: 'a' } }, bindings: [], display: {} } },
      widgets: [],
      diagnostics: [],
      config: { version: 3, queries: [native, query], patterns: [], overrides: [], widgets: [] },
    } as unknown as BindingPlan;
    const reported = result({ state: 'ready', frames: [series(3)], fetchedAt: 1, fromCache: false });
    const config = { queries: [{ ...native, id: 'n' }, query], defaultDatasource: context.defaultDatasource };
    const resolve = createPreviewResolver(
      plan,
      config,
      data,
      { ...reported, query: config.queries[0] },
      {
        generation: 2,
      }
    );
    expect(resolve('a', { queryId: 'n', match: {}, reducer: 'last' })).toMatchObject({
      state: 'ready',
      latestValue: 3,
    });
    expect(resolve('a', { queryId: 'q', match: {}, reducer: 'last' })).toMatchObject({
      state: 'ready',
      latestValue: 7,
    });
    expect(resolve('a', { queryId: 'missing', match: {}, reducer: 'last' })).toMatchObject({ state: 'unsupported' });
    expect(resolve('zz', { queryId: 'q', match: {}, reducer: 'last' })).toMatchObject({ state: 'unsupported' });
  });
});

describe('eager query results in the panel snapshot and controller', () => {
  it.each<[string, Partial<PanelData>, string]>([
    ['retained frames after request failure', { state: LoadingState.Error, series: [frame] }, 'error'],
    ['legacy error with retained frames', { error: { message: 'failed' }, series: [frame] }, 'error'],
    ['errors without frames', { errors: [{ message: 'failed' }] }, 'error'],
    ['not started with retained frames', { state: LoadingState.NotStarted, series: [frame] }, 'ready'],
    ['loading with retained frames', { state: LoadingState.Loading, series: [frame] }, 'ready'],
    ['missing result', {}, 'empty'],
    ['healthy result', { series: [frame] }, 'ready'],
    [
      'another query failed',
      { state: LoadingState.Error, errors: [{ refId: 'B', message: 'B failed' }], series: [frame] },
      'ready',
    ],
    ['matching query failed', { errors: [{ refId: 'A', message: 'A failed' }], series: [frame] }, 'error'],
    [
      'request-wide error alongside another query failure',
      { errors: [{ refId: 'B', message: 'B failed' }, { message: 'request failed' }], series: [frame] },
      'error',
    ],
  ])('%s', (_, patch, state) => {
    const data: PanelData = { state: LoadingState.Done, series: [], timeRange, ...patch };
    const execute = vi.fn();
    const controller = createQueryController(execute, undefined, () => 42);
    controller.setPanelData(data);
    const receive = vi.fn();
    controller.watch(
      {
        consumerId: 'preview',
        query,
        scope: { cell: {} },
        maxDataPoints: 160,
        context: { timeRange, timeZone: 'utc', scopedVars: {}, intervalMs: 1000, refreshMs: 0, generation: 1 },
      },
      receive
    );
    const preview = panelSnapshot(data, 'A', () => 42);
    expect(preview.state).toBe(state);
    expect(receive.mock.lastCall?.[0].state).toBe(state);
    if (preview.state === 'ready') {
      // the boundary copy: the same data, the same field config, not the panel's array
      expect(preview.frames[0]).not.toBe(frame);
      expect(preview.frames[0].fields[0].values).toEqual([7]);
      expect(preview.frames[0].fields[0].config).toBe(frame.fields[0].config);
    }
    expect(execute).not.toHaveBeenCalled();
    controller.dispose();
  });
});
