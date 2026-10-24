import { describe, expect, it } from 'vitest';
import type { CellMeta } from '../types';
import { cellMetaFromAttrs, applyContract, attachLinkLabels } from './portograph';
import { identityOf, assignTitles, cellFinder, cellTitle, displayName, idAndName, readableId } from './cellTitle';

const cell = (id: string, attrs: Record<string, string>, isEdge = false, label?: string): CellMeta =>
  cellMetaFromAttrs(id, attrs, isEdge, label);

const diagram = (): CellMeta[] => [
  cell('0', { 'pg-schema': '1' }),
  cell('pg-node~sw', { 'pg-kind': 'node', 'pg-id': 'sw', label: 'Switch-A' }),
  cell('pg-node~ap', { 'pg-kind': 'node', 'pg-id': 'ap', label: 'AP-1' }),
  cell('pg-node~bare', { 'pg-kind': 'node', 'pg-id': 'bare' }),
  cell('pg-port~sw~p9~1', { 'pg-kind': 'port', 'pg-id': 'sw:p9', 'pg-node': 'sw', 'pg-port': 'p9', label: 'p9' }),
  cell('pg-port~sw~p10~1', { 'pg-kind': 'port', 'pg-id': 'sw:p10', 'pg-node': 'sw', 'pg-port': 'p10' }),
  cell('pg-port~bare~e0~1', { 'pg-kind': 'port', 'pg-id': 'bare:e0', 'pg-node': 'bare', 'pg-port': 'e0', label: 'e0' }),
  cell('pg-link~l1', { 'pg-kind': 'link', 'pg-id': 'l1', 'pg-from': 'sw:p9', 'pg-to': 'ap', label: '' }, true),
  cell('pg-link~l2', { 'pg-kind': 'link', 'pg-id': 'l2', 'pg-from': 'sw:p10', 'pg-to': 'gone:x', label: '1G' }, true),
  cell('pg-link~l3', { 'pg-kind': 'link', 'pg-id': 'l3', label: 'Uplink' }, true),
];

describe('cellTitle', () => {
  const cells = assignTitles(attachLinkLabels(diagram()));
  const title = (id: string) => cells.find((c) => c.id === id)?.title;

  it('names a node by its label', () => {
    expect(title('pg-node~sw')).toBe('Switch-A');
  });

  it('names a port by the node label and the port label', () => {
    expect(title('pg-port~sw~p9~1')).toBe('Switch-A p9');
  });

  it('takes the port name from pg-port when the port has no label', () => {
    expect(title('pg-port~sw~p10~1')).toBe('Switch-A p10');
  });

  it('uses the node id when the node has no label', () => {
    expect(title('pg-port~bare~e0~1')).toBe('bare e0');
  });

  it('names a link by its two ends, a port end with its node', () => {
    expect(title('pg-link~l1')).toBe('Switch-A p9 ↔ AP-1');
  });

  it('keeps the link label out of the title and resolves an end that has no cell', () => {
    expect(title('pg-link~l2')).toBe('Switch-A p10 ↔ gone x');
  });

  it('falls back to the label of a link without ends', () => {
    expect(title('pg-link~l3')).toBe('Uplink');
  });

  it('writes a multi-line label on one line', () => {
    const find = cellFinder([]);
    expect(cellTitle(cell('n', { 'pg-kind': 'node' }, false, 'Switch\nA'), find)).toBe('Switch A');
  });

  it('does not treat a diagram without pg-schema as a portograph export', () => {
    const plain = [
      cell('0', {}),
      cell('pg-node~sw', { 'pg-kind': 'node', 'pg-id': 'sw', label: 'Switch-A' }),
      cell('pg-port~sw~p9~1', { 'pg-kind': 'port', 'pg-node': 'sw', 'pg-port': 'p9', label: 'p9' }),
      cell('e1', { 'pg-kind': 'link', 'pg-from': 'sw:p9', 'pg-to': 'sw' }, true, 'wire'),
    ];
    applyContract(plain);
    assignTitles(plain);
    expect(plain.map((c) => c.title)).toEqual(['0', 'Switch-A', 'p9', 'wire']);
  });
});

