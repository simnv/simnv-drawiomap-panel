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
 * 24 (0.6 × 8 × 5 glyphs in jsdom), the box 26 × 12. A label stands on its stroke (centre on the line); beside it with `linkWidth.max` 10 the centre stands 13 off the line.
 */
const SVG = (extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
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
    expect(a2b.getAttribute('y')).toBe('100');
    expect(a2b.getAttribute('transform')).toBe('rotate(0 120 100)');
    expect(a2b.getAttribute('data-dmap-side')).toBe('line');
    // the room of the status marker (the midpoint, 4 to the right, "? missing" wide) is reserved: the b2a label,
    // whose anchor is 280, slides past it towards the end of the link
    expect(b2a.getAttribute('x')).toBe('284');
    expect(b2a.getAttribute('y')).toBe('100');
    expect(a2b.getAttribute('fill')).toBe(theme.colors.text.primary);
    // no halo: the text has no stroke
    expect(a2b.hasAttribute('stroke')).toBe(false);
    expect(a2b.hasAttribute('paint-order')).toBe(false);
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
    expect(Number(k.getAttribute('width'))).toBe(24);
    expect(Number(k.getAttribute('height'))).toBe(10);
    expect(k.getAttribute('x')).toBe('108');
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
  it('a light theme with a dark diagram draws no rect and no theme colour behind the text', () => {
    const light = createTheme({ colors: { mode: 'light' } });
    const { root, index } = build();
    render(root, index, both(), { ...opts, theme: light });
    expect(byHalf(root, 'a2b')!.getAttribute('data-dmap-side')).toBe('line');
    expect(layerOf(root)!.querySelectorAll('rect')).toHaveLength(0);
    expect(byHalf(root, 'a2b')!.hasAttribute('stroke')).toBe(false);
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
    // the overlay is drawn again on each frame: the new strokes wear the mask too
    strokesOf(root).forEach((el) => expect(el.getAttribute('mask')).toBe(`url(#${maskOf(root)!.id})`));
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
    expect(Number(k.getAttribute('width'))).toBe(24);
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
    const patches = () =>
      new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    render(one.root, one.index, patches());
    render(two.root, two.index, patches());
    const ids = [maskOf(one.root)!.id, maskOf(two.root)!.id];
    expect(ids[0]).not.toBe(ids[1]);
    expect(document.querySelectorAll(`[id="${ids[0]}"]`)).toHaveLength(1);
  });
});

describe('renderLinkLabels: obstacles', () => {
  it('a plain draw.io node is an obstacle: the label slides towards the end of the link', () => {
    const node = `<g data-cell-id="n3"><g><rect x="100" y="60" width="40" height="50"/></g></g>`;
    const { root, index } = build(SVG(node));
    render(root, index, new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]));
    const a = byHalf(root, 'a2b')!;
    expect(Number(a.getAttribute('x'))).toBeLessThan(100 - 13);
    expect(a.getAttribute('y')).toBe('100');
    expect(byHalf(root, 'b2a')!.getAttribute('x')).toBe('284');
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
      piece: { leg: 'e1:a2b', index: 0 },
    });
    const two = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    const both = stageObstacles(root, index, two, 10, () => 60);
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
    // the vertical WAN link: the labels read bottom to top, on the stroke
    expect(byHalf(root, 'a2b', ISP_A)!.getAttribute('transform')).toMatch(/^rotate\(-90 /);
    expect(Number(byHalf(root, 'a2b', ISP_A)!.getAttribute('x'))).toBeCloseTo(188.37, 0);
  });
  it('a group frame is no obstacle; its title bar is, because a label must not cover the caption', () => {
    const frame = `<g data-cell-id="pg-group~wan"><g><rect x="60" y="40" width="280" height="120"/></g></g>`;
    const title = `<g data-cell-id="pg-groupTitle~wan"><g><rect x="100" y="60" width="40" height="50"/><text x="104" y="74">wan</text></g></g>`;
    const { root, index } = build(SVG(frame + title));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(100 - 13);
    const rects = stageObstacles(root, index, patches, 10, () => 60).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
    expect(rects).not.toContainEqual({ x: 60, y: 40, width: 280, height: 120 });
    expect(rects).toContainEqual({ x: 100, y: 60, width: 40, height: 50 });
  });
  it('a plain draw.io container that holds other vertices is a background; the vertices inside stay obstacles', () => {
    const container = `<g data-cell-id="box"><g><rect x="60" y="40" width="280" height="120"/></g></g>`;
    const inner = `<g data-cell-id="n3"><g><rect x="100" y="60" width="40" height="50"/></g></g>`;
    const inner2 = `<g data-cell-id="n4"><g><rect x="260" y="130" width="40" height="20"/></g></g>`;
    const { root, index } = build(SVG(container + inner + inner2));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(render(root, index, patches)).toEqual({ placed: 2, dropped: 0, moved: 0 });
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).toBeLessThan(100 - 13);
    const rects = stageObstacles(root, index, patches, 10, () => 60).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
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
    const rects = stageObstacles(root, index, patches, 10, () => 60).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
    expect(rects).toContainEqual({ x: 90, y: 56, width: 60, height: 50 });
    const second = `<g data-cell-id="badge2"><g><rect x="130" y="60" width="10" height="10"/></g></g>`;
    const container = build(SVG(device + badge + second));
    const more = stageObstacles(container.root, container.index, patches, 10, () => 60).flatMap((o) =>
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
  it('a plain text cell is an obstacle', () => {
    const text = `<g data-cell-id="t1"><g><text x="100" y="102" font-size="10">a caption</text></g></g>`;
    const { root, index } = build(SVG(text));
    const patches: PatchMap = new Map([['e1', linkPatch('e1', { a2b: half(), b2a: half(), labelMode: 'percent' })]]);
    expect(index.get('t1')?.label).toBeTruthy();
    render(root, index, patches);
    expect(Number(byHalf(root, 'a2b')!.getAttribute('x'))).not.toBe(120);
    const rects = stageObstacles(root, index, patches, 10, () => 60).flatMap((o) =>
      o.kind === 'rect' ? [o.rect] : []
    );
    expect(rects.some((r) => r.x === 100 && r.y < 102 && r.width > 40)).toBe(true);
  });
  describe('edge text', () => {
    // the label spot of the a2b half is x 120 (anchor), y 100: a text box of "tunnel link" stands on it
    const rectsOf = (root: SVGSVGElement, index: CellIndex, patches: PatchMap) =>
      stageObstacles(root, index, patches, 10, () => 60).flatMap((o) => (o.kind === 'rect' ? [o.rect] : []));
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
      const chip = `<g data-cell-id="pg-linkLabel~e1" data-pg-kind="link-label"><g><rect x="100" y="94" width="50" height="12"/><text x="102" y="102" font-size="8">metric 10</text></g></g>`;
      const { root, index } = build(SVG(chip));
      render(root, index, both());
      expect(clear(root, { x: 100, w: 50 })).toBe(true);
    });
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
