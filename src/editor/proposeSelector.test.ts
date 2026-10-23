import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellMatches } from '../binding/select';
import { buildCellIndex, cellMetas, mountSvg } from '../render/svgStage';
import type { CellMeta } from '../types';
import { escapeRegex, proposeSelector } from './proposeSelector';

const demo = cellMetas(
  buildCellIndex(
    mountSvg(
      document.createElement('div'),
      readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8')
    )
  )
);
const meta = (id: string, attrs: Record<string, string> = {}, labelText = '', kind: CellMeta['kind'] = 'node') =>
  ({ id, key: id, kind, attrs: { 'pg-id': id, ...attrs }, labelText, isEdge: kind === 'link' }) as CellMeta;
const pick = (...ids: string[]) => ids.map((id) => demo.find((cell) => cell.id === id)!);

describe('proposeSelector', () => {
  const routers = [
    meta('r1', { 'pg-kind': 'node', role: 'router', site: 'east' }, 'core-1'),
    meta('r2', { 'pg-kind': 'node', role: 'router', site: 'east' }, 'core-2'),
    meta('r3', { 'pg-kind': 'node', role: 'router', site: 'west' }, 'edge-3'),
    meta('r4', { 'pg-kind': 'node', role: 'router', site: 'west' }, 'edge-4'),
    meta('s1', { 'pg-kind': 'node', role: 'switch', site: 'east' }, 'sw-1'),
    meta('l1', { 'pg-kind': 'link', role: 'uplink' }, '', 'link'),
  ];

  it('puts the shared attributes first, with the other cells of the attribute as extras, and the ids last', () => {
    const proposals = proposeSelector([routers[0], routers[2]], routers);
    expect(proposals[0].kind).toBe('attrs');
    expect(proposals[0].select).toEqual({ kind: 'node', attrs: { role: 'router' } });
    expect(proposals[0].extra).toEqual(['r2', 'r4']);
    expect(proposals[0].missed).toEqual([]);
    expect(proposals.at(-1)).toMatchObject({ kind: 'ids', select: { ids: ['r1', 'r3'] }, extra: [], missed: [] });
  });

  it('drops an attribute that does not narrow the match, and keeps one that does', () => {
    const [first] = proposeSelector([routers[0], routers[1]], routers);
    // role and site both hold for r1 and r2. Dropping role leaves the same extras (none): site stays or goes alone.
    const matched = routers.filter((cell) => cellMatches(first.select, cell)).map((cell) => cell.id);
    expect(first.extra).toEqual(matched.filter((id) => id !== 'r1' && id !== 'r2'));
    expect(Object.keys(first.select.attrs ?? {}).length).toBeLessThanOrEqual(2);
    const alone = proposeSelector([routers[2], routers[3]], routers)[0];
    expect(alone.select.attrs).toEqual({ site: 'west' });
    expect(alone.extra).toEqual([]);
  });

  it('never uses the identity attributes', () => {
    const cells = [meta('a', { label: 'x' }, 'abc-1'), meta('b', { label: 'x' }, 'abc-2')];
    const proposals = proposeSelector(cells, cells);
    expect(proposals.some((p) => p.kind === 'attrs' && p.select.attrs)).toBe(false);
  });

  it('proposes a label prefix of three characters or more, escaped, after the attributes', () => {
    const proposals = proposeSelector([routers[0], routers[1]], routers);
    const label = proposals.find((p) => p.kind === 'label')!;
    expect(label.select).toEqual({ kind: 'node', label: '/^core-/' });
    expect(label.extra).toEqual([]);
    expect(proposals.map((p) => p.kind)).toEqual(['attrs', 'label', 'ids']);
    const special = [meta('a', {}, 'rtr.(1)'), meta('b', {}, 'rtr.(2)')];
    expect(proposeSelector(special, special).find((p) => p.kind === 'label')!.select.label).toBe('/^rtr\\.\\(/');
    expect(escapeRegex('a/b+c')).toBe('a\\/b\\+c');
    const short = [meta('a', {}, 'ab1'), meta('b', {}, 'ab2')];
    expect(proposeSelector(short, short).some((p) => p.kind === 'label')).toBe(false);
  });

  it('proposes the ids alone when the cells share nothing', () => {
    const odd = [meta('a', { x: '1' }, 'alpha', 'node'), meta('b', { y: '2' }, 'beta', 'link'), meta('c', {}, 'gamma')];
    const proposals = proposeSelector(odd, odd);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: 'ids', select: { ids: ['a', 'b', 'c'] } });
  });

  it('keeps ids behind a semantic candidate even when the ids have no extras and the attributes have many', () => {
    const proposals = proposeSelector(pick('pg-node~rtr-a', 'pg-node~rtr-b'), demo);
    expect(proposals.at(-1)!.kind).toBe('ids');
    expect(proposals[0].kind).not.toBe('ids');
    expect(proposals[0].extra.length).toBeGreaterThan(proposals.at(-1)!.extra.length);
  });

  it('on the demo diagram two routers share the node kind and the rtr- label prefix', () => {
    const proposals = proposeSelector(pick('pg-node~rtr-a', 'pg-node~rtr-b'), demo);
    expect(proposals[0]).toMatchObject({ kind: 'attrs', select: { kind: 'node' }, missed: [] });
    expect(proposals[0].extra).toContain('pg-node~isp-a');
    const label = proposals.find((p) => p.kind === 'label')!;
    expect(label.select).toEqual({ kind: 'node', label: '/^rtr-/' });
    expect(label.extra).toEqual([]);
  });

  it('uses an exact match for an attribute value that looks like a regular expression', () => {
    const cells = [meta('a', { tag: '/x/' }), meta('b', { tag: '/x/' }), meta('c', { tag: 'x' })];
    const [first] = proposeSelector([cells[0], cells[1]], cells);
    expect(first.select.attrs).toEqual({ tag: '/^\\/x\\/$/' });
    expect(first.extra).toEqual([]);
  });

  it('drops a candidate that misses a selected cell', () => {
    const cells = [meta('a', {}, 'abc-1'), meta('b', {}, 'abc-2'), meta('c', {}, 'abc-3')];
    for (const proposal of proposeSelector([cells[0], cells[1]], cells)) {
      expect(proposal.missed).toEqual([]);
    }
    // A mixed selection has no kind: only attributes and labels that all cells share can stay.
    const mixed = [meta('a', { x: '1' }, 'abc-1'), meta('b', { x: '2' }, 'abc-2', 'link')];
    const kinds = proposeSelector(mixed, mixed).map((p) => p.kind);
    expect(kinds).toEqual(['label', 'ids']);
  });

  it('returns nothing for an empty selection', () => {
    expect(proposeSelector([], routers)).toEqual([]);
  });
});