describe('captions of structure cells', () => {
  const all = assignTitles([
    cell('0', { 'pg-schema': '1' }),
    cell('pg-node~sw', { 'pg-kind': 'node', 'pg-id': 'sw', label: 'Switch-A' }),
    cell('pg-icon~sw', { 'pg-kind': 'node-icon', 'pg-of': 'sw' }),
    cell('pg-iconTile~sw', {}),
    cell('pg-nodeDescription~sw', {}, false, 'PoE · 24 ports'),
    cell('pg-group~mp-eval', {}),
    cell('pg-groupTitle~mp-eval', {}, false, 'Eval site'),
    cell('pg-group~core', {}, false, 'Core'),
    cell('pg-group~bare', {}),
    cell('pg-layer~labels', {}),
    cell('pg-legendRow~symbol:ap', {}, false, 'Access point'),
    cell('pg-legendBody~symbol:ap', {}),
    cell('pg-legendSwatch~symbol:ap', {}),
    cell('pg-legendTile~symbol:none', {}),
    cell('pg-legend', {}),
  ]);
  const title = (id: string) => all.find((c) => c.id === id)?.title;

  it('gives an icon, a tile and a description the title of their node', () => {
    expect(title('pg-icon~sw')).toBe('Switch-A');
    expect(title('pg-iconTile~sw')).toBe('Switch-A');
    expect(title('pg-nodeDescription~sw')).toBe('Switch-A');
  });

  it('gives a group its own label, else its group title', () => {
    expect(title('pg-group~core')).toBe('Core');
    expect(title('pg-group~mp-eval')).toBe('Eval site');
    expect(title('pg-groupTitle~mp-eval')).toBe('Eval site');
  });

  it('gives a legend part the label of its row', () => {
    expect(title('pg-legendRow~symbol:ap')).toBe('Access point');
    expect(title('pg-legendBody~symbol:ap')).toBe('Access point');
    expect(title('pg-legendSwatch~symbol:ap')).toBe('Access point');
  });

  it('falls back to the readable id when no text exists', () => {
    expect(title('pg-group~bare')).toBe('bare');
    expect(title('pg-layer~labels')).toBe('labels');
    expect(title('pg-legendTile~symbol:none')).toBe('symbol:none');
    expect(title('pg-legend')).toBe('pg-legend');
  });

  it('keeps the raw ids without pg-schema', () => {
    const plain = assignTitles([
      cell('0', {}),
      cell('pg-node~sw', { 'pg-kind': 'node', 'pg-id': 'sw', label: 'Switch-A' }),
      cell('pg-iconTile~sw', {}),
      cell('pg-group~g', {}),
      cell('pg-groupTitle~g', {}, false, 'Cap'),
    ]);
    expect(plain.slice(2).map((c) => c.title)).toEqual(['pg-iconTile~sw', 'pg-group~g', 'Cap']);
  });
});

describe('readableId', () => {
  it('turns a cell id into its parts and drops the port ordinal', () => {
    expect(readableId('pg-port~sw~eth2~1')).toBe('sw eth2');
    expect(readableId('pg-group~core')).toBe('core');
    expect(readableId('pg-node~a%7eb')).toBe('a~b');
  });

  it('keeps any other text', () => {
    expect(readableId('p-lite-9')).toBe('p-lite-9');
  });
});

describe('displayName', () => {
  it('prefers the title, then the label, then the handle', () => {
    expect(displayName({ title: 'T', labelText: 'L' }, 'x')).toBe('T');
    expect(displayName({ labelText: 'L' }, 'x')).toBe('L');
    expect(displayName({ labelText: '', handle: 'sw' }, 'pg-node~sw')).toBe('sw');
    expect(displayName(undefined, 'pg-node~sw')).toBe('pg-node~sw');
  });
});

describe('idAndName', () => {
  it('adds the title to the readable id, unless it adds nothing', () => {
    expect(idAndName({ title: 'Switch-A p9', labelText: 'p9', handle: 'sw p9' }, 'pg-port~sw~p9~1')).toBe(
      'sw p9 (Switch-A p9)'
    );
    expect(idAndName({ title: 'device-1', labelText: '' }, 'device-1')).toBe('device-1');
  });
});

describe('encoded ids', () => {
  const node = (id: string, attrs: Record<string, string>) => cell(id, { 'pg-kind': 'node', ...attrs });
  const titles = (cells: CellMeta[], schema: boolean) => {
    const all = schema ? [cell('0', { 'pg-schema': '1' }), ...cells] : [cell('0', {}), ...cells];
    applyContract(all);
    return assignTitles(all)
      .slice(1)
      .map((c) => c.title);
  };

  it('keeps a raw semantic pg-id as it is', () => {
    expect(titles([node('pg-node~a%7e', { 'pg-id': 'pg-node~a%7e' })], true)).toEqual(['pg-node~a%7e']);
  });

  it('decodes an encoded cell id when the cell has no pg-id', () => {
    expect(titles([node('pg-node~a%257e', {})], true)).toEqual(['a%7e']);
  });

  it('keeps the raw id without pg-schema', () => {
    expect(titles([node('pg-node~a%257e', {})], false)).toEqual(['pg-node~a%257e']);
  });
});

describe('handle and identity', () => {
  const run = (cells: CellMeta[], schema: boolean) => {
    const all = [cell('0', schema ? { 'pg-schema': '1' } : {}), ...cells];
    applyContract(all);
    assignTitles(all);
    return all.slice(1);
  };

  it('decodes the cell id with pg-schema, also when the cell has a pg-id', () => {
    const [c] = run([cell('pg-node~a%257e', { 'pg-kind': 'node', 'pg-id': 'pg-node~a%7e' })], true);
    expect(c.handle).toBe('a%7e');
  });

  it('keeps the cell id raw without pg-schema', () => {
    const [c] = run([cell('pg-node~a%257e', { 'pg-kind': 'node' })], false);
    expect(c.handle).toBe('pg-node~a%257e');
  });

  it('shows a raw pg-id as the identity, and the decoded cell id when there is no pg-id', () => {
    const [raw, none] = run(
      [cell('n1', { 'pg-kind': 'node', 'pg-id': 'pg-node~a%7e' }), cell('pg-node~b%257e', { 'pg-kind': 'node' })],
      true
    );
    expect(identityOf(raw, 'n1')).toBe('pg-node~a%7e');
    expect(identityOf(none, 'pg-node~b%257e')).toBe('b%7e');
    expect(identityOf(undefined, 'x')).toBe('x');
  });
});
