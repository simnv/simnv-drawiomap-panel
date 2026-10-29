import { describe, expect, it } from 'vitest';
import { isPast, STATUS_SEVERITY, statusLevel, type StatusView } from './status';

describe('statusLevel', () => {
  it('groups the states into the levels that the paint, the text and the legend show', () => {
    expect(statusLevel('down')).toBe('critical');
    expect(statusLevel('critical')).toBe('critical');
    expect(statusLevel('warning')).toBe('warning');
    expect(statusLevel('stale')).toBe('warning');
    expect(statusLevel('missing')).toBe('missing');
    expect(statusLevel('normal')).toBe('normal');
  });
});

describe('STATUS_SEVERITY', () => {
  it('orders the states from the most severe to the least severe', () => {
    const states: Array<StatusView['state']> = ['down', 'critical', 'warning', 'stale', 'missing', 'normal'];
    const sorted = [...states].reverse().sort((a, b) => STATUS_SEVERITY[a] - STATUS_SEVERITY[b]);
    expect(sorted).toEqual(states);
  });
});

describe('isPast', () => {
  it('is false at the deadline and true after it: a sample is stale after the deadline, not at it', () => {
    expect(isPast(1000, 999)).toBe(false);
    expect(isPast(1000, 1000)).toBe(false);
    expect(isPast(1000, 1001)).toBe(true);
  });
});
