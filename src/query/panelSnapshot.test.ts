import { FieldType, LoadingState, type DataFrame, type PanelData } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { panelSnapshot } from './panelSnapshot';

const frame = (): DataFrame => ({
  refId: 'D',
  length: 1,
  fields: [{ name: 'Value', type: FieldType.number, config: {}, values: [1] }],
});

const data = (state: LoadingState, series = [frame()], extra: Partial<PanelData> = {}): PanelData => ({
  state,
  series,
  timeRange: undefined as never,
  ...extra,
});

describe('panelSnapshot keeps the last good data while the panel loads', () => {
  it('reports loading on the first load, when no previous series exist', () => {
    expect(panelSnapshot(data(LoadingState.Loading, []), 'D', 5)).toEqual({ state: 'loading' });
    expect(panelSnapshot(data(LoadingState.NotStarted, []), 'D', 5)).toEqual({ state: 'loading' });
  });

  it('keeps the previous frames of the target as ready data during a refresh', () => {
    expect(panelSnapshot(data(LoadingState.Loading), 'D', 5)).toEqual({
      state: 'ready',
      frames: [frame()],
      fetchedAt: 5,
      fromCache: true,
    });
  });

  it('keeps a previous empty result of the target as empty during a refresh', () => {
    expect(panelSnapshot(data(LoadingState.Loading, [{ ...frame(), refId: 'OTHER' }]), 'D', 5)).toEqual({
      state: 'empty',
      fetchedAt: 5,
      fromCache: true,
    });
  });

  it('keeps the previous error during a refresh after an error', () => {
    const failed = data(LoadingState.Loading, [frame()], { errors: [{ message: 'secret', refId: 'D' }] });
    expect(panelSnapshot(failed, 'D', 5)).toEqual({ state: 'error', message: 'Panel query failed.' });
  });

  it('reports an error when the refresh fails, also when previous frames exist', () => {
    const failed = data(LoadingState.Error, [frame()], { error: { message: 'secret' } });
    expect(panelSnapshot(failed, 'D', 5)).toEqual({ state: 'error', message: 'Panel query failed.' });
  });

  it('reports fresh data when the refresh completes', () => {
    expect(panelSnapshot(data(LoadingState.Done), 'D', 5)).toEqual({
      state: 'ready',
      frames: [frame()],
      fetchedAt: 5,
      fromCache: false,
    });
  });
});
