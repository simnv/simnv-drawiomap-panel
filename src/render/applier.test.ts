import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { colorManipulator, createTheme } from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { noDataColor, statusColor, tintFill } from '../binding/color';
import type { CellIndex, CellPatch, HalfState, PatchMap, ShapeState } from '../types';
import { applyKey, applyPatches, INTERACTIVE_ATTR, markInteractive } from './applier';
import { clearOwnedAttrs, setOwnedAttrs } from './cellAttrs';
import { sanitizeSvg } from './sanitize';
import { buildCellIndex, mountSvg } from './svgStage';
import { renderOverlay } from './overlay';
import type { StatusView } from '../binding/status';
import type { StatusV4 } from '../binding/statusV4';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g data-cell-id="n1"><g><rect x="10" y="10" width="50" height="30" fill="#fff" style="fill: light-dark(#fff, #111); stroke: #000;"/></g><g><text><tspan>rtr-a</tspan></text></g></g>
  <g data-cell-id="n2"><g><rect x="10" y="50" width="50" height="30"/></g><g><switch><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><div>old</div></div></foreignObject></switch></g></g>
  <g data-cell-id="i1"><g><ellipse cx="20" cy="20" rx="5" ry="5" fill="#4f9aa6" style="fill: rgb(79, 154, 166);"/><path d="M 0 0 L 1 1" fill="#fff"/></g></g>
  <g data-cell-id="i2"><g><image x="10" y="50" width="10" height="10"/></g></g>
  <g data-cell-id="e1"><g><path d="M 60 25 L 150 25" fill="none" stroke="#333" stroke-width="2" pointer-events="stroke"/><path d="M 150 20 L 160 25 L 150 30 Z" fill="#333" pointer-events="all"/></g></g>
  <g data-cell-id="n3"><g><rect x="100" y="50" width="50" height="30" fill="#d5e8d4" stroke="#82b366" stroke-width="4"/></g></g>
  <g data-cell-id="n4"><g><rect x="100" y="10" width="50" height="30" fill="url(#g)"/></g></g>
  <g data-cell-id="n5"><g><rect x="150" y="50" width="20" height="20" style="fill: light-dark(#fff, #111) !important; stroke: #000 !important; stroke-width: 4px !important;"/></g></g>
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
  for (const id of ['n3', 'n4', 'n5']) {
    const node = g(id);
    const rect = node.querySelector('rect')!;
    index.set(id, {
      meta: cellMetaFromAttrs(id, {}, false, id),
      group: node,
      shape: rect,
      arrows: [],
      original: { fill: rect.style.fill, stroke: rect.style.stroke, strokeWidth: rect.style.strokeWidth },
    });
  }
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
  scope: { cell: {} },
  urls: [],
  ...p,
});

