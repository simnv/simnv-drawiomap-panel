import { formattedValueToString, type GrafanaTheme2 } from '@grafana/data';
import type { LinkLabelMode } from '../model/config';
import type { CellEntry, CellIndex, HalfState, PatchMap } from '../types';
import {
  applyMatrix,
  bendLengths,
  invert,
  localMatrix,
  multiply,
  parsePathPoints,
  pathGeometry,
  polylineLength,
  usable,
  type Matrix,
  type Point,
} from './geometry';
import {
  boundsOf,
  labelsVisible,
  LINK_LABEL_GEOMETRY,
  obstacleIndex,
  placeHalfLabel,
  type LegInput,
  type Obstacle,
  type ObstacleIndex,
  type Placed,
  type Placement,
  type Rect,
} from './labelPlacement';
import { linkSplit, OVERLAY_CLASS, statusMarkerBox, type TextProbe } from './overlay';
import { viewScaleOf } from './zoom';

/*
 * The value labels of the link halves: the only module that touches the DOM for them. One layer, the last child of
 * the root svg; one <text> per labelled half; the placement runs once per stage (docs/superpowers/specs/
 * 2026-10-25-link-value-labels-design.md, sections 6 and 7) and a data refresh changes the texts.
 */

export const LINK_LABEL_CLASS = 'dmap-link-label';
export const LINK_LABEL_LAYER_CLASS = 'dmap-link-labels';
const NS = 'http://www.w3.org/2000/svg';
/** a slot width rounds up to a multiple of this, so that a small change of a value keeps its slot */
const SLOT_GRAIN = 4;
/** the widest text `percentText` produces: every percent label has this one slot */
const WIDEST_PERCENT = '>999%';
/** the font of the status markers: the fallback when the stage has no portograph link label */
const FALLBACK_FONT = 'sans-serif';
/** a direction change of at most this angle (radians) is no bend: the overlay's rule */
const BEND_ANGLE = (5 * Math.PI) / 180;

export interface LinkLabelOptions {
  theme: GrafanaTheme2;
  linkWidth: { min: number; max: number };
}
export interface LinkLabelCounts {
  placed: number;
  dropped: number;
  moved: number;
}

type Half = 'a2b' | 'b2a';
type LabelMode = Exclude<LinkLabelMode, 'none'>;
interface Slot {
  cellId: string;
  which: Half;
  mode: LabelMode;
  state: HalfState;
}
interface LabelRecord {
  cellId: string;
  which: Half;
  mode: LabelMode;
  /** the leg without its size; undefined when the edge has no usable geometry */
  leg?: Omit<LegInput, 'size'>;
  /** the slot width without the halo; undefined until the half has shown a text */
  slot?: number;
  text?: string;
  el?: SVGTextElement;
  placement?: Placement;
  /** the box the label holds in the grid */
  obstacle?: Obstacle;
  /** an isolated re-placement found no spot: the label is hidden and tries again on the next call */
  retry: boolean;
}
interface LabelLayout {
  key: string;
  index: CellIndex;
  layer: SVGGElement;
  probe: SVGTextElement;
  fontFamily: string;
  theme: GrafanaTheme2;
  grid: ObstacleIndex;
  widths: Map<string, number>;
  records: Map<string, LabelRecord>;
}

const layouts = new WeakMap<SVGSVGElement, LabelLayout>();
let stamp = 0;

/** The text of a half label (spec section 3): nothing for no data, an unbound half or an empty display. */
export function linkLabelText(state: HalfState, mode: LinkLabelMode): string | undefined {
  if (mode === 'none' || state.status !== 'ok') {
    return undefined;
  }
  if (mode === 'percent' && state.percentDisplay !== undefined) {
    return state.percentDisplay;
  }
  const text = state.display ? formattedValueToString(state.display) : '';
  return text === '' ? undefined : text;
}

/**
 * Builds or updates the label layer. A call with a new stage, a new set of labelled halves, a new `linkWidth.max`
 * or a new font places everything; any other call changes the texts and the hidden state, and places again only a
 * label whose slot changed. Returns the counts for the tests and the debug log.
 */
