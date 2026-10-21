import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellIndex, CellPatch, HalfState, PatchMap, ShapeState } from '../types';
import { applyPatches, markInteractive } from './applier';
import { sanitizeSvg } from './sanitize';
import { buildCellIndex, mountSvg } from './svgStage';
import type { PlanCellPatch } from '../binding/engine';
import type { StatusView } from '../binding/status';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g data-cell-id="n1"><g><rect x="10" y="10" width="50" height="30" fill="#fff" style="fill: light-dark(#fff, #111); stroke: #000;"/></g><g><text><tspan>rtr-a</tspan></text></g></g>
  <g data-cell-id="n2"><g><rect x="10" y="50" width="50" height="30"/></g><g><switch><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><div>old</div></div></foreignObject></switch></g></g>
  <g data-cell-id="i1"><g><ellipse cx="20" cy="20" rx="5" ry="5" fill="#4f9aa6" style="fill: rgb(79, 154, 166);"/><path d="M 0 0 L 1 1" fill="#fff"/></g></g>
  <g data-cell-id="i2"><g><image x="10" y="50" width="10" height="10"/></g></g>
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
  for (const id of ['i1', 'i2']) {
    const icon = g(id);
    const el = icon.querySelector('ellipse, image') as SVGGraphicsElement;
    index.set(id, {
      meta: cellMetaFromAttrs(id, {}, false),
      group: icon,
      shape: el,
      arrows: [],
      original: { fill: el.style.fill, stroke: el.style.stroke },
    });
  }
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
  target: 'shape',
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
  it('marks explicit health accessibly without coloring normal shapes and resets its reason', () => {
    const index = build();
    const statusView: StatusView = {
      state: 'down',
      reason: 'Device down',
      conditionKey: 'health',
      queryIds: ['up'],
      coverage: { available: 1, expected: 1 },
    };
    const p: PlanCellPatch = { ...patch('n1', {}), statusView };
    const prev = applyPatches(index, new Map([['n1', p]]), new Set());
    expect(index.get('n1')!.group.getAttribute('data-dmap-status')).toBe('down');
    expect(index.get('n1')!.group.getAttribute('data-dmap-reason')).toBe('Device down');
    expect(index.get('n1')!.group.getAttribute('aria-label')).toBe('rtr-a: down. Device down');
    const normal: PlanCellPatch = { ...p, statusView: { ...statusView, state: 'normal', reason: 'Healthy' } };
    applyPatches(index, new Map([['n1', normal]]), prev);
    expect((index.get('n1')!.shape as SVGElement).style.fill).toBe(index.get('n1')!.original.fill);
    applyPatches(index, new Map(), prev);
    expect(index.get('n1')!.group.hasAttribute('data-dmap-reason')).toBe(false);
  });
  it('fills a shape through style and tags the group', () => {
    const index = build();
    const patches: PatchMap = new Map([['n1', patch('n1', { shape: shape() })]]);
    const done = applyPatches(index, patches, new Set());
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.fill).toMatch(RED);
    expect(rect.getAttribute('fill')).toBe('#fff');
    expect(index.get('n1')!.group.getAttribute('data-dmap-status')).toBe('ok');
    expect(index.get('n1')!.group.getAttribute('data-dmap-step')).toBe('0');
    expect(index.get('n1')!.group.getAttribute('tabindex')).toBe('0');
    expect(index.get('n1')!.group.getAttribute('role')).toBe('button');
    expect(index.get('n1')!.group.getAttribute('aria-label')).toBe('rtr-a');
    expect([...done]).toEqual(['n1']);
  });
  it('makes a patched cell focusable only when it is interactive', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape() })],
      ['n2', patch('n2', { shape: shape() })],
    ]);
    applyPatches(index, patches, new Set(), new Set(['n1']));
    expect(index.get('n1')!.group.getAttribute('role')).toBe('button');
    expect(index.get('n2')!.group.hasAttribute('role')).toBe(false);
    expect(index.get('n2')!.group.hasAttribute('tabindex')).toBe(false);
    expect(index.get('n2')!.group.getAttribute('aria-label')).toBe('old');
    expect(index.get('n2')!.group.getAttribute('data-dmap-status')).toBe('ok');
  });
  it('marks the interactive cells and clears the cells that are no longer interactive', () => {
    const index = build();
    const prev = markInteractive(index, new Set(['n1', 'i1', 'missing']), new Set());
    expect([...prev].sort()).toEqual(['i1', 'n1']);
    expect(index.get('i1')!.group.hasAttribute('data-dmap-interactive')).toBe(true);
    expect(index.get('n2')!.group.hasAttribute('data-dmap-interactive')).toBe(false);
    markInteractive(index, new Set(['n2']), prev);
    expect(index.get('n1')!.group.hasAttribute('data-dmap-interactive')).toBe(false);
    expect(index.get('i1')!.group.hasAttribute('data-dmap-interactive')).toBe(false);
    expect(index.get('n2')!.group.hasAttribute('data-dmap-interactive')).toBe(true);
  });
  it('strokes and writes text into tspan and foreignObject', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape({ target: 'stroke', text: 'rtr-a 1' }) })],
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
    expect(index.get('n1')!.group.hasAttribute('tabindex')).toBe(false);
    expect(index.get('e1')!.line!.style.strokeOpacity).toBe('');
  });
});