describe('applyPatches', () => {
  it('paints an unavailable cell grey with data-dmap-status="unavailable"; the drawn fill comes back only without the patch', () => {
    const index = build();
    const GREY = /^(#999999|rgb\(153, 153, 153\))$/;
    const unavailable = { reason: 'Pattern X is not applied', color: '#999999' };
    const patches = new Map([
      ['n1', patch('n1', { unavailable })],
      ['e1', patch('e1', { unavailable })],
    ]);
    const n1 = index.get('n1')!;
    const e1 = index.get('e1')!;
    const original = (n1.shape as SVGElement).style.fill;
    let prev = applyPatches(index, patches);
    expect((n1.shape as SVGElement).style.fill).toMatch(GREY);
    expect(n1.group.getAttribute('data-dmap-status')).toBe('unavailable');
    expect(n1.group.getAttribute('data-dmap-reason')).toBe('Pattern X is not applied');
    expect(n1.group.getAttribute('aria-label')).toBe('rtr-a: unavailable. Pattern X is not applied');
    expect(e1.line!.style.stroke).toMatch(GREY);
    expect(e1.group.getAttribute('data-dmap-status')).toBe('unavailable');
    // the next apply resets and paints again: the grey stays, the drawn fill does not come back
    prev = applyPatches(index, patches, prev);
    expect((n1.shape as SVGElement).style.fill).toMatch(GREY);
    expect(e1.line!.style.stroke).toMatch(GREY);
    applyPatches(index, new Map(), prev);
    expect((n1.shape as SVGElement).style.fill).toBe(original);
    expect(e1.line!.style.stroke).toBe('');
    expect(n1.group.getAttribute('data-dmap-status')).toBeNull();
  });
  it('marks explicit health accessibly, leaves a normal shape alone and resets its reason', () => {
    const index = build();
    const statusView: StatusView = {
      state: 'down',
      reason: 'Device down',
      conditionKey: 'health',
      queryIds: ['up'],
      coverage: { available: 1, expected: 1 },
    };
    const p: CellPatch = { ...patch('n1', {}), statusView };
    const prev = applyPatches(index, new Map([['n1', p]]));
    expect(index.get('n1')!.group.getAttribute('data-dmap-status')).toBe('down');
    expect(index.get('n1')!.group.getAttribute('data-dmap-reason')).toBe('Device down');
    expect(index.get('n1')!.group.getAttribute('aria-label')).toBe('rtr-a: down. Device down');
    const normal: CellPatch = { ...p, statusView: { ...statusView, state: 'normal', reason: 'Healthy' } };
    applyPatches(index, new Map([['n1', normal]]), prev);
    expect((index.get('n1')!.shape as SVGElement).style.fill).toBe(index.get('n1')!.original.fill);
    applyPatches(index, new Map(), prev);
    expect(index.get('n1')!.group.hasAttribute('data-dmap-reason')).toBe(false);
  });
  it('fills a shape through style and tags the group', () => {
    const index = build();
    const patches: PatchMap = new Map([['n1', patch('n1', { shape: shape() })]]);
    const done = applyPatches(index, patches);
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.fill).toMatch(RED);
    expect(rect.getAttribute('fill')).toBe('#fff');
    expect(index.get('n1')!.group.getAttribute('data-dmap-status')).toBe('ok');
    expect(index.get('n1')!.group.getAttribute('data-dmap-step')).toBe('0');
    expect(index.get('n1')!.group.getAttribute('tabindex')).toBe('0');
    expect(index.get('n1')!.group.getAttribute('role')).toBe('button');
    expect(index.get('n1')!.group.getAttribute('aria-label')).toBe('rtr-a');
    expect([...done.keys.keys()]).toEqual(['n1']);
    expect(done.index).toBe(index);
  });
  it('makes a patched cell focusable only when it is interactive', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape() })],
      ['n2', patch('n2', { shape: shape() })],
    ]);
    applyPatches(index, patches, undefined, new Set(['n1']));
    expect(index.get('n1')!.group.getAttribute('role')).toBe('button');
    expect(index.get('n2')!.group.hasAttribute('role')).toBe(false);
    expect(index.get('n2')!.group.hasAttribute('tabindex')).toBe(false);
    expect(index.get('n2')!.group.getAttribute('aria-label')).toBe('old');
    expect(index.get('n2')!.group.getAttribute('data-dmap-status')).toBe('ok');
  });
  it('a refresh keeps the tab stops and roles of the binding editor on cells without a card', () => {
    const index = build();
    const patches: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape() })],
      ['n2', patch('n2', { shape: shape() })],
    ]);
    // the panel applies the patches, then the binding editor makes every cell a button
    let prev = applyPatches(index, patches, undefined, new Set(['n1']));
    for (const [id, cell] of index) {
      setOwnedAttrs(cell.group, 'editor', { tabindex: '0', role: 'button', 'aria-label': `${id} diagram element` });
    }
    // two data refreshes with the same selection
    prev = applyPatches(index, patches, prev, new Set(['n1']));
    prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape() })]]), prev, new Set());
    for (const [id, cell] of index) {
      expect(cell.group.getAttribute('tabindex'), id).toBe('0');
      expect(cell.group.getAttribute('role'), id).toBe('button');
      expect(cell.group.getAttribute('aria-label'), id).toBe(`${id} diagram element`);
    }
    // the editor closes: only the applier attributes stay
    index.forEach((cell) => clearOwnedAttrs(cell.group, 'editor'));
    expect(index.get('n1')!.group.hasAttribute('role')).toBe(false);
    expect(index.get('n1')!.group.getAttribute('aria-label')).toBe('rtr-a');
    expect(index.get('n2')!.group.hasAttribute('tabindex')).toBe(false);
    expect(index.get('n2')!.group.hasAttribute('aria-label')).toBe(false);
  });
  it('marks the interactive cells and clears the cells that are no longer interactive', () => {
    const index = build();
    const prev = markInteractive(index, new Set(['n1', 'i1', 'missing']));
    expect([...prev.ids].sort()).toEqual(['i1', 'n1']);
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
    applyPatches(index, patches);
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
    applyPatches(index, patches);
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
    applyPatches(index, patches);
    expect(index.get('e1')!.group.getAttribute('data-dmap-status')).toBe('nodata');
    expect(index.get('e1')!.group.getAttribute('data-dmap-step')).toBe('-1');
  });
  it('resets cells that are no longer patched', () => {
    const index = build();
    const first: PatchMap = new Map([
      ['n1', patch('n1', { shape: shape({ text: 'x' }) })],
      ['e1', patch('e1', { link: { a2b: ok() } })],
    ]);
    const prev = applyPatches(index, first);
    const done = applyPatches(index, new Map(), prev);
    expect(done.keys.size).toBe(0);
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
    const prev = applyPatches(index, round('up 1'));
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
    let prev = applyPatches(index, new Map([['n', patch('n', { shape: shape({ text: 'up' }) })]]));
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
    let prev = applyPatches(index, new Map([['n', patch('n', { shape: shape({ text: 'x' }) })]]));
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
    const prev = applyPatches(index, round());
    applyPatches(index, round(), prev);
    expect(entry.label!.innerHTML).toBe(before);
    expect(lines(entry.label!)).toEqual(['rtr-a', 'multi-WAN + PBR']);
  });
  it('restores the exact markup after a text patch', () => {
    const { index, entry, before } = load();
    const round = (text: string) => new Map([['pg-node~rtr-a', patch('pg-node~rtr-a', { shape: shape({ text }) })]]);
    let prev = applyPatches(index, round('up 1'));
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
    const prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'icon' }) })]]));
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
    applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'icon' }) })]]));
    expect((index.get('n1')!.shape as SVGElement).style.stroke).toMatch(RED);
    expect(index.get('n1')!.group.getAttribute('data-dmap-target')).toBe('stroke');
  });
  it('icon: falls back to the stroke when the icon is a bitmap image', () => {
    const index = build();
    index.get('n2')!.iconId = 'i2';
    applyPatches(index, new Map([['n2', patch('n2', { shape: shape({ target: 'icon' }) })]]));
    expect((index.get('n2')!.shape as SVGElement).style.stroke).toMatch(RED);
    expect(index.get('n2')!.group.getAttribute('data-dmap-target')).toBe('stroke');
  });
  it('stroke: colours and widens the outline, the reset puts the width back', () => {
    const index = build();
    const prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'stroke' }) })]]));
    const rect = index.get('n1')!.shape as SVGElement;
    expect(rect.style.stroke).toMatch(RED);
    expect(rect.style.strokeWidth).toBe('2');
    applyPatches(index, new Map(), prev);
    expect(rect.style.strokeWidth).toBe('');
  });
  it('none: colours nothing', () => {
    const index = build();
    applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ target: 'none', text: 't' }) })]]));
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
    const prev = applyPatches(index, patches);
    applyPatches(index, patches, prev);
    expect((index.get('i1')!.shape as SVGElement).style.fill).toMatch(RED);
  });
  it('keeps the icon colour when the patch of the icon cell changes or goes; the icon keeps its own grey when the node changes', () => {
    const index = build();
    index.get('n1')!.iconId = 'i1';
    index.get('i1')!.ownerId = 'n1';
    const icon = () => index.get('i1')!.shape as SVGElement;
    const node = (color = '#ff0000') => patch('n1', { shape: shape({ target: 'icon', color }) });
    // a normal status: a new key for the icon cell, and no paint of its own
    const statusView: StatusView = {
      state: 'normal',
      reason: 'Healthy',
      conditionKey: 'k',
      queryIds: ['q'],
      coverage: { available: 1, expected: 1 },
    };
    let prev = applyPatches(
      index,
      new Map([
        ['n1', node()],
        ['i1', patch('i1', {})],
      ])
    );
    expect(icon().style.fill).toMatch(RED);
    // the icon cell gets a status (a new key), the node does not change: the icon keeps the node colour
    prev = applyPatches(
      index,
      new Map<string, CellPatch>([
        ['n1', node()],
        ['i1', { ...patch('i1', {}), statusView }],
      ]),
      prev
    );
    expect(icon().style.fill).toMatch(RED);
    expect(index.get('i1')!.group.getAttribute('data-dmap-status')).toBe('normal');
    // the patch of the icon cell goes: the icon keeps the node colour
    prev = applyPatches(index, new Map([['n1', node()]]), prev);
    expect(icon().style.fill).toMatch(RED);
    // the icon cell is unavailable (grey on its own shape) and the node changes colour: the grey wins, as in a full apply
    const grey = { reason: 'Pattern X is not applied', color: '#999999' };
    prev = applyPatches(
      index,
      new Map([
        ['n1', node()],
        ['i1', patch('i1', { unavailable: grey })],
      ]),
      prev
    );
    expect(icon().style.fill).toMatch(/^(#999999|rgb\(153, 153, 153\))$/);
    prev = applyPatches(
      index,
      new Map([
        ['n1', node('#00ff00')],
        ['i1', patch('i1', { unavailable: grey })],
      ]),
      prev
    );
    expect(icon().style.fill).toMatch(/^(#999999|rgb\(153, 153, 153\))$/);
    // nothing patched: the icon's own fill comes back
    applyPatches(index, new Map(), prev);
    expect(icon().style.fill).toBe('rgb(79, 154, 166)');
  });
  it('a changed description of the node leaves the grey of the icon cell in place (the closure reaches the icon)', () => {
    const index = build();
    index.get('n1')!.iconId = 'i1';
    index.get('i1')!.ownerId = 'n1';
    // n2 stands for a description of n1: a part outside the node group
    index.get('n2')!.ownerId = 'n1';
    const grey = { reason: 'Pattern X is not applied', color: '#999999' };
    const GREY = /^(#999999|rgb\(153, 153, 153\))$/;
    const round = (text: string): PatchMap =>
      new Map([
        ['n1', patch('n1', { shape: shape({ target: 'icon' }) })],
        ['i1', patch('i1', { unavailable: grey })],
        ['n2', patch('n2', { shape: shape({ target: 'none', text }) })],
      ]);
    const prev = applyPatches(index, round('one'));
    expect((index.get('i1')!.shape as SVGElement).style.fill).toMatch(GREY);
    applyPatches(index, round('two'), prev);
    expect((index.get('i1')!.shape as SVGElement).style.fill).toMatch(GREY);
    expect(index.get('n2')!.label!.textContent).toBe('two');
  });
});

describe('applyPatches on the dot of a bare link end (bare-end-dot)', () => {
  const ID = 'pg-link~dot-a-b';
  const load = () => {
    const raw = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/bare-end-dot.svg'), 'utf8');
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(raw).svg));
    const [start, end] = index.get(ID)!.ends!.map((e) => e.el as SVGElement);
    return { index, entry: index.get(ID)!, start, end };
  };
  const link = (l: CellPatch['link']): PatchMap => new Map([[ID, patch(ID, { link: l })]]);
  const AMBER = /ff8800|255, 136, 0/;
  const BLUE = /0000ff|0, 0, 255/;

  it('indexes the ellipses of the edge group as end markers', () => {
    expect(load().entry.ends).toHaveLength(2);
  });
  it('paints each dot with the colour of the half at its end, fill and stroke', () => {
    const { index, start, end } = load();
    applyPatches(index, link({ a2b: ok({ color: '#ff8800' }), b2a: ok({ color: '#0000ff' }) }));
    expect(start.style.fill).toMatch(AMBER);
    expect(start.style.stroke).toMatch(AMBER);
    expect(end.style.fill).toMatch(BLUE);
    // the end dot has stroke="none": no stroke is added
    expect(end.style.stroke).toBe('');
  });
  it('paints both dots with the colour of the only half', () => {
    const { index, start, end } = load();
    let prev = applyPatches(index, link({ a2b: ok({ color: '#ff8800' }) }));
    expect(start.style.fill).toMatch(AMBER);
    expect(end.style.fill).toMatch(AMBER);
    prev = applyPatches(index, link({ b2a: ok({ color: '#0000ff' }) }), prev);
    expect(start.style.fill).toMatch(BLUE);
    expect(end.style.fill).toMatch(BLUE);
  });
  it('restores the original paint when the link has no patch any more', () => {
    const { index, start, end } = load();
    const before = [start, end].map((e) => [e.style.fill, e.style.stroke]);
    const prev = applyPatches(index, link({ a2b: ok({ color: '#ff8800' }), b2a: ok({ color: '#0000ff' }) }));
    applyPatches(index, new Map(), prev);
    expect([start, end].map((e) => [e.style.fill, e.style.stroke])).toEqual(before);
  });
  it('restores the original paint when a refresh patch has no halves', () => {
    const { index, start } = load();
    const before = start.style.fill;
    let prev = applyPatches(index, link({ a2b: ok({ color: '#ff8800' }) }));
    prev = applyPatches(index, link({}), prev);
    expect(start.style.fill).toBe(before);
  });
});

describe('end markers: which shapes count and how they are painted', () => {
  const LINE = '<path d="M 10 30 L 200 30" fill="none" stroke="#333" stroke-width="2" pointer-events="stroke"/>';
  const load = (inner: string, wrapper = '') => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 60"><g data-cell-id="e"><g${wrapper}>${LINE}${inner}</g></g></svg>`;
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    return { index, entry: index.get('e')! };
  };
  const both = (): PatchMap =>
    new Map([['e', patch('e', { link: { a2b: ok({ color: '#ff8800' }), b2a: ok({ color: '#0000ff' }) } })]]);
  const AMBER = /ff8800|255, 136, 0/;
  const BLUE = /0000ff|0, 0, 255/;

  it('indexes only a circle or ellipse that sits on an end of the path', () => {
    const { entry } = load(
      '<circle cx="105" cy="30" r="9" fill="#fff"/><ellipse cx="10" cy="30" rx="4" ry="4" fill="#333"/><circle cx="105" cy="60" r="4"/>'
    );
    expect(entry.ends).toHaveLength(1);
    expect(entry.ends![0].el.getAttribute('cx')).toBe('10');
  });
  it('does not paint a circular label background in the middle of the edge', () => {
    const { index, entry } = load(
      '<circle id="bg" cx="105" cy="30" r="9" fill="#fff"/><ellipse cx="200" cy="30" rx="4" ry="4" fill="#333"/>'
    );
    applyPatches(index, both());
    expect(entry.group.querySelector<SVGElement>('#bg')!.style.fill).toBe('');
    expect((entry.ends![0].el as SVGElement).style.fill).toMatch(BLUE);
  });
  it('assigns a marker with a translate to the end that it sits on', () => {
    const { index, entry } = load('<circle cx="0" cy="0" r="4" fill="#333" transform="translate(200,30)"/>');
    expect(entry.ends).toHaveLength(1);
    applyPatches(index, both());
    expect((entry.ends![0].el as SVGElement).style.fill).toMatch(BLUE);
  });
  it('resolves a transform on the group of the edge for the path and the marker alike', () => {
    const { index, entry } = load('<circle cx="10" cy="30" r="4" fill="#333"/>', ' transform="translate(0.5,0.5)"');
    applyPatches(index, both());
    expect((entry.ends![0].el as SVGElement).style.fill).toMatch(AMBER);
  });
  it('does not paint a transparent fill and paints an inline-only stroke', () => {
    const { index, entry } = load(
      '<circle cx="10" cy="30" r="4" fill="none" style="stroke: #333"/><circle cx="200" cy="30" r="4" fill="transparent" fill-opacity="0" stroke="none"/>'
    );
    applyPatches(index, both());
    const [a, b] = entry.ends!.map((e) => e.el as SVGElement);
    expect(a.style.stroke).toMatch(AMBER);
    expect(a.style.fill).toBe('');
    expect(b.style.fill).toBe('');
    expect(b.style.stroke).toBe('');
  });
  describe.each([
    ['the transparent branch', 'rgba(0, 0, 0, 0)', false],
    ['the opaque branch', 'rgb(51, 51, 51)', true],
  ])('an inline light-dark() fill, %s resolved', (_name, resolved, painted) => {
    afterEach(() => vi.restoreAllMocks());
    it(`${painted ? 'paints' : 'leaves'} the dot by the computed fill`, () => {
      const { index, entry } = load('<circle cx="10" cy="30" r="4" style="fill: light-dark(transparent, #333)"/>');
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (p: string) => (p === 'fill' ? resolved : ''),
      } as unknown as CSSStyleDeclaration);
      applyPatches(index, both());
      const m = entry.ends![0].el as SVGElement;
      expect(/ff8800|255, 136, 0/.test(m.style.fill)).toBe(painted);
    });
  });
  it('restores the CSS priority of the original inline paint', () => {
    const { index, entry } = load('<circle cx="10" cy="30" r="4" style="fill: #333 !important"/>');
    const m = entry.ends![0].el as SVGElement;
    const prev = applyPatches(index, both());
    expect(m.style.getPropertyPriority('fill')).toBe('important');
    applyPatches(index, new Map(), prev);
    expect(m.style.getPropertyValue('fill')).toMatch(/#333|51, 51, 51/);
    expect(m.style.getPropertyPriority('fill')).toBe('important');
  });
});

