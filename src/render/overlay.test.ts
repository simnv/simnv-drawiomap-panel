import { describe, expect, it } from 'vitest';
import { createTheme } from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import { ensureOverlay, renderOverlay } from './overlay';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g><g data-cell-id="n1"><g><rect x="10" y="10" width="50" height="30"/></g></g>
  <g data-cell-id="e1"><g><path d="M 0 0 L 100 0 L 100 50" fill="none" stroke="#333" pointer-events="stroke"/></g></g></g>
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
    arrows: [],
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

describe('ensureOverlay', () => {
  it('creates one overlay group as the last child of the root', () => {
    const { root } = build();
    const g = ensureOverlay(root);
    expect(g.getAttribute('class')).toBe('dmap-overlay');
    expect(root.lastElementChild).toBe(g);
    expect(ensureOverlay(root)).toBe(g);
  });
});

describe('renderOverlay', () => {
  it('draws two halves, two arrows and two labels for a two-way link', () => {
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
    const labels = root.querySelectorAll('g.dmap-label text');
    expect(Array.from(labels, (t) => t.textContent)).toEqual(['41 Mb/s · 41%', '90 Mb/s · 90%']);
  });
  it('draws the whole edge as one half when only one series is bound', () => {
    const { root, index } = build();
    renderOverlay(root, index, new Map([['e1', patch('e1', { link: { b2a: half() } })]]), opts);
    const halves = root.querySelectorAll('polyline.dmap-half');
    expect(halves).toHaveLength(1);
    expect(halves[0].getAttribute('data-dmap-half')).toBe('b2a');
    expect(halves[0].getAttribute('points')).toBe('0,0 100,0 100,50');
  });
  it('draws a sparkline below a shape', () => {
    const { root, index } = build();
    renderOverlay(
      root,
      index,
      new Map([['n1', patch('n1', { sparkline: { values: [0, 1, 0.5], color: '#0000ff', position: 'bottom' } })]]),
      opts
    );
    const s = root.querySelector('polyline.dmap-spark')!;
    expect(s.getAttribute('data-dmap-cell')).toBe('n1');
    const pts = s
      .getAttribute('points')!
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(10);
    expect(pts[2][0]).toBe(60);
    expect(pts.every(([, y]) => y >= 42 && y <= 56)).toBe(true);
    expect(pts[1][1]).toBeLessThan(pts[0][1]);
  });
  it('maps sparkline bounds through the shape transform into overlay coordinates', () => {
    const { root, index } = build();
    const rect = index.get('n1')!.shape!;
    // jsdom has no layout. Simulate a shape group with transform="translate(100, 50)" and an overlay at identity.
    const ctm = (e: number, f: number) => () => ({ a: 1, b: 0, c: 0, d: 1, e, f }) as DOMMatrix;
    (rect as unknown as { getCTM: () => DOMMatrix }).getCTM = ctm(100, 50);
    const layer = ensureOverlay(root);
    (layer as unknown as { getCTM: () => DOMMatrix }).getCTM = ctm(0, 0);
    renderOverlay(
      root,
      index,
      new Map([['n1', patch('n1', { sparkline: { values: [0, 1, 0.5], color: '#0000ff', position: 'bottom' } })]]),
      opts
    );
    const pts = root
      .querySelector('polyline.dmap-spark')!
      .getAttribute('points')!
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts[0][0]).toBe(110);
    expect(pts[2][0]).toBe(160);
    expect(pts.every(([, y]) => y >= 92 && y <= 106)).toBe(true);
  });
  it('maps sparkline bounds of a rotated shape to its axis-aligned overlay box', () => {
    const { root, index } = build();
    const rect = index.get('n1')!.shape!;
    // rotate(90) about the origin: (x, y) -> (-y, x). Rect 10..60 x 10..40 becomes -40..-10 x 10..60.
    (rect as unknown as { getCTM: () => DOMMatrix }).getCTM = () =>
      ({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }) as DOMMatrix;
    renderOverlay(
      root,
      index,
      new Map([['n1', patch('n1', { sparkline: { values: [0, 1], color: '#0000ff', position: 'bottom' } })]]),
      opts
    );
    const pts = root
      .querySelector('polyline.dmap-spark')!
      .getAttribute('points')!
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts[0][0]).toBe(-40);
    expect(pts[1][0]).toBe(-10);
    expect(pts.every(([, y]) => y >= 62 && y <= 76)).toBe(true);
  });
  it('clears the previous render', () => {
    const { root, index } = build();
    const p: PatchMap = new Map([['e1', patch('e1', { link: { a2b: half() } })]]);
    renderOverlay(root, index, p, opts);
    renderOverlay(root, index, p, opts);
    expect(root.querySelectorAll('polyline.dmap-half')).toHaveLength(1);
    renderOverlay(root, index, new Map(), opts);
    expect(root.querySelectorAll('polyline.dmap-half')).toHaveLength(0);
  });
});
