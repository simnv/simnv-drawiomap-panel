import { describe, expect, it } from 'vitest';
import { baseRevision, hasConflict } from './revision';
import { EMPTY_CONFIG } from '../model/config';

const diagram = (hash: string) => ({ svg: '<svg/>', xml: '<mxfile/>', hash, updatedAt: '2026-10-23T00:00:00Z' });

describe('revision', () => {
  it('pins the diagram hash and the config text', () => {
    expect(baseRevision({ diagram: diagram('h1'), config: EMPTY_CONFIG })).toEqual({
      hash: 'h1',
      config: JSON.stringify(EMPTY_CONFIG),
    });
  });

  it('handles options without a diagram or a config', () => {
    const base = baseRevision({});
    expect(base.hash).toBeUndefined();
    expect(hasConflict(base, {})).toBe(false);
  });

  it('finds no conflict for equal options, also for a new object', () => {
    const base = baseRevision({ diagram: diagram('h1'), config: EMPTY_CONFIG });
    expect(hasConflict(base, { diagram: diagram('h1'), config: { ...EMPTY_CONFIG } })).toBe(false);
  });

  it('finds a conflict when the config or the diagram changed', () => {
    const base = baseRevision({ diagram: diagram('h1'), config: EMPTY_CONFIG });
    expect(
      hasConflict(base, { diagram: diagram('h1'), config: { ...EMPTY_CONFIG, defaultDatasource: { uid: 'x' } } })
    ).toBe(true);
    expect(hasConflict(base, { diagram: diagram('h2'), config: EMPTY_CONFIG })).toBe(true);
    expect(hasConflict(base, { config: EMPTY_CONFIG })).toBe(true);
  });
});