describe('end markers: unusable geometry and cost', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 60"><g data-cell-id="e"><g><path d="M 10 30 L 200 30" fill="none" stroke="#333" pointer-events="stroke"/><circle cx="10" cy="30" r="4" fill="#333"/></g></g></svg>`;
  const withCtm = (fn: () => SVGMatrix | null, run: () => void) => {
    const proto = Element.prototype as unknown as { getCTM?: () => unknown };
    proto.getCTM = fn as never;
    try {
      run();
    } finally {
      delete proto.getCTM;
    }
  };
  const ident = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as SVGMatrix;
  it('skips a marker whose matrix is singular or not finite', () => {
    for (const m of [
      { ...ident, a: 0, d: 0 },
      { ...ident, e: NaN },
      { ...ident, d: 1e-12 },
    ] as SVGMatrix[]) {
      withCtm(
        () => m,
        () => expect(buildCellIndex(mountSvg(document.createElement('div'), SVG)).get('e')!.ends).toHaveLength(0)
      );
    }
  });
  it('keeps a marker when it and its line share a small uniform scale: the matrix between them is the identity', () => {
    withCtm(
      () => ({ ...ident, a: 1e-6, d: 1e-6 }) as SVGMatrix,
      () =>
        expect(buildCellIndex(mountSvg(document.createElement('div'), SVG)).get('e')!.ends).toEqual([
          expect.objectContaining({ end: 'start' }),
        ])
    );
  });
  it('computes the end once at index time and never asks for a matrix while painting', () => {
    const getCTM = vi.fn(() => ident);
    withCtm(getCTM, () => {
      const index = buildCellIndex(mountSvg(document.createElement('div'), SVG));
      expect(index.get('e')!.ends).toEqual([expect.objectContaining({ end: 'start' })]);
      getCTM.mockClear();
      const link = { a2b: ok({ color: '#ff8800' }), b2a: ok({ color: '#0000ff' }) };
      const prev = applyPatches(index, new Map([['e', patch('e', { link })]]));
      applyPatches(index, new Map([['e', patch('e', { link })]]), prev);
      expect(getCTM).not.toHaveBeenCalled();
      expect((index.get('e')!.ends![0].el as SVGElement).style.fill).toMatch(/ff8800|255, 136, 0/);
    });
  });
});

