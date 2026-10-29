import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTheme } from '@grafana/data';
import type { CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import { cellAt, patchAt } from '../interact/hit';
import { buildCellIndex } from './svgStage';
import { renderOverlay } from './overlay';
import { applyPatches } from './applier';
import {
  haloColour,
  LINK_LABEL_CLASS,
  LINK_LABEL_LAYER_CLASS,
  renderLinkLabels,
  setLinkLabelScale,
  stageObstacles,
  watchLinkLabelFonts,
} from './linkLabels';
import { cornersOf } from './labelPlacement';
import type { Point } from './geometry';

/** The status of a patch, as `statusViewOf` gives it. */
type PatchStatus = NonNullable<CellPatch['statusView']>;

/*
 * A plain diagram: two nodes and one edge of 320 units between them. The split is at x = 200; the a2b leg runs
 * from x = 40 to 200 (its anchor at 120), the b2a leg from 360 to 200 (its anchor at 280). The percent slot is
 * 24 (0.6 × 8 × 5 glyphs in jsdom), the box 26 × 12. A label stands on its stroke (centre on the line); beside it with `linkWidth.max` 10 the centre stands 13 off the line.
 */
const SVG = (
  extra = ''
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" style="background-color: #1d2d3d">
  <g data-cell-id="n1"><g><rect x="0" y="80" width="40" height="40" stroke-width="2"/></g></g>
  <g data-cell-id="e1"><g><path d="M 40 100 L 360 100" fill="none" stroke="#333" pointer-events="stroke"/></g></g>
  <g data-cell-id="n2"><g><rect x="360" y="80" width="40" height="40"/></g></g>${extra}
</svg>`;

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
  scope: { cell: {} },
  urls: [],
  link,
});
const theme = createTheme();
/** the resolved colour of the background of the test svg */
const DARK = 'rgb(29, 45, 61)';
const opts = { theme, linkWidth: { min: 2, max: 10 } };
const labels = (root: SVGSVGElement) => Array.from(root.querySelectorAll<SVGTextElement>(`text.${LINK_LABEL_CLASS}`));
const byHalf = (root: SVGSVGElement, which: string, cell = 'e1') =>
  root.querySelector<SVGTextElement>(`text.${LINK_LABEL_CLASS}[data-dmap-cell="${cell}"][data-dmap-half="${which}"]`);
/** the mask of a link of the stage */
const maskOf = (root: SVGSVGElement, cell = 'e1') =>
  root.querySelector<SVGMaskElement>(`defs.dmap-link-label-defs mask[data-dmap-cell="${cell}"]`);
const blacks = (m: Element) => Array.from(m.querySelectorAll('rect')).filter((r) => r.getAttribute('fill') === 'black');
const whites = (m: Element) => Array.from(m.querySelectorAll('rect')).filter((r) => r.getAttribute('fill') === 'white');
/** the elements that draw the stroke of a link: the halves and the arrow heads of the overlay */
const strokesOf = (root: SVGSVGElement, cell = 'e1') =>
  Array.from(
    root.querySelectorAll<SVGElement>(`.dmap-half[data-dmap-cell="${cell}"], .dmap-arrow[data-dmap-cell="${cell}"]`)
  );
const layerOf = (root: SVGSVGElement) => root.querySelector<SVGGElement>(`g.${LINK_LABEL_LAYER_CLASS}`);
/** A render at the given pixel size of the svg (jsdom has no layout): `k` = pixels per user unit. */
const sized = (root: SVGSVGElement, k: number) => {
  root.getBoundingClientRect = () => ({ width: 400 * k, height: 200 * k }) as DOMRect;
};
function render(root: SVGSVGElement, index: CellIndex, patches: PatchMap, o = opts) {
  // jsdom has no layout: a root of no size would hide the layer, so a plain test gets the scale 1
  if (!root.getBoundingClientRect().width) {
    sized(root, 1);
  }
  renderOverlay(root, index, patches, { theme: o.theme, maxWidth: o.linkWidth.max });
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
    expect(a2b.getAttribute('y')).toBe('100');
    expect(a2b.getAttribute('transform')).toBe('rotate(0 120 100)');
    expect(a2b.getAttribute('data-dmap-side')).toBe('line');
    // the b2a label stands at its own anchor, the middle of its half
    expect(b2a.getAttribute('x')).toBe('280');
    expect(b2a.getAttribute('y')).toBe('100');
    expect(a2b.getAttribute('fill')).toBe(theme.colors.text.primary);
    // the halo: a thin stroke in the background of the diagram, painted behind the glyphs
    expect(a2b.getAttribute('stroke')).toBe(DARK);
    expect(a2b.getAttribute('stroke-width')).toBe('2');
    expect(a2b.getAttribute('paint-order')).toBe('stroke');
    expect(a2b.getAttribute('stroke-linejoin')).toBe('round');
    expect(a2b.getAttribute('stroke-linecap')).toBe('round');
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
  it('a half that gets wide grows its head on a refresh; no label moves and the mask keeps its frame', () => {
    const { root, index } = build();
    render(root, index, two({ width: 2 }, { width: 2 }));
    const a = byHalf(root, 'a2b')!;
    const before = [a.getAttribute('transform'), a.getAttribute('data-dmap-placed-at')];
    const mask = maskOf(root)!;
    const frame = () => ['x', 'y', 'width', 'height'].map((k) => mask.getAttribute(k));
    const area = frame();
    const head = root.querySelector('.dmap-arrow[data-dmap-half="a2b"]')!;
    const thin = head.getAttribute('points');
    expect(render(root, index, two({ width: 10 }, { width: 10 }))).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(head.getAttribute('points')).not.toBe(thin);
    expect(head.getAttribute('points')).toBe('200,100 188,88 188,112');
    expect([a.getAttribute('transform'), a.getAttribute('data-dmap-placed-at')]).toEqual(before);
    // the frame is the box of the edge path with the margin, not the box of the overlay that the wider head grew
    expect(maskOf(root)).toBe(mask);
    expect(frame()).toEqual(area);
  });
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
    expect(a.getAttribute('transform')).toBe('rotate(0 120 100)');
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
    // two blocks across the stroke of the a2b leg leave 60 free units around its anchor, on and beside the stroke
    const blocks = ['40', '150']
      .map((x) => `<g data-cell-id="b${x}"><g><rect x="${x}" y="70" width="50" height="60"/></g></g>`)
      .join('');
    const { root, index } = build(SVG(blocks));
    const value = (text: string): PatchMap =>
      new Map([
        ['e1', linkPatch('e1', { a2b: half({ display: { text, numeric: 0 } }), b2a: half(), labelMode: 'value' })],
      ]);
    expect(render(root, index, value('41 Mb/s'))).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const a = byHalf(root, 'a2b')!;
    const transform = a.getAttribute('transform');
    expect(transform).toBe('rotate(0 120 100)');
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
  it('a dropped half keeps its side for its mate: a resize of the mate stays on that side, the recovery follows it', () => {
    // a node sits on the whole stroke, another above the a2b leg; below it two blocks leave a gap of 60:
    // both halves start below the stroke
    const blocks = [
      '<g data-cell-id="strip"><g><rect x="40" y="98" width="320" height="4"/></g></g>',
      '<g data-cell-id="top"><g><rect x="40" y="60" width="160" height="26"/></g></g>',
      '<g data-cell-id="l"><g><rect x="40" y="106" width="50" height="24"/></g></g>',
      '<g data-cell-id="r"><g><rect x="150" y="106" width="50" height="24"/></g></g>',
    ].join('');
    const { root, index } = build(SVG(blocks));
    const value = (a: string, b: string): PatchMap =>
      new Map([
        [
          'e1',
          linkPatch('e1', {
            a2b: half({ display: { text: a, numeric: 0 } }),
            b2a: half({ display: { text: b, numeric: 0 } }),
            labelMode: 'value',
          }),
        ],
      ]);
    const below = (el: SVGTextElement) => el.getAttribute('data-dmap-side') === 'bottom';
    expect(render(root, index, value('41 Mb/s', '10 Mb/s'))).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(below(byHalf(root, 'a2b')!)).toBe(true);
    expect(below(byHalf(root, 'b2a')!)).toBe(true);
    // a2b widens and fits nowhere; b2a changes its slot and is placed again
    expect(render(root, index, value('abcdefghijklmn Mb/s', '10 Mb/s')).dropped).toBe(1);
    render(root, index, value('abcdefghijklmn Mb/s', '100 Mb/s'));
    expect(below(byHalf(root, 'b2a')!)).toBe(true);
    // a2b shrinks again: it recovers on the side of b2a
    render(root, index, value('41 Mb/s', '100 Mb/s'));
    expect(below(byHalf(root, 'a2b')!)).toBe(true);
    expect(below(byHalf(root, 'b2a')!)).toBe(true);
  });
  it('a half that its mate cannot join near the stroke stays on its stroke, also when it is placed again', () => {
    // a chip 14 high on the whole b2a leg blocks its stroke and both sides at the near gap; the wide gap is free
    const chip = '<g data-cell-id="chip"><g><rect x="210" y="93" width="140" height="14"/></g></g>';
    const { root, index } = build(SVG(chip));
    const value = (a: string): PatchMap =>
      new Map([
        [
          'e1',
          linkPatch('e1', {
            a2b: half({ display: { text: a, numeric: 0 } }),
            b2a: half({ display: { text: '10', suffix: ' Mb/s', numeric: 10 } }),
            labelMode: 'value',
          }),
        ],
      ]);
    expect(render(root, index, value('41 Mb/s'))).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('data-dmap-side')).toBe('line');
    expect(byHalf(root, 'b2a')!.getAttribute('data-dmap-side')).toBe('top-wide');
    // a longer text gives a2b a new slot: it is placed again on its own stroke, not on the far side of its mate
    expect(render(root, index, value('410 Mb/s')).moved).toBe(1);
    expect(a.getAttribute('data-dmap-side')).toBe('line');
    expect(a.getAttribute('y')).toBe('100');
  });
  it('a changed linkWidth.max, mode or stage places everything again; a theme change repaints only', () => {
    const { root, index } = build();
    render(root, index, two());
    const a = byHalf(root, 'a2b')!;
    const stamp = a.getAttribute('data-dmap-placed-at');
    render(root, index, two(), { ...opts, linkWidth: { min: 2, max: 2 } });
    const wider = byHalf(root, 'a2b')!;
    // on the stroke the spot does not depend on the stroke width
    expect(wider.getAttribute('y')).toBe('100');
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

describe('renderLinkLabels: the place of a label', () => {
  const strip = '<g data-cell-id="strip"><g><rect x="40" y="98" width="320" height="4"/></g></g>';
  const above = '<g data-cell-id="above"><g><rect x="40" y="60" width="320" height="26"/></g></g>';
  const both = (): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
  it('on its stroke the stroke is cut under the text: one mask for the link, a black rect per label slot', () => {
    const { root, index } = build();
    render(root, index, both());
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('data-dmap-side')).toBe('line');
    const m = maskOf(root)!;
    expect(m).toBeTruthy();
    expect(m.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    expect(m.getAttribute('maskContentUnits')).toBe('userSpaceOnUse');
    expect(whites(m)).toHaveLength(1);
    const slots = blacks(m);
    expect(slots).toHaveLength(2);
    const k = slots[0];
    expect(Number(k.getAttribute('width'))).toBe(27);
    expect(Number(k.getAttribute('height'))).toBe(10);
    expect(k.getAttribute('x')).toBe('106.5');
    expect(k.getAttribute('y')).toBe('95');
    expect(k.getAttribute('transform')).toBe('matrix(1 0 0 1 0 0) rotate(0 120 100)');
    // every element that draws the stroke of the link wears it; no rect is drawn in the diagram
    const drawn = strokesOf(root);
    expect(drawn.length).toBe(4);
    drawn.forEach((el) => expect(el.getAttribute('mask')).toBe(`url(#${m.id})`));
    expect(root.querySelector('rect.dmap-link-label-bg')).toBeNull();
    expect(layerOf(root)!.querySelector('rect')).toBeNull();
  });
  it('a label beside its stroke has no mask and the stroke is whole', () => {
    const { root, index } = build(SVG(strip));
    render(root, index, both());
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-side')).toBe('top');
    expect(maskOf(root)).toBeNull();
    strokesOf(root).forEach((el) => expect(el.hasAttribute('mask')).toBe(false));
  });
  it('a light theme with a dark diagram draws no rect and a dark halo', () => {
    const light = createTheme({ colors: { mode: 'light' } });
    const { root, index } = build();
    render(root, index, both(), { ...opts, theme: light });
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-side')).toBe('line');
    expect(layerOf(root)!.querySelectorAll('rect')).toHaveLength(0);
    expect(byHalf(root, 'a2b')!.getAttribute('stroke')).toBe(DARK);
    const fills = Array.from(maskOf(root)!.querySelectorAll('rect')).map((r) => r.getAttribute('fill'));
    expect(new Set(fills)).toEqual(new Set(['white', 'black']));
    expect(byHalf(root, 'a2b')!.getAttribute('fill')).toBe(light.colors.text.primary);
  });
  it('the top of a horizontal link is above; the near edge of the box is 2 beyond the drawn stroke edge', () => {
    const { root, index } = build(SVG(strip));
    render(root, index, both());
    // the drawn width is 4 (HalfState.width): the stroke edge at 98, the box (12 high) from 84 to 96, the centre at 90
    expect(byHalf(root, 'a2b')!.getAttribute('y')).toBe('90');
    expect(byHalf(root, 'b2a')!.getAttribute('y')).toBe('90');
    // the same half drawn at the widest stroke (linkWidth.max 10): the centre at 87
    const wide = new Map([
      ['e1', linkPatch('e1', { a2b: half({ width: 10 }), b2a: half({ width: 10 }), labelMode: 'percent' })],
    ]);
    const again = build(SVG(strip));
    render(again.root, again.index, wide);
    expect(byHalf(again.root, 'a2b')!.getAttribute('y')).toBe('87');
  });
  it('a width change on refresh moves the label across the link, not along it, and is no move', () => {
    const { root, index } = build(SVG(strip));
    const widths = (w: number) =>
      new Map([['e1', linkPatch('e1', { a2b: half({ width: w }), b2a: half({ width: w }), labelMode: 'percent' })]]);
    render(root, index, widths(4));
    const a = byHalf(root, 'a2b')!;
    const stamp = a.getAttribute('data-dmap-placed-at');
    const x = a.getAttribute('x');
    expect(a.getAttribute('y')).toBe('90');
    expect(render(root, index, widths(10))).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(a.getAttribute('y')).toBe('87');
    expect(a.getAttribute('x')).toBe(x);
    expect(a.getAttribute('data-dmap-placed-at')).toBe(stamp);
    expect(a.getAttribute('data-dmap-side')).toBe('top');
  });
  it('the cut follows the drawn text: its length plus 1.5 on each end, centred on the text, rebuilt when the text changes', () => {
    const { root, index } = build();
    render(root, index, both());
    const text = byHalf(root, 'a2b')!;
    // a text of 14 units whose glyphs stand 1 left of the anchor 120: the box x 112..126, the centre 119
    (text as unknown as { getBBox: () => unknown }).getBBox = () => ({ x: 112, y: 96, width: 14, height: 8 });
    render(root, index, both());
    let k = blacks(maskOf(root)!)[0];
    expect(Number(k.getAttribute('width'))).toBe(17);
    expect(Number(k.getAttribute('x'))).toBe(110.5);
    // the pads are equal: 112 - 110.5 = 127.5 - 126
    expect(Number(k.getAttribute('x')) + Number(k.getAttribute('width')) - 126).toBe(112 - Number(k.getAttribute('x')));
    expect(k.getAttribute('transform')).toBe('matrix(1 0 0 1 0 0) rotate(0 120 100)');
    const key = maskOf(root)!.getAttribute('data-dmap-key');
    // a longer text changes the key and the cut
    (text as unknown as { getBBox: () => unknown }).getBBox = () => ({ x: 108, y: 96, width: 22, height: 8 });
    render(root, index, both());
    k = blacks(maskOf(root)!)[0];
    expect(maskOf(root)!.getAttribute('data-dmap-key')).not.toBe(key);
    expect(Number(k.getAttribute('width'))).toBe(25);
    expect(Number(k.getAttribute('x'))).toBe(106.5);
  });
  it('the cut covers the drawn stroke plus 1 on each side and follows the width on a refresh', () => {
    const { root, index } = build();
    const widths = (w: number) =>
      new Map([['e1', linkPatch('e1', { a2b: half({ width: w }), b2a: half({ width: w }), labelMode: 'percent' })]]);
    render(root, index, widths(4));
    expect(Number(blacks(maskOf(root)!)[0].getAttribute('height'))).toBe(10);
    // the widest stroke, linkWidth.max 10: the cut is 12 high; a wider width is clamped to the range
    render(root, index, widths(10));
    const k = blacks(maskOf(root)!)[0];
    expect(Number(k.getAttribute('height'))).toBe(12);
    expect(Number(k.getAttribute('y'))).toBe(94);
    render(root, index, widths(14));
    expect(Number(blacks(maskOf(root)!)[0].getAttribute('height'))).toBe(12);
    // the overlay updates its strokes in place: they still wear the mask
    strokesOf(root).forEach((el) => expect(el.getAttribute('mask')).toBe(`url(#${maskOf(root)!.id})`));
  });
  it('a refresh keeps the strokes and their mask; a rebuilt overlay layer gets the mask in the same pass', () => {
    const { root, index } = build();
    const widths = (w: number, b2a = true) =>
      new Map([
        [
          'e1',
          linkPatch('e1', {
            a2b: half({ width: w }),
            ...(b2a ? { b2a: half({ width: w }) } : {}),
            labelMode: 'percent',
          }),
        ],
      ]);
    render(root, index, widths(4));
    const before = strokesOf(root);
    expect(before).toHaveLength(4);
    const ref = `url(#${maskOf(root)!.id})`;
    // the same values in new objects: the same elements, the mask stays
    render(root, index, widths(4));
    expect(strokesOf(root).every((el, i) => el.isSameNode(before[i]))).toBe(true);
    strokesOf(root).forEach((el) => expect(el.getAttribute('mask')).toBe(ref));
    // a new width: the same elements, updated, the mask stays
    render(root, index, widths(8));
    expect(strokesOf(root).every((el, i) => el.isSameNode(before[i]))).toBe(true);
    strokesOf(root).forEach((el) => expect(el.getAttribute('mask')).toBe(ref));
    // a half goes: the layer of the link is built again, and its new strokes wear the mask of the on-stroke label
    render(root, index, widths(8, false));
    const after = strokesOf(root);
    expect(after).toHaveLength(2);
    expect(after.some((el) => before.includes(el))).toBe(false);
    const m = maskOf(root);
    after.forEach((el) => expect(el.getAttribute('mask')).toBe(m ? `url(#${m.id})` : null));
  });
  it('both halves go to the bottom side when the top side is blocked along the whole half of one', () => {
    const { root, index } = build(SVG(strip + above));
    render(root, index, both());
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-side')).toBe('bottom');
    expect(byHalf(root, 'b2a')!.getAttribute('data-dmap-side')).toBe('bottom');
    // the drawn width 4: the centre at 100 + 2 + 2 + 6
    expect(byHalf(root, 'a2b')!.getAttribute('y')).toBe('110');
  });
  it('the cut leaves with a label that has no text and with the labels that are switched off', () => {
    const { root, index } = build();
    const two = (a: HalfState) => new Map([['e1', linkPatch('e1', { a2b: a, b2a: half(), labelMode: 'percent' })]]);
    render(root, index, two(half()));
    expect(blacks(maskOf(root)!)).toHaveLength(2);
    render(root, index, two(nodata()));
    expect(blacks(maskOf(root)!)).toHaveLength(1);
    render(root, index, two(half()));
    expect(blacks(maskOf(root)!)).toHaveLength(2);
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'none' })]]));
    expect(maskOf(root)).toBeNull();
    expect(root.querySelector('defs.dmap-link-label-defs')).toBeNull();
    strokesOf(root).forEach((el) => expect(el.hasAttribute('mask')).toBe(false));
  });
  it('a hidden layer (too small a scale) takes the mask off the strokes, and a shown layer puts it back', () => {
    const { root, index } = build();
    sized(root, 0.2);
    render(root, index, both());
    strokesOf(root).forEach((el) => expect(el.hasAttribute('mask')).toBe(false));
    sized(root, 1);
    setLinkLabelScale(root);
    strokesOf(root).forEach((el) => expect(el.getAttribute('mask')).toBe(`url(#${maskOf(root)!.id})`));
    sized(root, 0.2);
    setLinkLabelScale(root);
    strokesOf(root).forEach((el) => expect(el.hasAttribute('mask')).toBe(false));
  });
});

