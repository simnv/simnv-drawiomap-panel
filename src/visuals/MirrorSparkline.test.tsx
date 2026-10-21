import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createTheme, FieldType, dateTime, type TimeRange } from '@grafana/data';
import { MirrorSparkline, mirrorSegments, type MirrorDirection } from './MirrorSparkline';
import type { HistoryModel } from '../query/frames';

vi.mock('@grafana/ui', () => ({ useTheme2: () => createTheme() }));

const range = { from: 0, to: 100 };
const timeRange: TimeRange = { from: dateTime(0), to: dateTime(100), raw: { from: dateTime(0), to: dateTime(100) } };
const history = (values: Array<number | null>, times = values.map((_, i) => i * 50)): HistoryModel => ({
  state: 'ready',
  field: { name: 'v', type: FieldType.number, config: {}, values },
  timeField: { name: 'Time', type: FieldType.time, config: {}, values: times },
  timestamps: times,
  values,
  latestValue: values.at(-1) ?? undefined,
  fetchedAt: 0,
  fromCache: false,
});
const ys = (points: string) => points.split(' ').map((p) => Number(p.split(',')[1]));

describe('mirrorSegments', () => {
  it('maps times over the dashboard range and values over the domain', () => {
    expect(mirrorSegments([0, 10, 5], [0, 50, 100], range, 200, 22, [0, 10], false)).toEqual(['0,21 100,1 200,11']);
  });
  it('draws a mirrored series below the zero line', () => {
    expect(mirrorSegments([10, 5], [0, 100], range, 100, 22, [-10, 10], true)).toEqual(['0,21 100,16']);
  });
  it('breaks the line at a null gap and drops a lone point', () => {
    expect(
      mirrorSegments([1, 2, null, 3, null, 4, 5], [0, 10, 20, 30, 40, 50, 60], range, 100, 12, [0, 10], false)
    ).toEqual(['0,10 10,9', '50,7 60,6']);
  });
  it('keeps about two points per pixel for a long series and keeps the last point', () => {
    const values = Array.from({ length: 10_000 }, (_, i) => i % 7);
    const times = values.map((_, i) => i / 100);
    const [seg] = mirrorSegments(values, times, range, 100, 12, [0, 10], false);
    expect(seg.split(' ').length).toBeLessThanOrEqual(202);
    expect(seg.split(' ').at(-1)).toBe(`100,${12 - 1 - ((9999 % 7) / 10) * 10}`);
  });
});

describe('MirrorSparkline', () => {
  const both = (): MirrorDirection[] => [
    { direction: 'up', color: '#0a0', mirrored: false, history: history([4, 8, 6]) },
    { direction: 'down', color: '#00a', mirrored: true, history: history([1, 2, 1]) },
  ];
  it('draws a thin zero line in the middle, up above it and down mirrored below it', () => {
    const { container } = render(
      <MirrorSparkline
        directions={both()}
        domain={[-8, 8]}
        width={200}
        height={40}
        timeRange={timeRange}
        label="Traffic"
      />
    );
    const zero = container.querySelector('[data-testid="dmap-zero-line"]')!;
    expect(zero.getAttribute('y1')).toBe('20');
    const up = container.querySelector('polyline[data-direction="up"]')!;
    const down = container.querySelector('polyline[data-direction="down"]')!;
    expect(ys(up.getAttribute('points')!).every((y) => y <= 20)).toBe(true);
    expect(ys(down.getAttribute('points')!).every((y) => y > 20)).toBe(true);
    expect(up.getAttribute('stroke')).toBe('#0a0');
    expect(down.getAttribute('stroke')).toBe('#00a');
    expect(down.getAttribute('data-mirrored')).toBe('true');
  });
  it('puts the zero line at the bottom for a single direction', () => {
    const { container } = render(
      <MirrorSparkline
        directions={[{ direction: 'down', color: '#00a', mirrored: false, history: history([1, 2]) }]}
        domain={[0, 2]}
        width={200}
        height={40}
        timeRange={timeRange}
        label="In"
      />
    );
    expect(container.querySelector('[data-testid="dmap-zero-line"]')!.getAttribute('y1')).toBe('39');
    expect(ys(container.querySelector('polyline')!.getAttribute('points')!)).toEqual([20, 1]);
  });
  it('draws nothing for a direction without data', () => {
    const [up] = both();
    const { container } = render(
      <MirrorSparkline
        directions={[up, { direction: 'down', color: '#888', mirrored: true, history: { state: 'loading' } }]}
        domain={[-8, 8]}
        width={200}
        height={40}
        timeRange={timeRange}
        label="Traffic"
      />
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
  });
});
