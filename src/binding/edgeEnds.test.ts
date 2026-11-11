import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyContract, cellMetaFromAttrs } from '../adapter/portograph';
import type { CellEntry, CellIndex, CellMeta } from '../types';
import { edgeEnds, endAttr, endContextOf } from './edgeEnds';

/** A cell index as buildCellIndex gives it: the metas after the contract, no DOM. */
function indexOf(cells: Array<[id: string, attrs: Record<string, string>, isEdge?: boolean]>): CellIndex {
  const metas: CellMeta[] = cells.map(([id, attrs, isEdge]) => cellMetaFromAttrs(id, attrs, isEdge ?? false));
  applyContract(metas);
  return new Map(metas.map((meta) => [meta.id, { meta } as CellEntry]));
}
const page = (cells: string) =>
  `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root>` +
  `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const context = (xml: string | undefined, index: CellIndex) => ({ index, ...edgeEnds(xml, index) });

afterEach(() => vi.restoreAllMocks());

describe('edgeEnds: a portograph link', () => {
  const index = indexOf([
    ['0', { 'pg-schema': '1' }],
    ['pg-node~rtr-a', { 'pg-kind': 'node', 'pg-id': 'rtr-a', key: 'rtr-a-node', site: 'hq', role: 'router' }],
    [
      'pg-port~rtr-a~wan~1',
      { 'pg-kind': 'port', 'pg-id': 'rtr-a:wan', 'pg-node': 'rtr-a', 'pg-port': 'wan', key: 'rtr-a:wan' },
    ],
    ['pg-node~isp-a', { 'pg-kind': 'node', 'pg-id': 'isp-a', key: 'isp-a-node' }],
    [
      'pg-link~rtr-a:wan->isp-a',
      { 'pg-kind': 'link', 'pg-id': 'rtr-a:wan->isp-a', 'pg-from': 'rtr-a:wan', 'pg-to': 'isp-a' },
      true,
    ],
  ]);
  const link = 'pg-link~rtr-a:wan->isp-a';

  it('the source is the port cell of pg-from and the target the node cell of pg-to, with no XML', () => {
    const r = edgeEnds(undefined, index);
    expect(r.ends.get(link)).toEqual({ source: 'pg-port~rtr-a~wan~1', target: 'pg-node~isp-a' });
    expect(r.report).toEqual([]);
  });

  it('${from.key} reads the port cell before the node cell', () => {
    const ctx = context(undefined, index);
    expect(endAttr(link, 'from', 'key', ctx)).toBe('rtr-a:wan');
    expect(endAttr(link, 'from', 'site', ctx)).toBe('hq');
    expect(endAttr(link, 'to', 'key', ctx)).toBe('isp-a-node');
    expect(endAttr(link, 'from', 'absent', ctx)).toBeUndefined();
  });

  it('${from.id} is the draw.io id of the end cell', () => {
    expect(endAttr(link, 'from', 'id', context(undefined, index))).toBe('pg-port~rtr-a~wan~1');
  });

  it('an endpoint that names a port with no port cell ends on the node cell', () => {
    const idx = indexOf([
      ['0', { 'pg-schema': '1' }],
      ['pg-node~rtr-a', { 'pg-kind': 'node', 'pg-id': 'rtr-a', key: 'n' }],
      ['pg-node~isp-a', { 'pg-kind': 'node', 'pg-id': 'isp-a' }],
      ['l', { 'pg-kind': 'link', 'pg-id': 'l', 'pg-from': 'rtr-a:lan#2', 'pg-to': 'isp-a' }, true],
    ]);
    expect(edgeEnds(undefined, idx).ends.get('l')).toEqual({ source: 'pg-node~rtr-a', target: 'pg-node~isp-a' });
  });
});

describe('edgeEnds: an ordinary draw.io edge', () => {
  const index = indexOf([
    ['0', {}],
    ['1', { key: 'layer-key' }],
    ['box', { key: 'box-key', site: 'lab' }],
    ['a', { label: 'A' }],
    ['b', { key: 'b-key' }],
    ['e1', { key: 'e1-key' }, true],
  ]);
  const xml = page(
    `<mxCell id="box" vertex="1" parent="1"/>` +
      `<object id="a" label="A"><mxCell vertex="1" parent="box"/></object>` +
      `<mxCell id="b" vertex="1" parent="1"/>` +
      `<UserObject id="e1" key="e1-key"><mxCell edge="1" parent="1" source="a" target="b"/></UserObject>`
  );

  it('reads its ends from page 1 of the XML', () => {
    const r = edgeEnds(xml, index);
    expect(r.ends.get('e1')).toEqual({ source: 'a', target: 'b' });
    expect(r.report).toEqual([]);
  });

  it('${from.key} of a shape inside a container reads key from the container', () => {
    const ctx = context(xml, index);
    expect(endAttr('e1', 'from', 'key', ctx)).toBe('box-key');
    expect(endAttr('e1', 'from', 'label', ctx)).toBe('A');
    expect(endAttr('e1', 'to', 'key', ctx)).toBe('b-key');
  });

  it('the parent chain stops below the layer', () => {
    const ctx = context(xml, index);
    expect(endAttr('e1', 'to', 'site', ctx)).toBeUndefined();
    const idx = indexOf([
      ['0', {}],
      ['1', { key: 'layer-key' }],
      ['a', {}],
      ['b', {}],
      ['e1', {}, true],
    ]);
    const x = page(
      `<mxCell id="a" vertex="1" parent="1"/><mxCell id="b" vertex="1" parent="1"/>` +
        `<mxCell id="e1" edge="1" parent="1" source="a" target="b"/>`
    );
    expect(endAttr('e1', 'from', 'key', context(x, idx))).toBeUndefined();
  });

  it('a sheet with no pg-schema ignores pg-from and reads the XML', () => {
    const idx = indexOf([
      ['a', {}],
      ['b', {}],
      ['e1', { 'pg-from': 'b', 'pg-to': 'a' }, true],
    ]);
    const x = page(
      `<mxCell id="a" vertex="1" parent="1"/><mxCell id="b" vertex="1" parent="1"/>` +
        `<mxCell id="e1" edge="1" parent="1" source="a" target="b"/>`
    );
    expect(edgeEnds(x, idx).ends.get('e1')).toEqual({ source: 'a', target: 'b' });
  });

  it('reads page 1 only', () => {
    const idx = indexOf([
      ['a', {}],
      ['b', {}],
      ['e1', {}, true],
    ]);
    const x =
      `<mxfile><diagram id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
      `<mxCell id="e1" edge="1" parent="1" source="a"/></root></mxGraphModel></diagram>` +
      `<diagram id="p2"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
      `<mxCell id="e1" edge="1" parent="1" source="b" target="a"/></root></mxGraphModel></diagram></mxfile>`;
    expect(edgeEnds(x, idx).ends.get('e1')).toEqual({ source: 'a' });
  });

  it('reads a bare mxGraphModel', () => {
    const idx = indexOf([
      ['a', {}],
      ['b', {}],
      ['e1', {}, true],
    ]);
    const x = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="e1" edge="1" parent="1" source="a" target="b"/></root></mxGraphModel>`;
    expect(edgeEnds(x, idx).ends.get('e1')).toEqual({ source: 'a', target: 'b' });
  });

  it('parses the XML once for the same diagram', () => {
    const idx = indexOf([['e1', {}, true]]);
    const x = page(`<mxCell id="e1" edge="1" parent="1" source="a" target="b"/>`);
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    edgeEnds(x, idx);
    edgeEnds(x, idx);
    expect(parse).toHaveBeenCalledTimes(1);
    edgeEnds(page(`<mxCell id="e1" edge="1" parent="1" source="b" target="a"/>`), idx);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('no XML gives no ends and no entry', () => {
    const r = edgeEnds(undefined, index);
    expect(r.ends.get('e1')).toBeUndefined();
    expect(r.report).toEqual([]);
    expect(endAttr('e1', 'from', 'key', context(undefined, index))).toBeUndefined();
  });
});

