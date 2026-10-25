import { formattedValueToString, type GrafanaTheme2 } from '@grafana/data';
import type { LinkLabelMode } from '../model/config';
import { hoverKind } from '../interact/hit';
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
  scaleOf,
  toMatrix,
  usable,
  type Matrix,
  type Point,
} from './geometry';
import {
  aabbOf,
  boundsOf,
  labelsVisible,
  LABEL_SIDES,
  LINK_LABEL_GEOMETRY,
  type LabelSide,
  drawnCentre,
  obstacleIndex,
  placeHalfLabel,
  placeLinkLabels,
  pointToSegment,
  type LegInput,
  type Obstacle,
  type ObstacleIndex,
  type Placed,
  type Placement,
  type Rect,
} from './labelPlacement';
import { fmt, linkSplit, OVERLAY_CLASS, statusMarkerBox, type TextProbe } from './overlay';
import { viewScaleOf } from './zoom';

/*
 * The value labels of the link halves: the only module that touches the DOM for them. One layer, the last child of
 * the root svg; one <text> per labelled half; the placement runs once per stage (docs/superpowers/specs/
 * 2026-10-25-link-value-labels-design.md, sections 6 and 7) and a data refresh changes the texts.
 */

export const LINK_LABEL_CLASS = 'dmap-link-label';
/** The class of the canvas-coloured rect behind the text of a label that stands on its stroke. */
export const LINK_LABEL_BG_CLASS = 'dmap-link-label-bg';
export const LINK_LABEL_LAYER_CLASS = 'dmap-link-labels';
const NS = 'http://www.w3.org/2000/svg';
/** a slot width rounds up to a multiple of this, so that a small change of a value keeps its slot */
const SLOT_GRAIN = 4;
/** the widest text `percentText` produces: every percent label has this one slot */
const WIDEST_PERCENT = '>999%';
/** the font of the status markers: the fallback when the stage has no portograph link label */
const FALLBACK_FONT = 'sans-serif';
/** a box inside another by at most this much on a side still counts as contained (two decimals in the export) */
const CONTAIN_EPS = 0.5;

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
type Leg = Omit<LegInput, 'size'> & { id: string };
type EdgeLegs = { a2b?: Leg; b2a?: Leg };
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
  leg?: Leg;
  /** the slot width without the halo; undefined until the half has shown a text */
  slot?: number;
  el?: SVGTextElement;
  placement?: Placement;
  /** the side of the last spot the label held; a dropped half keeps it with its reserved box */
  side?: LabelSide;
  /** the drawn stroke width of the half in root units (`HalfState.width` as the overlay draws it) */
  drawn: number;
  /** the canvas-coloured rect behind the text of a label that stands on its stroke */
  bg?: SVGRectElement;
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
  /** `linkWidth.max` of the placement: the widest stroke, in the units of the edge */
  max: number;
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
 * Builds or updates the label layer. A call with a new stage, a new set of patched cells or labelled halves, a new
 * `linkWidth.max` or a new font places everything; any other call changes the texts and the hidden state, and
 * places again only a label whose slot changed. Returns the counts for the tests and the debug log.
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
  // the obstacles depend on every patched cell (its marker room, its arrows, its stroke, the split of its halves)
  const patched = Array.from(patches.keys())
    .sort()
    .map((id) => {
      const { a2b, b2a } = halvesOf(patches, id);
      return `${id}:${a2b ? 'a' : ''}${b2a ? 'b' : ''}`;
    });
  const key = [
    slots.map((s) => `${s.cellId}:${s.which}:${s.mode}`).join('\n'),
    patched.join('\n'),
    opts.linkWidth.max,
    fontFamily,
  ].join('|');
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
    // the linter allows no console.debug; the flag `localStorage.dmapDebug` keeps it quiet by default
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

