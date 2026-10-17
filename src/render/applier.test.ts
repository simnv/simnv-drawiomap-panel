import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellIndex, CellPatch, HalfState, PatchMap, ShapeState } from '../types';
import { applyPatches } from './applier';
import { sanitizeSvg } from './sanitize';
import { buildCellIndex, mountSvg } from './svgStage';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g data-cell-id="n1"><g><rect x="10" y="10" width="50" height="30" fill="#fff" style="fill: light-dark(#fff, #111); stroke: #000;"/></g><g><text><tspan>rtr-a</tspan></text></g></g>
  <g data-cell-id="n2"><g><rect x="10" y="50" width="50" height="30"/></g><g><switch><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><div>old</div></div></foreignObject></switch></g></g>
  <g data-cell-id="e1"><g><path d="M 60 25 L 150 25" fill="none" stroke="#333" stroke-width="2" pointer-events="stroke"/><path d="M 150 20 L 160 25 L 150 30 Z" fill="#333" pointer-events="all"/></g></g>
</svg>`;

function build(): CellIndex {
  const host = document.createElement('div');
  host.innerHTML = SVG;
  const index: CellIndex = new Map();
  const g = (id: string) => host.querySelector(`[data-cell-id="${id}"]`) as SVGGElement;
  const n1 = g('n1');
  index.set('n1', {
    meta: cellMetaFromAttrs('n1', {}, false, 'rtr-a'),
    group: n1,
    shape: n1.querySelector('rect')!,
    arrows: [],
    label: n1.querySelector('text')!,
    original: {
      fill: n1.querySelector('rect')!.style.fill,
      stroke: n1.querySelector('rect')!.style.stroke,
      text: 'rtr-a',
    },
  });
  const n2 = g('n2');
  index.set('n2', {
    meta: cellMetaFromAttrs('n2', {}, false, 'old'),
    group: n2,
    shape: n2.querySelector('rect')!,
    arrows: [],
    label: n2.querySelector('foreignObject')!,
    original: { fill: '', text: 'old' },
  });
  const e1 = g('e1');
  const paths = Array.from(e1.querySelectorAll('path'));
  index.set('e1', {
    meta: cellMetaFromAttrs('e1', {}, true),
    group: e1,
    line: paths[0],
    arrows: [paths[1]],
    original: { stroke: '', strokeWidth: '' },
  });
  return index;
}

const ok = (over: Partial<HalfState> = {}): HalfState => ({
  status: 'ok',
  color: '#00ff00',
  width: 4,
  label: '41 Mb/s',
  stepIndex: 1,
  ...over,
});
const shape = (over: Partial<ShapeState> = {}): ShapeState => ({
  status: 'ok',
  color: '#ff0000',
  fill: true,
  stroke: false,
  stepIndex: 0,
  ...over,
});
/** jsdom keeps '#ff0000' as written; browsers read it back as 'rgb(255, 0, 0)'. */
const RED = /^(#ff0000|rgb\(255, 0, 0\))$/;
const patch = (cellId: string, p: Partial<CellPatch>): CellPatch => ({
  cellId,
  ruleNames: ['r'],
  scope: { cell: {} },
  urls: [],
  warnings: [],
  ...p,
});

describe('applyPatches', () => {
  it('fills a shape through style and tags the group', () => {
    const index = build();
    const patches: PatchMap = new Map([['n1', patch('n1', { shape: shape() })]]);
    const done = applyPatches(index, patches, new Set());
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.fill).toMatch(RED);
    expect(rect.getAttribute('fill')).toBe('#fff');
    expect(index.get('n1')!.group.getAttribute('data-dmap-status')).toBe('ok');
    expect(index.get('n1')!.group.getAttribute('data-dmap-step')).toBe('0');
    expect([...done]).toEqual(['n1']);
  });
  it('strokes and writes text into tspan and foreignObject', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape({ fill: false, stroke: true, text: 'rtr-a 1' }) })],
      ['n2', patch('n2', { shape: shape({ text: 'new' }) })],
    ]);
    applyPatches(index, patches, new Set());
    expect((index.get('n1')!.shape as SVGElement).style.stroke).toMatch(RED);
    expect((index.get('n1')!.shape as SVGElement).style.fill).not.toMatch(RED);
    expect(index.get('n1')!.label!.textContent).toBe('rtr-a 1');
    expect(index.get('n2')!.label!.textContent).toBe('new');
  });
  it('hides the original edge stroke when a link patch exists', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['e1', patch('e1', { link: { a2b: ok(), b2a: ok({ status: 'nodata', stepIndex: -1 }) } })],
    ]);
    applyPatches(index, patches, new Set());
    const e = index.get('e1')!;
    expect(e.line!.style.strokeOpacity).toBe('0');
    expect(e.arrows[0].style.opacity).toBe('0');
    expect(e.group.getAttribute('data-dmap-status')).toBe('ok');
    expect(e.group.getAttribute('data-dmap-step')).toBe('1');
  });
  it('reports nodata when no half has data', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['e1', patch('e1', { link: { a2b: ok({ status: 'nodata', stepIndex: -1 }) } })],
    ]);
    applyPatches(index, patches, new Set());
    expect(index.get('e1')!.group.getAttribute('data-dmap-status')).toBe('nodata');
    expect(index.get('e1')!.group.getAttribute('data-dmap-step')).toBe('-1');
  });
  it('resets cells that are no longer patched', () => {
    const index = build();
    const first: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape({ text: 'x' }) })],
      ['e1', patch('e1', { link: { a2b: ok() } })],
    ]);
    const prev = applyPatches(index, first, new Set());
    const done = applyPatches(index, new Map(), prev);
    expect(done.size).toBe(0);
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.fill).toBe(index.get('n1')!.original.fill ?? '');
    expect(index.get('n1')!.label!.textContent).toBe('rtr-a');
    expect(index.get('n1')!.group.hasAttribute('data-dmap-status')).toBe(false);
    expect(index.get('e1')!.line!.style.strokeOpacity).toBe('');
  });
});

describe('applyPatches on a native text label (l3-routing)', () => {
  it('writes the text and restores it on reset', () => {
    const raw = readFileSync(resolve(__dirname, '../../fixtures/svg/l3-routing.svg'), 'utf8');
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(raw).svg));
    const entry = index.get('pg-node~rtr-a')!;
    expect(entry.label!.localName).toBe('text');
    const before = entry.label!.outerHTML;
    const round = (text: string) =>
      new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape({ text }) })]]);
    const prev = applyPatches(index, round('up 1'), new Set());
    expect(entry.label!.textContent).toBe('up 1');
    applyPatches(index, new Map(), prev);
    expect(entry.label!.outerHTML).toBe(before);
  });
  it('writes a multi-line label into its first line and restores every line on reset', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-cell-id="n"><g><rect width="5" height="5"/></g><g><g fill="#000"><text x="1" y="2">first</text><text x="1" y="4">second</text></g></g></g></svg>`;
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    const label = index.get('n')!.label!;
    const before = label.innerHTML;
    const lines = Array.from(label.querySelectorAll('text'));
    let prev = applyPatches(index, new Map([['n', patch('n', { shape: shape({ text: 'up' }) })]]), new Set());
    expect(lines.map((t) => t.textContent)).toEqual(['up', '']);
    prev = applyPatches(index, new Map([['n', patch('n', { shape: shape({ text: 'up 2' }) })]]), prev);
    applyPatches(index, new Map(), prev);
    expect(label.innerHTML).toBe(before);
    // Codex: the same elements stay in the DOM, so nothing indexed is detached by a reset.
    expect(lines.every((t) => label.contains(t))).toBe(true);
  });
  it('keeps the indexed shape attached when a label background shares the label group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-cell-id="n"><g><g fill="#000"><rect width="5" height="5"/><text x="1" y="2">A</text><text x="1" y="4">B</text></g></g></g></svg>`;
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    const entry = index.get('n')!;
    expect(entry.label!.localName).toBe('g');
    const rect = entry.shape!;
    let prev = applyPatches(index, new Map([['n', patch('n', { shape: shape({ text: 'x' }) })]]), new Set());
    prev = applyPatches(index, new Map(), prev);
    applyPatches(index, new Map([['n', patch('n', { shape: shape({ text: 'y' }) })]]), prev);
    expect(entry.group.contains(rect)).toBe(true);
    expect(entry.label!.querySelector('rect')).toBe(rect);
  });
});