describe('renderLinkLabels: the cut follows its label', () => {
  // thin strips on the stroke leave a gap of 60 around the anchor of a2b: a short text fits on the stroke, a long one
  // stands beside it (above is free)
  const strips = ['40', '150']
    .map((x) => `<g data-cell-id="s${x}"><g><rect x="${x}" y="98" width="50" height="4"/></g></g>`)
    .join('');
  const value = (text: string): PatchMap =>
    new Map([
      ['e1', linkPatch('e1', { a2b: half({ display: { text, numeric: 0 } }), b2a: half(), labelMode: 'value' })],
    ]);
  const count = (root: SVGSVGElement) => {
    const m = maskOf(root);
    return m ? blacks(m).length : 0;
  };
  it('the slot leaves the mask when its label moves from the stroke to a side, and comes back with it', () => {
    const { root, index } = build(SVG(strips));
    render(root, index, value('41'));
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('data-dmap-side')).toBe('line');
    const before = count(root);
    expect(before).toBeGreaterThan(0);
    render(root, index, value('abcdefghijklmn Mb/s'));
    expect(a.getAttribute('data-dmap-side')).toBe('top');
    expect(count(root)).toBe(before - 1);
    render(root, index, value('41'));
    expect(a.getAttribute('data-dmap-side')).toBe('line');
    expect(count(root)).toBe(before);
  });
  it('a dropped label leaves the mask and a recovered label comes back', () => {
    // blocks across the stroke and beside it leave a gap of 60 only
    const blocks = ['40', '150']
      .map((x) => `<g data-cell-id="b${x}"><g><rect x="${x}" y="70" width="50" height="60"/></g></g>`)
      .join('');
    const { root, index } = build(SVG(blocks));
    render(root, index, value('41'));
    const a = byHalf(root, 'a2b')!;
    const before = count(root);
    expect(before).toBeGreaterThan(0);
    render(root, index, value('abcdefghijklmn Mb/s'));
    expect(a.getAttribute('visibility')).toBe('hidden');
    expect(count(root)).toBe(before - 1);
    render(root, index, value('42'));
    expect(a.getAttribute('visibility')).toBeNull();
    expect(count(root)).toBe(before);
  });
  it('the box is mapped into the local space of a scaled, translated group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" style="background-color: #1d2d3d">
      <g transform="translate(10 20) scale(2)">
        <g data-cell-id="e1"><g><path d="M 0 0 L 160 0" fill="none" stroke="#333" pointer-events="stroke"/></g></g>
      </g></svg>`;
    const { root, index } = build(svg);
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]));
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('data-dmap-side')).toBe('line');
    const k = blacks(maskOf(root)!)[0];
    // the inverse of translate(10 20) scale(2): scale 0.5, shift -5 -10
    expect(k.getAttribute('transform')).toMatch(/^matrix\(0\.5 0 0 0\.5 -5 -10\) rotate\(0 /);
    expect(Number(k.getAttribute('width'))).toBe(27);
    expect(strokesOf(root)[0].getAttribute('mask')).toBe(`url(#${maskOf(root)!.id})`);
  });
  it('a vertical link has a rotated slot', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" style="background-color: #1d2d3d">
      <g data-cell-id="e1"><g><path d="M 100 10 L 100 190" fill="none" stroke="#333" pointer-events="stroke"/></g></g></svg>`;
    const { root, index } = build(svg);
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]));
    const k = blacks(maskOf(root)!)[0];
    expect(k.getAttribute('transform')).toMatch(/rotate\(-90 /);
  });
  it('two panels get two different mask ids', () => {
    const one = build();
    const two = build();
    const patches = () => new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    render(one.root, one.index, patches());
    render(two.root, two.index, patches());
    const ids = [maskOf(one.root)!.id, maskOf(two.root)!.id];
    expect(ids[0]).not.toBe(ids[1]);
    expect(document.querySelectorAll(`[id="${ids[0]}"]`)).toHaveLength(1);
  });
});

describe('renderLinkLabels: obstacles', () => {
  it('the obstacle of an arrow head is the head of the widest half, also while the half is thin', () => {
    const { root, index } = build();
    const patches: PatchMap = new Map([
      ['e1', linkPatch('e1', { a2b: half({ width: 2 }), b2a: half({ width: 2 }), labelMode: 'percent' })],
    ]);
    render(root, index, patches);
    // the drawn heads are 8 by 8; the reserved ones 12 long and 24 wide (linkWidth.max 10), both tips at x = 200
    expect(root.querySelector('.dmap-arrow[data-dmap-half="a2b"]')!.getAttribute('points')).toBe(
      '200,100 192,96 192,104'
    );
    // the triangle itself, not its box: a label beside the stroke may stand next to the narrow end. Each head knows
    // its edge and the leg of its half.
    const heads = stageObstacles(root, index, patches, 10).filter((o) => o.kind === 'polygon');
    expect(heads).toContainEqual({
      kind: 'polygon',
      points: [
        { x: 200, y: 100 },
        { x: 188, y: 88 },
        { x: 188, y: 112 },
      ],
      owner: 'e1',
      leg: 'e1:a2b',
    });
    expect(heads).toContainEqual({
      kind: 'polygon',
      points: [
        { x: 200, y: 100 },
        { x: 212, y: 112 },
        { x: 212, y: 88 },
      ],
      owner: 'e1',
      leg: 'e1:b2a',
    });
  });
  it('a plain draw.io node is an obstacle: the label slides towards the end of the link', () => {
    const node = `<g data-cell-id="n3"><g><rect x="100" y="60" width="40" height="50"/></g></g>`;
    const { root, index } = build(SVG(node));
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]));
    const a = byHalf(root, 'a2b')!;
    expect(Number(a.getAttribute('x'))).toBeLessThan(100 - 13);
    expect(a.getAttribute('y')).toBe('100');
    expect(byHalf(root, 'b2a')!.getAttribute('x')).toBe('280');
  });
  it('the clearance of a node body is half its drawn stroke: a status border of 12 reserves 6 (R5)', () => {
    const node = `<g data-cell-id="n3"><g><rect x="100" y="20" width="40" height="30" stroke-width="8"/></g></g>`;
    const { root, index } = build(SVG(node));
    const statusView: PatchStatus = {
      state: 'down',
      severity: 'down',
      refId: 'up',
      reason: 'Down',
      conditionKey: 'k',
      queryIds: ['q'],
      coverage: { available: 1, expected: 1 },
    };
    const down: CellPatch = {
      cellId: 'n3',
      scope: { cell: {} },
      urls: [],
      statusView,
    };
    const before = stageObstacles(root, index, new Map(), 10);
    // the reach is the border a down status gives (12), also while the status is normal
    expect(before).toContainEqual({ kind: 'rect', rect: { x: 100, y: 20, width: 40, height: 30 }, clearance: 6 });
    applyPatches(index, new Map([['n3', down]]), undefined, undefined, { theme, osDark: false });
    expect((index.get('n3')!.shape as SVGElement).style.strokeWidth).toBe('12');
    const after = stageObstacles(root, index, new Map(), 10);
    expect(after).toEqual(before);
  });
  it('an image under scale(4,1) reserves 4 root units on its wide axis', () => {
    const node = `<g transform="scale(4,1)"><g data-cell-id="n4"><g><image x="25" y="20" width="10" height="30" href="data:image/png;base64,AAAA"/></g></g></g>`;
    const { root, index } = build(SVG(node));
    const r = stageObstacles(root, index, new Map(), 10).find((o) => o.kind === 'rect' && o.rect.y === 20);
    expect(r && r.kind === 'rect' && r.clearance).toBe(4);
  });
  it('a 1.5 stroke with a stroke binding (painted 2.5) reserves at least 1.25', () => {
    const node = `<g data-cell-id="n5"><g><rect x="100" y="20" width="40" height="30" stroke-width="1.5"/></g></g>`;
    const { root, index } = build(SVG(node));
    const patch = {
      cellId: 'n5',
      scope: { cell: {} },
      urls: [],
      shape: { color: '#00ff00', target: 'stroke' },
    } as unknown as CellPatch;
    applyPatches(index, new Map([['n5', patch]]), undefined, undefined, { theme, osDark: false });
    const r = stageObstacles(root, index, new Map(), 10).find((o) => o.kind === 'rect' && o.rect.y === 20);
    expect(r && r.kind === 'rect' && r.clearance).toBeGreaterThanOrEqual(1.25);
  });
  it('a stroke binding keeps the reserve of the grid through down and normal (the widest stroke is fixed)', () => {
    const node = `<g data-cell-id="n6"><g><rect x="100" y="20" width="40" height="30" stroke-width="1.5"/></g></g>`;
    const { root, index } = build(SVG(node));
    const view = (state: 'down' | 'normal'): PatchStatus => ({
      state,
      severity: state,
      refId: 'up',
      reason: state,
      conditionKey: 'k',
      queryIds: ['q'],
      coverage: { available: 1, expected: 1 },
    });
    const patch = (state: 'down' | 'normal') =>
      ({
        cellId: 'n6',
        scope: { cell: {} },
        urls: [],
        shape: { color: '#00ff00', target: 'stroke' },
        statusView: view(state),
      }) as unknown as CellPatch;
    const ctx = { theme, osDark: false };
    const grid = stageObstacles(root, index, new Map(), 10);
    const prev = applyPatches(index, new Map([['n6', patch('down')]]), undefined, undefined, ctx);
    applyPatches(index, new Map([['n6', patch('normal')]]), prev, undefined, ctx);
    expect((index.get('n6')!.shape as SVGElement).style.strokeWidth).toBe('2.5');
    const reach = (o: ReturnType<typeof stageObstacles>) => {
      const r = o.find((x) => x.kind === 'rect' && x.rect.y === 20);
      return r && r.kind === 'rect' ? r.clearance : 0;
    };
    expect(reach(grid)).toBeGreaterThanOrEqual(1.25);
    expect(reach(stageObstacles(root, index, new Map(), 10))).toBe(reach(grid));
  });
  it('a rotated, unevenly scaled border is reserved by the bounding box of its square', () => {
    const wrap = (t: string) =>
      `<g transform="${t}"><g data-cell-id="n7"><g><image x="25" y="20" width="10" height="30" href="data:image/png;base64,AAAA"/></g></g></g>`;
    const clearance = (t: string) => {
      const { root, index } = build(SVG(wrap(t)));
      const base = stageObstacles(...(Object.values(build()) as [SVGSVGElement, CellIndex]), new Map(), 10);
      const extra = stageObstacles(root, index, new Map(), 10).filter(
        (o) => o.kind === 'rect' && !base.some((b) => JSON.stringify(b) === JSON.stringify(o))
      );
      const r = extra[0];
      return r && r.kind === 'rect' ? r.clearance : 0;
    };
    expect(clearance('scale(4,1)')).toBe(4);
    expect(clearance('matrix(2.8284271 0.7071068 -2.8284271 0.7071068 0 0)')).toBeGreaterThanOrEqual(5.65);
  });
  it('an image device reserves the half of its status border: 1 unit', () => {
    const node = `<g data-cell-id="n4"><g><image x="100" y="20" width="40" height="30" href="data:image/png;base64,AAAA"/></g></g>`;
    const { root, index } = build(SVG(node));
    const obstacles = stageObstacles(root, index, new Map(), 10);
    expect(obstacles).toContainEqual({ kind: 'rect', rect: { x: 100, y: 20, width: 40, height: 30 }, clearance: 1 });
  });
  it('a status on a patched edge reserves no room: the obstacles are the stroke pieces and the node bodies', () => {
    const { root, index } = build();
    const statusView: PatchStatus = {
      state: 'down',
      severity: 'down',
      refId: 'up',
      reason: 'Down',
      conditionKey: 'k',
      queryIds: ['q'],
      coverage: { available: 1, expected: 1 },
    };
    const patch: CellPatch = { ...linkPatch('e1', { a2b: half(), labelMode: 'percent' }), statusView };
    const patches = new Map<string, CellPatch>([['e1', patch]]);
    render(root, index, patches);
    expect(root.querySelector('.dmap-status-marker')).toBeNull();
    // one leg: its label stands at the midpoint of the edge
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('x')).toBe('200');
    const obstacles = stageObstacles(root, index, patches, 10);
    // no rect at the midpoint of the edge (the room of the marker of old)
    expect(obstacles.some((o) => o.kind === 'rect' && o.rect.x > 190 && o.rect.x < 215)).toBe(false);
    // the edge stroke at linkWidth.max / 2: one piece for a one-leg link, the pieces up to the split for two legs;
    // the node bodies at half their stroke
    expect(obstacles).toContainEqual({
      kind: 'segment',
      a: { x: 40, y: 100 },
      b: { x: 360, y: 100 },
      clearance: 5,
      owner: 'e1',
      piece: { leg: 'e1:a2b', index: 0 },
    });
    const two = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    const both = stageObstacles(root, index, two, 10);
    expect(both).toContainEqual({
      kind: 'segment',
      a: { x: 40, y: 100 },
      b: { x: 200, y: 100 },
      clearance: 5,
      owner: 'e1',
      piece: { leg: 'e1:a2b', index: 0 },
    });
    expect(both).toContainEqual({
      kind: 'segment',
      a: { x: 360, y: 100 },
      b: { x: 200, y: 100 },
      clearance: 5,
      owner: 'e1',
      piece: { leg: 'e1:b2a', index: 0 },
    });
    expect(obstacles).toContainEqual({ kind: 'rect', rect: { x: 0, y: 80, width: 40, height: 40 }, clearance: 1.5 });
    expect(obstacles).toContainEqual({ kind: 'rect', rect: { x: 360, y: 80, width: 40, height: 40 }, clearance: 1 });
  });
});

describe('renderLinkLabels: backgrounds', () => {
  it('the portograph canvas and the groups of the demo sheet are no obstacles: the WAN link gets both labels', () => {
    const { root, index } = build(readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8'));
    const ISP_A = 'pg-link~isp-a:pppoe->rtr-a:wan1';
    expect(index.get('pg-canvas')?.shape?.localName).toBe('rect');
    const patches: PatchMap = new Map([[ISP_A, linkPatch(ISP_A, { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const obstacles = stageObstacles(root, index, patches, 10);
    const bodies = obstacles.flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    expect(bodies.some((r) => r.width > 1000)).toBe(false);
    // the vertical WAN link: the labels read bottom to top, on the stroke
    expect(byHalf(root, 'a2b', ISP_A)!.getAttribute('transform')).toMatch(/^rotate\(-90 /);
    expect(Number(byHalf(root, 'a2b', ISP_A)!.getAttribute('x'))).toBeCloseTo(188.37, 0);
  });
  it('the short WAN link (104 units) keeps both value labels beside the reserved heads of the widest halves', () => {
    const { root, index } = build(readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8'));
    const ISP_A = 'pg-link~isp-a:pppoe->rtr-a:wan1';
    const patches: PatchMap = new Map([[ISP_A, linkPatch(ISP_A, { a2b: half(), b2a: half(), labelMode: 'value' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
  });
  it('a link of 36 units keeps both labels beside the drawn heads; the text moves out when its head grows', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
      <g data-cell-id="e1"><g><path d="M 200 82 L 200 118" fill="none" pointer-events="stroke"/></g></g></svg>`;
    const { root, index } = build(svg);
    const patches: PatchMap = new Map([
      ['e1', linkPatch('e1', { a2b: half({ width: 2 }), b2a: half({ width: 2 }), labelMode: 'percent' })],
    ]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    // one side holds both, as the pair prefers
    expect([byHalf(root, 'a2b')!, byHalf(root, 'b2a')!].map((t) => t.getAttribute('data-dmap-side'))).toEqual([
      'top-head',
      'top-head',
    ]);
    // left of the vertical link at x = 200: the wide gap (4) beyond the wing of the drawn head (4: the head of a
    // half 2 wide is 8 wide) and half the box height (6, the 10-unit slot and the halo), 14 off the line
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('transform')).toMatch(/^rotate\(-90 186 /);
    const placedAt = a.getAttribute('data-dmap-placed-at');
    // the half at linkWidth.max: its head is 24 wide, the text stands 4 + 12 + 6 = 22 off the line, at the same place
    // along it, and the label is not placed again
    const wide: PatchMap = new Map([
      ['e1', linkPatch('e1', { a2b: half({ width: 10 }), b2a: half({ width: 2 }), labelMode: 'percent' })],
    ]);
    expect(render(root, index, wide)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(a.getAttribute('transform')).toMatch(/^rotate\(-90 178 /);
    expect(a.getAttribute('data-dmap-placed-at')).toBe(placedAt);
  });
  it('a group frame is no obstacle; its title bar is, because a label must not cover the caption', () => {
    const frame = `<g data-cell-id="pg-group~wan"><g><rect x="60" y="40" width="280" height="120"/></g></g>`;
    const title = `<g data-cell-id="pg-groupTitle~wan"><g><rect x="100" y="60" width="40" height="50"/><text x="104" y="74">wan</text></g></g>`;
    const { root, index } = build(SVG(frame + title));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(100 - 13);
    const rects = stageObstacles(root, index, patches, 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    expect(rects).not.toContainEqual({ x: 60, y: 40, width: 280, height: 120 });
    expect(rects).toContainEqual({ x: 100, y: 60, width: 40, height: 50 });
  });
  describe('the title text of a group', () => {
    const VERTICAL = (
      extra: string
    ) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" style="background-color: #1d2d3d">${extra}
      <g data-cell-id="e1"><g><path d="M 100 10 L 100 190" fill="none" stroke="#333" pointer-events="stroke"/></g></g></svg>`;
    // the leg of the a2b half only: 10 .. 190, its middle at y 100; the title text stands across the link there
    const title = (id: string) =>
      `<g data-cell-id="${id}"><g><rect x="20" y="20" width="160" height="160" fill="none" stroke="#999"/></g><g><g font-size="12" text-anchor="middle"><text x="100" y="104">Core group</text></g></g></g>`;
    const patches = (): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]);
    const textBox = { x: 100 - 0.6 * 12 * 5, y: 104 - 12, width: 0.6 * 12 * 10, height: 15 };
    const overlaps = (root: SVGSVGElement) => {
      const el = byHalf(root, 'a2b')!;
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      // the rotated label: 12 along y, 26 .. wide box turned by -90: it spans y +- 13 and x +- 6
      return (
        y + 13 > textBox.y &&
        y - 13 < textBox.y + textBox.height &&
        x + 6 > textBox.x &&
        x - 6 < textBox.x + textBox.width
      );
    };
    it('a portograph group title is an obstacle; the frame and the interior stay free', () => {
      const { root, index } = build(VERTICAL(title('pg-group~core')));
      expect(index.get('pg-group~core')?.label).toBeTruthy();
      render(root, index, patches());
      const rects = stageObstacles(root, index, patches(), 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
      expect(rects).toContainEqual(textBox);
      expect(rects).not.toContainEqual({ x: 20, y: 20, width: 160, height: 160 });
      expect(overlaps(root)).toBe(false);
      expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-dropped')).toBeNull();
    });
    it('a plain draw.io container with a title is the same', () => {
      const inner = `<g data-cell-id="n3"><g><rect x="30" y="40" width="20" height="20"/></g></g><g data-cell-id="n4"><g><rect x="150" y="140" width="20" height="20"/></g></g>`;
      const { root, index } = build(VERTICAL(title('box') + inner));
      render(root, index, patches());
      const rects = stageObstacles(root, index, patches(), 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
      expect(rects).toContainEqual(textBox);
      expect(overlaps(root)).toBe(false);
    });
  });
  it('a plain draw.io container that holds other vertices is a background; the vertices inside stay obstacles', () => {
    const container = `<g data-cell-id="box"><g><rect x="60" y="40" width="280" height="120"/></g></g>`;
    const inner = `<g data-cell-id="n3"><g><rect x="100" y="60" width="40" height="50"/></g></g>`;
    const inner2 = `<g data-cell-id="n4"><g><rect x="260" y="130" width="40" height="20"/></g></g>`;
    const { root, index } = build(SVG(container + inner + inner2));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(100 - 13);
    const rects = stageObstacles(root, index, patches, 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    expect(rects).not.toContainEqual({ x: 60, y: 40, width: 280, height: 120 });
    expect(rects).toContainEqual({ x: 100, y: 60, width: 40, height: 50 });
  });
});

describe('renderLinkLabels: review cases', () => {
  const two = (a: HalfState, b: HalfState = half()): PatchMap =>
    new Map([['e1', linkPatch('e1', { a2b: a, b2a: b, labelMode: 'percent' })]]);
  it('a slot that changes while the label is hidden is placed again: no small reservation survives', () => {
    // an obstacle right of the anchor: a 1-glyph reading fits beside it, the percent slot does not
    const block = `<g data-cell-id="n3"><g><rect x="128" y="70" width="40" height="45"/></g></g>`;
    const { root, index } = build(SVG(block));
    const reading = half({ percent: undefined, percentDisplay: undefined, display: { text: '1', numeric: 1 } });
    render(root, index, two(reading));
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('x')).toBe('120');
    render(root, index, two(nodata()));
    expect(a.getAttribute('visibility')).toBe('hidden');
    render(root, index, two(half({ percentDisplay: '41%' })));
    expect(a.getAttribute('visibility')).toBeNull();
    expect(a.textContent).toBe('41%');
    // the percent box (28 wide) at the anchor would meet the block at 128: the label stands away from it
    expect(Number(a.getAttribute('x'))).toBeLessThanOrEqual(128 - 13);
  });
  it('a device body with one badge inside stays an obstacle; a vertex that holds two vertices is a background', () => {
    const device = `<g data-cell-id="dev"><g><rect x="90" y="56" width="60" height="50"/></g></g>`;
    const badge = `<g data-cell-id="badge"><g><rect x="94" y="60" width="10" height="10"/></g></g>`;
    const { root, index } = build(SVG(device + badge));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    render(root, index, patches);
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(90 - 13);
    const rects = stageObstacles(root, index, patches, 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    expect(rects).toContainEqual({ x: 90, y: 56, width: 60, height: 50 });
    const second = `<g data-cell-id="badge2"><g><rect x="130" y="60" width="10" height="10"/></g></g>`;
    const container = build(SVG(device + badge + second));
    const more = stageObstacles(container.root, container.index, patches, 10).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
    expect(more).not.toContainEqual({ x: 90, y: 56, width: 60, height: 50 });
  });
  it('adding the reverse half of an unlabelled edge moves its arrow heads: the placement runs again', () => {
    const other = `<g data-cell-id="e2"><g><path d="M 40 150 L 360 150" fill="none" stroke="#333" pointer-events="stroke"/></g></g>`;
    const { root, index } = build(SVG(other));
    const labelled = linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' });
    const one = new Map([
      ['e1', labelled],
      ['e2', linkPatch('e2', { a2b: half(), labelMode: 'none' })],
    ]);
    render(root, index, one);
    const stamp = byHalf(root, 'a2b')!.getAttribute('data-dmap-placed-at');
    const both = new Map([
      ['e1', labelled],
      ['e2', linkPatch('e2', { a2b: half(), b2a: half(), labelMode: 'none' })],
    ]);
    render(root, index, both);
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-placed-at')).not.toBe(stamp);
  });
  describe('the own head on another run (review of 2026-10-29)', () => {
    // a one-way link: a jog of 4, a vertical run of 40 and the run of 24 that holds the head, which points left to
    // (80, 60). Two bodies leave the left of the vertical run as the only spot of the 28-unit percent slot. Before
    // the fix the head was no obstacle for that spot, and at width 8 it met the text.
    const svg = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <g data-cell-id="e1"><g><path d="${d}" fill="none" pointer-events="stroke"/></g></g>
      <g data-cell-id="n1"><g><rect x="97" y="41" width="42" height="68" stroke-width="0"/></g></g>
      <g data-cell-id="n2"><g><rect x="61" y="98" width="78" height="13" stroke-width="0"/></g></g></svg>`;
    /** a separating-axis test of two convex polygons; touching is free */
    const convexMeet = (a: Point[], b: Point[]) =>
      ![a, b].some((poly) =>
        poly.some((p, i) => {
          const q = poly[(i + 1) % poly.length];
          const ax = { x: p.y - q.y, y: q.x - p.x };
          const span = (pts: Point[]) => pts.map((v) => v.x * ax.x + v.y * ax.y);
          const [sa, sb] = [span(a), span(b)];
          return Math.max(...sa) <= Math.min(...sb) + 1e-9 || Math.max(...sb) <= Math.min(...sa) + 1e-9;
        })
      );
    const pointsOf = (el: Element) =>
      el
        .getAttribute('points')!
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [x, y] = pair.split(',').map(Number);
          return { x, y };
        });
    it.each([
      ['a2b', 'M 100 100 L 104 100 L 104 60 L 80 60'],
      ['b2a', 'M 80 60 L 104 60 L 104 100 L 100 100'],
    ] as const)('%s: the text clears its drawn head at every width, on each refresh', (which, d) => {
      const length = vi.fn(() => 28);
      Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value: length });
      try {
        const { root, index } = build(svg(d));
        const patches = (width: number): PatchMap =>
          new Map([
            ['e1', linkPatch('e1', { [which]: half({ width, percentDisplay: '100%' }), labelMode: 'percent' })],
          ]);
        for (const width of [2, 3, 4, 5, 6, 7, 8, 9, 10, 6, 2]) {
          expect(render(root, index, patches(width)).placed).toBe(1);
          const label = byHalf(root, which)!;
          const [, degrees] = /^rotate\((\S+) /.exec(label.getAttribute('transform')!)!;
          // the text box of the slot (28 × 10, without the halo) about its centre
          const box = cornersOf({
            centre: { x: Number(label.getAttribute('x')), y: Number(label.getAttribute('y')) },
            width: 28,
            height: 10,
            degrees: Number(degrees),
          });
          const head = pointsOf(root.querySelector(`polygon.dmap-arrow[data-dmap-half="${which}"]`)!);
          expect(convexMeet(box, head), `width ${width}`).toBe(false);
        }
        expect(length).toHaveBeenCalled();
      } finally {
        delete (SVGElement.prototype as { getComputedTextLength?: unknown }).getComputedTextLength;
      }
    });
  });
  describe('the bend spot', () => {
    // a run of 31 and a jog of 10: no straight run holds the 26 unit box, so only the last resort can place it
    const bend = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" style="background-color: #1d2d3d">
      <g data-cell-id="e1"><g><path d="M 20 100 L 51 100 L 51 110" fill="none" stroke="#333" pointer-events="stroke"/></g></g></svg>`;
    const one = (): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]);
    it('places the label beside the bend', () => {
      const { root, index } = build(bend);
      expect(render(root, index, one())).toEqual({ placed: 1, dropped: 0, moved: 0 });
    });
    it('a label whose box would leave the bounds of the diagram stays dropped', () => {
      const { root, index } = build(bend);
      sized(root, 1);
      renderOverlay(root, index, one(), { theme, maxWidth: opts.linkWidth.max });
      const bounds = { x: 0, y: 95, w: 400, h: 10 };
      expect(renderLinkLabels(root, index, one(), { ...opts, bounds })).toEqual({ placed: 0, dropped: 1, moved: 0 });
    });
  });
  it('a plain text cell is an obstacle', () => {
    const text = `<g data-cell-id="t1"><g><text x="100" y="102" font-size="10">a caption</text></g></g>`;
    const { root, index } = build(SVG(text));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(index.get('t1')?.label).toBeTruthy();
    render(root, index, patches);
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).not.toBe(120);
    const rects = stageObstacles(root, index, patches, 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    expect(rects.some((r) => r.x === 100 && r.y < 102 && r.width > 40)).toBe(true);
  });
  describe('edge text', () => {
    // the label spot of the a2b half is x 120 (anchor), y 100: a text box of "tunnel link" stands on it
    const rectsOf = (root: SVGSVGElement, index: CellIndex, patches: PatchMap) =>
      stageObstacles(root, index, patches, 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
    const both = (): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    /** the label box of the half as the DOM says it: centre x/y and the 24 x 10 slot */
    const clear = (root: SVGSVGElement, text: { x: number; w: number }) => {
      const a = byHalf(root, 'a2b')!;
      const x = Number(a.getAttribute('x'));
      const y = Number(a.getAttribute('y'));
      const overlapX = x + 12 > text.x && x - 12 < text.x + text.w;
      const overlapY = y + 5 > 95 && y - 5 < 105;
      return !(overlapX && overlapY);
    };
    it('the value text of the edge itself is an obstacle for the labels of that edge', () => {
      const own = `<text x="100" y="102" font-size="8">tunnel link</text>`;
      const svg = SVG().replace('pointer-events="stroke"/>', `pointer-events="stroke"/>${own}`);
      const { root, index } = build(svg);
      expect(index.get('e1')?.label).toBeTruthy();
      render(root, index, both());
      expect(rectsOf(root, index, both()).some((r) => r.x === 100 && r.width > 40)).toBe(true);
      expect(clear(root, { x: 100, w: 0.6 * 8 * 11 })).toBe(true);
    });
    it('a draw.io edge label child cell is an obstacle', () => {
      const child = `<g data-cell-id="el1"><g><rect x="100" y="94" width="50" height="12" fill="none" stroke="none"/><text x="100" y="102" font-size="8">tunnel link</text></g></g>`;
      const { root, index } = build(SVG(child));
      render(root, index, both());
      expect(clear(root, { x: 100, w: 50 })).toBe(true);
    });
    it('a portograph link label cell is an obstacle', () => {
      const chip = `<g data-cell-id="0" data-meta-label="" data-meta-pg-schema="1"/><g data-cell-id="pg-linkLabel~e1" data-pg-kind="link-label"><g><rect x="100" y="94" width="50" height="12"/><text x="102" y="102" font-size="8">metric 10</text></g></g>`;
      const { root, index } = build(SVG(chip));
      render(root, index, both());
      expect(clear(root, { x: 100, w: 50 })).toBe(true);
    });
  });
});

describe('renderLinkLabels: the halo colour', () => {
  const both = (): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
  const bare = () => build(SVG().replace(' style="background-color: #1d2d3d"', ''));
  it('is the computed background of the root; a transparent root takes the canvas colour of the theme', () => {
    const dark = build();
    render(dark.root, dark.index, both());
    labels(dark.root).forEach((el) => expect(el.getAttribute('stroke')).toBe(DARK));
    for (const style of ['', 'background-color: transparent', 'background-color: rgba(0, 0, 0, 0)']) {
      const { root, index } = build(
        SVG().replace(' style="background-color: #1d2d3d"', style ? ` style="${style}"` : '')
      );
      render(root, index, both());
      labels(root).forEach((el) => expect(el.getAttribute('stroke')).toBe(theme.colors.background.canvas));
    }
  });
  it('keeps an opaque colour with a zero channel and falls back for any alpha below 1', () => {
    const colour = (css: string) => {
      const { root, index } = build();
      root.style.backgroundColor = css;
      render(root, index, both());
      return byHalf(root, 'a2b')!.getAttribute('stroke');
    };
    expect(colour('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)');
    expect(colour('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
    expect(colour('rgba(29, 45, 61, 0.5)')).toBe(theme.colors.background.canvas);
    expect(colour('rgba(0, 0, 0, 0)')).toBe(theme.colors.background.canvas);
    expect(colour('rgb(0 0 0 / 0.5)')).toBe(theme.colors.background.canvas);
  });
  it('keeps only an opaque rgb colour as the computed style gives it', () => {
    const { root } = build();
    const halo = (backgroundColor: string) => {
      const spy = vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({ backgroundColor } as CSSStyleDeclaration);
      try {
        return haloColour(root, theme);
      } finally {
        spy.mockRestore();
      }
    };
    for (const opaque of [
      'rgb(29, 45, 61)',
      'rgb(29 45 61)',
      'rgba(29, 45, 61, 1)',
      'rgb(29 45 61 / 100%)',
      'RGB(0, 0, 0)',
    ]) {
      expect(halo(opaque)).toBe(opaque);
    }
    for (const other of [
      'rgba(29, 45, 61, 0.5)',
      'rgb(29 45 61 / 50%)',
      'transparent',
      '',
      '#1d2d3d',
      'black',
      'var(--bg)',
      'light-dark(#fff, #000)',
      'hsl(0, 0%, 0%)',
    ]) {
      expect(halo(other)).toBe(theme.colors.background.canvas);
    }
  });
  it('is read again on a theme change', () => {
    const { root, index } = bare();
    render(root, index, both());
    const a = byHalf(root, 'a2b')!;
    expect(a.getAttribute('stroke')).toBe(theme.colors.background.canvas);
    const light = createTheme({ colors: { mode: 'light' } });
    render(root, index, both(), { ...opts, theme: light });
    expect(a.getAttribute('stroke')).toBe(light.colors.background.canvas);
    expect(a.getAttribute('fill')).toBe(light.colors.text.primary);
    root.style.backgroundColor = '#1d2d3d';
    render(root, index, both(), { ...opts, theme: createTheme({ colors: { mode: 'light' } }) });
    expect(a.getAttribute('stroke')).toBe(DARK);
  });
  it('a light theme with a dark root gives a dark halo, never the colour of the light theme', () => {
    const light = createTheme({ colors: { mode: 'light' } });
    const { root, index } = build();
    render(root, index, both(), { ...opts, theme: light });
    labels(root).forEach((el) => expect(el.getAttribute('stroke')).toBe(DARK));
    expect(DARK).not.toBe(light.colors.background.canvas);
  });
});

describe('renderLinkLabels: HTML labels', () => {
  // draw.io writes an HTML label as a foreignObject of 100% x 100% with overflow visible: its own box is the whole
  // viewport, the text is a flex child that overflows it. The obstacle is the box of that content.
  const fo = `<switch><foreignObject width="100%" height="100%" style="overflow: visible"><div xmlns="http://www.w3.org/1999/xhtml" class="inner"><div>tunnel link</div></div></foreignObject></switch>`;
  const both = (): PatchMap => new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  /** the content box of the label as the browser would report it, in screen pixels (= root units here) */
  function stubContent(root: SVGSVGElement, box: { x: number; y: number; width: number; height: number }) {
    Object.assign(root, { getScreenCTM: () => identity });
    const inner = root.querySelector('div.inner') as HTMLElement;
    inner.getBoundingClientRect = () =>
      ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }) as DOMRect;
  }
  const rects = (root: SVGSVGElement, index: CellIndex, patches: PatchMap) =>
    stageObstacles(root, index, patches, 10).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));

  it('an HTML edge label is an obstacle of its content box, not of the 100% viewport box', () => {
    const svg = SVG().replace('pointer-events="stroke"/>', `pointer-events="stroke"/></g><g>${fo}`);
    const { root, index } = build(svg);
    expect(index.get('e1')?.label?.localName).toBe('foreignObject');
    stubContent(root, { x: 100, y: 94, width: 50, height: 12 });
    const boxes = rects(root, index, both());
    expect(boxes).toContainEqual({ x: 100, y: 94, width: 50, height: 12 });
    expect(boxes.some((r) => r.width >= 100 && r.height >= 100)).toBe(false);
    // every label still has a place: the label slides along or steps off the line, none is dropped
    expect(render(root, index, both())).toEqual({ placed: 2, dropped: 0, moved: 0 });
    const a = byHalf(root, 'a2b')!;
    const x = Number(a.getAttribute('x'));
    expect(a.getAttribute('data-dmap-side') !== 'line' || x + 12 <= 100 || x - 12 >= 150).toBe(true);
  });
  it('a plain text cell and a chip with an HTML label measure the content too', () => {
    const cell = `<g data-cell-id="t1"><g>${fo}</g></g>`;
    const { root, index } = build(SVG(cell));
    stubContent(root, { x: 100, y: 94, width: 50, height: 12 });
    const boxes = rects(root, index, both());
    expect(boxes).toContainEqual({ x: 100, y: 94, width: 50, height: 12 });
    expect(boxes.some((r) => r.width >= 100 && r.height >= 100)).toBe(false);
    const chip = `<g data-cell-id="0" data-meta-label="" data-meta-pg-schema="1"/><g data-cell-id="pg-linkLabel~e1" data-meta-pg-kind="link-label"><g>${fo}</g></g>`;
    const second = build(SVG(chip));
    stubContent(second.root, { x: 100, y: 94, width: 50, height: 12 });
    const chips = rects(second.root, second.index, both());
    expect(chips.some((r) => r.width >= 100 && r.height >= 100)).toBe(false);
    expect(chips).toContainEqual({ x: 100, y: 94, width: 50, height: 12 });
  });
  it('an empty child next to an HTML label does not stretch the box to the origin', () => {
    const cell = `<g data-cell-id="0" data-meta-label="" data-meta-pg-schema="1"/><g data-cell-id="pg-linkLabel~e1" data-meta-pg-kind="link-label" data-meta-pg-of="e1"><g><rect width="0" height="0"/>${fo}</g></g>`;
    const { root, index } = build(SVG(cell));
    stubContent(root, { x: 100, y: 94, width: 50, height: 12 });
    const boxes = rects(root, index, both());
    expect(boxes).toContainEqual({ x: 100, y: 94, width: 50, height: 12 });
    expect(boxes.some((r) => r.x === 0 && r.y === 0 && r.width > 0)).toBe(false);
  });
  it('a linked cell (an <a> around the label) measures the HTML content too', () => {
    const cell = `<g data-cell-id="0" data-meta-label="" data-meta-pg-schema="1"/><g data-cell-id="pg-linkLabel~e1" data-meta-pg-kind="link-label" data-meta-pg-of="e1"><g><rect x="90" y="90" width="5" height="5"/><a href="#x">${fo}</a></g></g>`;
    const { root, index } = build(SVG(cell));
    stubContent(root, { x: 100, y: 94, width: 50, height: 12 });
    // the chip box (the group) holds the swatch and the content of the label inside the link
    expect(
      rects(root, index, both()).some((r) => r.x <= 90 && r.x + r.width >= 150 && r.y <= 90 && r.y + r.height >= 106)
    ).toBe(true);
  });
  it('a content box that cannot be read gives no obstacle, never the 100% box', () => {
    const cell = `<g data-cell-id="t1"><g>${fo}</g></g>`;
    const { root, index } = build(SVG(cell));
    const boxes = rects(root, index, both());
    expect(boxes.some((r) => r.width >= 100 && r.height >= 100)).toBe(false);
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
    expect(a.getAttribute('y')).toBe('0');
    const b = byHalf(root, 'b2a')!;
    expect(b.getAttribute('transform')).toBe('rotate(-90 200 96)');
    // a 3-unit stroke in the scaled group: a 6-unit stroke in root units, a 3-unit clearance
    const obstacles = stageObstacles(root, index, patches, 10);
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
      piece: { leg: 'e1:a2b', index: 0 },
    });
    expect(obstacles).toContainEqual({
      kind: 'segment',
      a: { x: 200, y: 200 },
      b: { x: 200, y: 0 },
      clearance: 10,
      owner: 'e1',
      piece: { leg: 'e1:b2a', index: 0 },
    });
  });
  it('a path with a 3° turn keeps that vertex in the root polyline', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
      <g data-cell-id="e1"><g><path d="M 0 50 L 100 50 L 200 55.2" fill="none" pointer-events="stroke"/></g></g></svg>`;
    const { root, index } = build(svg);
    renderLinkLabels(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), labelMode: 'percent' })]]), opts);
    const a = byHalf(root, 'a2b')!;
    // the anchor is on the first segment (y = 50), not on the chord (y = 52.6): the centre sits 16 above it
    expect(Number(a.getAttribute('y'))).toBeCloseTo(50, 0);
    expect(a.getAttribute('transform')).toMatch(/^rotate\(1\.49 /);
  });
});

