import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame, type PanelData } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { preparedSnapshot, previewSnapshot, type QueryPreview } from './preview';
import { createQueryController } from '../query/controller';
import type { NamedQuery } from '../model/config';
import type { QueryContext, QuerySnapshot } from '../query/types';

const timeRange = getDefaultTimeRange();
const frame = toDataFrame({
  refId: 'A',
  fields: [{ name: 'Value', type: FieldType.number, values: [7], config: { unit: 'percent' } }],
});
const query: NamedQuery = { id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } };

describe('prepared result eligibility', () => {
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
  const empty: QuerySnapshot = { state: 'empty', fetchedAt: 1, fromCache: false };
  const failed: QuerySnapshot = { state: 'error', message: 'Datasource failed' };
  const candidate = (snapshot: QuerySnapshot): QueryPreview => ({ query: native, cellId: 'a', context, snapshot });
  it('preserves a saved failure for display while demand reuse can select an earlier successful preview', () => {
    const data: PanelData = { state: LoadingState.Done, series: [], timeRange };
    expect(previewSnapshot(native, context, data, 'a', candidate(success), [candidate(failed)], 2)).toBe(failed);
    expect(previewSnapshot(native, context, data, 'a', candidate(success), [candidate(failed)], 2, 'reuse')).toBe(
      success
    );
    expect(previewSnapshot(native, context, data, 'a', candidate(success), [candidate({ state: 'loading' })], 2)).toBe(
      success
    );
  });
  it.each(['generation', 'query', 'parameters', 'cell', 'datasource'] as const)(
    'rejects a ready candidate with another %s in either order',
    (difference) => {
      const incompatible = candidate(success);
      if (difference === 'generation') {
        incompatible.context = { ...context, generation: 1 };
      }
      if (difference === 'query') {
        incompatible.query = {
          ...native,
          source: {
            kind: 'datasource',
            target: { refId: 'A', ...{ expr: 'changed' } },
            parameters: { key: 'cell.key' },
          },
        };
      }
      if (difference === 'parameters') {
        incompatible.query = { ...native, source: { kind: 'datasource', target: { refId: 'A' }, parameters: {} } };
      }
      if (difference === 'cell') {
        incompatible.cellId = 'b';
      }
      if (difference === 'datasource') {
        incompatible.context = { ...context, defaultDatasource: { uid: 'old' } };
      }
      for (const values of [
        [incompatible, candidate(failed)],
        [candidate(failed), incompatible],
      ]) {
        expect(preparedSnapshot(native, context, 'a', undefined, values, 2)).toBe(failed);
      }
    }
  );
  it.each(['idle', 'loading', 'error', 'unsupported'] as const)(
    'retains %s diagnostics when no successful compatible result exists',
    (state) => {
      const snapshot: QuerySnapshot =
        state === 'error' || state === 'unsupported' ? { state, message: 'Failed' } : { state };
      expect(preparedSnapshot(native, context, 'a', undefined, [candidate(snapshot)], 2)).toBe(snapshot);
      expect(preparedSnapshot(native, context, 'a', candidate(empty), [candidate(snapshot)], 2)).toBe(empty);
      expect(
        preparedSnapshot(native, context, 'a', candidate(success), [candidate(empty), candidate(snapshot)], 2)
      ).toBe(success);
    }
  );
});

describe('eager query results in the preview and controller', () => {
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
    const preview = previewSnapshot(query, {}, data, 'device-1');
    expect(preview.state).toBe(state);
    expect(receive.mock.lastCall?.[0].state).toBe(state);
    if (preview.state === 'ready') {
      expect(preview.frames[0]).toBe(frame);
      expect(preview.frames[0].fields[0].config.unit).toBe('percent');
    }
    expect(execute).not.toHaveBeenCalled();
    controller.dispose();
  });
});
