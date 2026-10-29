import { describe, expect, it } from 'vitest';
import { baseRevision, hasConflict } from './revision';
import type { ConfigV4 } from '../model/v4';

const EMPTY_CONFIG: ConfigV4 = { version: 4, freshness: '3x', classes: {}, overrides: {} };
const diagram = (hash: string) => ({ svg: '<svg/>', xml: '<mxfile/>', hash, updatedAt: '2026-10-23T00:00:00Z' });

describe('revision', () => {
  it('pins the diagram hash and the config text', () => {
    expect(baseRevision({ diagram: diagram('h1'), config: EMPTY_CONFIG })).toEqual({
      hash: 'h1',
      config: '{"classes":{},"freshness":"3x","overrides":{},"version":4}',
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

  it('ignores map key order and undefined keys at every depth', () => {
    const base = baseRevision({
      config: { version: 4, classes: { dev: { match: { key: 'job', value: 'demo' }, status: 'up' } } },
    });
    expect(
      hasConflict(base, {
        config: {
          classes: { dev: { status: 'up', match: { value: 'demo', key: 'job' } }, removed: undefined },
          version: 4,
        },
      })
    ).toBe(false);
  });

  it('finds a conflict when list order changes', () => {
    const first = { kind: 'metadata', text: 'first' };
    const second = { kind: 'metadata', text: 'second' };
    const base = baseRevision({ config: { version: 4, classes: { dev: { rows: [first, second] } } } });
    expect(hasConflict(base, { config: { version: 4, classes: { dev: { rows: [second, first] } } } })).toBe(true);
  });

  it('finds a conflict when the config or the diagram changed', () => {
    const base = baseRevision({ diagram: diagram('h1'), config: EMPTY_CONFIG });
    expect(hasConflict(base, { diagram: diagram('h1'), config: { ...EMPTY_CONFIG, freshness: '5m' } })).toBe(true);
    expect(hasConflict(base, { diagram: diagram('h2'), config: EMPTY_CONFIG })).toBe(true);
    expect(hasConflict(base, { config: EMPTY_CONFIG })).toBe(true);
  });
});