describe('watchLinkLabelFonts', () => {
  const patches = (): PatchMap =>
    new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
  const cutWidth = (root: SVGSVGElement) => Number(blacks(maskOf(root)!)[0].getAttribute('width'));
  const glyphs = (root: SVGSVGElement, width: number) =>
    labels(root).forEach((t) => {
      (t as unknown as { getBBox: () => DOMRect }).getBBox = () =>
        ({ x: -width / 2, y: 0, width, height: 10 }) as DOMRect;
    });
  const setFonts = (value: unknown) => Object.defineProperty(document, 'fonts', { value, configurable: true });
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
  });
  it('cuts the stroke again when a web font loads and the glyphs grow; the cleanup stops it', () => {
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
    setFonts(fonts);
    const { root, index } = build();
    render(root, index, patches());
    glyphs(root, 20);
    const stop = watchLinkLabelFonts(root);
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(cutWidth(root)).toBe(23);
    glyphs(root, 40);
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(cutWidth(root)).toBe(43);
    stop();
    glyphs(root, 60);
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(cutWidth(root)).toBe(43);
  });
  it('cuts again when document.fonts.ready resolves', async () => {
    let done!: () => void;
    setFonts(Object.assign(new EventTarget(), { ready: new Promise<void>((r) => (done = r)) }));
    const { root, index } = build();
    render(root, index, patches());
    glyphs(root, 20);
    watchLinkLabelFonts(root);
    glyphs(root, 40);
    done();
    await Promise.resolve();
    expect(cutWidth(root)).toBe(43);
  });
  it('does nothing in a host without document.fonts', () => {
    setFonts(undefined);
    const { root } = build();
    expect(() => watchLinkLabelFonts(root)()).not.toThrow();
  });
});