export function renderLinkLabels(
  root: SVGSVGElement,
  index: CellIndex,
  patches: PatchMap,
  opts: LinkLabelOptions
): LinkLabelCounts {
  const slots = collectSlots(index, patches);
  let layout = layouts.get(root);
  if (!slots.length) {
    if (layout) {
      layout.layer.remove();
      layouts.delete(root);
    }
    return { placed: 0, dropped: 0, moved: 0 };
  }
  const fontFamily = stageFont(root);
  const key = [slots.map((s) => `${s.cellId}:${s.which}:${s.mode}`).join('\n'), opts.linkWidth.max, fontFamily].join(
    '|'
  );
  const started = typeof performance === 'undefined' ? 0 : performance.now();
  let moved = 0;
  if (!layout || layout.key !== key || layout.index !== index || layout.layer.parentNode !== root) {
    layout = fullPlacement(root, index, patches, slots, opts, key, fontFamily, layout);
    layouts.set(root, layout);
    setLinkLabelScale(root);
  } else {
    moved = refresh(layout, slots, opts.theme);
  }
  if (root.lastElementChild !== layout.layer) {
    root.appendChild(layout.layer);
  }
  let placed = 0;
  let dropped = 0;
  for (const rec of layout.records.values()) {
    if (rec.placement && 'centre' in rec.placement) {
      placed++;
    } else if (rec.placement) {
      dropped++;
    }
  }
  layout.layer.setAttribute('data-dmap-labels-placed', String(placed));
  layout.layer.setAttribute('data-dmap-labels-dropped', String(dropped));
  if (debugEnabled()) {
    const ms = (typeof performance === 'undefined' ? 0 : performance.now()) - started;
    console.info(`dmap link labels: ${placed} placed, ${dropped} dropped, ${moved} moved, ${ms.toFixed(1)} ms`);
  }
  return { placed, dropped, moved };
}

/**
 * Hides the layer when a glyph would be smaller than the minimum on-screen size, shows it otherwise (spec section
 * 6). O(1): one rect, one attribute. The zoom effects call it after `applyLayout`.
 */
export function setLinkLabelScale(root: SVGSVGElement): void {
  const layer = Array.from(root.children).find((c) => c.classList.contains(LINK_LABEL_LAYER_CLASS));
  if (!layer) {
    return;
  }
  if (labelsVisible(viewScaleOf(root))) {
    layer.removeAttribute('visibility');
  } else {
    layer.setAttribute('visibility', 'hidden');
  }
}

/* ---------- the slots ---------- */

/** The labelled halves in placement order: cell id ascending, a2b before b2a. */
function collectSlots(index: CellIndex, patches: PatchMap): Slot[] {
  const out: Slot[] = [];
  for (const [cellId, patch] of patches) {
    const link = patch.link;
    const mode = link?.labelMode;
    if (!link || !mode || mode === 'none' || !index.get(cellId)?.line) {
      continue;
    }
    for (const which of ['a2b', 'b2a'] as const) {
      const state = link[which];
      if (state) {
        out.push({ cellId, which, mode, state });
      }
    }
  }
  return out.sort((a, b) => (a.cellId < b.cellId ? -1 : a.cellId > b.cellId ? 1 : a.which < b.which ? -1 : 1));
}

/** The slot of a text: one fixed slot for every percent, the text's own width on the grain for a reading. */
function slotOf(layout: LabelLayout, slot: Slot, text: string | undefined): number | undefined {
  if (slot.mode === 'percent' && (text === undefined || slot.state.percentDisplay !== undefined)) {
    return grain(measure(layout, WIDEST_PERCENT));
  }
  return text === undefined ? undefined : grain(measure(layout, text));
}

const grain = (width: number) => Math.ceil(width / SLOT_GRAIN - 1e-9) * SLOT_GRAIN;

