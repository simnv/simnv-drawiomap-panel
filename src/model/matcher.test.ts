import { describe, expect, it } from 'vitest';
import { compileMatcher, escapeRegex, isRegexMatcher, matcherError } from './matcher';

describe('compileMatcher', () => {
  it('matches exact strings and /regex/', () => {
    expect(compileMatcher('wan')('wan')).toBe(true);
    expect(compileMatcher('wan')('wan2')).toBe(false);
    expect(compileMatcher('/^w/')('wan')).toBe(true);
    expect(compileMatcher('/WAN/i')('wan')).toBe(true);
  });
});

describe('compileMatcher review fixes', () => {
  it('finding 1: an invalid regex does not throw and matches nothing', () => {
    expect(() => compileMatcher('/[/')).not.toThrow();
    expect(compileMatcher('/[/')('[')).toBe(false);
    expect(compileMatcher('/a/z')('a')).toBe(false);
    expect(matcherError('/[/')).toMatch(/invalid regex/i);
    expect(matcherError('/a/z')).toMatch(/invalid regex/i);
    expect(matcherError('/^ok$/i')).toBeUndefined();
    expect(matcherError('plain [')).toBeUndefined();
  });
  it('finding 2: g and y flags are stripped so repeated tests are stable', () => {
    const g = compileMatcher('/router/g');
    expect([g('router'), g('router'), g('router')]).toEqual([true, true, true]);
    const y = compileMatcher('/router/y');
    expect([y('router'), y('router')]).toEqual([true, true]);
    expect(matcherError('/router/g')).toMatch(/flag/i);
    expect(matcherError('/router/gy')).toMatch(/flag/i);
  });
});

describe('isRegexMatcher', () => {
  it('reads "/re/flags" as a regex, as compileMatcher and matcherError do', () => {
    expect(['/^w/', '/WAN/i', '/[/', '/a/z'].map(isRegexMatcher)).toEqual([true, true, true, true]);
    expect(['wan', '/', '//', 'a/b/', '/a/B'].map(isRegexMatcher)).toEqual([false, false, false, false, false]);
  });
  it('escapes a value so the regex matches it literally', () => {
    expect(escapeRegex('a/b+c')).toBe('a\\/b\\+c');
    expect(compileMatcher(`/^${escapeRegex('rtr.(1)')}$/`)('rtr.(1)')).toBe(true);
  });
});