describe('setLinkLabelScale', () => {
  it('a pan or a zoom with the same visibility does not rebuild the masks', () => {
    const { root, index } = build();
    sized(root, 1);
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    render(root, index, patches);
    const mask = maskOf(root)!;
    const children = Array.from(mask.children);
    const key = mask.getAttribute('data-dmap-key');
    sized(root, 1.5);
    setLinkLabelScale(root);
    sized(root, 2);
    setLinkLabelScale(root);
    expect(Array.from(mask.children)).toEqual(children);
    expect(mask.getAttribute('data-dmap-key')).toBe(key);
    // a data refresh with the same geometry keeps them too; a new width rebuilds
    render(root, index, patches);
    expect(Array.from(maskOf(root)!.children)).toEqual(children);
    const wider = new Map([
      ['e1', linkPatch('e1', { a2b: half({ width: 9 }), b2a: half({ width: 9 }), labelMode: 'percent' })],
    ]);
    render(root, index, wider);
    expect(maskOf(root)!.getAttribute('data-dmap-key')).not.toBe(key);
    expect(Array.from(maskOf(root)!.children)).not.toEqual(children);
    // a flip of the visibility does change them
    sized(root, 0.2);
    setLinkLabelScale(root);
    expect(maskOf(root)).toBeNull();
    sized(root, 1);
    setLinkLabelScale(root);
    expect(maskOf(root)).not.toBeNull();
  });
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
