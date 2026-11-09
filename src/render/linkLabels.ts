import { formattedValueToString, type GrafanaTheme2 } from '@grafana/data';
import type { ArrowStyle, LinkLabelMode } from '../model/v4';
import { hoverKind } from '../adapter/portograph';
import type { CellEntry, CellIndex, HalfState, PatchMap } from '../types';
import {
  applyMatrix,
  bendLengths,
  invert,
  parsePathPoints,
  pathGeometry,
  polylineLength,
  strokeReach,
  scaleOf,
  drawnStrokeWidth,
  originalStrokeWidth,
  toMatrix,
  toRoot,
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
  NEAR_SIDES,
  type LabelSide,
  drawnCentre,
  obstacleIndex,
  placeHalfLabel,
  placeLinkLabels,
  placeAgain,
  pointToSegment,
  type LegInput,
  type Obstacle,
  type ObstacleIndex,
  type Placed,
  type Placement,
  type Rect,
} from './labelPlacement';
import { alphaOf, maxBodyWidth, statusBorderWidth } from '../binding/color';
import {
  drawnWidth,
  fmt,
  headSize,
  linkGeometryKey,
  linkSplit,
  OVERLAY_CLASS,
  overlayHalves,
  reservedHead,
} from './overlay';
import { readViewBox, viewScaleOf } from './zoom';

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
/** the fallback font family when the stage has no portograph link label */
const FALLBACK_FONT = 'sans-serif';
/** a box inside another by at most this much on a side still counts as contained (two decimals in the export) */
const CONTAIN_EPS = 0.5;
/** the most measured texts a layout keeps: live values give ever new texts, the memo must not grow for days */
const MAX_WIDTHS = 2000;

export interface LinkLabelOptions {
  theme: GrafanaTheme2;
  linkWidth: { min: number; max: number };
  /** the bounds of the diagram (the base view box of the stage); the live view box of the root when absent */
  bounds?: { x: number; y: number; w: number; h: number };
}
export interface LinkLabelCounts {
  placed: number;
  dropped: number;
  moved: number;
}