describe('applyPatches on a multi-line foreignObject label (legacy-html-labels)', () => {
  const load = () => {
    const raw = readFileSync(resolve(__dirname, '../../fixtures/svg/legacy-html-labels.svg'), 'utf8');
    const root = mountSvg(document.createElement('div'), sanitizeSvg(raw).svg);
    const index = buildCellIndex(root);
    const entry = index.get('pg-node~rtr-a')!;
    return { index, entry, before: entry.label!.innerHTML };
  };
  const lines = (label: Element) =>
    Array.from(label.querySelectorAll('div'))
      .filter((d) => d.children.length === 0)
      .map((d) => d.textContent);

  it('keeps the line structure over two refreshes without a text patch', () => {
    const { index, entry, before } = load();
    expect(lines(entry.label!)).toEqual(['rtr-a', 'mwan3 + PBR']);
    const round = () => new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape() })]]);
    const prev = applyPatches(index, round(), new Set());
    applyPatches(index, round(), prev);
    expect(entry.label!.innerHTML).toBe(before);
    expect(lines(entry.label!)).toEqual(['rtr-a', 'mwan3 + PBR']);
  });
  it('restores the exact markup after a text patch', () => {
    const { index, entry, before } = load();
    const round = (text: string) =>
      new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape({ text }) })]]);
    let prev = applyPatches(index, round('up 1'), new Set());
    prev = applyPatches(index, round('up 2'), prev);
    expect(entry.label!.textContent).toBe('up 2');
    applyPatches(index, new Map(), prev);
    expect(entry.label!.innerHTML).toBe(before);
    expect(lines(entry.label!)).toEqual(['rtr-a', 'mwan3 + PBR']);
  });
});