/**
 * The width of `text` by the hidden probe, memoised per string and font. jsdom has no measure and gets 0.6 em per
 * glyph; a browser that measures 0 (a panel without layout at this frame) gets the same estimate, not memoised.
 */
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
  const canMeasure = typeof probe.getComputedTextLength === 'function';
  const measured = canMeasure ? probe.getComputedTextLength() : 0;
  const estimate = 0.6 * font.size * text.length;
  if (measured > 0 || !canMeasure) {
    layout.widths.set(key, measured > 0 ? measured : estimate);
  }
  return measured > 0 ? measured : estimate;
}

/** The font of the first portograph link label in the stage, else the status markers' font. */
function stageFont(root: SVGSVGElement): string {
  const text = root.querySelector('g[data-cell-id^="pg-linkLabel"] text');
  const family =
    text?.closest('[font-family]')?.getAttribute('font-family') ?? (text as SVGElement | null)?.style.fontFamily;
  return family || FALLBACK_FONT;
}

/* ---------- coordinates ---------- */

/**
 * The matrix from the user space of `el` into root user units: the screen CTMs of both (the outermost svg has one in
 * every engine), the transform attributes in jsdom. Undefined when it cannot be read.
 */
function toRoot(el: Element, root: SVGSVGElement): Matrix | undefined {
  const g = el as SVGGraphicsElement;
  if (typeof g.getScreenCTM === 'function' && typeof root.getScreenCTM === 'function') {
    const own = toMatrix(g.getScreenCTM());
    const base = toMatrix(root.getScreenCTM());
    return own && base && usable(own) && usable(base) ? multiply(invert(base), own) : undefined;
  }
  return localMatrix(el, root);
}

