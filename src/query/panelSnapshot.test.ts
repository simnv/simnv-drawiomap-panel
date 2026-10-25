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
const at = (time: number) => () => time;

describe('panelSnapshot keeps the last good data while the panel loads', () => {
  it('reports loading on the first load, when no previous series exist', () => {
    expect(panelSnapshot(data(LoadingState.Loading, []), 'D', at(5))).toEqual({ state: 'loading' });
    expect(panelSnapshot(data(LoadingState.NotStarted, []), 'D', at(5))).toEqual({ state: 'loading' });
  });

  it('keeps the previous frames of the target as ready data during a refresh', () => {
    expect(panelSnapshot(data(LoadingState.Loading), 'D', at(5))).toEqual({
      state: 'ready',
      frames: [frame()],
      fetchedAt: 5,
      fromCache: true,
    });
  });

  it('keeps a previous empty result of the target as empty during a refresh', () => {
    expect(panelSnapshot(data(LoadingState.Loading, [{ ...frame(), refId: 'OTHER' }]), 'D', at(5))).toEqual({
      state: 'empty',
      fetchedAt: 5,
      fromCache: true,
    });
  });

  it('keeps the previous error during a refresh after an error', () => {
    const failed = data(LoadingState.Loading, [frame()], { errors: [{ message: 'secret', refId: 'D' }] });
    expect(panelSnapshot(failed, 'D', at(5))).toEqual({ state: 'error', message: 'Panel query failed.' });
  });

  it('reports an error when the refresh fails, also when previous frames exist', () => {
    const failed = data(LoadingState.Error, [frame()], { error: { message: 'secret' } });
    expect(panelSnapshot(failed, 'D', at(5))).toEqual({ state: 'error', message: 'Panel query failed.' });
  });

  it('reports fresh data when the refresh completes', () => {
    expect(panelSnapshot(data(LoadingState.Done), 'D', at(5))).toEqual({
      state: 'ready',
      frames: [frame()],
      fetchedAt: 5,
      fromCache: false,
    });
  });
});

describe('panelSnapshot is memoised per panel data and refId', () => {
  it('gives the same object for the same (data, refId), with the fetch time of the first call', () => {
    const d = data(LoadingState.Done);
    const first = panelSnapshot(d, 'D', at(5));
    expect(panelSnapshot(d, 'D', at(9))).toBe(first);
    expect(first).toMatchObject({ fetchedAt: 5 });
    expect(panelSnapshot(d, 'OTHER', at(5))).not.toBe(first);
    expect(panelSnapshot({ ...d }, 'D', at(5))).not.toBe(first);
  });

  it('copies the frames of the refId at the boundary: a later write to the panel series does not reach it', () => {
    const d = data(LoadingState.Done, [frame(), { ...frame(), refId: 'OTHER' }]);
    const snapshot = panelSnapshot(d, 'D', at(5));
    if (snapshot.state !== 'ready') {
      throw new Error('expected ready');
    }
    expect(snapshot.frames).toHaveLength(1);
    expect(snapshot.frames[0]).not.toBe(d.series[0]);
    expect(snapshot.frames[0].fields[0].values).not.toBe(d.series[0].fields[0].values);
    d.series[0].fields[0].values.push(2);
    expect(snapshot.frames[0].fields[0].values).toEqual([1]);
    expect(snapshot.frames[0].fields[0].config).toBe(d.series[0].fields[0].config);
  });

  it('is idle without data', () => {
    expect(panelSnapshot(undefined, 'D', at(5))).toEqual({ state: 'idle' });
  });
});