describe('edgeEnds: no-edge-ends', () => {
  const index = indexOf([
    ['0', {}],
    ['a', {}],
    ['e1', {}, true],
    ['e2', {}, true],
  ]);

  it('a compressed page gives no-edge-ends "compressed page" with the edges', () => {
    const xml = `<mxfile><diagram id="p1" name="Page-1">7VnRbtowFP0avu6S0nKbxQ</diagram></mxfile>`;
    const r = edgeEnds(xml, index);
    expect(r.ends.size).toBe(0);
    expect(r.report).toEqual([{ kind: 'no-edge-ends', reason: 'compressed page', cellIds: ['e1', 'e2'] }]);
  });

  it('a compressed page gives no entry when the portograph ends resolve all edges', () => {
    const idx = indexOf([
      ['0', { 'pg-schema': '1' }],
      ['pg-node~rtr-a', { 'pg-kind': 'node', 'pg-id': 'rtr-a' }],
      ['l', { 'pg-kind': 'link', 'pg-id': 'l', 'pg-from': 'rtr-a', 'pg-to': 'rtr-a' }, true],
    ]);
    const r = edgeEnds(`<mxfile><diagram id="p1">7VnRbtowFP0a</diagram></mxfile>`, idx);
    expect(r.ends.get('l')).toEqual({ source: 'pg-node~rtr-a', target: 'pg-node~rtr-a' });
    expect(r.report).toEqual([]);
  });

  it('an XML that does not parse gives no-edge-ends with the reason', () => {
    const r = edgeEnds('<mxfile><diagram>', index);
    expect(r.report).toEqual([
      { kind: 'no-edge-ends', reason: 'the diagram XML does not parse', cellIds: ['e1', 'e2'] },
    ]);
  });
});

