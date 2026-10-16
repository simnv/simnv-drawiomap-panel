import { describe, expect, it } from 'vitest';
import { fnv1a } from './hash';

describe('fnv1a', () => {
  it('is stable and 8 hex chars', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('<svg/>')).toHaveLength(8);
  });
  it('changes with content', () => {
    expect(fnv1a('x')).not.toBe(fnv1a('y'));
  });
});
