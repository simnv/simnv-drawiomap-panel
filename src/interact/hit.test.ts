import { describe, expect, it } from 'vitest';
import type { CellPatch, PatchMap } from '../types';
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
  it('returns undefined outside any patched cell', () => {
    expect(patchAt(host.querySelector('#free'), host, patches)).toBeUndefined();
    expect(patchAt(null, host, patches)).toBeUndefined();
  });
});