/** The axis-aligned box of `rect` mapped through `m`. */
function mapRect(rect: Rect, m: Matrix): Rect {
  return aabbOf(
    [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((p) => applyMatrix(m, p))
  )!;
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
    case 'path':
      return aabbOf(parsePathPoints(el.getAttribute('d') ?? ''));
    case 'text': {
      // no layout in jsdom: 0.6 em per glyph on the baseline, the anchor from the text or an ancestor
      const size = parseFloat(el.closest('[font-size]')?.getAttribute('font-size') ?? '') || 12;
      const width = 0.6 * size * (el.textContent ?? '').length;
      const anchor = el.closest('[text-anchor]')?.getAttribute('text-anchor');
      const x = num(el, 'x') - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
      return { x, y: num(el, 'y') - size, width, height: size * 1.25 };
    }
    case 'polygon':
    case 'polyline': {
      const nums = (el.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      return aabbOf(nums.flatMap((v, i) => (i % 2 ? [{ x: nums[i - 1], y: v }] : [])));
    }
    default:
      return undefined;
  }
}

const union = (a: Rect | undefined, b: Rect): Rect =>
  a
    ? aabbOf([
        { x: a.x, y: a.y },
        { x: a.x + a.width, y: a.y + a.height },
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
      ])!
    : b;

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

/** The inline stroke width of a primitive: the attribute, the style, the original style, else 1 (the SVG default). */
function strokeWidthOf(el: SVGElement, original?: string): number {
  const n = parseFloat(el.getAttribute('stroke-width') || el.style.strokeWidth || original || '');
  return Number.isFinite(n) ? n : 1;
}

/* ---------- obstacles ---------- */

const hasHalves = (patches: PatchMap, cellId: string) => {
  const link = patches.get(cellId)?.link;
  return !!link && !!(link.a2b || link.b2a);
};

/** `inner` lies inside `outer` (a plain draw.io container holds its children; a background is no obstacle). */
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - CONTAIN_EPS &&
  inner.y >= outer.y - CONTAIN_EPS &&
  inner.x + inner.width <= outer.x + outer.width + CONTAIN_EPS &&
  inner.y + inner.height <= outer.y + outer.height + CONTAIN_EPS &&
  (inner.width < outer.width || inner.height < outer.height);

/**
 * The non-edge cell bodies that are backgrounds, not obstacles (spec section 5, decision 8): the portograph canvas,
 * layers and groups by their kind, and in a plain draw.io diagram a vertex whose body holds two or more other
 * vertices (a container or a swimlane: the export carries no other sign of it; one badge inside a device is not one).
 */
function backgroundIds(index: CellIndex, boxes: Map<string, Rect>): Set<string> {
  const out = new Set<string>();
  const plain: Array<[string, Rect]> = [];
  for (const [cellId, entry] of index) {
    if (entry.line || !entry.shape) {
      continue;
    }
    const kind = hoverKind(entry);
    // a group title bar is `group` too, but it carries the caption: a label must not cover it
    if (kind === 'canvas' || (kind === 'group' && !entry.meta.id.startsWith('pg-groupTitle~'))) {
      out.add(cellId);
    } else if (kind === 'node' && entry.meta.kind === 'other' && !entry.ownerId) {
      const box = boxes.get(cellId);
      if (box) {
        plain.push([cellId, box]);
      }
    }
  }
  for (const [outerId, outer] of plain) {
    // two or more: a device with one badge inside stays an obstacle
    if (plain.filter(([innerId, inner]) => innerId !== outerId && contains(outer, inner)).length >= 2) {
      out.add(outerId);
    }
  }
  return out;
}

/**
 * Every obstacle of the stage in root units (spec section 5), built once per full placement. `legs` are the root
 * polylines of the labelled edges (with the split as a vertex): their pieces are the stroke obstacles of those edges,
 * so that a label's own run is told apart exactly.
 */
export function stageObstacles(
  root: SVGSVGElement,
  index: CellIndex,
  patches: PatchMap,
  max: number,
  probe: TextProbe,
  legs: Map<string, EdgeLegs> = new Map()
): Obstacle[] {
  const out: Obstacle[] = [];
  const rect = (el: Element | undefined, clearance = 0) => {
    const box = el && rootBox(el, root);
    if (box) {
      out.push({ kind: 'rect', rect: box, clearance });
    }
  };
  const bodies = new Map<string, Rect>();
  for (const [cellId, entry] of index) {
    const box = !entry.line && entry.shape ? rootBox(entry.shape, root) : undefined;
    if (box) {
      bodies.set(cellId, box);
    }
  }
  const backgrounds = backgroundIds(index, bodies);
  const strokes = (cellId: string, points: Point[], clearance: number, leg?: string) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.x !== b.x || a.y !== b.y) {
        out.push({ kind: 'segment', a, b, clearance, owner: cellId, ...(leg ? { piece: { leg, index: i - 1 } } : {}) });
      }
    }
  };
  for (const [cellId, entry] of index) {
    if (entry.line) {
      const m = toRoot(entry.line, root);
      if (m) {
        const unit = scaleOf(m);
        const own =
          legs.get(cellId) ??
          (hasHalves(patches, cellId) ? edgeLegs(entry, root, max, halvesOf(patches, cellId)) : undefined);
        if (own) {
          [own.a2b, own.b2a].forEach((leg) => leg && strokes(cellId, leg.points, leg.strokeRoot / 2, leg.id));
        } else {
          const width = hasHalves(patches, cellId) ? max : strokeWidthOf(entry.line, entry.original.strokeWidth);
          const pts = parsePathPoints(entry.line.getAttribute('d') ?? '').map((p) => applyMatrix(m, p));
          strokes(cellId, pts, (width * unit) / 2);
        }
      }
      for (const { el } of entry.ends ?? []) {
        rect(el);
      }
      if (!hasHalves(patches, cellId)) {
        entry.arrows.forEach((a) => rect(a));
      }
    } else if (!entry.shape && entry.label) {
      // a plain text cell: its text is as much in the way as a body
      rect(entry.label);
    } else if (entry.shape && !backgrounds.has(cellId)) {
      const m = toRoot(entry.shape, root);
      const body = bodies.get(cellId);
      if (body && m) {
        out.push({
          kind: 'rect',
          rect: body,
          clearance: (strokeWidthOf(entry.shape, entry.original.strokeWidth) * scaleOf(m)) / 2,
        });
      }
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

const halvesOf = (patches: PatchMap, cellId: string) => {
  const link = patches.get(cellId)?.link;
  return { a2b: !!link?.a2b, b2a: !!link?.b2a };
};

/** The nearest point of a polyline to `p`, with the index of the segment that holds it. */
function nearestOnPolyline(pts: Point[], p: Point): { at: number; point: Point } {
  let best = { at: 0, point: pts[0], distance: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const distance = pointToSegment(p, a, b);
    if (distance < best.distance) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      best = { at: i - 1, point: { x: a.x + t * dx, y: a.y + t * dy }, distance };
    }
  }
  return { at: best.at, point: best.point };
}

const legOf = (id: string, points: Point[], strokeRoot: number): Leg => ({
  id,
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
): EdgeLegs {
  const line = entry.line!;
  const id = entry.meta.id;
  const m = toRoot(line, root);
  if (!m) {
    return {};
  }
  const pts = parsePathPoints(line.getAttribute('d') ?? '').map((p) => applyMatrix(m, p));
  if (pts.length < 2 || !(polylineLength(pts) > 0)) {
    return {};
  }
  const strokeRoot = max * scaleOf(m);
  if (halves.a2b && halves.b2a) {
    // the split in path-local arc length, as the overlay computes it against its own layer (a sibling of the path),
    // then the point in the path's own space, into root units through the same matrix as the vertices
    const mid = linkSplit(pathGeometry(line, line.parentNode as SVGGraphicsElement));
    const local = pathGeometry(line, line).pointAt(mid);
    const { at, point } = nearestOnPolyline(pts, applyMatrix(m, { x: local.x, y: local.y }));
    return {
      a2b: legOf(`${id}:a2b`, [...pts.slice(0, at + 1), point], strokeRoot),
      b2a: legOf(`${id}:b2a`, [...pts.slice(at + 1).reverse(), point], strokeRoot),
    };
  }
  return halves.a2b
    ? { a2b: legOf(`${id}:a2b`, pts, strokeRoot) }
    : { b2a: legOf(`${id}:b2a`, [...pts].reverse(), strokeRoot) };
}

/* ---------- the layer and its elements ---------- */

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

function paint(rec: LabelRecord, theme: GrafanaTheme2): void {
  rec.el?.setAttribute('fill', theme.colors.text.primary);
  rec.el?.setAttribute('stroke', theme.colors.background.primary);
  rec.bg?.setAttribute('fill', theme.colors.background.primary);
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
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('text-rendering', 'geometricPrecision');
  layout.layer.appendChild(el);
  rec.el = el;
  paint(rec, layout.theme);
  return el;
}

const SIDE_NAMES = { '0': 'line', '1': 'top', '-1': 'bottom', '2': 'top-wide', '-2': 'bottom-wide' } as const;
/** The corner radius of the gap a label on its stroke cuts into the line. */
const GAP_RADIUS = 2;

function position(layout: LabelLayout, rec: LabelRecord, placed: Placed): void {
  const el = ensureElement(layout, rec);
  el.setAttribute('data-dmap-side', SIDE_NAMES[placed.side]);
  el.setAttribute('data-dmap-placed-at', String(++stamp));
  draw(layout, rec, placed);
}

/** Writes the geometry of a placed label: the text at the drawn stroke, the gap rect behind it on the stroke. */
function draw(layout: LabelLayout, rec: LabelRecord, placed: Placed): void {
  const el = rec.el;
  if (!el) {
    return;
  }
  const at = drawnCentre(placed, rec.drawn);
  const x = fmt(at.x);
  const y = fmt(at.y);
  const turn = `rotate(${fmt(placed.degrees)} ${x} ${y})`;
  el.setAttribute('x', x);
  el.setAttribute('y', y);
  el.setAttribute('transform', turn);
  // a label on its stroke gets a gap in the line: a rect in the canvas colour behind the text, as wide as the slot
  // and covering the drawn stroke with 1 unit more on each side
  if (placed.side !== 0 || rec.slot === undefined) {
    rec.bg?.remove();
    rec.bg = undefined;
    return;
  }
  if (!rec.bg) {
    rec.bg = document.createElementNS(NS, 'rect');
    rec.bg.setAttribute('class', LINK_LABEL_BG_CLASS);
    rec.bg.setAttribute('pointer-events', 'none');
    rec.bg.setAttribute('rx', String(GAP_RADIUS));
    layout.layer.insertBefore(rec.bg, el);
    paint(rec, layout.theme);
    if (el.getAttribute('visibility') === 'hidden') {
      rec.bg.setAttribute('visibility', 'hidden');
    }
  }
  const height = Math.max(LINK_LABEL_GEOMETRY.fontSize * 1.25, rec.drawn + 2);
  rec.bg.setAttribute('x', fmt(at.x - rec.slot / 2));
  rec.bg.setAttribute('y', fmt(at.y - height / 2));
  rec.bg.setAttribute('width', fmt(rec.slot));
  rec.bg.setAttribute('height', fmt(height));
  rec.bg.setAttribute('transform', turn);
}

/** Shows `text` in the element, or hides the element (its slot stays reserved) when there is none. */
function showText(rec: LabelRecord, text: string | undefined): void {
  const el = rec.el;
  if (!el) {
    return;
  }
  if (text === undefined || rec.retry) {
    el.setAttribute('visibility', 'hidden');
    rec.bg?.setAttribute('visibility', 'hidden');
    return;
  }
  if (el.textContent !== text) {
    el.textContent = text;
  }
  el.removeAttribute('visibility');
  rec.bg?.removeAttribute('visibility');
}

/** Places one label with its current slot; a placed label takes its box in the grid. */
function tryPlace(layout: LabelLayout, rec: LabelRecord): boolean {
  const leg = inputOf(rec);
  if (!leg) {
    rec.placement = undefined;
    rec.obstacle = undefined;
    return false;
  }
  // an isolated re-placement tries first the side the other half of the link holds (or held before it dropped)
  const mate = layout.records.get(`${rec.cellId}:${rec.which === 'a2b' ? 'b2a' : 'a2b'}`)?.side;
  const sides: readonly LabelSide[] =
    mate === undefined ? LABEL_SIDES : [mate, ...LABEL_SIDES.filter((side) => side !== mate)];
  return hold(layout, rec, placeHalfLabel(leg, rec.cellId, layout.grid, sides));
}

/** The leg of a record with its slot size; undefined when the edge has no geometry or the half has no slot yet. */
function inputOf(rec: LabelRecord): LegInput | undefined {
  if (!rec.leg || rec.slot === undefined) {
    return undefined;
  }
  return { ...rec.leg, size: { width: rec.slot, height: LINK_LABEL_GEOMETRY.fontSize * 1.25 } };
}

/** Stores the placement of a record; a placed label takes its box in the grid. */
function hold(layout: LabelLayout, rec: LabelRecord, placement: Placement): boolean {
  rec.placement = placement;
  if ('centre' in placement) {
    rec.side = placement.side;
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
    max: opts.linkWidth.max,
  };
  const probe: TextProbe = (text, font) => measure(layout, text, font);
  // the legs of every labelled edge first: their pieces are the stroke obstacles of those edges
  const legs = new Map<string, EdgeLegs>();
  for (const slot of slots) {
    if (!legs.has(slot.cellId)) {
      legs.set(
        slot.cellId,
        edgeLegs(index.get(slot.cellId)!, root, opts.linkWidth.max, halvesOf(patches, slot.cellId))
      );
    }
  }
  layout.grid = obstacleIndex(stageObstacles(root, index, patches, opts.linkWidth.max, probe, legs));
  const texts: Array<string | undefined> = [];
  for (const slot of slots) {
    const text = linkLabelText(slot.state, slot.mode);
    texts.push(text);
    const rec: LabelRecord = {
      cellId: slot.cellId,
      which: slot.which,
      mode: slot.mode,
      leg: legs.get(slot.cellId)?.[slot.which],
      slot: slotOf(layout, slot, text),
      drawn: drawnOf(layout, legs.get(slot.cellId)?.[slot.which], slot.state),
      retry: false,
    };
    layout.records.set(`${slot.cellId}:${slot.which}`, rec);
  }
  // the two halves of a link are placed together: both on one side when a side holds both
  const done = new Set<LabelRecord>();
  slots.forEach((slot, i) => {
    const rec = layout.records.get(`${slot.cellId}:${slot.which}`)!;
    if (!done.has(rec)) {
      const mate = layout.records.get(`${slot.cellId}:${slot.which === 'a2b' ? 'b2a' : 'a2b'}`);
      const [a, b] = slot.which === 'a2b' ? [rec, mate] : [mate, rec];
      const legA = a && inputOf(a);
      const legB = b && inputOf(b);
      if (a && b && legA && legB && !done.has(mate!)) {
        const [pa, pb] = placeLinkLabels(legA, legB, rec.cellId, layout.grid);
        hold(layout, a, pa);
        hold(layout, b, pb);
        done.add(a).add(b);
      } else {
        tryPlace(layout, rec);
        done.add(rec);
      }
    }
    if (rec.placement && 'centre' in rec.placement) {
      position(layout, rec, rec.placement);
    }
    showText(rec, texts[i]);
  });
  return layout;
}

/** The drawn stroke width of a half in root units: its width in the units of the edge, converted as the widest one is. */
function drawnOf(layout: LabelLayout, leg: Leg | undefined, state: HalfState): number {
  const width = Math.max(state.width, 0);
  return leg && layout.max > 0 ? (width * leg.strokeRoot) / layout.max : width;
}

/** A call with the same key: the texts, the hidden state, the theme, and an isolated re-placement per changed slot. */
function refresh(layout: LabelLayout, slots: Slot[], theme: GrafanaTheme2): number {
  let moved = 0;
  if (layout.theme !== theme) {
    layout.theme = theme;
    for (const rec of layout.records.values()) {
      paint(rec, theme);
    }
  }
  for (const slot of slots) {
    const rec = layout.records.get(`${slot.cellId}:${slot.which}`)!;
    const text = linkLabelText(slot.state, slot.mode);
    // a changed load changes the drawn width: the text moves across the link, on the same side and place along it
    const drawn = drawnOf(layout, rec.leg, slot.state);
    if (drawn !== rec.drawn) {
      rec.drawn = drawn;
      if (rec.placement && 'centre' in rec.placement) {
        draw(layout, rec, rec.placement);
      }
    }
    const width = slotOf(layout, slot, text);
    const slotChanged = width !== undefined && width !== rec.slot;
    if (slotChanged) {
      rec.slot = width;
    }
    // a changed slot is placed again also while the label is hidden: a stale reservation must never survive
    if (slotChanged || (rec.retry && text !== undefined)) {
      // the label held a box (placed, or hidden with its reserved box): a new spot is a move
      const old = rec.obstacle;
      if (old) {
        layout.grid.remove(old);
      }
      if (tryPlace(layout, rec)) {
        const el = ensureElement(layout, rec);
        position(layout, rec, rec.placement as Placed);
        el.removeAttribute('data-dmap-dropped');
        rec.retry = false;
        if (old) {
          moved++;
        }
      } else {
        // no spot: the label hides, keeps its old box as its reserved slot, and tries again on the next call
        if (old) {
          layout.grid.add(old);
          rec.obstacle = old;
        }
        rec.retry = true;
        rec.el?.setAttribute(
          'data-dmap-dropped',
          rec.placement && 'dropped' in rec.placement ? rec.placement.dropped : 'no-free-spot'
        );
      }
    }
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
