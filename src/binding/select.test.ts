import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { compileMatcher, matcherError, selectCells } from './select';

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

describe('compileMatcher', () => {
  it('matches exact strings and /regex/', () => {
    expect(compileMatcher('wan')('wan')).toBe(true);
    expect(compileMatcher('wan')('wan2')).toBe(false);
    expect(compileMatcher('/^w/')('wan')).toBe(true);
    expect(compileMatcher('/WAN/i')('wan')).toBe(true);
  });
});

describe('selectCells', () => {
  it('by kind', () => {
    expect(selectCells({ kind: 'link' }, cells).map((c) => c.id)).toEqual([link.id, link2.id]);
    expect(selectCells({ kind: 'any' }, cells)).toHaveLength(4);
    expect(selectCells({}, cells)).toHaveLength(4);
  });
  it('by ids (cell id or pg-id)', () => {
    expect(selectCells({ ids: ['a', 'x1'] }, cells).map((c) => c.id)).toEqual([node.id, hand.id]);
    expect(selectCells({ ids: ['pg-link~a:p1->b:p2'] }, cells)).toEqual([link]);
  });
  it('by attrs with AND semantics and regex', () => {
    expect(selectCells({ attrs: { kind: 'wan' } }, cells)).toEqual([link]);
    expect(selectCells({ attrs: { 'pg-to': '/^b:/' } }, cells)).toEqual([link]);
    expect(selectCells({ attrs: { kind: 'wan', 'pg-from': 'zzz' } }, cells)).toEqual([]);
  });
  it('by label regex', () => {
    expect(selectCells({ label: '/metric/' }, cells)).toEqual([link]);
  });
  it('by between in either direction', () => {
    expect(selectCells({ between: ['b', 'a'] }, cells)).toEqual([link]);
    expect(selectCells({ between: ['a', 'c'] }, cells)).toEqual([]);
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
  it('finding 1: selectCells skips cells for an invalid regex instead of a crash', () => {
    expect(selectCells({ label: '/[/' }, cells)).toEqual([]);
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