type Half = 'a2b' | 'b2a';
type LabelMode = Exclude<LinkLabelMode, 'none'>;
type Leg = Omit<LegInput, 'size'> & { id: string; arrow: ArrowStyle };
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
  /** the base of the drawn arrow head of the half in root units: a label beside the heads (±3) stands beyond it */
  head: number;
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
  /** the halo colour of this pass: the computed background of the root, else the canvas colour of the theme */
  halo: string;
  grid: ObstacleIndex;
  widths: Map<string, number>;
  records: Map<string, LabelRecord>;
  /** `linkWidth.max` of the placement: the widest stroke, in the units of the edge */
  max: number;
  min: number;
  /** the bounds of the diagram in root units */
  bounds: Rect;
  /** the halves that carry a cut, with their cell: the next sync takes the cut off one that is no longer wanted */
  cuts: Map<SVGElement, string>;
  /** the matrix of an overlay group into root units, read once per layout: a pan or a zoom does not change it */
  spaces: Map<Element, Matrix | undefined>;
  /** a change since the last sync that can move a cut: a text, a slot, a drawn width, a placement, a hidden label */
  cutsStale: boolean;
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
    dropCuts(root);
    return { placed: 0, dropped: 0, moved: 0 };
  }
  const fontFamily = stageFont(root);
  // the obstacles depend on every patched cell (its arrows, its stroke, the split of its halves)
  const patched = Array.from(patches.keys())
    .sort()
    .map((id) => `${id}:${linkGeometryKey(patches.get(id)?.link)}`);
  const key = [
    slots.map((s) => `${s.cellId}:${s.which}:${s.mode}`).join('\n'),
    patched.join('\n'),
    opts.linkWidth.max,
    opts.linkWidth.min,
    fontFamily,
  ].join('|');
  const started = typeof performance === 'undefined' ? 0 : performance.now();
  let moved = 0;
  if (!layout || layout.key !== key || layout.index !== index || layout.layer.parentNode !== root) {
    layout = fullPlacement(root, index, patches, slots, opts, key, fontFamily, layout);
    layouts.set(root, layout);
    applyScale(root);
  } else {
    moved = refresh(layout, slots, opts.theme, root);
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
  // the cuts follow the texts on the strokes: a pass that changed none of them (and whose cut halves are still in the
  // DOM: an overlay that was built again has none) writes none
  if (layout.cutsStale || [...layout.cuts.keys()].some((el) => !el.isConnected)) {
    syncCuts(root, layout);
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

/** The rendered size of the root svg, when the caller knows it: `viewScaleOf` then reads no layout. */
export type StageRect = { width: number; height: number };

/** Writes the visibility of the layer for the current scale; true when it flipped. */
function applyScale(root: SVGSVGElement, rect?: StageRect): { layer?: Element; flipped: boolean } {
  const layer = Array.from(root.children).find((c) => c.classList.contains(LINK_LABEL_LAYER_CLASS));
  if (!layer) {
    return { flipped: false };
  }
  const hidden = !labelsVisible(viewScaleOf(root, rect));
  const flipped = hidden !== (layer.getAttribute('visibility') === 'hidden');
  if (hidden) {
    layer.setAttribute('visibility', 'hidden');
  } else {
    layer.removeAttribute('visibility');
  }
  return { layer, flipped };
}

/**
 * Hides the layer when a glyph would be smaller than the minimum on-screen size, shows it otherwise (spec section
 * 6). One attribute on a pan or a zoom, and one rect read unless the caller passes the rendered size of the svg
 * (`rect`: the zoom effects keep it from a `ResizeObserver`, so a pointer move forces no layout); the cuts in the
 * strokes change only when the layer flips (a pan or a zoom changes nothing in the local space of the overlay). The
 * zoom effects call it after `applyLayout`.
 */
export function setLinkLabelScale(root: SVGSVGElement, rect?: StageRect): void {
  const { flipped } = applyScale(root, rect);
  const layout = layouts.get(root);
  if (flipped && layout) {
    syncCuts(root, layout);
  }
}

/**
 * Cuts the strokes again when a web font finishes loading: the cut follows the painted box of the text (`getBBox`),
 * and the glyphs of a late font are wider than those of the first render. Only the cuts change. The placement uses
 * the slot, which is an estimate from the font size and not a measure, so a font does not move any label. Runs once
 * for `document.fonts.ready` and after each 'loadingdone'. A host without `document.fonts` does nothing. Returns the
 * cleanup for the unmount.
 */
export function watchLinkLabelFonts(root: SVGSVGElement): () => void {
  const fonts = typeof document === 'undefined' ? undefined : (document.fonts as FontFaceSet | undefined);
  if (!fonts) {
    return () => {};
  }
  let live = true;
  const resync = () => {
    const layout = layouts.get(root);
    if (live && layout && layout.layer.parentNode === root) {
      syncCuts(root, layout);
    }
  };
  fonts.addEventListener?.('loadingdone', resync);
  fonts.ready?.then(resync, () => {});
  return () => {
    live = false;
    fonts.removeEventListener?.('loadingdone', resync);
  };
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
    if (layout.widths.size >= MAX_WIDTHS) {
      layout.widths.clear();
    }
    layout.widths.set(key, measured > 0 ? measured : estimate);
  }
  return measured > 0 ? measured : estimate;
}

/** The font of the first portograph link label in the stage, else the fallback font. */
function stageFont(root: SVGSVGElement): string {
  const text = root.querySelector('g[data-cell-id^="pg-linkLabel"] text');
  const family =
    text?.closest('[font-family]')?.getAttribute('font-family') ?? (text as SVGElement | null)?.style.fontFamily;
  return family || FALLBACK_FONT;
}

/* ---------- coordinates ---------- */

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

/** A foreignObject sized in percent (draw.io: 100% x 100%, overflow visible): its own box is the whole viewport. */
const isFluid = (el: Element) =>
  el.localName === 'foreignObject' && ['width', 'height'].some((a) => (el.getAttribute(a) ?? '').trim().endsWith('%'));

/**
 * The box of the HTML content of a fluid foreignObject in root units: the union of the line boxes of its text nodes
 * (a range per text node; a range over the elements would add the 1 px wide flex wrapper with its padding that
 * draw.io uses to position the text). Where ranges have no layout (jsdom), the box of its first element child.
 * The foreignObject box is never used. Undefined when the content has no box.
 */
function htmlBox(fo: Element, root: SVGSVGElement, rootCtm?: Matrix): Rect | undefined {
  const empty = (r: { width: number; height: number } | undefined) => !r || !(r.width > 0) || !(r.height > 0);
  let r: { x: number; y: number; width: number; height: number } | undefined;
  const probe = document.createRange();
  if (typeof probe.getBoundingClientRect === 'function') {
    const walker = document.createTreeWalker(fo, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) {
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const b = range.getBoundingClientRect();
      if (!empty(b)) {
        r = union(r, { x: b.x, y: b.y, width: b.width, height: b.height });
      }
    }
  } else {
    r = fo.firstElementChild?.getBoundingClientRect();
  }
  if (!r || empty(r) || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) {
    return undefined;
  }
  // screen pixels into root units; a root without a screen matrix (jsdom) keeps them as they are
  const base = rootCtm ?? screenCtm(root);
  if (!base) {
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  return usable(base) ? mapRect({ x: r.x, y: r.y, width: r.width, height: r.height }, invert(base)) : undefined;
}

/** The screen matrix of the root, read once per pass and passed down: every `toRoot` of the pass needs it. */
const screenCtm = (root: SVGSVGElement): Matrix | undefined =>
  typeof root.getScreenCTM === 'function' ? toMatrix(root.getScreenCTM()) : undefined;

/** The painted box of an element in root user units, or undefined when it cannot be read. */
function rootBox(el: Element, root: SVGSVGElement, rootCtm?: Matrix): Rect | undefined {
  const g = el as SVGGraphicsElement;
  if (isFluid(el)) {
    return htmlBox(el, root, rootCtm);
  }
  // a group with a fluid foreignObject inside: its own box would be the viewport, so take the union of the children
  const fluidInside = Array.from(el.querySelectorAll('foreignObject')).some(isFluid);
  if (typeof g.getBBox === 'function' && !fluidInside) {
    try {
      const m = toRoot(el, root, rootCtm);
      const b = g.getBBox();
      if (!m || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) {
        return undefined;
      }
      return mapRect({ x: b.x, y: b.y, width: b.width, height: b.height }, m);
    } catch {
      return undefined;
    }
  }
  if (el.localName === 'g' || el.localName === 'a' || el.localName === 'switch') {
    let box: Rect | undefined;
    // a switch draws its first usable child: the foreignObject, not the image fallback after it
    const fo =
      el.localName === 'switch' ? Array.from(el.children).find((c) => c.localName === 'foreignObject') : undefined;
    for (const child of fo ? [fo] : Array.from(el.children)) {
      const b = rootBox(child, root, rootCtm);
      // an empty child (a box of 0 x 0 at the origin) would stretch the union
      if (b && (b.width > 0 || b.height > 0)) {
        box = union(box, b);
      }
    }
    return box;
  }
  const local = attributeBox(el);
  const m = local && toRoot(el, root, rootCtm);
  return local && m ? mapRect(local, m) : undefined;
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
  legs: Map<string, EdgeLegs> = new Map(),
  rootCtm: Matrix | undefined = screenCtm(root)
): Obstacle[] {
  const out: Obstacle[] = [];
  const rect = (el: Element | undefined, clearance = 0) => {
    const box = el && rootBox(el, root, rootCtm);
    if (box) {
      out.push({ kind: 'rect', rect: box, clearance });
    }
  };
  const bodies = new Map<string, Rect>();
  for (const [cellId, entry] of index) {
    const box = !entry.line && entry.shape ? rootBox(entry.shape, root, rootCtm) : undefined;
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
      const m = toRoot(entry.line, root, rootCtm);
      if (m) {
        const unit = scaleOf(m);
        const own =
          legs.get(cellId) ??
          (hasHalves(patches, cellId)
            ? edgeLegs(entry, root, max, halvesOf(patches, cellId), max, patches.get(cellId)?.link?.arrow, rootCtm)
            : undefined);
        if (own) {
          [own.a2b, own.b2a].forEach((leg) => leg && strokes(cellId, leg.points, leg.strokeRoot / 2, leg.id));
        } else {
          const width = hasHalves(patches, cellId) ? max : drawnStrokeWidth(entry.line);
          const pts = parsePathPoints(entry.line.getAttribute('d') ?? '').map((p) => applyMatrix(m, p));
          strokes(cellId, pts, (width * unit) / 2);
        }
      }
      for (const { el } of entry.ends ?? []) {
        rect(el);
      }
      // the value text of the edge is drawn in its own cell group: the exemption of the own stroke does not cover it
      rect(entry.label);
      if (!hasHalves(patches, cellId)) {
        entry.arrows.forEach((a) => rect(a));
      }
    } else if (!entry.shape && entry.label) {
      // a plain text cell: its text is as much in the way as a body
      rect(entry.label);
    } else if (entry.shape && backgrounds.has(cellId)) {
      // a group or a container is a background, but its title text is not: a label must not stand on the caption
      // (the frame line and the interior stay free; the halo covers the frame)
      rect(entry.label);
    } else if (entry.shape && !backgrounds.has(cellId)) {
      const m = toRoot(entry.shape, root, rootCtm);
      const body = bodies.get(cellId);
      if (body && m) {
        out.push({
          kind: 'rect',
          rect: body,
          clearance: strokeReach(m, bodyReach(entry)),
        });
      }
    }
    if (entry.meta.kind === 'link-label') {
      rect(entry.group);
    }
  }
  // the head of a half grows with its width: the obstacle is the triangle of the head at linkWidth.max (not its box:
  // a label beside the stroke may stand next to the narrow end), so a refresh needs no new one. It knows its edge and
  // its half: a label beside the drawn heads moves with the head of its own half.
  root.querySelectorAll(`g.${OVERLAY_CLASS} polygon.dmap-arrow`).forEach((a) => {
    const head = reservedHead(a);
    const m = head && toRoot(a, root, rootCtm);
    if (head && m) {
      const owner = a.getAttribute('data-dmap-cell');
      const half = a.getAttribute('data-dmap-half');
      out.push({
        kind: 'polygon',
        points: head.map((p) => applyMatrix(m, p)),
        ...(owner && half ? { owner, leg: `${owner}:${half}` } : {}),
      });
    } else {
      rect(a);
    }
  });
  return out;
}

/**
 * The widest stroke that a device body can ever show, in its user units: a fixed value of its original stroke (a
 * stroke binding or the status border, `maxBodyWidth`); an `<image>` has no stroke, only the border of the overlay.
 * It reads nothing that a patch changes, so a status change never needs new obstacles.
 */
function bodyReach(entry: CellEntry): number {
  const shape = entry.shape as SVGElement;
  if (shape.localName === 'image') {
    return statusBorderWidth(0);
  }
  return maxBodyWidth(originalStrokeWidth(shape, entry.original.strokeWidth));
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

const legOf = (
  id: string,
  points: Point[],
  strokeRoot: number,
  minRoot: number,
  head: { headRoot: number; headMinRoot: number },
  arrow: ArrowStyle
): Leg => ({
  id,
  arrow,
  points,
  bends: bendLengths(points),
  length: polylineLength(points),
  strokeRoot,
  minRoot,
  ...head,
});

/**
 * The legs of a link in root units: the root polyline is every vertex of the path through the path's matrix, plus
 * the overlay's split as a vertex. Each leg runs from the end of the link towards the arrowhead (`LegInput`).
 */
function edgeLegs(
  entry: CellEntry,
  root: SVGSVGElement,
  max: number,
  halves: { a2b: boolean; b2a: boolean },
  min = max,
  arrow: ArrowStyle = 'point',
  rootCtm?: Matrix
): EdgeLegs {
  const line = entry.line!;
  const id = entry.meta.id;
  const m = toRoot(line, root, rootCtm);
  if (!m) {
    return {};
  }
  const pts = parsePathPoints(line.getAttribute('d') ?? '').map((p) => applyMatrix(m, p));
  if (pts.length < 2 || !(polylineLength(pts) > 0)) {
    return {};
  }
  const strokeRoot = max * scaleOf(m);
  const minRoot = Math.min(min, max) * scaleOf(m);
  // the bases of the widest and of the thinnest arrow head, through the same scale as the widest stroke
  const head = {
    headRoot: headSize(max, max, arrow).base * scaleOf(m),
    headMinRoot: headSize(min, max, arrow).base * scaleOf(m),
  };
  if (halves.a2b && halves.b2a) {
    // the split in path-local arc length, as the overlay computes it against its own layer (a sibling of the path),
    // then the point in the path's own space, into root units through the same matrix as the vertices
    const mid = linkSplit(pathGeometry(line, line.parentNode as SVGGraphicsElement), max);
    const local = pathGeometry(line, line).pointAt(mid);
    const { at, point } = nearestOnPolyline(pts, applyMatrix(m, { x: local.x, y: local.y }));
    return {
      a2b: legOf(`${id}:a2b`, [...pts.slice(0, at + 1), point], strokeRoot, minRoot, head, arrow),
      b2a: legOf(`${id}:b2a`, [...pts.slice(at + 1).reverse(), point], strokeRoot, minRoot, head, arrow),
    };
  }
  return halves.a2b
    ? { a2b: legOf(`${id}:a2b`, pts, strokeRoot, minRoot, head, arrow) }
    : { b2a: legOf(`${id}:b2a`, [...pts].reverse(), strokeRoot, minRoot, head, arrow) };
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

/**
 * The halo colour: the computed `background-color` of the root svg (draw.io writes the page background there; the
 * browser has resolved `light-dark()` with the colour scheme of the panel), else the canvas colour of the theme when
 * the root has none (transparent) or it cannot be read. One colour per pass: never a guess from the shapes below.
 */
export function haloColour(root: SVGSVGElement, theme: GrafanaTheme2): string {
  const value = typeof getComputedStyle === 'function' ? getComputedStyle(root).backgroundColor.trim() : '';
  return opaqueColour(value) ?? theme.colors.background.canvas;
}

/** An rgb colour as a computed style writes it: `rgb(r, g, b)`, `rgb(r g b)`, `rgba(r, g, b, a)` or `rgb(r g b / a)`. */
const RGB = /^rgba?\(\s*[\d.]+(?:\s*,\s*|\s+)[\d.]+(?:\s*,\s*|\s+)[\d.]+(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i;

/** The colour when it is an rgb colour with alpha 1, else undefined: `transparent`, an empty value, a keyword. */
function opaqueColour(value: string): string | undefined {
  return RGB.test(value) && alphaOf(value) === 1 ? value : undefined;
}

function paint(rec: LabelRecord, theme: GrafanaTheme2, halo: string): void {
  rec.el?.setAttribute('fill', theme.colors.text.primary);
  rec.el?.setAttribute('stroke', halo);
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
  paint(rec, layout.theme, layout.halo);
  return el;
}

const SIDE_NAMES = {
  '0': 'line',
  '1': 'top',
  '-1': 'bottom',
  '2': 'top-wide',
  '-2': 'bottom-wide',
  '3': 'top-head',
  '-3': 'bottom-head',
  '4': 'top-head-wide',
  '-4': 'bottom-head-wide',
} as const;
function position(layout: LabelLayout, rec: LabelRecord, placed: Placed): void {
  const el = ensureElement(layout, rec);
  el.setAttribute('data-dmap-side', SIDE_NAMES[placed.side]);
  el.setAttribute('data-dmap-placed-at', String(++stamp));
  draw(rec, placed);
}

/** Writes the geometry of a placed label: the text at the drawn stroke. The cut in the stroke is `syncCuts`. */
function draw(rec: LabelRecord, placed: Placed): void {
  const el = rec.el;
  if (!el) {
    return;
  }
  const at = drawnCentre(placed, rec.drawn, rec.head);
  const x = fmt(at.x);
  const y = fmt(at.y);
  el.setAttribute('x', x);
  el.setAttribute('y', y);
  el.setAttribute('transform', turnOf(placed.degrees, at));
}

const turnOf = (degrees: number, at: Point) => `rotate(${fmt(degrees)} ${fmt(at.x)} ${fmt(at.y)})`;

/* ---------- the cut in the stroke ---------- */

/** the cut stands this far beyond each end of the text */
const CUT_PAD = 1.5;

/**
 * The text of a label along its own axis: the length and the centre (in the x of the text element, before its
 * rotation). The painted box of the glyphs when it can be read, else the slot centred on the anchor. The slot of a
 * percent label is the width of ">999%", so a short text such as "<1%" would get a cut that is too long.
 */
function textSpan(rec: LabelRecord, at: Point): { centre: number; length: number } {
  const el = rec.el as (SVGGraphicsElement & { getBBox?: () => DOMRect }) | undefined;
  try {
    const b = typeof el?.getBBox === 'function' ? el.getBBox() : undefined;
    if (b && b.width > 0 && Number.isFinite(b.x) && Number.isFinite(b.width)) {
      return { centre: b.x + b.width / 2, length: b.width };
    }
  } catch {
    // no layout: the slot
  }
  return { centre: at.x, length: rec.slot! };
}

/** Takes the cut off every half of the stage. The overlay never writes a dash pattern, so every one is a cut. */
function dropCuts(root: SVGSVGElement): void {
  root.querySelectorAll(`g.${OVERLAY_CLASS} .dmap-half[stroke-dasharray]`).forEach((el) => {
    el.removeAttribute('stroke-dasharray');
  });
}

/** The parsed `points` of a half, with the attribute they came from: the overlay writes a new string for new points. */
const parsedPoints = new WeakMap<Element, { attr: string; pts: Point[] }>();

/** The points of a `points` attribute, parsed once per attribute value. */
function pointsOf(el: Element): Point[] {
  const attr = el.getAttribute('points') ?? '';
  const known = parsedPoints.get(el);
  if (known && known.attr === attr) {
    return known.pts;
  }
  const nums = attr
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const pts: Point[] = [];
  for (let i = 1; i < nums.length; i += 2) {
    pts.push({ x: nums[i - 1], y: nums[i] });
  }
  const out = pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : [];
  parsedPoints.set(el, { attr, pts: out });
  return out;
}

/** The arc length of the point of a polyline nearest to `p`, and the distance of `p` to it. */
function arcOf(pts: Point[], p: Point): { at: number; distance: number } {
  const { at, point } = nearestOnPolyline(pts, p);
  let arc = 0;
  for (let i = 1; i <= at; i++) {
    arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return {
    at: arc + Math.hypot(point.x - pts[at].x, point.y - pts[at].y),
    distance: Math.hypot(point.x - p.x, point.y - p.y),
  };
}

/**
 * The dash pattern of a polyline of length `total` with gaps at `cuts` (arc lengths from its first point), or
 * undefined without a gap. The last dash runs past the end, so the pattern never repeats on the line.
 */
export function cutPattern(cuts: Array<[number, number]>, total: number): string | undefined {
  const merged: Array<[number, number]> = [];
  for (const [from, to] of cuts
    .map(([a, b]): [number, number] => [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else {
      merged.push([from, to]);
    }
  }
  if (!merged.length) {
    return undefined;
  }
  const out: number[] = [];
  let at = 0;
  for (const [from, to] of merged) {
    out.push(from - at, to - from);
    at = to;
  }
  out.push(total - at + 1, 0);
  return out.map(fmt).join(' ');
}

/**
 * The stroke of a link stops under the text of its on-stroke labels, whatever lies behind it (no colour is read): a
 * gap in the dash pattern (`stroke-dasharray`) of each half that the text lies on, as long as the drawn text plus
 * `CUT_PAD` at each end. A stroke cut by a dash pattern has butt ends (the halves are drawn with butt caps), so the
 * gap is exact across the whole width of the stroke. The cut is in the space of the half: the two ends of the text
 * axis are mapped from root units through the inverse of the matrix of the overlay group, then onto the polyline of
 * the half. The arrow heads need no cut: an on-stroke label never stands on a head (each head is an obstacle at its
 * widest). No `<mask>`, no id and no `url()` reference: the links that Safari stopped painting after a long time in
 * the background were the ones whose halves wore a mask. Called after a pass that changed a text, a slot, a drawn
 * width or a placement (`cutsStale`), when the layer flips, and when a font arrives: only the halves of the links
 * with a text on the stroke are read (an overlay layer that was built again in this frame has no cut yet, and a half
 * whose points changed, a new width, gets its pattern again); a cut that is no longer wanted is taken off; an
 * attribute that did not change is not written.
 */
function syncCuts(root: SVGSVGElement, layout: LabelLayout): void {
  layout.cutsStale = false;
  const shown = layout.layer.getAttribute('visibility') !== 'hidden';
  const wanted = new Map<string, LabelRecord[]>();
  for (const rec of layout.records.values()) {
    const placed = rec.placement;
    if (
      shown &&
      placed &&
      'centre' in placed &&
      placed.side === 0 &&
      rec.slot !== undefined &&
      rec.el &&
      rec.el.getAttribute('visibility') !== 'hidden'
    ) {
      wanted.set(rec.cellId, [...(wanted.get(rec.cellId) ?? []), rec]);
    }
  }
  // all the reads first (the matrices and the text boxes), then all the writes: one layout, not one per link
  const patterns = new Map<SVGElement, string | undefined>();
  for (const [el, cell] of layout.cuts) {
    if (!el.isConnected) {
      // a half of an overlay layer that was built again: the new one is below, this one is gone
      layout.cuts.delete(el);
    } else if (!wanted.has(cell)) {
      patterns.set(el, undefined);
    }
  }
  let base: Matrix | undefined;
  for (const [cell, recs] of wanted) {
    const els = overlayHalves(root, cell);
    if (!els.length) {
      continue;
    }
    const space = els[0].parentElement!;
    if (!layout.spaces.has(space)) {
      base ??= screenCtm(root);
      layout.spaces.set(space, toRoot(space, root, base));
    }
    const m = layout.spaces.get(space);
    if (!m) {
      els.forEach((el) => patterns.set(el, undefined));
      continue;
    }
    const back = invert(m);
    // the ends of the text axis of each label, in the space of the halves
    const ends = recs.map((rec) => {
      const placed = rec.placement as Placed;
      const at = drawnCentre(placed, rec.drawn);
      const { centre, length } = textSpan(rec, at);
      const angle = (placed.degrees * Math.PI) / 180;
      const u = { x: Math.cos(angle), y: Math.sin(angle) };
      const mid = { x: at.x + (centre - at.x) * u.x, y: at.y + (centre - at.x) * u.y };
      const reach = length / 2 + CUT_PAD;
      return [
        applyMatrix(back, { x: mid.x - reach * u.x, y: mid.y - reach * u.y }),
        applyMatrix(back, { x: mid.x + reach * u.x, y: mid.y + reach * u.y }),
      ];
    });
    // a text axis on the half lies within half the widest stroke of it (a label on a straight run lies on it)
    const near = layout.max / 2 + 1;
    for (const el of els) {
      const pts = pointsOf(el);
      if (pts.length < 2) {
        patterns.set(el, undefined);
        continue;
      }
      const cuts: Array<[number, number]> = [];
      for (const [p0, p1] of ends) {
        const a = arcOf(pts, p0);
        const b = arcOf(pts, p1);
        if (Math.min(a.distance, b.distance) <= near) {
          cuts.push([a.at, b.at]);
        }
      }
      patterns.set(el, cutPattern(cuts, polylineLength(pts)));
    }
  }
  for (const [el, pattern] of patterns) {
    if (pattern === undefined) {
      el.removeAttribute('stroke-dasharray');
      layout.cuts.delete(el);
    } else {
      if (el.getAttribute('stroke-dasharray') !== pattern) {
        el.setAttribute('stroke-dasharray', pattern);
      }
      layout.cuts.set(el, el.getAttribute('data-dmap-cell') ?? '');
    }
  }
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
  const leg = inputOf(rec, layout.bounds);
  if (!leg) {
    rec.placement = undefined;
    rec.obstacle = undefined;
    return false;
  }
  // an isolated re-placement tries first the near place the other half of the link holds (or held before it
  // dropped); a place away from the stroke is the mate's own, it does not pull this half away from its link
  const mate = layout.records.get(`${rec.cellId}:${rec.which === 'a2b' ? 'b2a' : 'a2b'}`)?.side;
  const sides: readonly LabelSide[] =
    mate === undefined || !NEAR_SIDES.includes(mate)
      ? LABEL_SIDES
      : [mate, ...LABEL_SIDES.filter((side) => side !== mate)];
  return hold(layout, rec, placeHalfLabel(leg, rec.cellId, layout.grid, sides, true));
}

/** The leg of a record with its slot size; undefined when the edge has no geometry or the half has no slot yet. */
function inputOf(rec: LabelRecord, bounds: Rect): LegInput | undefined {
  if (!rec.leg || rec.slot === undefined) {
    return undefined;
  }
  return { ...rec.leg, bounds, size: { width: rec.slot, height: LINK_LABEL_GEOMETRY.fontSize * 1.25 } };
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

/** The bounds of the diagram: the base view box of the stage, else the view box of the root. */
function boundsOfStage(root: SVGSVGElement, base: LinkLabelOptions['bounds']): Rect {
  const vb = base ?? readViewBox(root);
  return { x: vb.x, y: vb.y, width: vb.w, height: vb.h };
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
    halo: haloColour(root, opts.theme),
    grid: obstacleIndex([]),
    widths: new Map(),
    records: new Map(),
    max: opts.linkWidth.max,
    min: opts.linkWidth.min,
    bounds: boundsOfStage(root, opts.bounds),
    // the cuts of the last layout stay on their halves until the sync below takes them off
    cuts: previous?.cuts ?? new Map(),
    spaces: new Map(),
    cutsStale: true,
  };
  // the screen matrix of the root, once for the whole placement
  const rootCtm = screenCtm(root);
  // the legs of every labelled edge first: their pieces are the stroke obstacles of those edges
  const legs = new Map<string, EdgeLegs>();
  for (const slot of slots) {
    if (!legs.has(slot.cellId)) {
      legs.set(
        slot.cellId,
        edgeLegs(
          index.get(slot.cellId)!,
          root,
          opts.linkWidth.max,
          halvesOf(patches, slot.cellId),
          opts.linkWidth.min,
          patches.get(slot.cellId)?.link?.arrow,
          rootCtm
        )
      );
    }
  }
  layout.grid = obstacleIndex(stageObstacles(root, index, patches, opts.linkWidth.max, legs, rootCtm));
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
      ...drawnOf(layout, legs.get(slot.cellId)?.[slot.which], slot.state),
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
      const legA = a && inputOf(a, layout.bounds);
      const legB = b && inputOf(b, layout.bounds);
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

/**
 * The drawn stroke width of a half and the base of its drawn head, in root units: the sizes in the units of the edge,
 * converted as the widest stroke is.
 */
function drawnOf(layout: LabelLayout, leg: Leg | undefined, state: HalfState): { drawn: number; head: number } {
  // the width as the overlay draws it, between linkWidth.min and linkWidth.max: the reservation holds those only
  const width = drawnWidth(state.width, { min: layout.min, max: layout.max });
  const toRootUnits = (v: number) => (leg && layout.max > 0 ? (v * leg.strokeRoot) / layout.max : v);
  return { drawn: toRootUnits(width), head: toRootUnits(headSize(width, layout.max, leg?.arrow ?? 'point').base) };
}

/**
 * The label keeps its spot with its new slot when the box of that slot fits there (`placeAgain`): the grid then holds
 * the new box. False when it does not fit; the grid is as before and the caller places the label again.
 */
function keepSpot(layout: LabelLayout, rec: LabelRecord, placed: Placed): boolean {
  const leg = inputOf(rec, layout.bounds);
  const old = rec.obstacle;
  if (!leg || !old) {
    return false;
  }
  layout.grid.remove(old);
  const again = placeAgain(leg, rec.cellId, layout.grid, placed);
  if (again) {
    hold(layout, rec, again);
    return true;
  }
  layout.grid.add(old);
  return false;
}

/** A placed label that stands on its stroke: its text, slot, width and place set the cut. */
const onStroke = (rec: LabelRecord) => !!rec.placement && 'centre' in rec.placement && rec.placement.side === 0;

/** A label whose element shows its text (`showText`): a hidden one cuts no stroke. */
const shown = (rec: LabelRecord) => !!rec.el && rec.el.getAttribute('visibility') !== 'hidden';

/**
 * A call with the same key: the texts, the hidden state, the theme, and per changed slot the same spot when the slot
 * changed by one grain and the new box fits there, else an isolated re-placement.
 */
function refresh(layout: LabelLayout, slots: Slot[], theme: GrafanaTheme2, root: SVGSVGElement): number {
  let moved = 0;
  const halo = haloColour(root, theme);
  if (layout.theme !== theme || layout.halo !== halo) {
    layout.theme = theme;
    layout.halo = halo;
    for (const rec of layout.records.values()) {
      paint(rec, theme, halo);
    }
  }
  for (const slot of slots) {
    const rec = layout.records.get(`${slot.cellId}:${slot.which}`)!;
    const text = linkLabelText(slot.state, slot.mode);
    const before = {
      onStroke: onStroke(rec),
      placement: rec.placement,
      retry: rec.retry,
      text: rec.el?.textContent,
      shown: shown(rec),
    };
    let changed = false;
    // a changed load changes the drawn width and head: the text moves across the link, on the same side and place
    // along it
    const { drawn, head } = drawnOf(layout, rec.leg, slot.state);
    if (drawn !== rec.drawn || head !== rec.head) {
      rec.drawn = drawn;
      rec.head = head;
      changed = true;
      if (rec.placement && 'centre' in rec.placement) {
        draw(rec, rec.placement);
      }
    }
    const width = slotOf(layout, slot, text);
    const slotChanged = width !== undefined && width !== rec.slot;
    let kept = false;
    if (slotChanged) {
      const held = rec.slot;
      rec.slot = width;
      changed = true;
      // hysteresis: a label that holds a spot keeps it when its slot changes by one grain and its box at the new slot
      // still fits there (a value that goes from two digits to three and back does not move it); a slot that changes
      // by two grains or more goes over the whole ladder again, so a long value that goes away gives the preferred
      // spot back
      const placed = !rec.retry && rec.placement && 'centre' in rec.placement ? rec.placement : undefined;
      if (placed && held !== undefined && Math.abs(width - held) <= SLOT_GRAIN) {
        kept = keepSpot(layout, rec, placed);
      }
    }
    // a changed slot is placed again also while the label is hidden: a stale reservation must never survive
    if ((slotChanged && !kept) || (rec.retry && text !== undefined)) {
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
    // the cut of a stroke follows the text on it: a change of a label on a stroke, a label that came onto one or
    // left it, and a label that hid or came back (a zero load and no data draw at the same width) move a cut
    if (
      changed ||
      rec.placement !== before.placement ||
      rec.retry !== before.retry ||
      shown(rec) !== before.shown ||
      (rec.el?.textContent ?? undefined) !== (before.text ?? undefined)
    ) {
      if (before.onStroke || onStroke(rec)) {
        layout.cutsStale = true;
      }
    }
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