/** The width of `text` by the hidden probe, memoised per string and font; jsdom gets 0.6 em per glyph. */
function measure(
  layout: LabelLayout,
  text: string,
  font: { family: string; size: number; weight?: string } = {
    family: layout.fontFamily,
    size: LINK_LABEL_GEOMETRY.fontSize,
  }
): number {
  const key = `${font.family}|${font.size}|${font.weight ?? ''}|${text}`;
  const known = layout.widths.get(key);
  if (known !== undefined) {
    return known;
  }
  const probe = layout.probe;
  probe.setAttribute('font-family', font.family);
  probe.setAttribute('font-size', String(font.size));
  if (font.weight) {
    probe.setAttribute('font-weight', font.weight);
  } else {
    probe.removeAttribute('font-weight');
  }
  probe.textContent = text;
  const measured = typeof probe.getComputedTextLength === 'function' ? probe.getComputedTextLength() : 0;
  const width = measured > 0 ? measured : 0.6 * font.size * text.length;
  layout.widths.set(key, width);
  return width;
}

/** The font of the first portograph link label in the stage, else the status markers' font. */
function stageFont(root: SVGSVGElement): string {
  const text = root.querySelector('g[data-cell-id^="pg-linkLabel"] text');
  const family =
    text?.closest('[font-family]')?.getAttribute('font-family') ?? (text as SVGElement | null)?.style.fontFamily;
  return family || FALLBACK_FONT;
}

/* ---------- coordinates ---------- */

const toM = (m: DOMMatrix | Matrix | null | undefined): Matrix | undefined =>
  m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : undefined;

/** The matrix from the user space of `el` into root user units; undefined when it cannot be read. */
function toRoot(el: Element, root: SVGSVGElement): Matrix | undefined {
  const g = el as SVGGraphicsElement;
  if (typeof g.getCTM === 'function' && typeof root.getCTM === 'function') {
    const own = toM(g.getCTM());
    const base = toM(root.getCTM());
    return own && base && usable(own) && usable(base) ? multiply(invert(base), own) : undefined;
  }
  return localMatrix(el, root);
}

const unitOf = (m: Matrix) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

