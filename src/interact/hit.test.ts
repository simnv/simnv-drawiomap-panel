import { describe, expect, it } from 'vitest';
import type { CellIndex, CellPatch, PatchMap } from '../types';
import { patchAt } from './hit';

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
  it('returns undefined outside any patched cell', () => {
    expect(patchAt(host.querySelector('#free'), host, patches)).toBeUndefined();
    expect(patchAt(null, host, patches)).toBeUndefined();
  });
});
