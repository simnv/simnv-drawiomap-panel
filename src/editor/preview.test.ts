import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame, type PanelData } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { previewSnapshot } from './preview';
import { createQueryController } from '../query/controller';
import type { NamedQuery } from '../model/config';

const timeRange = getDefaultTimeRange();
const frame = toDataFrame({
  refId: 'A',
  fields: [{ name: 'Value', type: FieldType.number, values: [7], config: { unit: 'percent' } }],
});
const query: NamedQuery = { id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } };

describe('eager query results in the preview and controller', () => {
  it.each<[string, Partial<PanelData>, string]>([
    ['retained frames after request failure', { state: LoadingState.Error, series: [frame] }, 'error'],
    ['legacy error with retained frames', { error: { message: 'failed' }, series: [frame] }, 'error'],
    ['errors without frames', { errors: [{ message: 'failed' }] }, 'error'],
    ['not started with retained frames', { state: LoadingState.NotStarted, series: [frame] }, 'loading'],
    ['loading with retained frames', { state: LoadingState.Loading, series: [frame] }, 'loading'],
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
