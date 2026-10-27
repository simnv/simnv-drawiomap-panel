import { describe, expect, it } from 'vitest';
import { createTheme } from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import { ensureOverlay, linkSplit, renderOverlay } from './overlay';
import type { PlanCellPatch } from '../binding/engine';
import type { StatusView } from '../binding/status';
import { statusColor } from '../binding/color';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g><g data-cell-id="n1"><g><rect x="10" y="10" width="50" height="30"/></g></g>
  <g data-cell-id="e1"><g><path d="M 0 0 L 100 0 L 100 50" fill="none" stroke="#333" pointer-events="stroke"/><path id="e1-arrow" d="M 100 50 L 98 46 L 102 46 Z" pointer-events="all"/></g><g id="e1-value"><text>10G</text></g>
    <g data-cell-id="lbl1"><g><rect x="90" y="20" width="20" height="10"/><text>edge label</text></g></g></g>
  <g data-cell-id="n2"><g><rect x="150" y="10" width="40" height="30"/></g></g>
  <g data-cell-id="e2"><g><path d="M 0 80 L 200 80" fill="none" stroke="#333" pointer-events="stroke"/></g></g>
  <g data-cell-id="n3"><g><image x="10" y="60" width="20" height="20"/></g></g></g>
</svg>`;

function build(d?: string): { root: SVGSVGElement; index: CellIndex } {
  const host = document.createElement('div');
  host.innerHTML = d ? SVG.replace('M 0 0 L 100 0 L 100 50', d) : SVG;
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
  const e2 = root.querySelector('[data-cell-id="e2"]') as SVGGElement;
  index.set('e2', {
    meta: cellMetaFromAttrs('e2', {}, true),
    group: e2,
    line: e2.querySelector('path')!,
    arrows: [],
    original: {},
  });
  const n3 = root.querySelector('[data-cell-id="n3"]') as SVGGElement;
  index.set('n3', {
    meta: cellMetaFromAttrs('n3', {}, false, 'n3'),
    group: n3,
    shape: n3.querySelector('image')!,
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

const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('status paint of the halves', () => {
  const statusView: StatusView = {
    state: 'down',
    reason: 'Device down',
    conditionKey: 'health-zero',
    queryIds: ['up'],
    coverage: { available: 1, expected: 1 },
  };
  const round = (view: StatusView | undefined) =>
    new Map<string, PlanCellPatch>([
      ['n1', { ...patch('n1', {}), statusView: view }],
      [
        'e1',
        { ...patch('e1', { link: { a2b: half(), b2a: half({ status: 'nodata', stepIndex: -1 }) } }), statusView: view },
      ],
    ]);
  const strokes = (root: SVGSVGElement) =>
    Array.from(root.querySelectorAll('.dmap-half'), (el) => el.getAttribute('stroke'));
  const fills = (root: SVGSVGElement) =>
    Array.from(root.querySelectorAll('.dmap-arrow'), (el) => el.getAttribute('fill'));

  it('a status that is not normal paints both halves and arrow heads in the status colour; the data attributes stay', () => {
    const { root, index } = build();
    const red = statusColor({ state: 'down' }, opts.theme);
    renderOverlay(root, index, round(statusView), opts);
    expect(strokes(root)).toEqual([red, red]);
    expect(fills(root)).toEqual([red, red]);
    const [a2b, b2a] = Array.from(root.querySelectorAll('.dmap-half'));
    expect(a2b.getAttribute('data-dmap-status')).toBe('ok');
    expect(b2a.getAttribute('data-dmap-status')).toBe('nodata');
    expect(b2a.getAttribute('data-dmap-step')).toBe('-1');
    // nothing is drawn on the device and no marker anywhere: the applier paints the shape
    expect(root.querySelectorAll('.dmap-status-marker, .dmap-status-summary')).toHaveLength(0);
    expect(root.querySelectorAll('[data-dmap-cell="n1"]')).toHaveLength(0);
    // the summary lives in a band above the diagram, never on top of it
    expect(root.querySelector('.dmap-status-summary')).toBeNull();
  });
  it('a normal status and a missing status leave the binding colours; the same elements are updated in place', () => {
    const { root, index } = build();
    renderOverlay(root, index, round(statusView), opts);
    const before = Array.from(root.querySelectorAll('.dmap-half, .dmap-arrow'));
    renderOverlay(root, index, round({ ...statusView, state: 'normal', reason: 'Healthy' }), opts);
    expect(strokes(root)).toEqual(['#00ff00', '#00ff00']);
    expect(Array.from(root.querySelectorAll('.dmap-half, .dmap-arrow'))).toEqual(before);
    renderOverlay(root, index, round({ ...statusView, state: 'missing', reason: 'No data' }), opts);
    expect(strokes(root)).toEqual(['#00ff00', '#00ff00']);
    renderOverlay(root, index, round({ ...statusView, state: 'warning' }), opts);
    const orange = statusColor({ state: 'warning' }, opts.theme);
    expect(strokes(root)).toEqual([orange, orange]);
    expect(Array.from(root.querySelectorAll('.dmap-half, .dmap-arrow'))).toEqual(before);
    renderOverlay(root, index, round(undefined), opts);
    expect(strokes(root)).toEqual(['#00ff00', '#00ff00']);
  });
  it('an image device gets a border rect in the status colour after its image; a normal status removes it (R4)', () => {
    const { root, index } = build();
    const image = index.get('n3')!.shape!;
    const red = statusColor({ state: 'down' }, opts.theme);
    const withView = (view: StatusView | undefined) =>
      new Map<string, PlanCellPatch>([['n3', { ...patch('n3', {}), ...(view ? { statusView: view } : {}) }]]);
    renderOverlay(root, index, withView(statusView), opts);
    const border = root.querySelector('rect.dmap-status-border')!;
    expect(border).not.toBeNull();
    expect(border.previousElementSibling).toBe(image);
    expect(['x', 'y', 'width', 'height'].map((a) => border.getAttribute(a))).toEqual(['10', '60', '20', '20']);
    expect(border.getAttribute('stroke')).toBe(red);
    expect(border.getAttribute('stroke-width')).toBe('2');
    expect(border.getAttribute('fill')).toBe('none');
    expect(border.getAttribute('pointer-events')).toBe('none');
    expect(border.getAttribute('data-dmap-cell')).toBe('n3');
    // the same status: the same element; another colour: updated in place
    renderOverlay(root, index, withView({ ...statusView, reason: 'Power lost' }), opts);
    expect(root.querySelector('rect.dmap-status-border')!.isSameNode(border)).toBe(true);
    renderOverlay(root, index, withView({ ...statusView, state: 'warning' }), opts);
    expect(root.querySelector('rect.dmap-status-border')!.isSameNode(border)).toBe(true);
    expect(border.getAttribute('stroke')).toBe(statusColor({ state: 'warning' }, opts.theme));
    renderOverlay(root, index, withView({ ...statusView, state: 'normal', reason: 'Healthy' }), opts);
    expect(root.querySelectorAll('.dmap-status-border')).toHaveLength(0);
    renderOverlay(root, index, withView(statusView), opts);
    expect(root.querySelectorAll('.dmap-status-border')).toHaveLength(1);
    renderOverlay(root, index, withView(undefined), opts);
    expect(root.querySelectorAll('.dmap-status-border')).toHaveLength(0);
    // a rect device gets no border element: the applier paints its shape
    renderOverlay(root, index, new Map([['n1', { ...patch('n1', {}), statusView }]]), opts);
    expect(root.querySelectorAll('.dmap-status-border')).toHaveLength(0);
    // a new index removes the border of the old render
    renderOverlay(root, index, withView(statusView), opts);
    renderOverlay(root, new Map(index), new Map(), opts);
    expect(root.querySelectorAll('.dmap-status-border')).toHaveLength(0);
  });
  it('a new theme paints the same elements in its own status colour', () => {
    const { root, index } = build();
    const light = createTheme({ colors: { mode: 'light' } });
    const dark = createTheme({ colors: { mode: 'dark' } });
    renderOverlay(root, index, round(statusView), { theme: light });
    const before = Array.from(root.querySelectorAll('.dmap-half'));
    expect(strokes(root)).toEqual([statusColor(statusView, light), statusColor(statusView, light)]);
    renderOverlay(root, index, round(statusView), { theme: dark });
    expect(strokes(root)).toEqual([statusColor(statusView, dark), statusColor(statusView, dark)]);
    expect(statusColor(statusView, dark)).not.toBe(statusColor(statusView, light));
    expect(Array.from(root.querySelectorAll('.dmap-half'))).toEqual(before);
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
  it('draws an ok half and an unbound half as two halves, the unbound one in its grey', () => {
    const { root, index } = build();
    const unbound: HalfState = { status: 'unbound', color: '#808080', width: 2, label: 'unavailable', stepIndex: -1 };
    renderOverlay(root, index, new Map([['e1', patch('e1', { link: { a2b: half(), b2a: unbound } })]]), opts);
    expect(root.querySelectorAll('polyline.dmap-half')).toHaveLength(2);
    const a2b = root.querySelector('polyline.dmap-half[data-dmap-half="a2b"]')!;
    expect(a2b.getAttribute('points')).toBe('0,0 75,0');
    expect(a2b.getAttribute('stroke')).toBe('#00ff00');
    const b2a = root.querySelector('polyline.dmap-half[data-dmap-half="b2a"]')!;
    expect(b2a.getAttribute('points')).toBe('75,0 100,0 100,50');
    expect(b2a.getAttribute('stroke')).toBe('#808080');
    expect(b2a.getAttribute('data-dmap-status')).toBe('unbound');
  });
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
      new Map([['n1', patch('n1', { shape: { status: 'ok', color: '#0f0', target: 'icon', stepIndex: 0 } })]]),
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

describe('renderOverlay keeps its elements across refreshes', () => {
  const statusView: StatusView = {
    state: 'down',
    reason: 'Device down',
    conditionKey: 'k',
    queryIds: ['q'],
    coverage: { available: 1, expected: 1 },
  };
  /** Two links and a status cell; new objects on every call. */
  const round = (a2b: Partial<HalfState> = {}, view: StatusView | null = statusView) =>
    new Map<string, PlanCellPatch>([
      ['e1', patch('e1', { link: { a2b: half(a2b), b2a: half({ color: '#ff0000', stepIndex: 2 }) } })],
      ['e2', patch('e2', { link: { a2b: half() } })],
      ['n1', { ...patch('n1', {}), ...(view ? { statusView: view } : {}) }],
    ]);
  const observe = (root: SVGSVGElement) => {
    const observer = new MutationObserver(() => {});
    observer.observe(root, { attributes: true, childList: true, subtree: true, characterData: true });
    return observer;
  };
  const strokes = (root: SVGSVGElement, cell: string) =>
    Array.from(root.querySelectorAll(`.dmap-half[data-dmap-cell="${cell}"], .dmap-arrow[data-dmap-cell="${cell}"]`));
  const same = (a: Element[], b: Element[]) => a.length === b.length && a.every((el, i) => el.isSameNode(b[i]));

  it('a second render with equal halves keeps the same elements and writes nothing', () => {
    const { root, index } = build();
    renderOverlay(root, index, round(), opts);
    const before = strokes(root, 'e1');
    const observer = observe(root);
    renderOverlay(root, index, round(), opts);
    expect(observer.takeRecords()).toHaveLength(0);
    expect(same(before, strokes(root, 'e1'))).toBe(true);
    expect(root.querySelectorAll('polyline.dmap-half')).toHaveLength(3);
  });
  it('a colour and width change updates the same elements in place and keeps the points and the mask', () => {
    const { root, index } = build();
    renderOverlay(root, index, round(), opts);
    const [line, arrow] = strokes(root, 'e1');
    const points = line.getAttribute('points');
    line.setAttribute('mask', 'url(#dmap-lm-1-0)');
    arrow.setAttribute('mask', 'url(#dmap-lm-1-0)');
    const observer = observe(root);
    renderOverlay(root, index, round({ color: '#0000ff', width: 7, stepIndex: 3, status: 'ok' }), opts);
    const records = observer.takeRecords();
    expect(records.length).toBeGreaterThan(0);
    records.forEach((r) => expect(r.type).toBe('attributes'));
    records.forEach((r) => expect([line, arrow]).toContain(r.target));
    expect(line.getAttribute('stroke')).toBe('#0000ff');
    expect(line.getAttribute('stroke-width')).toBe('7');
    expect(line.getAttribute('data-dmap-step')).toBe('3');
    expect(line.getAttribute('points')).toBe(points);
    expect(line.getAttribute('mask')).toBe('url(#dmap-lm-1-0)');
    expect(arrow.getAttribute('fill')).toBe('#0000ff');
    expect(arrow.getAttribute('mask')).toBe('url(#dmap-lm-1-0)');
    // the other link is not touched
    expect(same(strokes(root, 'e2'), strokes(root, 'e2'))).toBe(true);
  });
  it('a half that goes rebuilds the layer of that link only', () => {
    const { root, index } = build();
    renderOverlay(root, index, round(), opts);
    const e1 = strokes(root, 'e1');
    const e2 = strokes(root, 'e2');
    const next = round();
    next.get('e1')!.link = { a2b: half() };
    renderOverlay(root, index, next, opts);
    const after = strokes(root, 'e1');
    expect(after).toHaveLength(2);
    expect(after.some((el) => e1.includes(el))).toBe(false);
    expect(after[0].getAttribute('points')).toBe('0,0 100,0 100,50');
    expect(same(e2, strokes(root, 'e2'))).toBe(true);
    expect(root.querySelectorAll('g.dmap-overlay')).toHaveLength(2);
  });
  it('a status cell draws nothing of its own; a status on a link changes no element count', () => {
    const { root, index } = build();
    renderOverlay(root, index, round(), opts);
    expect(root.querySelectorAll('[data-dmap-cell="n1"]')).toHaveLength(0);
    const count = root.querySelectorAll('*').length;
    renderOverlay(root, index, round({}, { ...statusView, state: 'normal', reason: 'Healthy' }), opts);
    renderOverlay(root, index, round({}, null), opts);
    expect(root.querySelectorAll('*')).toHaveLength(count);
  });
  it('the child order on an edge is path, overlay without arrow heads and path, arrow, overlay with them, also after a rebuild', () => {
    const { root, index } = build();
    const order = () =>
      Array.from(index.get('e2')!.line!.parentElement!.children).map((c) =>
        c.localName === 'path' ? 'path' : c.getAttribute('class')
      );
    const withStatus = (b2a: boolean) =>
      new Map<string, PlanCellPatch>([
        ['e2', { ...patch('e2', { link: { a2b: half(), ...(b2a ? { b2a: half() } : {}) } }), statusView }],
      ]);
    renderOverlay(root, index, withStatus(true), opts);
    expect(order()).toEqual(['path', 'dmap-overlay']);
    // a half goes: the layer is built again in the same place
    renderOverlay(root, index, withStatus(false), opts);
    expect(order()).toEqual(['path', 'dmap-overlay']);
    renderOverlay(root, index, new Map([['e1', { ...patch('e1', { link: { a2b: half() } }), statusView }]]), opts);
    const e1 = Array.from(index.get('e1')!.line!.parentElement!.children).map((c) => c.getAttribute('class') ?? c.id);
    expect(e1).toEqual([null, 'e1-arrow', 'dmap-overlay'].map((v) => v ?? expect.anything()));
  });
  it('a link patch that goes removes its overlay; a new index removes every element of the old render', () => {
    const { root, index } = build();
    renderOverlay(root, index, round(), opts);
    const next = round();
    next.delete('e2');
    renderOverlay(root, index, next, opts);
    expect(strokes(root, 'e2')).toHaveLength(0);
    expect(root.querySelectorAll('g.dmap-overlay')).toHaveLength(1);
    const e1 = strokes(root, 'e1');
    // the same elements under a new index: the state of the old index does not apply
    renderOverlay(root, new Map(index), next, opts);
    expect(root.querySelectorAll('g.dmap-overlay')).toHaveLength(1);
    expect(strokes(root, 'e1').some((el) => e1.includes(el))).toBe(false);
  });
});

describe('arrow tip position', () => {
  const ARROW = 8;
  const tipOf = (root: SVGSVGElement, which: 'a2b' | 'b2a') => {
    const [x, y] = root
      .querySelector(`.dmap-arrow[data-dmap-half="${which}"]`)!
      .getAttribute('points')!
      .split(' ')[0]
      .split(',')
      .map(Number);
    return { x, y };
  };
  const draw = (d: string, link: CellPatch['link']) => {
    const { root, index } = build(d);
    renderOverlay(root, index, new Map([['e1', patch('e1', { link })]]), opts);
    return root;
  };
  const both = { a2b: half(), b2a: half() };
  // distance from the tip to the nearest vertex of the polyline
  const toBend = (tip: { x: number; y: number }, vertices: Array<[number, number]>) =>
    Math.min(...vertices.map(([x, y]) => Math.hypot(x - tip.x, y - tip.y)));

  it('moves both tips off the corner of an L-shaped path and keeps them together', () => {
    // L = 200: the middle is the corner at (100, 0)
    const root = draw('M 0 0 L 100 0 L 100 100', both);
    const tip = tipOf(root, 'a2b');
    expect(tipOf(root, 'b2a')).toEqual(tip);
    expect(toBend(tip, [[100, 0]])).toBeGreaterThanOrEqual(2 * ARROW);
    const a2b = root.querySelector('.dmap-half[data-dmap-half="a2b"]')!.getAttribute('points')!.split(' ');
    const b2a = root.querySelector('.dmap-half[data-dmap-half="b2a"]')!.getAttribute('points')!.split(' ');
    expect(a2b[a2b.length - 1]).toBe(b2a[0]);
    expect(a2b[0]).toBe('0,0');
    expect(b2a[b2a.length - 1]).toBe('100,100');
  });
  it('moves both tips out of the jog of a Z-shaped path', () => {
    // L = 230: the middle (115) lies inside the 30 px jog between 100 and 130
    const root = draw('M 0 0 L 100 0 L 100 30 L 200 30', both);
    const tip = tipOf(root, 'a2b');
    expect(tipOf(root, 'b2a')).toEqual(tip);
    expect(
      toBend(tip, [
        [100, 0],
        [100, 30],
      ])
    ).toBeGreaterThanOrEqual(2 * ARROW);
  });
  it('keeps the middle of a straight path', () => {
    const root = draw('M 0 0 L 120 0 L 200 0', both);
    expect(tipOf(root, 'a2b')).toEqual({ x: 100, y: 0 });
  });
  it('keeps the middle when it has the clearance although the path bends elsewhere', () => {
    const root = draw('M 0 0 L 200 0 L 200 20', both);
    expect(tipOf(root, 'a2b')).toEqual({ x: 110, y: 0 });
  });
  it('uses the middle of the longest straight run when no run is long enough', () => {
    // runs of 20, 25 and 15 px: none has 2 * 16 px
    const root = draw('M 0 0 L 20 0 L 20 25 L 35 25', both);
    expect(tipOf(root, 'a2b')).toEqual({ x: 20, y: 12.5 });
  });
  it('keeps the tip of a single direction at the port', () => {
    expect(tipOf(draw('M 0 0 L 100 0 L 100 50', { a2b: half() }), 'a2b')).toEqual({ x: 100, y: 50 });
    expect(tipOf(draw('M 0 0 L 100 0 L 100 50', { b2a: half() }), 'b2a')).toEqual({ x: 0, y: 0 });
  });
  it('pulls the tip of a single direction back from a bend near the port', () => {
    // the last bend is 6 px before the port at (100, 56)
    const a2b = tipOf(draw('M 0 0 L 100 0 L 100 50 L 106 50', { a2b: half() }), 'a2b');
    expect(
      toBend(a2b, [
        [100, 50],
        [100, 0],
      ])
    ).toBeGreaterThanOrEqual(2 * ARROW);
    const b2a = tipOf(draw('M 0 0 L 6 0 L 6 50 L 106 50', { b2a: half() }), 'b2a');
    expect(
      toBend(b2a, [
        [6, 0],
        [6, 50],
      ])
    ).toBeGreaterThanOrEqual(2 * ARROW);
  });
  it('measures the clearance in the units of the overlay when the path is scaled', () => {
    const { root, index } = build('M 0 0 L 400 0 L 400 400');
    const line = index.get('e1')!.line!;
    const along = (d: number) => (d <= 400 ? { x: d, y: 0 } : { x: 400, y: d - 400 });
    Object.assign(line, {
      getTotalLength: () => 800,
      getPointAtLength: along,
      getCTM: () => ({ a: 0.25, b: 0, c: 0, d: 0.25, e: 0, f: 0 }),
    });
    // an engine with getTotalLength has getCTM on every element: the overlay group draws in root units
    const proto = SVGElement.prototype as unknown as { getCTM?: () => unknown };
    proto.getCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    try {
      renderOverlay(root, index, new Map([['e1', patch('e1', { link: both })]]), opts);
    } finally {
      delete proto.getCTM;
    }
    // the corner is at (100, 0) in the overlay
    expect(toBend(tipOf(root, 'a2b'), [[100, 0]])).toBeGreaterThanOrEqual(2 * ARROW - 0.01);
  });
});

describe('linkSplit', () => {
  it('the split is the middle of a straight path, and moves off a corner onto one run by two arrow lengths', () => {
    const geo = { length: 200, bends: [], unit: 1, matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    expect(linkSplit({ ...geo, pointAt: () => ({ x: 0, y: 0, angle: 0 }), polyline: () => [] })).toBe(100);
    const bent = { ...geo, bends: [100], pointAt: () => ({ x: 0, y: 0, angle: 0 }), polyline: () => [] };
    expect(linkSplit(bent)).toBe(84);
    // the clearance is in the units of the path: a path drawn at half size keeps 32 of its own units
    expect(linkSplit({ ...bent, unit: 0.5 })).toBe(68);
  });
});