describe('endContextOf: the cache', () => {
  const cells = [
    ['0', { 'pg-schema': '1' }],
    ['e', {}, true],
  ] as Array<[string, Record<string, string>, boolean?]>;
  const xml = page('<mxCell id="e" edge="1" parent="1" source="a" target="b"/>');

  it('gives the same object for the same index and the same XML', () => {
    const index = indexOf(cells);
    const first = endContextOf(xml, index);
    for (let i = 0; i < 20; i++) {
      expect(endContextOf(xml, index)).toBe(first);
    }
  });

  it('builds again for a new XML text, and again for the next one', () => {
    const index = indexOf(cells);
    const first = endContextOf(xml, index);
    const other = endContextOf(page('<mxCell id="e" edge="1" parent="1" source="b" target="a"/>'), index);
    expect(other).not.toBe(first);
    expect(other.ends.get('e')).toEqual({ source: 'b', target: 'a' });
    expect(endContextOf(xml, index)).not.toBe(other);
  });

  it('builds again for a new index with the same XML', () => {
    const first = endContextOf(xml, indexOf(cells));
    const next = endContextOf(xml, indexOf(cells));
    expect(next).not.toBe(first);
  });

  it('keeps no-edge-ends in the cached result', () => {
    const index = indexOf(cells);
    const compressed = '<mxfile><diagram id="p1">eJzLSM3JyQcABiwCFQ==</diagram></mxfile>';
    const first = endContextOf(compressed, index);
    expect(first.report).toEqual([{ kind: 'no-edge-ends', reason: 'compressed page', cellIds: ['e'] }]);
    expect(endContextOf(compressed, index).report).toBe(first.report);
  });

  it('serves a missing XML and has the index and the maps of edgeEnds', () => {
    const index = indexOf(cells);
    const ctx = endContextOf(undefined, index);
    expect(ctx.index).toBe(index);
    expect(endContextOf(undefined, index)).toBe(ctx);
    expect(ctx.ends).toEqual(edgeEnds(undefined, index).ends);
    expect(ctx.parents).toEqual(edgeEnds(undefined, index).parents);
  });
});