describe('applyPatches on a native text label (demo-l3)', () => {
  it('writes the text and restores it on reset', () => {
    const raw = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8');
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(raw).svg));
    const entry = index.get('pg-node~rtr-a')!;
    expect(entry.label!.localName).toBe('text');
    const before = entry.label!.outerHTML;
    const round = (text: string) => new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape({ text }) })]]);
    const prev = applyPatches(index, round('up 1'), new Set());
    expect(entry.label!.textContent).toBe('up 1');
    applyPatches(index, new Map(), prev);
    expect(entry.label!.outerHTML).toBe(before);
  });
  it('writes a multi-line label into its first line and restores every line on reset', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-cell-id="n"><g><rect width="5" height="5"/></g><g><g fill="#000"><text x="1" y="2">first</text><text x="1" y="4"><tspan fill="red">sec</tspan>ond</text></g></g></g></svg>`;
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
    const raw = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/legacy-html-labels.svg'), 'utf8');
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
    expect(lines(entry.label!)).toEqual(['rtr-a', 'multi-WAN + PBR']);
    const round = () => new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape() })]]);
    const prev = applyPatches(index, round(), new Set());
    applyPatches(index, round(), prev);
    expect(entry.label!.innerHTML).toBe(before);
    expect(lines(entry.label!)).toEqual(['rtr-a', 'multi-WAN + PBR']);
  });
  it('restores the exact markup after a text patch', () => {
    const { index, entry, before } = load();
    const round = (text: string) => new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape({ text }) })]]);
    let prev = applyPatches(index, round('up 1'), new Set());
    prev = applyPatches(index, round('up 2'), prev);
    expect(entry.label!.textContent).toBe('up 2');
    applyPatches(index, new Map(), prev);
    expect(entry.label!.innerHTML).toBe(before);
    expect(lines(entry.label!)).toEqual(['rtr-a', 'multi-WAN + PBR']);
  });
});

describe('applyPatches shape targets', () => {
  const iconOf = (index: CellIndex, id: string) => index.get(id)!.shape as SVGElement;
  it('icon: fills the first shape of the icon cell and leaves the node shape alone', () => {
    const index = build();
    index.get('n1')!.iconId = 'i1';
    const prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'icon' }) })]]), new Set());
    expect(iconOf(index, 'i1').style.fill).toMatch(RED);
    expect((index.get('n1')!.shape as SVGElement).style.fill).not.toMatch(RED);
    expect((index.get('n1')!.shape as SVGElement).style.stroke).not.toMatch(RED);
    expect(index.get('n1')!.group.getAttribute('data-dmap-target')).toBe('icon');
    applyPatches(index, new Map(), prev);
    expect(iconOf(index, 'i1').style.fill).toBe('rgb(79, 154, 166)');
    expect(index.get('n1')!.group.hasAttribute('data-dmap-target')).toBe(false);
  });
  it('icon: falls back to the stroke without an icon cell', () => {
    const index = build();
    applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'icon' }) })]]), new Set());
    expect((index.get('n1')!.shape as SVGElement).style.stroke).toMatch(RED);
    expect(index.get('n1')!.group.getAttribute('data-dmap-target')).toBe('stroke');
  });
  it('icon: falls back to the stroke when the icon is a bitmap image', () => {
    const index = build();
    index.get('n2')!.iconId = 'i2';
    applyPatches(index, new Map([['n2', patch('n2', { shape: shape({ target: 'icon' }) })]]), new Set());
    expect((index.get('n2')!.shape as SVGElement).style.stroke).toMatch(RED);
    expect(index.get('n2')!.group.getAttribute('data-dmap-target')).toBe('stroke');
  });
  it('stroke: colours and widens the outline, the reset puts the width back', () => {
    const index = build();
    const prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'stroke' }) })]]), new Set());
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.stroke).toMatch(RED);
    expect(rect.style.strokeWidth).toBe('2');
    applyPatches(index, new Map(), prev);
    expect(rect.style.strokeWidth).toBe('');
  });
  it('none: colours nothing', () => {
    const index = build();
    applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'none', text: 't' }) })]]), new Set());
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.fill).not.toMatch(RED);
    expect(rect.style.stroke).not.toMatch(RED);
    expect(index.get('n1')!.label!.textContent).toBe('t');
  });
});

describe('applyPatches with a patched icon cell', () => {
  it('keeps the icon colour of the node when the icon cell has its own patch (url only)', () => {
    const index = build();
    index.get('n1')!.iconId = 'i1';
    const patches: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape({ target: 'icon' }) })],
      ['i1', patch('i1', { urls: [{ title: 'u', url: '/x' }] })],
    ]);
    const prev = applyPatches(index, patches, new Set());
    applyPatches(index, patches, prev);
    expect((index.get('i1')!.shape as SVGElement).style.fill).toMatch(RED);
  });
});
