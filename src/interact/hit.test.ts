import { describe, expect, it } from 'vitest';
import type { CellIndex, CellPatch, PatchMap } from '../types';
import { cellAt, hoverKind, interactiveCells, patchAt } from './hit';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { buildCellIndex } from '../render/svgStage';

describe('cellAt', () => {
  it('selects unbound indexed cells and resolves icon ownership without patches', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg><g data-cell-id="node"><rect/></g><g data-cell-id="icon"><ellipse/></g><g data-cell-id="unbound"><path/></g></svg>';
    const cells = buildCellIndex(host.querySelector('svg')!);
    cells.get('icon')!.ownerId = 'node';
    expect(cellAt(host.querySelector('ellipse'), cells)?.meta.id).toBe('node');
    expect(cellAt(host.querySelector('path'), cells)?.meta.id).toBe('unbound');
    expect(cellAt(null, cells)).toBeUndefined();
    expect(cellAt(host, cells)).toBeUndefined();
  });
});

const p = (cellId: string): CellPatch => ({ cellId, ruleNames: [], scope: { cell: {} }, urls: [], warnings: [] });

describe('patchAt', () => {
  const host = document.createElement('div');
  host.innerHTML = `<svg><g data-cell-id="link"><g><path id="line"/></g><g data-cell-id="lbl"><text id="t">x</text></g></g>
    <g class="dmap-overlay"><polyline id="half" data-dmap-cell="link" data-dmap-half="a2b"/></g><rect id="free"/></svg>`;
  const patches: PatchMap = new Map([['link', p('link')]]);
  it('resolves overlay elements by data-dmap-cell', () => {
    expect(patchAt(host.querySelector('#half'), host, patches)?.cellId).toBe('link');
  });
  it('walks up through nested cells until a patched one', () => {
    expect(patchAt(host.querySelector('#t'), host, patches)?.cellId).toBe('link');
    expect(patchAt(host.querySelector('#line'), host, patches)?.cellId).toBe('link');
  });
  it('resolves an icon cell to its node with the index', () => {
    const h = document.createElement('div');
    h.innerHTML = '<svg><g data-cell-id="node"><rect/></g><g data-cell-id="icon"><ellipse id="e"/></g></svg>';
    const index = new Map([['icon', { ownerId: 'node' }]]) as unknown as CellIndex;
    const ps: PatchMap = new Map([['node', p('node')]]);
    expect(patchAt(h.querySelector('#e'), h, ps)).toBeUndefined();
    expect(patchAt(h.querySelector('#e'), h, ps, index)?.cellId).toBe('node');
  });
  it('uses the patch of the owner before the own patch of an icon, and never the own patch', () => {
    const h = document.createElement('div');
    h.innerHTML = '<svg><g data-cell-id="node"><rect/></g><g data-cell-id="icon"><ellipse id="e"/></g></svg>';
    const index = new Map([['icon', { ownerId: 'node' }]]) as unknown as CellIndex;
    const ps: PatchMap = new Map([
      ['node', p('node')],
      ['icon', p('icon')],
    ]);
    expect(patchAt(h.querySelector('#e'), h, ps, index)?.cellId).toBe('node');
    // the owner opens no card: the icon does not open its own card either
    expect(patchAt(h.querySelector('#e'), h, ps, index, (x) => x.cellId !== 'node')).toBeUndefined();
  });
  it('returns undefined outside any patched cell', () => {
    expect(patchAt(host.querySelector('#free'), host, patches)).toBeUndefined();
    expect(patchAt(null, host, patches)).toBeUndefined();
  });
});

describe('hoverKind', () => {
  const drawn = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const meta = (id: string, attrs: Record<string, string> = {}, isEdge = false) => ({
    meta: cellMetaFromAttrs(id, attrs, isEdge),
    shape: drawn,
  });
  it('uses the portograph kind of nodes, links, ports and link labels', () => {
    expect(hoverKind(meta('n', { 'pg-kind': 'node' }))).toBe('node');
    expect(hoverKind(meta('l', { 'pg-kind': 'link' }, true))).toBe('link');
    expect(hoverKind(meta('p', { 'pg-kind': 'port' }))).toBe('port');
    expect(hoverKind(meta('t', { 'pg-kind': 'link-label' }))).toBe('link-label');
  });
  it('knows the portograph canvas, layers, groups, group titles and legend cells', () => {
    expect(hoverKind(meta('pg-canvas'))).toBe('canvas');
    expect(hoverKind(meta('pg-layer~diagram'))).toBe('canvas');
    expect(hoverKind(meta('pg-group~core'))).toBe('group');
    expect(hoverKind(meta('pg-groupTitle~core'))).toBe('group');
    expect(hoverKind(meta('pg-legend'))).toBe('legend');
    expect(hoverKind(meta('pg-legendRow~1'))).toBe('legend');
    expect(hoverKind(meta('pg-overlayMark~x'))).toBe('other');
    expect(hoverKind(meta('chart-1', { 'pg-kind': 'other' }))).toBe('other');
  });
  it('treats cells of a plain draw.io diagram as nodes (vertices) and links (edges)', () => {
    expect(hoverKind(meta('box'))).toBe('node');
    expect(hoverKind(meta('edge-ab', {}, true))).toBe('link');
    // the root and the layers draw nothing of their own
    expect(hoverKind({ meta: cellMetaFromAttrs('1', {}, false) })).toBe('canvas');
  });
});

describe('patchAt with a filter', () => {
  it('skips patched cells that the filter rejects and walks up', () => {
    const h = document.createElement('div');
    h.innerHTML = '<svg><g data-cell-id="layer"><g data-cell-id="canvas"><rect id="bg"/></g></g></svg>';
    const ps: PatchMap = new Map([
      ['canvas', p('canvas')],
      ['layer', p('layer')],
    ]);
    expect(patchAt(h.querySelector('#bg'), h, ps)?.cellId).toBe('canvas');
    expect(patchAt(h.querySelector('#bg'), h, ps, undefined, (x) => x.cellId !== 'canvas')?.cellId).toBe('layer');
    expect(patchAt(h.querySelector('#bg'), h, ps, undefined, () => false)).toBeUndefined();
  });
});

describe('interactiveCells', () => {
  const host = document.createElement('div');
  host.innerHTML = `<svg><g data-cell-id="node"><rect/></g><g data-cell-id="icon"><ellipse/></g>
    <g data-cell-id="plain"><rect/></g><g data-cell-id="plainIcon"><ellipse/></g><g data-cell-id="free"><rect/></g></svg>`;
  const cells = buildCellIndex(host.querySelector('svg')!);
  cells.get('icon')!.ownerId = 'node';
  cells.get('plainIcon')!.ownerId = 'plain';
  const patches: PatchMap = new Map([
    ['node', p('node')],
    ['plain', p('plain')],
  ]);
  it('has the accepted patched cells and the parts that resolve to them', () => {
    const ids = interactiveCells(patches, cells, (x) => x.cellId === 'node');
    expect([...ids].sort()).toEqual(['icon', 'node']);
  });
  it('is empty when no patch is accepted', () => {
    expect(interactiveCells(patches, cells, () => false).size).toBe(0);
  });
});
