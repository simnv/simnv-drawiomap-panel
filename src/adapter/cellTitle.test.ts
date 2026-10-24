import { describe, expect, it } from 'vitest';
import type { CellMeta } from '../types';
import { cellMetaFromAttrs, applyContract, attachLinkLabels } from './portograph';
import { assignTitles, cellFinder, cellTitle, displayName, idAndName, readableId } from './cellTitle';

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
  it('prefers the title, then the label, then the readable id', () => {
    expect(displayName({ title: 'T', labelText: 'L' }, 'x')).toBe('T');
    expect(displayName({ labelText: 'L' }, 'x')).toBe('L');
    expect(displayName(undefined, 'pg-node~sw')).toBe('sw');
  });
});

describe('idAndName', () => {
  it('adds the title to the readable id, unless it adds nothing', () => {
    expect(idAndName({ title: 'Switch-A p9', labelText: 'p9' }, 'pg-port~sw~p9~1')).toBe('sw p9 (Switch-A p9)');
    expect(idAndName({ title: 'device-1', labelText: '' }, 'device-1')).toBe('device-1');
  });
});
