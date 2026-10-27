import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellSelector } from '../types';
import { cellMatches, compileMatcher, matcherError } from './select';

const link = cellMetaFromAttrs(
  'pg-link~a:p1->b:p2',
  { 'pg-kind': 'link', 'pg-id': 'a:p1->b:p2', 'pg-from': 'a:p1', 'pg-to': 'b:p2', kind: 'wan' },
  true,
  'metric 10'
);
const link2 = cellMetaFromAttrs(
  'pg-link~b:p3->c:p4',
  { 'pg-kind': 'link', 'pg-id': 'b:p3->c:p4', 'pg-from': 'b:p3', 'pg-to': 'c:p4' },
  true,
  'lan'
);
const node = cellMetaFromAttrs('pg-node~a', { 'pg-kind': 'node', 'pg-id': 'a' }, false, 'A');
const hand = cellMetaFromAttrs('x1', { host: 'h' }, false, 'Hand');
const cells = [link, link2, node, hand];
const matching = (sel: CellSelector) => cells.filter((c) => cellMatches(sel, c));

describe('compileMatcher', () => {
  it('matches exact strings and /regex/', () => {
    expect(compileMatcher('wan')('wan')).toBe(true);
    expect(compileMatcher('wan')('wan2')).toBe(false);
    expect(compileMatcher('/^w/')('wan')).toBe(true);
    expect(compileMatcher('/WAN/i')('wan')).toBe(true);
  });
});

describe('cellMatches', () => {
  it('by kind', () => {
    expect(matching({ kind: 'link' }).map((c) => c.id)).toEqual([link.id, link2.id]);
    expect(matching({ kind: 'any' })).toHaveLength(4);
    expect(matching({})).toHaveLength(4);
  });
  it('by ids (cell id or pg-id)', () => {
    expect(matching({ ids: ['a', 'x1'] }).map((c) => c.id)).toEqual([node.id, hand.id]);
    expect(matching({ ids: ['pg-link~a:p1->b:p2'] })).toEqual([link]);
  });
  it('by attrs with AND semantics and regex', () => {
    expect(matching({ attrs: { kind: 'wan' } })).toEqual([link]);
    expect(matching({ attrs: { 'pg-to': '/^b:/' } })).toEqual([link]);
    expect(matching({ attrs: { kind: 'wan', 'pg-from': 'zzz' } })).toEqual([]);
  });
  it('by label regex', () => {
    expect(matching({ label: '/metric/' })).toEqual([link]);
  });
  it('by between in either direction', () => {
    expect(matching({ between: ['b', 'a'] })).toEqual([link]);
    expect(matching({ between: ['a', 'c'] })).toEqual([]);
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
  it('finding 1: cellMatches skips cells for an invalid regex instead of a crash', () => {
    expect(matching({ label: '/[/' })).toEqual([]);
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