describe('applyPatches diff', () => {
  const statusView: StatusView = {
    state: 'down',
    reason: 'Device down',
    conditionKey: 'health',
    queryIds: ['up'],
    coverage: { available: 1, expected: 1 },
  };
  /** The patches of one refresh: a coloured node, a two-way link and a status cell. New objects on every call. */
  const round = (color = '#ff0000'): Map<string, CellPatch> =>
    new Map<string, CellPatch>([
      ['n1', patch('n1', { shape: shape({ color, text: 'up' }) })],
      ['e1', patch('e1', { link: { a2b: ok(), b2a: ok({ color: '#0000ff' }) } })],
      ['n2', { ...patch('n2', {}), statusView }],
    ]);
  const observe = (index: CellIndex) => {
    const root = index.get('n1')!.group.closest('svg')!;
    const observer = new MutationObserver(() => {});
    observer.observe(root, { attributes: true, childList: true, subtree: true, characterData: true });
    return observer;
  };
  it('a second apply with equal patches of new objects writes nothing', () => {
    const index = build();
    const prev = applyPatches(index, round(), undefined, new Set(['n1']));
    const observer = observe(index);
    const done = applyPatches(index, round(), prev, new Set(['n1']));
    expect(observer.takeRecords()).toHaveLength(0);
    expect(done.keys).toEqual(prev.keys);
    expect((index.get('n1')!.shape as SVGElement).style.fill).toMatch(RED);
    expect(index.get('n2')!.group.getAttribute('data-dmap-status')).toBe('down');
  });
  it('a changed colour writes that cell only', () => {
    const index = build();
    const prev = applyPatches(index, round());
    const observer = observe(index);
    applyPatches(index, round('#00ff00'), prev);
    const records = observer.takeRecords();
    expect(records.length).toBeGreaterThan(0);
    const n1 = index.get('n1')!.group;
    records.forEach((r) => expect(n1.contains(r.target)).toBe(true));
    expect((index.get('n1')!.shape as SVGElement).style.fill).toMatch(/^(#00ff00|rgb\(0, 255, 0\))$/);
  });
  it('a removed cell is reset and the others are not touched', () => {
    const index = build();
    const prev = applyPatches(index, round());
    const observer = observe(index);
    const next = round();
    next.delete('e1');
    const done = applyPatches(index, next, prev);
    const e1 = index.get('e1')!;
    const records = observer.takeRecords();
    expect(records.length).toBeGreaterThan(0);
    records.forEach((r) => expect(e1.group.contains(r.target)).toBe(true));
    expect(e1.line!.style.strokeOpacity).toBe('');
    expect([...done.keys.keys()].sort()).toEqual(['n1', 'n2']);
  });
  it('a changed interactive flag rewrites the tab stop of that cell', () => {
    const index = build();
    const prev = applyPatches(index, round(), undefined, new Set(['n1']));
    expect(index.get('n1')!.group.getAttribute('role')).toBe('button');
    const observer = observe(index);
    applyPatches(index, round(), prev, new Set());
    expect(index.get('n1')!.group.hasAttribute('role')).toBe(false);
    observer.takeRecords().forEach((r) => expect(index.get('n1')!.group.contains(r.target)).toBe(true));
  });
  it('a shape whose step or status changes with the same colour gets the new data attributes', () => {
    const index = build();
    const group = index.get('n1')!.group;
    let prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ stepIndex: 0 }) })]]));
    expect(group.getAttribute('data-dmap-step')).toBe('0');
    prev = applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ stepIndex: 2 }) })]]), prev);
    expect(group.getAttribute('data-dmap-step')).toBe('2');
    applyPatches(index, new Map([['n1', patch('n1', { shape: shape({ stepIndex: 2, status: 'nodata' }) })]]), prev);
    expect(group.getAttribute('data-dmap-status')).toBe('nodata');
  });
  it('another theme or OS colour scheme resets and writes every cell; the same scheme again writes nothing', () => {
    const index = build();
    const light = { theme: createTheme({ colors: { mode: 'light' } }), osDark: false };
    const dark = createTheme({ colors: { mode: 'dark' } });
    let prev = applyPatches(index, round(), undefined, undefined, light);
    const observer = observe(index);
    const everyCell = () => {
      const touched = observer.takeRecords().map((r) => r.target);
      for (const id of ['n1', 'e1', 'n2']) {
        expect(
          touched.some((t) => index.get(id)!.group.contains(t)),
          id
        ).toBe(true);
      }
    };
    // the theme
    prev = applyPatches(index, round(), prev, undefined, { theme: dark, osDark: false });
    everyCell();
    expect(prev.scheme).toMatchObject({ isDark: true, osDark: false });
    // the OS preference, with the same theme
    prev = applyPatches(index, round(), prev, undefined, { theme: dark, osDark: true });
    everyCell();
    // the same scheme again: nothing
    applyPatches(index, round(), prev, undefined, { theme: dark, osDark: true });
    expect(observer.takeRecords()).toHaveLength(0);
  });
  it('markInteractive with the same ids makes no mutation, and marks the cells of a new stage', () => {
    const index = build();
    const prev = markInteractive(index, new Set(['n1', 'n2']));
    const observer = observe(index);
    markInteractive(index, new Set(['n1', 'n2']), prev);
    expect(observer.takeRecords()).toHaveLength(0);
    const other = build();
    markInteractive(other, new Set(['n1']), prev);
    expect(other.get('n1')!.group.hasAttribute(INTERACTIVE_ATTR)).toBe(true);
  });
  it('an applied set of another index counts as empty: every patch is written, nothing is reset', () => {
    const a = build();
    const b = build();
    const prev = applyPatches(a, round());
    const done = applyPatches(b, round(), prev);
    expect((b.get('n1')!.shape as SVGElement).style.fill).toMatch(RED);
    expect(b.get('e1')!.line!.style.strokeOpacity).toBe('0');
    // the old stage keeps its paint: nothing of it was reset
    expect((a.get('n1')!.shape as SVGElement).style.fill).toMatch(RED);
    expect(done.index).toBe(b);
  });
});

