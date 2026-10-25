import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTheme } from '@grafana/data';
import type { CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import type { StatusView } from '../binding/status';
import type { PlanCellPatch } from '../binding/engine';
import { cellAt, patchAt } from '../interact/hit';
import { buildCellIndex } from './svgStage';
import { renderOverlay, statusMarkerBox } from './overlay';
import {
  LINK_LABEL_CLASS,
  LINK_LABEL_LAYER_CLASS,
  renderLinkLabels,
  setLinkLabelScale,
  stageObstacles,
} from './linkLabels';

/*
 * A plain diagram: two nodes and one edge of 320 units between them. The split is at x = 200; the a2b leg runs
 * from x = 40 to 200 (its anchor at 120), the b2a leg from 360 to 200 (its anchor at 280). The percent slot is
 * 24 (0.6 × 8 × 5 glyphs in jsdom), the box 28 × 14; with `linkWidth.max` 10 the centre stands 16 off the line.
 */
const SVG = (extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <g data-cell-id="n1"><g><rect x="0" y="80" width="40" height="40" stroke-width="2"/></g></g>
  <g data-cell-id="e1"><g><path d="M 40 100 L 360 100" fill="none" stroke="#333" pointer-events="stroke"/></g></g>
  <g data-cell-id="n2"><g><rect x="360" y="80" width="40" height="40"/></g></g>${extra}
</svg>`;
const OFFSET = 16;

function build(svg = SVG()): { root: SVGSVGElement; index: CellIndex } {
  const host = document.createElement('div');
  host.innerHTML = svg;
  document.body.appendChild(host);
  const root = host.querySelector('svg') as SVGSVGElement;
  return { root, index: buildCellIndex(root) };
}
const half = (over: Partial<HalfState> = {}): HalfState => ({
  status: 'ok',
  color: '#00ff00',
  width: 4,
  label: '41 Mb/s · 41% of 100 Mb/s',
  stepIndex: 0,
  percent: 41,
  percentDisplay: '41%',
  display: { text: '41', suffix: ' Mb/s', numeric: 41 },
  ...over,
});
const nodata = (): HalfState => ({ status: 'nodata', color: '#888', width: 2, label: 'no data', stepIndex: -1 });
const linkPatch = (cellId: string, link: CellPatch['link']): CellPatch => ({
  cellId,
  ruleNames: ['r'],
  scope: { cell: {} },
  urls: [],
  warnings: [],
  link,
});
const theme = createTheme();
const opts = { theme, linkWidth: { min: 2, max: 10 } };
const labels = (root: SVGSVGElement) => Array.from(root.querySelectorAll<SVGTextElement>(`text.${LINK_LABEL_CLASS}`));
const byHalf = (root: SVGSVGElement, which: string, cell = 'e1') =>
  root.querySelector<SVGTextElement>(`text.${LINK_LABEL_CLASS}[data-dmap-cell="${cell}"][data-dmap-half="${which}"]`);
const layerOf = (root: SVGSVGElement) => root.querySelector<SVGGElement>(`g.${LINK_LABEL_LAYER_CLASS}`);
/** A render at the given pixel size of the svg (jsdom has no layout): `k` = pixels per user unit. */
const sized = (root: SVGSVGElement, k: number) => {
  root.getBoundingClientRect = () => ({ width: 400 * k, height: 200 * k }) as DOMRect;
};
function render(root: SVGSVGElement, index: CellIndex, patches: PatchMap, o = opts) {
  renderOverlay(root, index, patches, { theme: o.theme });
  return renderLinkLabels(root, index, patches, o);
}

afterEach(() => document.body.replaceChildren());

describe('renderLinkLabels: the layer and its elements', () => {
  it('draws one text per labelled half in a layer that is the last child of the root; the overlays stay by their edges', () => {
    const { root, index } = build();
    sized(root, 1);
    const patches: PatchMap = new Map([
      ['e1', linkPatch('e1', { a2b: half(), b2a: half({ percentDisplay: '10%' }), labelMode: 'percent' })],
    ]);
    const counts = render(root, index, patches);
    expect(counts).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const layer = layerOf(root)!;
    expect(root.lastElementChild).toBe(layer);
    expect(layer.getAttribute('data-dmap-labels-placed')).toBe('2');
    expect(layer.getAttribute('data-dmap-labels-dropped')).toBe('0');
    const line = index.get('e1')!.line!;
    expect(line.nextElementSibling?.classList.contains('dmap-overlay')).toBe(true);
    const a2b = byHalf(root, 'a2b')!;
    const b2a = byHalf(root, 'b2a')!;
    expect(a2b.textContent).toBe('41%');
    expect(b2a.textContent).toBe('10%');
    expect(a2b.getAttribute('data-dmap-mode')).toBe('percent');
    expect(a2b.getAttribute('pointer-events')).toBe('visiblePainted');
    expect(a2b.getAttribute('x')).toBe('120');
    expect(a2b.getAttribute('y')).toBe(String(100 - OFFSET));
    expect(a2b.getAttribute('transform')).toBe(`rotate(0 120 ${100 - OFFSET})`);
    // the room of the status marker (the midpoint, 4 to the right, "? missing" wide) is reserved: the b2a label,
    // whose anchor is 280, slides past it towards the end of the link
    expect(b2a.getAttribute('x')).toBe('288');
    expect(b2a.getAttribute('y')).toBe(String(100 - OFFSET));
    expect(a2b.getAttribute('fill')).toBe(theme.colors.text.primary);
    expect(a2b.getAttribute('stroke')).toBe(theme.colors.background.primary);
    expect(a2b.getAttribute('paint-order')).toBe('stroke');
    expect(a2b.getAttribute('font-size')).toBe('8');
    expect(a2b.getAttribute('font-family')).toBe('sans-serif');
    expect(a2b.getAttribute('data-dmap-placed-at')).toMatch(/^\d+$/);
  });
  it('hit.ts resolves a label to its link, with the index and without', () => {
    const { root, index } = build();
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'value' })]]);
    render(root, index, patches);
    const label = byHalf(root, 'a2b')!;
    expect(label.textContent).toBe('41 Mb/s');
    expect(patchAt(label, root, patches, index)?.cellId).toBe('e1');
    expect(patchAt(label, root, patches)?.cellId).toBe('e1');
    expect(cellAt(label, index)?.meta.id).toBe('e1');
  });
  it('mode none draws nothing; an unbound half and a half without a text draw nothing visible', () => {
    const { root, index } = build();
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'none' })]]));
    expect(layerOf(root)).toBeNull();
    expect(labels(root)).toHaveLength(0);
    const unbound: HalfState = { status: 'unbound', color: '#888', width: 2, label: 'unavailable', stepIndex: -1 };
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), b2a: unbound, labelMode: 'percent' })]]));
    expect(byHalf(root, 'a2b')!.getAttribute('visibility')).toBeNull();
    expect(byHalf(root, 'b2a')!.getAttribute('visibility')).toBe('hidden');
    expect(byHalf(root, 'b2a')!.textContent).toBe('');
    // the layer goes when no half is labelled any more
    render(root, index, new Map());
    expect(layerOf(root)).toBeNull();
  });
  it('takes the font of the first portograph link label in the stage', () => {
    const chip = `<g data-cell-id="pg-linkLabel~x" data-meta-pg-kind="link-label"><g><g font-family="Arial, Helvetica, sans-serif" font-size="9px"><rect x="300" y="150" width="40" height="12"/><text x="320" y="158">lbl</text></g></g></g>`;
    const { root, index } = build(SVG(chip));
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]));
    expect(byHalf(root, 'a2b')!.getAttribute('font-family')).toBe('Arial, Helvetica, sans-serif');
  });
});

describe('renderLinkLabels: the refresh path', () => {
  const two = (
    a: Partial<HalfState> = {},
    b: Partial<HalfState> = {},
    mode: 'percent' | 'value' = 'percent'
  ): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(a), b2a: half(b), labelMode: mode })]]);
  it('a second call with new values changes the texts only: same elements, same transforms, no stamp', () => {
    const { root, index } = build();
    render(root, index, two());
    const [a, b] = [byHalf(root, 'a2b')!, byHalf(root, 'b2a')!];
    const before = [a.getAttribute('transform'), a.getAttribute('data-dmap-placed-at'), b.getAttribute('transform')];
    const counts = render(root, index, two({ percentDisplay: '77%' }, { percentDisplay: '<1%' }));
    expect(counts).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(byHalf(root, 'a2b')).toBe(a);
    expect(byHalf(root, 'b2a')).toBe(b);
    expect(a.textContent).toBe('77%');
    expect(b.textContent).toBe('<1%');
    expect([a.getAttribute('transform'), a.getAttribute('data-dmap-placed-at'), b.getAttribute('transform')]).toEqual(
      before
    );
  });
  it('a percent label keeps its slot from <1% to >999%; a half that goes to no data hides and keeps its element', () => {
    const { root, index } = build();
    render(root, index, two({ percentDisplay: '<1%' }));
    const a = byHalf(root, 'a2b')!;
    const stamp = a.getAttribute('data-dmap-placed-at');
    expect(render(root, index, two({ percentDisplay: '>999%' })).moved).toBe(0);
    expect(a.getAttribute('data-dmap-placed-at')).toBe(stamp);
    const gone: PatchMap = new Map([['e1', linkPatch('e1', { a2b: nodata(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, gone)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(byHalf(root, 'a2b')).toBe(a);
    expect(a.getAttribute('visibility')).toBe('hidden');
    expect(a.getAttribute('pointer-events')).toBe('visiblePainted');
    expect(a.getAttribute('transform')).toBe(`rotate(0 120 ${100 - OFFSET})`);
    // the data comes back: the same spot, no new stamp
    render(root, index, two({ percentDisplay: '5%' }));
    expect(a.getAttribute('visibility')).toBeNull();
    expect(a.getAttribute('data-dmap-placed-at')).toBe(stamp);
    expect(a.textContent).toBe('5%');
  });
  it('a value text that crosses a grain places that label again and leaves the other one alone', () => {
    const { root, index } = build();
    const value = (text: string, suffix = ' Mb/s') => half({ display: { text, suffix, numeric: 0 } });
    render(root, index, two(value('41'), value('10'), 'value'));
    const [a, b] = [byHalf(root, 'a2b')!, byHalf(root, 'b2a')!];
    const transformB = b.getAttribute('transform');
    const stamps = () => [a.getAttribute('data-dmap-placed-at'), b.getAttribute('data-dmap-placed-at')];
    const first = stamps();
    // "41 Mb/s" and "99 Mb/s" share the slot 36; "410 Mb/s" is 38.4 wide and takes the slot 40
    expect(render(root, index, two(value('99'), value('10'), 'value')).moved).toBe(0);
    expect(stamps()).toEqual(first);
    const counts = render(root, index, two(value('410'), value('10'), 'value'));
    expect(counts).toEqual({ placed: 2, dropped: 0, moved: 1 });
    expect(a.getAttribute('data-dmap-placed-at')).not.toBe(first[0]);
    expect(b.getAttribute('data-dmap-placed-at')).toBe(first[1]);
    expect(b.getAttribute('transform')).toBe(transformB);
    expect(a.textContent).toBe('410 Mb/s');
  });
  it('a new slot that fits nowhere hides the label with its transform; it comes back when a later text fits', () => {
    // blocks above and below the a2b leg (the label boxes span y 77..91 and 109..123) leave 60 free units around
    // its anchor
    const blocks = ['40', '150']
      .flatMap((x) =>
        [70, 106].map((y) => `<g data-cell-id="b${x}${y}"><g><rect x="${x}" y="${y}" width="50" height="24"/></g></g>`)
      )
      .join('');
    const { root, index } = build(SVG(blocks));
    const value = (text: string): PatchMap =>
      new Map([
        ['e1', linkPatch('e1', { a2b: half({ display: { text, numeric: 0 } }), b2a: half(), labelMode: 'value' })],
      ]);
    expect(render(root, index, value('41 Mb/s'))).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const a = byHalf(root, 'a2b')!;
    const transform = a.getAttribute('transform');
    expect(transform).toBe(`rotate(0 120 ${100 - OFFSET})`);
    const wide = value('abcdefghijklmn Mb/s');
    expect(render(root, index, wide)).toEqual({ placed: 1, dropped: 1, moved: 0 });
    expect(byHalf(root, 'a2b')).toBe(a);
    expect(a.getAttribute('visibility')).toBe('hidden');
    expect(a.getAttribute('data-dmap-dropped')).toBe('no-free-spot');
    expect(a.getAttribute('transform')).toBe(transform);
    expect(layerOf(root)!.getAttribute('data-dmap-labels-dropped')).toBe('1');
    // still no spot on the next refresh: it stays hidden
    expect(render(root, index, wide).dropped).toBe(1);
    // the old box stayed reserved: a text that fits goes back to the same spot
    // a label that held a reserved box and finds a spot again counts as moved, also at the same spot
    expect(render(root, index, value('42 Mb/s'))).toEqual({ placed: 2, dropped: 0, moved: 1 });
    expect(a.getAttribute('visibility')).toBeNull();
    expect(a.getAttribute('data-dmap-dropped')).toBeNull();
    expect(a.getAttribute('transform')).toBe(transform);
    expect(a.textContent).toBe('42 Mb/s');
  });
  it('a changed linkWidth.max, mode or stage places everything again; a theme change repaints only', () => {
    const { root, index } = build();
    render(root, index, two());
    const a = byHalf(root, 'a2b')!;
    const stamp = a.getAttribute('data-dmap-placed-at');
    render(root, index, two(), { ...opts, linkWidth: { min: 2, max: 2 } });
    const wider = byHalf(root, 'a2b')!;
    expect(wider.getAttribute('y')).toBe(String(100 - (4 + 1 + 7)));
    expect(wider.getAttribute('data-dmap-placed-at')).not.toBe(stamp);
    const stamp2 = wider.getAttribute('data-dmap-placed-at');
    render(root, index, two({}, {}, 'value'), { ...opts, linkWidth: { min: 2, max: 2 } });
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-placed-at')).not.toBe(stamp2);
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-mode')).toBe('value');
    const dark = createTheme({ colors: { mode: 'dark' } });
    const el = byHalf(root, 'a2b')!;
    const stamp3 = el.getAttribute('data-dmap-placed-at');
    render(root, index, two({}, {}, 'value'), { theme: dark, linkWidth: { min: 2, max: 2 } });
    expect(byHalf(root, 'a2b')).toBe(el);
    expect(el.getAttribute('data-dmap-placed-at')).toBe(stamp3);
    expect(el.getAttribute('fill')).toBe(dark.colors.text.primary);
  });
});

describe('renderLinkLabels: obstacles', () => {
  it('a plain draw.io node is an obstacle: the label slides towards the end of the link', () => {
    const node = `<g data-cell-id="n3"><g><rect x="100" y="60" width="40" height="20"/></g></g>`;
    const { root, index } = build(SVG(node));
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]));
    const a = byHalf(root, 'a2b')!;
    expect(Number(a.getAttribute('x'))).toBeLessThan(100 - 14);
    expect(a.getAttribute('y')).toBe(String(100 - OFFSET));
    expect(byHalf(root, 'b2a')!.getAttribute('x')).toBe('288');
  });
  it('reserves the status marker room of a patched edge; drawStatusMarker writes the anchor into x and y', () => {
    const { root, index } = build();
    const entry = index.get('e1')!;
    const box = statusMarkerBox(entry)!;
    expect(box.anchor).toEqual({ x: 204, y: 96 });
    expect(box.space).toBe(entry.line!.parentNode);
    expect(box.bounds.x).toBeCloseTo(202.5);
    expect(box.bounds.y).toBeCloseTo(96 - 12 - 1.5);
    expect(box.bounds.height).toBeCloseTo(15 + 3);
    const statusView: StatusView = {
      state: 'down',
      reason: 'Down',
      conditionKey: 'k',
      queryIds: ['q'],
      coverage: { available: 1, expected: 1 },
    };
    const patch: PlanCellPatch = { ...linkPatch('e1', { a2b: half(), labelMode: 'percent' }), statusView };
    const patches = new Map<string, PlanCellPatch>([['e1', patch]]);
    render(root, index, patches);
    const marker = root.querySelector('.dmap-status-marker text')!;
    expect(marker.getAttribute('x')).toBe('204');
    expect(marker.getAttribute('y')).toBe('96');
    // one leg: its anchor is the midpoint, inside the marker room; the label moves away from it
    const a = byHalf(root, 'a2b')!;
    expect(Number(a.getAttribute('x'))).toBeLessThan(200);
    const obstacles = stageObstacles(root, index, patches, 10, (text) => 0.6 * 12 * text.length);
    expect(obstacles).toContainEqual({
      kind: 'rect',
      rect: expect.objectContaining({ x: expect.closeTo(202.5, 5), y: expect.closeTo(82.5, 5) }),
      clearance: 0,
    });
    // the edge stroke at linkWidth.max / 2: one piece for a one-leg link, the pieces up to the split for two legs;
    // the node bodies at half their stroke
    expect(obstacles).toContainEqual({
      kind: 'segment',
      a: { x: 40, y: 100 },
      b: { x: 360, y: 100 },
      clearance: 5,
      owner: 'e1',
    });
    const two = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    const both = stageObstacles(root, index, two, 10, () => 60);
    expect(both).toContainEqual({
      kind: 'segment',
      a: { x: 40, y: 100 },
      b: { x: 200, y: 100 },
      clearance: 5,
      owner: 'e1',
    });
    expect(both).toContainEqual({
      kind: 'segment',
      a: { x: 360, y: 100 },
      b: { x: 200, y: 100 },
      clearance: 5,
      owner: 'e1',
    });
    expect(obstacles).toContainEqual({ kind: 'rect', rect: { x: 0, y: 80, width: 40, height: 40 }, clearance: 1 });
    expect(obstacles).toContainEqual({ kind: 'rect', rect: { x: 360, y: 80, width: 40, height: 40 }, clearance: 0.5 });
  });
});

describe('renderLinkLabels: backgrounds', () => {
  it('the portograph canvas and the groups of the demo sheet are no obstacles: the WAN link gets both labels', () => {
    const { root, index } = build(readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8'));
    const ISP_A = 'pg-link~isp-a:pppoe->rtr-a:wan1';
    expect(index.get('pg-canvas')?.shape?.localName).toBe('rect');
    const patches: PatchMap = new Map([[ISP_A, linkPatch(ISP_A, { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const obstacles = stageObstacles(root, index, patches, 10, () => 60);
    const bodies = obstacles.flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    expect(bodies.some((r) => r.width > 1000)).toBe(false);
    // the vertical WAN link: the labels read bottom to top, to the right of the stroke
    expect(byHalf(root, 'a2b', ISP_A)!.getAttribute('transform')).toMatch(/^rotate\(-90 /);
    expect(Number(byHalf(root, 'a2b', ISP_A)!.getAttribute('x'))).toBeCloseTo(188.37 + 16, 0);
  });
  it('a group frame is no obstacle; its title bar is, because a label must not cover the caption', () => {
    const frame = `<g data-cell-id="pg-group~wan"><g><rect x="60" y="40" width="280" height="120"/></g></g>`;
    const title = `<g data-cell-id="pg-groupTitle~wan"><g><rect x="100" y="60" width="40" height="20"/><text x="104" y="74">wan</text></g></g>`;
    const { root, index } = build(SVG(frame + title));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(100 - 14);
    const rects = stageObstacles(root, index, patches, 10, () => 60).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
    expect(rects).not.toContainEqual({ x: 60, y: 40, width: 280, height: 120 });
    expect(rects).toContainEqual({ x: 100, y: 60, width: 40, height: 20 });
  });
  it('a plain draw.io container that holds other vertices is a background; the vertices inside stay obstacles', () => {
    const container = `<g data-cell-id="box"><g><rect x="60" y="40" width="280" height="120"/></g></g>`;
    const inner = `<g data-cell-id="n3"><g><rect x="100" y="60" width="40" height="20"/></g></g>`;
    const { root, index } = build(SVG(container + inner));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(100 - 14);
    const rects = stageObstacles(root, index, patches, 10, () => 60).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
    expect(rects).not.toContainEqual({ x: 60, y: 40, width: 280, height: 120 });
    expect(rects).toContainEqual({ x: 100, y: 60, width: 40, height: 20 });
  });
});

describe('renderLinkLabels: coordinates', () => {
  const scale2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  it("an edge inside scale(2) places the split and the labels at the overlay's own points, with a root gap", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><g transform="scale(2)">
      <g data-cell-id="e1"><g><path d="M 0 0 L 100 0 L 100 100" fill="none" pointer-events="stroke"/></g></g>
      <g data-cell-id="e2"><g><path d="M 0 40 L 100 40" fill="none" pointer-events="stroke" stroke-width="3"/></g></g>
    </g></svg>`;
    const { root, index } = build(svg);
    Object.assign(root, { getScreenCTM: () => identity });
    const line = index.get('e1')!.line!;
    Object.assign(line, {
      getTotalLength: () => 200,
      getPointAtLength: (d: number) => (d <= 100 ? { x: d, y: 0 } : { x: 100, y: d - 100 }),
      getCTM: () => scale2,
      getScreenCTM: () => scale2,
    });
    Object.assign(line.parentNode as object, { getCTM: () => scale2 });
    Object.assign(index.get('e2')!.line!, { getScreenCTM: () => scale2 });
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(renderLinkLabels(root, index, patches, opts)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    // the split: the overlay moves it from the corner (path-local 100) to 84 on the first run, root x = 168 (not 184)
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('x')).toBe('84');
    expect(a.getAttribute('y')).toBe(String(-(4 + (10 * 2) / 2 + 7)));
    const b = byHalf(root, 'b2a')!;
    expect(b.getAttribute('transform')).toBe(`rotate(-90 ${200 + 4 + 10 + 7} 84)`);
    // a 3-unit stroke in the scaled group: a 6-unit stroke in root units, a 3-unit clearance
    const obstacles = stageObstacles(root, index, patches, 10, (text) => 0.6 * 12 * text.length);
    expect(obstacles).toContainEqual({
      kind: 'segment',
      a: { x: 0, y: 80 },
      b: { x: 200, y: 80 },
      clearance: 3,
      owner: 'e2',
    });
    expect(obstacles).toContainEqual({
      kind: 'segment',
      a: { x: 0, y: 0 },
      b: { x: 168, y: 0 },
      clearance: 10,
      owner: 'e1',
    });
    expect(obstacles).toContainEqual({
      kind: 'segment',
      a: { x: 200, y: 200 },
      b: { x: 200, y: 0 },
      clearance: 10,
      owner: 'e1',
    });
  });
  it('a path with a 3° turn keeps that vertex in the root polyline', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
      <g data-cell-id="e1"><g><path d="M 0 50 L 100 50 L 200 55.2" fill="none" pointer-events="stroke"/></g></g></svg>`;
    const { root, index } = build(svg);
    renderLinkLabels(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]), opts);
    const a = byHalf(root, 'a2b')!;
    // the anchor is on the first segment (y = 50), not on the chord (y = 52.6): the centre sits 16 above it
    expect(Number(a.getAttribute('y'))).toBeCloseTo(50 - OFFSET, 0);
    expect(a.getAttribute('transform')).toMatch(/^rotate\(1\.49 /);
  });
});

describe('setLinkLabelScale', () => {
  it('hides the layer below 7 px per glyph, shows it above; a fresh layer takes the current scale', () => {
    const { root, index } = build();
    sized(root, 0.2);
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]);
    render(root, index, patches);
    expect(layerOf(root)!.getAttribute('visibility')).toBe('hidden');
    sized(root, 1);
    setLinkLabelScale(root);
    expect(layerOf(root)!.getAttribute('visibility')).toBeNull();
    sized(root, 0.8);
    setLinkLabelScale(root);
    expect(layerOf(root)!.getAttribute('visibility')).toBe('hidden');
    sized(root, 7 / 8);
    setLinkLabelScale(root);
    expect(layerOf(root)!.getAttribute('visibility')).toBeNull();
  });
  it('does nothing without a layer', () => {
    const { root } = build();
    expect(() => setLinkLabelScale(root)).not.toThrow();
  });
});
