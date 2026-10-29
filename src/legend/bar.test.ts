import { describe, expect, it } from 'vitest';
import { barTicks } from './bar';
import type { LegendBarSegment } from './model';

/** Equal segments for the step values above the base step, as the model makes them. */
const segments = (...values: number[]): LegendBarSegment[] =>
  [undefined, ...values].map((v, i, all) => ({
    from: i / all.length,
    to: (i + 1) / all.length,
    range: '',
    ...(v === undefined ? {} : { tick: `${v}%` }),
  }));

describe('barTicks', () => {
  it('gives the tick text of each step value at its stop on the bar', () => {
    expect(barTicks(segments(60, 85))).toEqual([
      { at: 1 / 3, text: '60%' },
      { at: 2 / 3, text: '85%' },
    ]);
    expect(barTicks(segments())).toEqual([]);
    // the lan levels: four texts with a point fit the bar
    expect(barTicks(segments(0.1, 0.5, 2, 10)).map((t) => t.text)).toEqual(['0.1%', '0.5%', '2%', '10%']);
  });
  it('drops a tick text that comes too near to the tick text before it', () => {
    expect(barTicks(segments(0.1, 0.5, 2, 10), 100).map((t) => t.text)).toEqual(['0.1%', '2%']);
    expect(barTicks(segments(60, 85), 50).map((t) => t.text)).toEqual(['60%']);
  });
  it('drops a tick text that goes past an end of the bar', () => {
    // eight equal segments on 100 px: '0.0001%' at 12.5 px is wider than 25 px, '100%' at 87.5 px fits
    const ticks = barTicks(segments(0.0001, 0.001, 0.01, 0.1, 1, 10, 100), 100);
    expect(ticks.map((t) => t.text)).not.toContain('0.0001%');
    expect(barTicks(segments(1234567), 40)).toEqual([]);
  });
});
