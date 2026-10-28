import { dateTime, FieldType, LoadingState, type PanelData } from '@grafana/data';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staleCheck, type FreshnessPatchMap } from '../binding/freshness';
import type { Series } from '../query/snapshot';
import { useStaleStatusV4 } from './useSampleStale';

type Status = { state: 'normal' | 'stale' | 'missing'; reason?: string };
const normal: Status = { state: 'normal' };
const stale: Status = { state: 'stale', reason: 'Sample is stale' };
const samples: Series[] = [
  {
    refId: 'status',
    labels: {},
    frameIndex: 0,
    fieldIndex: 1,
    field: { name: 'Value', type: FieldType.number, config: {}, values: [1] },
    times: [1000],
    values: [1],
  },
];
const data = (rawTo: string, rangeTo = 1000): PanelData => ({
  state: LoadingState.Done,
  series: [],
  timeRange: { from: dateTime(0), to: dateTime(rangeTo), raw: { from: 'now-1h', to: rawTo } },
});

/** Build once from the data. The hook receives no query data or time range. */
function bind(input: PanelData, selected = samples): FreshnessPatchMap<Status> {
  const check = staleCheck(selected, { timeRange: input.timeRange, freshnessMs: 1000, instant: false });
  return new Map([
    [
      'node-1',
      {
        cellId: 'node-1',
        scope: { cell: {} },
        urls: [],
        statusV4: check.reason ? { state: 'missing', reason: check.reason } : check.stale ? stale : normal,
        staleStatusV4: check.deadline === undefined ? undefined : { after: check.deadline, status: stale },
      },
    ],
  ]);
}

afterEach(() => vi.useRealTimers());

describe('useStaleStatusV4', () => {
  it('turns a relative range stale with the same data and patches, without a new bind', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const input = data('now');
    const timeRange = input.timeRange;
    const patches = bind(input);
    const view = renderHook(() => useStaleStatusV4(patches));
    expect(view.result.current).toBe(patches);
    expect(view.result.current.get('node-1')?.statusV4?.state).toBe('normal');
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(view.result.current).toBe(patches);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(view.result.current.get('node-1')?.statusV4).toEqual(stale);
    expect(view.result.current).not.toBe(patches);
    expect(patches.get('node-1')?.statusV4).toBe(normal);
    expect(input.timeRange).toBe(timeRange);
    const shown = view.result.current;
    view.rerender();
    expect(view.result.current).toBe(shown);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks the cell stale when one of six status series expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const six = Array.from({ length: 6 }, () => ({ ...samples[0], times: [1500] }));
    six[5] = samples[0];
    const patches = bind(data('now'), six);
    const view = renderHook(() => useStaleStatusV4(patches));
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(view.result.current.get('node-1')?.statusV4?.state).toBe('stale');
  });

  it('keeps an absolute range at its bound state through a clock step', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fresh = bind(data('2000', 2000));
    const old = bind(data('2001', 2001));
    const view = renderHook(() => [useStaleStatusV4(fresh), useStaleStatusV4(old)]);
    expect(view.result.current[0].get('node-1')?.statusV4?.state).toBe('normal');
    expect(view.result.current[1].get('node-1')?.statusV4?.state).toBe('stale');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(3_600_000));
    view.rerender();
    expect(view.result.current[0]).toBe(fresh);
    expect(view.result.current[1]).toBe(old);
  });

  it('keeps a missing timestamp missing and gives it no timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const patches = bind(data('now'), [{ ...samples[0], times: [] }]);
    const view = renderHook(() => useStaleStatusV4(patches));
    expect(view.result.current.get('node-1')?.statusV4).toEqual({
      state: 'missing',
      reason: 'Sample timestamp is missing',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('changes only the expired status and leaves capacity unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const patches = bind(data('now'));
    const link = {
      a2b: {
        status: 'ok' as const,
        color: 'blue',
        width: 2,
        label: '1 Gb/s',
        stepIndex: 0,
        capacity: 1_000_000_000,
        capacitySource: 'series' as const,
      },
    };
    patches.get('node-1')!.link = link;
    const untouched = { cellId: 'link-1', scope: { cell: {} }, urls: [], link };
    patches.set('link-1', untouched);
    const view = renderHook(() => useStaleStatusV4(patches));
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(view.result.current.get('node-1')?.statusV4).toEqual(stale);
    expect(view.result.current.get('node-1')?.link).toBe(link);
    expect(view.result.current.get('link-1')).toBe(untouched);
    expect(link.a2b.capacity).toBe(1_000_000_000);
  });

  it('handles new patches and releases the old deadline on change and unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const patches = bind(data('now'));
    const view = renderHook(({ patches }) => useStaleStatusV4(patches), { initialProps: { patches } });
    expect(vi.getTimerCount()).toBe(1);
    const renewed = bind(data('now'), [{ ...samples[0], times: [5000] }]);
    view.rerender({ patches: renewed });
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(view.result.current).toBe(renewed);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies a deadline that was already past when the hook mounted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3000);
    const view = renderHook(() => useStaleStatusV4(bind(data('now'))));
    expect(view.result.current.get('node-1')?.statusV4?.state).toBe('stale');
    expect(vi.getTimerCount()).toBe(0);
  });
});