describe('applyPatches status paint', () => {
  const light = createTheme({ colors: { mode: 'light' } });
  const dark = createTheme({ colors: { mode: 'dark' } });
  const view = (state: StatusView['state'], reason = 'Health check failed'): StatusView => ({
    state,
    reason,
    conditionKey: 'health',
    queryIds: ['up'],
    coverage: { available: 1, expected: 1 },
  });
  const withStatus = (cellId: string, state: StatusView['state'], p: Partial<CellPatch> = {}): CellPatch => ({
    ...patch(cellId, p),
    statusView: view(state),
  });
  /** jsdom keeps a hex colour as written or reads it back as rgb(). */
  const expectColour = (actual: string, expected: string) =>
    expect([expected.toLowerCase(), colorManipulator.asRgbString(expected)]).toContain(actual.toLowerCase());
  const red = statusColor({ state: 'down' }, light);
  const rect = (index: CellIndex, id: string) => index.get(id)!.shape as SVGElement;

  it('a down node gets a border in the status colour, 1.5 times its width and at least 2, and a tinted fill', () => {
    const index = build();
    const prev = applyPatches(index, new Map([['n3', withStatus('n3', 'down')]]), undefined, undefined, {
      theme: light,
      osDark: false,
    });
    const n3 = rect(index, 'n3');
    expectColour(n3.style.stroke, red);
    expect(n3.style.strokeWidth).toBe('6');
    expectColour(n3.style.fill, tintFill('#d5e8d4', red)!);
    expect(n3.getAttribute('fill')).toBe('#d5e8d4');
    // a shape without a width: 2
    applyPatches(index, new Map([['n4', withStatus('n4', 'down')]]), prev, undefined, { theme: light, osDark: false });
    expect(rect(index, 'n4').style.strokeWidth).toBe('2');
  });
  it('the paint goes with a normal status and with the patch; the originals come back', () => {
    const index = build();
    const n3 = rect(index, 'n3');
    const ctx = { theme: light, osDark: false };
    let prev = applyPatches(index, new Map([['n3', withStatus('n3', 'warning')]]), undefined, undefined, ctx);
    expectColour(n3.style.stroke, statusColor({ state: 'warning' }, light));
    prev = applyPatches(index, new Map([['n3', withStatus('n3', 'normal')]]), prev, undefined, ctx);
    expect([n3.style.fill, n3.style.stroke, n3.style.strokeWidth]).toEqual(['', '', '']);
    expect(index.get('n3')!.group.getAttribute('data-dmap-status')).toBe('normal');
    prev = applyPatches(index, new Map([['n3', withStatus('n3', 'missing', {})]]), prev, undefined, ctx);
    expectColour(n3.style.stroke, noDataColor(light));
    applyPatches(index, new Map(), prev, undefined, ctx);
    expect([n3.style.fill, n3.style.stroke, n3.style.strokeWidth]).toEqual(['', '', '']);
  });
  it('with a shape target the tint is of the binding colour; with a stroke target the status border wins', () => {
    const index = build();
    const ctx = { theme: light, osDark: false };
    let prev = applyPatches(
      index,
      new Map([['n3', withStatus('n3', 'down', { shape: shape({ color: '#00ff00', target: 'shape' }) })]]),
      undefined,
      undefined,
      ctx
    );
    const n3 = rect(index, 'n3');
    expectColour(n3.style.fill, tintFill('#00ff00', red)!);
    prev = applyPatches(
      index,
      new Map([['n3', withStatus('n3', 'down', { shape: shape({ color: '#00ff00', target: 'stroke' }) })]]),
      prev,
      undefined,
      ctx
    );
    expectColour(n3.style.stroke, red);
    expect(n3.style.strokeWidth).toBe('6');
    // the binding outline alone: the drawn width plus one
    applyPatches(index, new Map([['n3', patch('n3', { shape: shape({ target: 'stroke' }) })]]), prev, undefined, ctx);
    expect(n3.style.strokeWidth).toBe('5');
    expectColour(n3.style.stroke, '#ff0000');
  });
  it('a fill that is not an opaque colour keeps its fill: the border alone shows the status', () => {
    const index = build();
    applyPatches(index, new Map([['n4', withStatus('n4', 'down')]]), undefined, undefined, {
      theme: light,
      osDark: false,
    });
    const n4 = rect(index, 'n4');
    expect(n4.style.fill).toBe('');
    expectColour(n4.style.stroke, red);
  });
  it('an edge without halves takes the status colour on its stroke; a normal status leaves it', () => {
    const index = build();
    const ctx = { theme: light, osDark: false };
    const line = index.get('e1')!.line!;
    let prev = applyPatches(index, new Map([['e1', withStatus('e1', 'down')]]), undefined, undefined, ctx);
    expectColour(line.style.stroke, red);
    expect(line.style.strokeOpacity).toBe('');
    prev = applyPatches(index, new Map([['e1', withStatus('e1', 'missing')]]), prev, undefined, ctx);
    expectColour(line.style.stroke, noDataColor(light));
    applyPatches(index, new Map([['e1', withStatus('e1', 'normal')]]), prev, undefined, ctx);
    expect(line.style.stroke).toBe('');
  });
  it('a link with halves and a down status paints the end dots in the status colour; missing leaves the half colour', () => {
    const ID = 'pg-link~dot-a-b';
    const raw = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/bare-end-dot.svg'), 'utf8');
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(raw).svg));
    const [start, end] = index.get(ID)!.ends!.map((e) => e.el as SVGElement);
    const original = start.style.fill;
    const ctx = { theme: light, osDark: false };
    const link = { a2b: ok({ color: '#ff8800' }), b2a: ok({ color: '#0000ff' }) };
    let prev = applyPatches(index, new Map([[ID, withStatus(ID, 'down', { link })]]), undefined, undefined, ctx);
    expectColour(start.style.fill, red);
    expectColour(end.style.fill, red);
    // the hidden edge stroke stays hidden: the halves show the colour
    expect(index.get(ID)!.line!.style.strokeOpacity).toBe('0');
    prev = applyPatches(index, new Map([[ID, withStatus(ID, 'missing', { link })]]), prev, undefined, ctx);
    expectColour(start.style.fill, '#ff8800');
    expectColour(end.style.fill, '#0000ff');
    applyPatches(index, new Map(), prev, undefined, ctx);
    expect(start.style.fill).toBe(original);
  });
  it('a theme with another palette and the same colour scheme writes the paint again (R1)', () => {
    const index = build();
    const round = () => new Map([['n3', withStatus('n3', 'down')]]);
    const prev = applyPatches(index, round(), undefined, undefined, { theme: dark, osDark: false });
    const palette = createTheme({
      colors: { mode: 'dark' },
      visualization: { hues: [{ name: 'red', shades: [{ name: 'red', color: '#123456', primary: true }] }] },
    });
    expect(palette.isDark).toBe(true);
    expect(statusColor({ state: 'down' }, palette)).toBe('#123456');
    const observer = new MutationObserver(() => {});
    observer.observe(index.get('n3')!.group, { attributes: true, subtree: true });
    const done = applyPatches(index, round(), prev, undefined, { theme: palette, osDark: false });
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    expectColour(rect(index, 'n3').style.stroke, '#123456');
    expect(done.scheme).not.toEqual(prev.scheme);
    // the same palette again: nothing
    applyPatches(index, round(), done, undefined, { theme: palette, osDark: false });
    expect(observer.takeRecords()).toHaveLength(0);
  });
  it('keeps the !important priority of the inline fill, stroke and width, and restores each declaration (R2)', () => {
    const index = build();
    const n5 = rect(index, 'n5');
    const props = ['fill', 'stroke', 'stroke-width'];
    const read = () => props.map((p) => [n5.style.getPropertyValue(p), n5.style.getPropertyPriority(p)]);
    const before = read();
    expect(before.map((d) => d[1])).toEqual(['important', 'important', 'important']);
    const ctx = { theme: light, osDark: false };
    const down = () =>
      new Map([['n5', withStatus('n5', 'down', { shape: shape({ color: '#00ff00', target: 'shape' }) })]]);
    let prev = applyPatches(index, down(), undefined, undefined, ctx);
    expectColour(n5.style.getPropertyValue('stroke'), red);
    expectColour(n5.style.getPropertyValue('fill'), tintFill('#00ff00', red)!);
    expect(n5.style.getPropertyValue('stroke-width')).toBe('6');
    // the written declarations keep the priority of the diagram's
    expect(read().map((d) => d[1])).toEqual(['important', 'important', 'important']);
    prev = applyPatches(index, new Map([['n5', withStatus('n5', 'normal')]]), prev, undefined, ctx);
    expect(read()).toEqual(before);
    prev = applyPatches(index, down(), prev, undefined, ctx);
    applyPatches(index, new Map(), prev, undefined, ctx);
    expect(read()).toEqual(before);
  });
  it('a status-only edge paints its end dots in the status colour too, and restores them (R3)', () => {
    const ID = 'pg-link~dot-a-b';
    const raw = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/bare-end-dot.svg'), 'utf8');
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(raw).svg));
    const [start, end] = index.get(ID)!.ends!.map((e) => e.el as SVGElement);
    const original = start.style.fill;
    const originalStroke = index.get(ID)!.line!.style.stroke;
    const ctx = { theme: light, osDark: false };
    const prev = applyPatches(index, new Map([[ID, withStatus(ID, 'down')]]), undefined, undefined, ctx);
    expectColour(index.get(ID)!.line!.style.stroke, red);
    expectColour(start.style.fill, red);
    expectColour(end.style.fill, red);
    applyPatches(index, new Map([[ID, withStatus(ID, 'normal')]]), prev, undefined, ctx);
    expect(start.style.fill).toBe(original);
    expect(index.get(ID)!.line!.style.stroke).toBe(originalStroke);
  });
  it('an image device gets no style paint: the overlay draws its border (R4)', () => {
    const index = build();
    applyPatches(index, new Map([['i2', withStatus('i2', 'down')]]), undefined, undefined, {
      theme: light,
      osDark: false,
    });
    const image = rect(index, 'i2');
    expect([image.style.stroke, image.style.strokeWidth, image.style.fill]).toEqual(['', '', '']);
    expect(index.get('i2')!.group.getAttribute('data-dmap-status')).toBe('down');
  });
  it('the same status again writes nothing; another theme writes the paint in its own colour', () => {
    const index = build();
    const round = () => new Map([['n3', withStatus('n3', 'down')]]);
    let prev = applyPatches(index, round(), undefined, undefined, { theme: light, osDark: false });
    const observer = new MutationObserver(() => {});
    observer.observe(index.get('n3')!.group, { attributes: true, subtree: true });
    prev = applyPatches(index, round(), prev, undefined, { theme: light, osDark: false });
    expect(observer.takeRecords()).toHaveLength(0);
    applyPatches(index, round(), prev, undefined, { theme: dark, osDark: false });
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    expectColour(rect(index, 'n3').style.stroke, statusColor({ state: 'down' }, dark));
    expect(statusColor({ state: 'down' }, dark)).not.toBe(red);
  });
});

