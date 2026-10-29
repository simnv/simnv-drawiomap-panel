import { describe, expect, it } from 'vitest';
import { createTheme } from '@grafana/data';
import type { CellPatch, HalfState, PatchMap } from '../types';
import { buildCellIndex } from './svgStage';
import { paintStage } from './paintStage';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <g data-cell-id="n1"><g><rect x="0" y="80" width="40" height="40"/></g></g>
  <g data-cell-id="e1"><g><path d="M 40 100 L 360 100" fill="none" stroke="#333" pointer-events="stroke"/></g></g>
  <g data-cell-id="n2"><g><rect x="360" y="80" width="40" height="40"/></g></g>
</svg>`;
const half: HalfState = {
  status: 'ok',
  color: '#00ff00',
  width: 4,
  label: '41 Mb/s · 41% of 100 Mb/s',
  stepIndex: 0,
  percent: 41,
  percentDisplay: '41%',
};
const patches: PatchMap = new Map<string, CellPatch>([
  [
    'n1',
    {
      cellId: 'n1',
      scope: { cell: {} },
      urls: [],
      shape: { status: 'ok', color: '#123456', target: 'shape', stepIndex: 0 },
    },
  ],
  ['e1', { cellId: 'e1', scope: { cell: {} }, urls: [], link: { a2b: half, b2a: half, labelMode: 'percent' } }],
]);
const opts = { theme: createTheme(), osDark: false, linkWidth: { min: 2, max: 10 } };

function build() {
  const host = document.createElement('div');
  host.innerHTML = SVG;
  document.body.appendChild(host);
  const root = host.querySelector('svg') as SVGSVGElement;
  // jsdom has no layout: a root of no size hides the label layer
  root.getBoundingClientRect = () => ({ width: 400, height: 200 }) as DOMRect;
  return { root, index: buildCellIndex(root) };
}

describe('paintStage', () => {
  it('applies the patches, draws the overlay and puts the value labels above it', () => {
    const { root, index } = build();
    paintStage(root, index, patches, undefined, opts);
    expect(index.get('n1')!.group.getAttribute('data-dmap-target')).toBe('shape');
    expect(root.querySelectorAll('g.dmap-overlay polyline.dmap-half')).toHaveLength(2);
    expect(root.querySelectorAll('text.dmap-link-label')).toHaveLength(2);
    expect(root.lastElementChild?.classList.contains('dmap-link-labels')).toBe(true);
    // the labels come after the overlay: their cut reaches the halves of the overlay (a gap in the dash pattern)
    root
      .querySelectorAll('g.dmap-overlay > polyline.dmap-half')
      .forEach((el) => expect(el.getAttribute('stroke-dasharray')).toMatch(/^[\d.]+ [\d.]+ /));
    expect(root.querySelector('mask, [mask]')).toBeNull();
  });

  it('changes no cell, overlay or label for the same patches with the applied state it returned', () => {
    const { root, index } = build();
    const applied = paintStage(root, index, patches, undefined, opts);
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    paintStage(root, index, patches, applied, opts);
    // only the counters of the label layer are written again, with the same values
    const records = observer
      .takeRecords()
      .map((r) => `${(r.target as Element).getAttribute('class')} ${r.attributeName}`);
    expect(records).toEqual(['dmap-link-labels data-dmap-labels-placed', 'dmap-link-labels data-dmap-labels-dropped']);
    observer.disconnect();
  });

  it('makes only the interactive cells buttons; without the set every patched cell is one', () => {
    const marked = build();
    paintStage(marked.root, marked.index, patches, undefined, { ...opts, interactive: new Set(['e1']) });
    expect(marked.index.get('n1')!.group.getAttribute('role')).toBeNull();
    expect(marked.index.get('e1')!.group.getAttribute('role')).toBe('button');
    const all = build();
    paintStage(all.root, all.index, patches, undefined, opts);
    expect(all.index.get('n1')!.group.getAttribute('role')).toBe('button');
  });
});
