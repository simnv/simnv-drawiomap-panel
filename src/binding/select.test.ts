import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellSelector } from '../types';
import { cellMatches } from './select';

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

describe('cellMatches review fixes', () => {
  it('finding 1: cellMatches skips cells for an invalid regex instead of a crash', () => {
    expect(matching({ label: '/[/' })).toEqual([]);
  });
});