/** The axis-aligned box of `rect` mapped through `m`. */
function mapRect(rect: Rect, m: Matrix): Rect {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((p) => applyMatrix(m, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const num = (el: Element, name: string) => parseFloat(el.getAttribute(name) ?? '') || 0;

/** The box of an element from its attributes, in its own user space: the jsdom road, where `getBBox` is missing. */
function attributeBox(el: Element): Rect | undefined {
  switch (el.localName) {
    case 'rect':
    case 'image':
    case 'foreignObject':
      return { x: num(el, 'x'), y: num(el, 'y'), width: num(el, 'width'), height: num(el, 'height') };
    case 'circle': {
      const r = num(el, 'r');
      return { x: num(el, 'cx') - r, y: num(el, 'cy') - r, width: 2 * r, height: 2 * r };
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      return { x: num(el, 'cx') - rx, y: num(el, 'cy') - ry, width: 2 * rx, height: 2 * ry };
    }
    case 'polygon':
    case 'polyline':
    case 'path': {
      const pts =
        el.localName === 'path'
          ? parsePathPoints(el.getAttribute('d') ?? '')
          : (el.getAttribute('points') ?? '')
              .trim()
              .split(/[\s,]+/)
              .map(Number)
              .reduce<Point[]>((acc, v, i, all) => (i % 2 ? [...acc, { x: all[i - 1], y: v }] : acc), []);
      if (!pts.length) {
        return undefined;
      }
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    default:
      return undefined;
  }
}

const union = (a: Rect | undefined, b: Rect): Rect => {
  if (!a) {
    return b;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/** The painted box of an element in root user units, or undefined when it cannot be read. */
function rootBox(el: Element, root: SVGSVGElement): Rect | undefined {
  const g = el as SVGGraphicsElement;
  if (typeof g.getBBox === 'function') {
    try {
      const m = toRoot(el, root);
      const b = g.getBBox();
      if (!m || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) {
        return undefined;
      }
      return mapRect({ x: b.x, y: b.y, width: b.width, height: b.height }, m);
    } catch {
      return undefined;
    }
  }
  if (el.localName === 'g' || el.localName === 'switch') {
    let box: Rect | undefined;
    for (const child of Array.from(el.children)) {
      const b = rootBox(child, root);
      if (b) {
        box = union(box, b);
      }
    }
    return box;
  }
  const local = attributeBox(el);
  const m = local && toRoot(el, root);
  return local && m ? mapRect(local, m) : undefined;
}

/** The inline stroke width of a primitive, 1 (the SVG default) when it has none. */
function strokeWidthOf(el: SVGElement, original?: string): number {
  const raw = el.getAttribute('stroke-width') ?? el.style.strokeWidth ?? original ?? '';
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 1;
}

/** The straight runs of a polyline: a vertex is a corner when the direction turns by more than 5°. */
function runsOf(pts: Point[]): Array<{ a: Point; b: Point }> {
  const runs: Array<{ a: Point; b: Point }> = [];
  let start: Point | undefined;
  let prev: Point | undefined;
  let heading: number | undefined;
  for (const p of pts) {
    if (!prev) {
      start = prev = p;
      continue;
    }
    if (p.x === prev.x && p.y === prev.y) {
      continue;
    }
    const next = Math.atan2(p.y - prev.y, p.x - prev.x);
    if (
      heading !== undefined &&
      Math.abs(Math.atan2(Math.sin(next - heading), Math.cos(next - heading))) > BEND_ANGLE
    ) {
      runs.push({ a: start!, b: prev });
      start = prev;
    }
    heading = next;
    prev = p;
  }
  if (start && prev && start !== prev) {
    runs.push({ a: start, b: prev });
  }
  return runs;
}

/* ---------- obstacles ---------- */

const hasHalves = (patches: PatchMap, cellId: string) => {
  const link = patches.get(cellId)?.link;
  return !!link && !!(link.a2b || link.b2a);
};

/** Every obstacle of the stage in root units (spec section 5), built once per full placement. */
export function stageObstacles(
  root: SVGSVGElement,
  index: CellIndex,
  patches: PatchMap,
  max: number,
  probe: TextProbe
): Obstacle[] {
  const out: Obstacle[] = [];
  const rect = (el: Element | undefined, clearance = 0) => {
    const box = el && rootBox(el, root);
    if (box) {
      out.push({ kind: 'rect', rect: box, clearance });
    }
  };
  for (const [cellId, entry] of index) {
    if (entry.line) {
      const m = toRoot(entry.line, root);
      if (m) {
        const pts = parsePathPoints(entry.line.getAttribute('d') ?? '').map((p) => applyMatrix(m, p));
        const width = hasHalves(patches, cellId) ? max : strokeWidthOf(entry.line, entry.original.strokeWidth);
        const clearance = (width * unitOf(m)) / 2;
        for (const { a, b } of runsOf(pts)) {
          out.push({ kind: 'segment', a, b, clearance, owner: cellId });
        }
      }
      for (const { el } of entry.ends ?? []) {
        rect(el);
      }
      if (!hasHalves(patches, cellId)) {
        entry.arrows.forEach((a) => rect(a));
      }
    } else if (entry.shape) {
      const m = toRoot(entry.shape, root);
      rect(entry.shape, m ? (strokeWidthOf(entry.shape, entry.original.strokeWidth) * unitOf(m)) / 2 : 0);
    }
    if (entry.meta.kind === 'link-label') {
      rect(entry.group);
    }
    if (patches.has(cellId)) {
      const marker = statusMarkerBox(entry, probe);
      const m = marker && toRoot(marker.space, root);
      if (marker && m) {
        out.push({ kind: 'rect', rect: mapRect(marker.bounds, m), clearance: 0 });
      }
    }
  }
  root.querySelectorAll(`g.${OVERLAY_CLASS} polygon.dmap-arrow`).forEach((a) => rect(a));
  return out;
}

/* ---------- legs ---------- */

/** The nearest point of a polyline to `p`, with the index of the segment that holds it. */
function nearestOnPolyline(pts: Point[], p: Point): { at: number; point: Point } {
  let best = { at: 0, point: pts[0], distance: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance < best.distance) {
      best = { at: i - 1, point, distance };
    }
  }
  return { at: best.at, point: best.point };
}

const legOf = (points: Point[], strokeRoot: number): Omit<LegInput, 'size'> => ({
  points,
  bends: bendLengths(points),
  length: polylineLength(points),
  strokeRoot,
});

/**
 * The legs of a link in root units: the root polyline is every vertex of the path through the path's matrix, plus
 * the overlay's split as a vertex. Each leg runs from the end of the link towards the arrowhead (`LegInput`).
 */
function edgeLegs(
  entry: CellEntry,
  root: SVGSVGElement,
  max: number,
  halves: { a2b: boolean; b2a: boolean }
): { a2b?: Omit<LegInput, 'size'>; b2a?: Omit<LegInput, 'size'> } {
  const line = entry.line!;
  const geoRoot = pathGeometry(line, root);
  const pts = parsePathPoints(line.getAttribute('d') ?? '').map((p) => applyMatrix(geoRoot.matrix, p));
  if (pts.length < 2 || !(geoRoot.length > 0)) {
    return {};
  }
  const strokeRoot = max * geoRoot.unit;
  if (halves.a2b && halves.b2a) {
    // the split in path-local arc length, as the overlay computes it against its own layer (a sibling of the path)
    const mid = linkSplit(pathGeometry(line, line.parentNode as SVGGraphicsElement));
    const split = geoRoot.pointAt(mid);
    const { at, point } = nearestOnPolyline(pts, { x: split.x, y: split.y });
    return {
      a2b: legOf([...pts.slice(0, at + 1), point], strokeRoot),
      b2a: legOf([...pts.slice(at + 1).reverse(), point], strokeRoot),
    };
  }
  return halves.a2b ? { a2b: legOf(pts, strokeRoot) } : { b2a: legOf([...pts].reverse(), strokeRoot) };
}

/* ---------- the layer and its elements ---------- */

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function createLayer(root: SVGSVGElement): SVGGElement {
  const layer = document.createElementNS(NS, 'g');
  layer.setAttribute('class', LINK_LABEL_LAYER_CLASS);
  root.appendChild(layer);
  return layer;
}

function createProbe(layer: SVGGElement): SVGTextElement {
  const probe = document.createElementNS(NS, 'text');
  probe.setAttribute('class', 'dmap-link-label-probe');
  probe.setAttribute('visibility', 'hidden');
  probe.setAttribute('pointer-events', 'none');
  probe.setAttribute('aria-hidden', 'true');
  layer.appendChild(probe);
  return probe;
}

function paint(el: SVGTextElement, theme: GrafanaTheme2): void {
  el.setAttribute('fill', theme.colors.text.primary);
  el.setAttribute('stroke', theme.colors.background.primary);
}

function ensureElement(layout: LabelLayout, rec: LabelRecord): SVGTextElement {
  if (rec.el) {
    return rec.el;
  }
  const el = document.createElementNS(NS, 'text');
  el.setAttribute('class', LINK_LABEL_CLASS);
  el.setAttribute('data-dmap-cell', rec.cellId);
  el.setAttribute('data-dmap-half', rec.which);
  el.setAttribute('data-dmap-mode', rec.mode);
  el.setAttribute('pointer-events', 'visiblePainted');
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('dominant-baseline', 'central');
  el.setAttribute('font-size', String(LINK_LABEL_GEOMETRY.fontSize));
  el.setAttribute('font-family', layout.fontFamily);
  el.setAttribute('stroke-width', String(2 * LINK_LABEL_GEOMETRY.halo));
  el.setAttribute('paint-order', 'stroke');
  el.setAttribute('stroke-linejoin', 'round');
  paint(el, layout.theme);
  layout.layer.appendChild(el);
  rec.el = el;
  return el;
}

function position(el: SVGTextElement, placed: Placed): void {
  const x = fmt(placed.centre.x);
  const y = fmt(placed.centre.y);
  el.setAttribute('x', x);
  el.setAttribute('y', y);
  el.setAttribute('transform', `rotate(${fmt(placed.degrees)} ${x} ${y})`);
  el.setAttribute('data-dmap-placed-at', String(++stamp));
}

/** Shows `text` in the element, or hides the element (its slot stays reserved) when there is none. */
function showText(rec: LabelRecord, text: string | undefined): void {
  const el = rec.el;
  if (!el) {
    return;
  }
  if (text === undefined || rec.retry) {
    el.setAttribute('visibility', 'hidden');
    return;
  }
  if (el.textContent !== text) {
    el.textContent = text;
  }
  el.removeAttribute('visibility');
}

/** Places one label with its current slot; a placed label takes its box in the grid. */
function tryPlace(layout: LabelLayout, rec: LabelRecord): boolean {
  if (!rec.leg || rec.slot === undefined) {
    rec.placement = undefined;
    rec.obstacle = undefined;
    return false;
  }
  const leg: LegInput = { ...rec.leg, size: { width: rec.slot, height: LINK_LABEL_GEOMETRY.fontSize * 1.25 } };
  const placement = placeHalfLabel(leg, rec.cellId, layout.grid);
  rec.placement = placement;
  if ('centre' in placement) {
    rec.obstacle = { kind: 'rect', rect: boundsOf(placement.box), clearance: 0 };
    layout.grid.add(rec.obstacle);
    return true;
  }
  rec.obstacle = undefined;
  return false;
}

function fullPlacement(
  root: SVGSVGElement,
  index: CellIndex,
  patches: PatchMap,
  slots: Slot[],
  opts: LinkLabelOptions,
  key: string,
  fontFamily: string,
  previous: LabelLayout | undefined
): LabelLayout {
  const layer = previous?.layer.parentNode === root ? previous.layer : createLayer(root);
  layer.replaceChildren();
  const layout: LabelLayout = {
    key,
    index,
    layer,
    probe: createProbe(layer),
    fontFamily,
    theme: opts.theme,
    grid: obstacleIndex([]),
    widths: new Map(),
    records: new Map(),
  };
  const probe: TextProbe = (text, font) => measure(layout, text, font);
  layout.grid = obstacleIndex(stageObstacles(root, index, patches, opts.linkWidth.max, probe));
  const legs = new Map<string, ReturnType<typeof edgeLegs>>();
  for (const slot of slots) {
    let cellLegs = legs.get(slot.cellId);
    if (!cellLegs) {
      const link = patches.get(slot.cellId)!.link!;
      cellLegs = edgeLegs(index.get(slot.cellId)!, root, opts.linkWidth.max, { a2b: !!link.a2b, b2a: !!link.b2a });
      legs.set(slot.cellId, cellLegs);
    }
    const text = linkLabelText(slot.state, slot.mode);
    const rec: LabelRecord = {
      cellId: slot.cellId,
      which: slot.which,
      mode: slot.mode,
      leg: cellLegs[slot.which],
      slot: slotOf(layout, slot, text),
      text,
      retry: false,
    };
    layout.records.set(`${slot.cellId}:${slot.which}`, rec);
    if (tryPlace(layout, rec)) {
      position(ensureElement(layout, rec), rec.placement as Placed);
    }
    showText(rec, text);
  }
  return layout;
}

/** A call with the same key: the texts, the hidden state, the theme, and an isolated re-placement per changed slot. */
function refresh(layout: LabelLayout, slots: Slot[], theme: GrafanaTheme2): number {
  let moved = 0;
  if (layout.theme !== theme) {
    layout.theme = theme;
    for (const rec of layout.records.values()) {
      if (rec.el) {
        paint(rec.el, theme);
      }
    }
  }
  for (const slot of slots) {
    const rec = layout.records.get(`${slot.cellId}:${slot.which}`)!;
    const text = linkLabelText(slot.state, slot.mode);
    const width = slotOf(layout, slot, text);
    const slotChanged = width !== undefined && width !== rec.slot;
    if (slotChanged) {
      rec.slot = width;
    }
    if ((slotChanged || rec.retry) && text !== undefined) {
      const old = rec.obstacle;
      const wasPlaced = !!rec.placement && 'centre' in rec.placement;
      if (old) {
        layout.grid.remove(old);
      }
      if (tryPlace(layout, rec)) {
        const el = ensureElement(layout, rec);
        position(el, rec.placement as Placed);
        el.removeAttribute('data-dmap-dropped');
        rec.retry = false;
        if (wasPlaced) {
          moved++;
        }
      } else {
        // no spot: the label hides, keeps its old box as its reserved slot, and tries again on the next call
        if (old) {
          layout.grid.add(old);
          rec.obstacle = old;
        }
        rec.retry = true;
        rec.el?.setAttribute('data-dmap-dropped', 'no-free-spot');
      }
    }
    rec.text = text;
    showText(rec, text);
  }
  return moved;
}

function debugEnabled(): boolean {
  try {
    return !!window.localStorage?.getItem('dmapDebug');
  } catch {
    return false;
  }
}