describe('applyKey and the v4 status (Astra R1)', () => {
  const theme = createTheme({ colors: { mode: 'light' } });
  const ctx = { theme, osDark: false };
  const GREEN = '#73bf69';
  const BLUE = '#0000ff';
  /** a v4 status on the v3 patch type: the cut-over (P1-13c) drops the v3 fields */
  const v4 = (over: Partial<StatusV4> = {}): CellPatch => ({
    ...patch('n3', {}),
    statusView: {
      queryIds: ['up'],
      conditionKey: '',
      coverage: { available: 1, expected: 1 },
      state: 'normal',
      severity: 'normal',
      color: GREEN,
      text: 'Up',
      refId: 'up',
      reason: '',
      ...over,
    },
  });
  const expectColour = (actual: string, expected: string) =>
    expect([expected.toLowerCase(), colorManipulator.asRgbString(expected)]).toContain(actual.toLowerCase());

  it.each([
    ['state', { state: 'critical' }],
    ['severity', { severity: 'critical' }],
    ['color', { color: BLUE }],
    ['text', { text: 'Online' }],
    ['refId', { refId: 'scrape_up' }],
    ['reason', { reason: '1 of 2 series have no value' }],
  ] as const)('a change of %s alone gives a new key', (_, over) => {
    expect(applyKey(v4(over), true)).not.toBe(applyKey(v4(), true));
  });
  it('a v3 status keeps its key: state and reason', () => {
    const view: StatusView = {
      state: 'down',
      reason: 'Device down',
      conditionKey: 'health',
      queryIds: ['up'],
      coverage: { available: 1, expected: 1 },
    };
    const p: CellPatch = { ...patch('n3', {}), statusView: view };
    expect(applyKey(p, true)).toBe(applyKey({ ...p, statusView: { ...view, conditionKey: 'other' } }, true));
    expect(applyKey(p, true)).not.toBe(applyKey({ ...p, statusView: { ...view, reason: 'Other' } }, true));
  });
  it('repaints green → blue with the same state and text; blue → transparent removes the paint', () => {
    const index = build();
    const n3 = index.get('n3')!.shape as SVGElement;
    const original = { fill: n3.style.fill, stroke: n3.style.stroke, width: n3.style.strokeWidth };
    let prev = applyPatches(index, new Map([['n3', v4()]]), undefined, undefined, ctx);
    expectColour(n3.style.stroke, GREEN);
    prev = applyPatches(index, new Map([['n3', v4({ color: BLUE })]]), prev, undefined, ctx);
    expectColour(n3.style.stroke, BLUE);
    expectColour(n3.style.fill, tintFill('#d5e8d4', BLUE)!);
    applyPatches(
      index,
      new Map([['n3', v4({ color: theme.visualization.getColorByName('transparent') })]]),
      prev,
      undefined,
      ctx
    );
    expect({ fill: n3.style.fill, stroke: n3.style.stroke, width: n3.style.strokeWidth }).toEqual(original);
    expect(index.get('n3')!.group.getAttribute('data-dmap-status')).toBe('normal');
  });
  it.each(['light', 'dark'] as const)(
    'paints normal v4 link statuses on halves, heads and dots; transparent and missing restore halves (%s)',
    (mode) => {
      const theme = createTheme({ colors: { mode } });
      const ctx = { theme, osDark: mode === 'dark' };
      const id = 'pg-link~dot-a-b';
      const raw = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/bare-end-dot.svg'), 'utf8');
      const root = mountSvg(document.createElement('div'), sanitizeSvg(raw).svg);
      const index = buildCellIndex(root);
      const ends = index.get(id)!.ends!.map((end) => end.el as SVGElement);
      const magenta = theme.visualization.getColorByName('magenta');
      const halfColors = ['#ff8800', '#0000ff'];
      const link = { a2b: ok({ color: halfColors[0] }), b2a: ok({ color: halfColors[1] }) };
      const rounds: Array<{ status: Partial<StatusV4>; colors: string[] }> = [
        { status: { color: magenta, text: 'Offline' }, colors: [magenta, magenta] },
        { status: { color: GREEN }, colors: [GREEN, GREEN] },
        { status: { color: 'transparent' }, colors: halfColors },
        { status: { color: magenta, text: 'Offline' }, colors: [magenta, magenta] },
        { status: { state: 'missing', severity: 'missing', text: '–' }, colors: halfColors },
      ];
      let prev: ReturnType<typeof applyPatches> | undefined;
      for (const { status, colors } of rounds) {
        const patches = new Map([[id, { ...v4(status), cellId: id, link }]]);
        prev = applyPatches(index, patches, prev, undefined, ctx);
        renderOverlay(root, index, patches, { theme, maxWidth: 10 });
        expect(Array.from(root.querySelectorAll('.dmap-half'), (el) => el.getAttribute('stroke'))).toEqual(colors);
        expect(Array.from(root.querySelectorAll('.dmap-arrow'), (el) => el.getAttribute('fill'))).toEqual(colors);
        ends.forEach((end, i) => expectColour(end.style.fill, colors[i]));
      }
    }
  );
});
