import { describe, expect, it } from 'vitest';
import { createTheme } from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import { ensureOverlay, renderOverlay } from './overlay';
import type { PlanCellPatch } from '../binding/engine';
import type { StatusView } from '../binding/status';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g><g data-cell-id="n1"><g><rect x="10" y="10" width="50" height="30"/></g></g>
  <g data-cell-id="e1"><g><path d="M 0 0 L 100 0 L 100 50" fill="none" stroke="#333" pointer-events="stroke"/><path id="e1-arrow" d="M 100 50 L 98 46 L 102 46 Z" pointer-events="all"/></g><g id="e1-value"><text>10G</text></g>
    <g data-cell-id="lbl1"><g><rect x="90" y="20" width="20" height="10"/><text>edge label</text></g></g></g>
  <g data-cell-id="n2"><g><rect x="150" y="10" width="40" height="30"/></g></g></g>
</svg>`;

function build(): { root: SVGSVGElement; index: CellIndex } {
  const host = document.createElement('div');
  host.innerHTML = SVG;
  const root = host.querySelector('svg') as SVGSVGElement;
  const index: CellIndex = new Map();
  const n1 = root.querySelector('[data-cell-id="n1"]') as SVGGElement;
  index.set('n1', {
    meta: cellMetaFromAttrs('n1', {}, false, 'n1'),
    group: n1,
    shape: n1.querySelector('rect')!,
    arrows: [],
    original: {},
  });
  const e1 = root.querySelector('[data-cell-id="e1"]') as SVGGElement;
  index.set('e1', {
    meta: cellMetaFromAttrs('e1', {}, true),
    group: e1,
    line: e1.querySelector('path')!,
    arrows: [e1.querySelector('#e1-arrow')!],
    original: {},
  });
  return { root, index };
}
const half = (over: Partial<HalfState> = {}): HalfState => ({
  status: 'ok',
  color: '#00ff00',
  width: 4,
  label: '41 Mb/s · 41%',
  stepIndex: 0,
  ...over,
});
const patch = (cellId: string, p: Partial<CellPatch>): CellPatch => ({
  cellId,
  ruleNames: ['r'],
  scope: { cell: {} },
  urls: [],
  warnings: [],
  ...p,
});
const opts = { theme: createTheme() };

const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('status overlay', () => {
  it('marks every affected element without a summary inside the diagram and without changing directional colors', () => {
    const { root, index } = build();
    const statusView: StatusView = {
      state: 'down',
      reason: 'Device down',
      conditionKey: 'health-zero',
      queryIds: ['up'],
      coverage: { available: 1, expected: 1 },
    };
    const patches = new Map<string, PlanCellPatch>([
      ['n1', { ...patch('n1', {}), statusView }],
      ['e1', { ...patch('e1', { link: { a2b: half() } }), statusView }],
    ]);
    renderOverlay(root, index, patches, opts);
    expect(root.querySelectorAll('.dmap-status-marker')).toHaveLength(2);
    // the panel shows the summary in a band above the diagram, never on top of it
    expect(root.querySelectorAll('.dmap-status-summary')).toHaveLength(0);
    expect(root.querySelector('.dmap-half')!.getAttribute('stroke')).toBe('#00ff00');
    expect(root.querySelector('.dmap-status-marker text')!.textContent).toContain('!');
    expect(root.querySelector('.dmap-status-marker')!.getAttribute('pointer-events')).toBe('none');
    patches.get('e1')!.statusView = { ...statusView, conditionKey: 'power', reason: 'Power lost' };
    renderOverlay(root, index, patches, opts);
    expect(root.querySelectorAll('.dmap-status-marker')).toHaveLength(2);
    for (const p of patches.values()) {
      p.statusView = { ...statusView, state: 'normal', reason: 'Healthy' };
    }
    renderOverlay(root, index, patches, opts);
    expect(root.querySelectorAll('.dmap-status-marker, .dmap-status-summary')).toHaveLength(0);
  });
});

describe('ensureOverlay', () => {
  it('creates one overlay group directly after the edge path and its arrow heads', () => {
    const { root, index } = build();
    const e1 = index.get('e1')!;
    const g = ensureOverlay(e1);
    expect(g.getAttribute('class')).toBe('dmap-overlay');
    expect(g.getAttribute('data-dmap-cell')).toBe('e1');
    expect(g.previousElementSibling).toBe(root.querySelector('#e1-arrow'));
    expect(g.parentElement).toBe(e1.line!.parentElement);
    expect(ensureOverlay(e1)).toBe(g);
  });
});

describe('renderOverlay', () => {
  it('draws two halves and two arrows for a two-way link, without value labels', () => {
    const { root, index } = build();
    const patches: PatchMap = new Map([
      [
        'e1',
        patch('e1', { link: { a2b: half(), b2a: half({ color: '#ff0000', stepIndex: 2, label: '90 Mb/s · 90%' }) } }),
      ],
    ]);
    renderOverlay(root, index, patches, opts);
    const halves = root.querySelectorAll('polyline.dmap-half');
    expect(halves).toHaveLength(2);
    const a2b = root.querySelector('polyline.dmap-half[data-dmap-half="a2b"]')!;
    expect(a2b.getAttribute('data-dmap-cell')).toBe('e1');
    expect(a2b.getAttribute('points')).toBe('0,0 75,0');
    expect(a2b.getAttribute('stroke')).toBe('#00ff00');
    expect(a2b.getAttribute('stroke-width')).toBe('4');
    expect(a2b.getAttribute('data-dmap-step')).toBe('0');
    expect(a2b.getAttribute('data-dmap-status')).toBe('ok');
    const b2a = root.querySelector('polyline.dmap-half[data-dmap-half="b2a"]')!;
    expect(b2a.getAttribute('points')).toBe('75,0 100,0 100,50');
    expect(b2a.getAttribute('data-dmap-step')).toBe('2');
    expect(root.querySelectorAll('polygon.dmap-arrow')).toHaveLength(2);
    // the values show in the hover card only
    expect(root.querySelectorAll('.dmap-label, .dmap-overlay text')).toHaveLength(0);
  });
  it('draws the whole edge as one half when only one series is bound', () => {
    const { root, index } = build();
    renderOverlay(root, index, new Map([['e1', patch('e1', { link: { b2a: half() } })]]), opts);
    const halves = root.querySelectorAll('polyline.dmap-half');
    expect(halves).toHaveLength(1);
    expect(halves[0].getAttribute('data-dmap-half')).toBe('b2a');
    expect(halves[0].getAttribute('points')).toBe('0,0 100,0 100,50');
  });
  it('draws nothing for a shape patch (no canvas sparklines)', () => {
    const { root, index } = build();
    renderOverlay(
      root,
      index,
      new Map([['n1', patch('n1', { card: { reducer: 'last', rows: [{ refId: 'D' }] } })]]),
      opts
    );
    expect(root.querySelectorAll('g.dmap-overlay')).toHaveLength(0);
  });
  it('clears the previous render', () => {
    const { root, index } = build();
    const p: PatchMap = new Map([['e1', patch('e1', { link: { a2b: half() } })]]);
    renderOverlay(root, index, p, opts);
    renderOverlay(root, index, p, opts);
    expect(root.querySelectorAll('polyline.dmap-half')).toHaveLength(1);
    expect(root.querySelectorAll('g.dmap-overlay')).toHaveLength(1);
    renderOverlay(root, index, new Map(), opts);
    expect(root.querySelectorAll('polyline.dmap-half')).toHaveLength(0);
    expect(root.querySelectorAll('g.dmap-overlay')).toHaveLength(0);
  });
  it('draws the halves above the edge path and below the labels and the later cells', () => {
    const { root, index } = build();
    const patches: PatchMap = new Map([['e1', patch('e1', { link: { a2b: half(), b2a: half() } })]]);
    renderOverlay(root, index, patches, opts);
    const path = index.get('e1')!.line!;
    const items = Array.from(root.querySelectorAll('.dmap-half, .dmap-arrow'));
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(before(path, item)).toBe(true);
      // the value label of the edge, the link-label cell and a node drawn after the edge stay on top
      expect(before(item, root.querySelector('#e1-value text')!)).toBe(true);
      expect(before(item, root.querySelector('[data-cell-id="lbl1"] text')!)).toBe(true);
      expect(before(item, root.querySelector('[data-cell-id="n2"]')!)).toBe(true);
    }
  });
});
