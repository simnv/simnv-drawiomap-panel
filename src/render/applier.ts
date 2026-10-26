import { createTheme, type GrafanaTheme2 } from '@grafana/data';
import type { CellEntry, CellIndex, CellPatch, HalfState, PatchMap } from '../types';
import type { PlanCellPatch } from '../binding/engine';
import {
  linkStatusPaint,
  STROKE_TARGET_EXTRA,
  statusBorderWidth,
  statusPaint,
  statusPalette,
  tintFill,
} from '../binding/color';
import { clearOwnedAttrs, setOwnedAttrs } from './cellAttrs';
import { originalStrokeWidth } from './geometry';

/** Labels that a patch wrote text into. Only these need a label reset. */
const written = new WeakSet<Element>();

function setText(label: Element | undefined, text: string): void {
  if (!label) {
    return;
  }
  written.add(label);
  if (label.localName === 'g') {
    // A multi-line plain-text label: the first line takes the text, the others are emptied. No
    // element is replaced, so a reference into the group stays attached.
    Array.from(label.children)
      .filter((el) => el.localName === 'text')
      .forEach((line, i) => (line.textContent = i === 0 ? text : ''));
    return;
  }
  if (label.localName === 'text') {
    const spans = label.querySelectorAll('tspan');
    if (spans.length) {
      spans[0].textContent = text;
      for (let i = 1; i < spans.length; i++) {
        spans[i].textContent = '';
      }
    } else {
      label.textContent = text;
    }
    return;
  }
  // foreignObject: write into the deepest element that holds text
  let el: Element = label;
  while (el.children.length === 1) {
    el = el.children[0];
  }
  el.textContent = text;
}

/** Icon cells that a patch coloured, with the patch's node. Only these need an icon reset. */
const iconOwner = new WeakMap<Element, CellEntry>();

type Paint = { value: string; priority: string };

/** The inline declaration (value and priority) of a style property before the first patch wrote it, per element. */
const styleOriginal = new WeakMap<Element, Map<string, Paint>>();

/**
 * Writes an inline style property and keeps the diagram's declaration for the reset. The write takes the priority
 * of that declaration, so an `!important` fill of the diagram stays important while it is painted.
 */
function writeStyle(el: SVGElement, prop: string, value: string): void {
  let props = styleOriginal.get(el);
  if (!props) {
    props = new Map();
    styleOriginal.set(el, props);
  }
  let original = props.get(prop);
  if (!original) {
    original = { value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) };
    props.set(prop, original);
  }
  el.style.setProperty(prop, value, original.priority);
}

/** Puts the diagram's declarations back on `el`: the given properties, else every one a patch wrote. */
function restoreStyle(el: SVGElement, only?: string[]): void {
  const props = styleOriginal.get(el);
  if (!props) {
    return;
  }
  for (const [prop, { value, priority }] of props) {
    if (only && !only.includes(prop)) {
      continue;
    }
    if (value) {
      el.style.setProperty(prop, value, priority);
    } else {
      el.style.removeProperty(prop);
    }
    props.delete(prop);
  }
}

/** The shape that takes the icon colour, or undefined when the node has no usable icon. */
function iconShape(entry: CellEntry, index: CellIndex): SVGElement | undefined {
  const shape = entry.iconId ? index.get(entry.iconId)?.shape : undefined;
  // a bitmap icon has no fill
  return shape && shape.localName !== 'image' ? shape : undefined;
}

/** Colours the target and returns the target that it used (icon falls back to stroke). */
function applyShape(entry: CellEntry, patch: CellPatch, index: CellIndex): string | undefined {
  const s = patch.shape;
  if (!s) {
    return undefined;
  }
  if (s.text !== undefined) {
    setText(entry.label, s.text);
  }
  let target: string = s.target;
  if (target === 'icon') {
    const icon = iconShape(entry, index);
    if (icon) {
      writeStyle(icon, 'fill', s.color);
      iconOwner.set(icon, entry);
      return target;
    }
    target = 'stroke';
  }
  const shape = entry.shape as SVGElement | undefined;
  if (shape && target === 'shape') {
    writeStyle(shape, 'fill', s.color);
  }
  if (shape && target === 'stroke') {
    writeStyle(shape, 'stroke', s.color);
    writeStyle(
      shape,
      'stroke-width',
      String(originalStrokeWidth(shape, entry.original.strokeWidth) + STROKE_TARGET_EXTRA)
    );
  }
  return target;
}

/** The alpha of a CSS colour, 0 to 1. A colour that is not understood, or not a plain colour (url, var), counts as opaque. */
export function colourAlpha(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') {
    return 0;
  }
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);
  const token = (t: string) => {
    const x = t.trim();
    if (x === 'none') {
      return 0;
    }
    return clamp(x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x));
  };
  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) {
      return 1;
    }
    if (hex.length === 4) {
      return parseInt(hex[3] + hex[3], 16) / 255;
    }
    return hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  }
  const fn = /^[a-z-]+\((.*)\)$/s.exec(v);
  if (!fn) {
    return 1;
  }
  const body = fn[1];
  if (body.includes('/')) {
    return token(body.split('/').pop()!);
  }
  if (body.includes(',')) {
    const parts = body.split(',');
    return parts.length === 4 ? token(parts[3]) : 1;
  }
  return 1;
}

/** The effective value of a paint property: inline style, then the computed style (CSS rules), then the attribute. */
function effective(m: SVGElement, prop: string, fallback: string): string {
  const inline = m.style.getPropertyValue(prop).trim();
  if (inline) {
    return inline;
  }
  let computed = '';
  try {
    computed = getComputedStyle(m).getPropertyValue(prop).trim();
  } catch {
    // no computed style in this host
  }
  return computed || (m.getAttribute(prop) ?? '').trim() || fallback;
}

/** True when the marker paints `prop` (fill or stroke): a colour that is not none or transparent, with some opacity. */
function paints(m: SVGElement, prop: 'fill' | 'stroke'): boolean {
  if (colourAlpha(effective(m, prop, prop === 'fill' ? 'black' : 'none')) <= 0) {
    return false;
  }
  return [`${prop}-opacity`, 'opacity'].every((o) => colourAlpha(effective(m, o, '1')) > 0);
}

/**
 * Paints the end markers (the dot of a bare end) with the colour that `colourAt` gives for their end: the colour of
 * the half that they close, or the status colour of the link when its status paints (`linkStatusPaint`).
 */
function paintEnds(entry: CellEntry, colourAt: (end: 'start' | 'end') => string | undefined): void {
  for (const { el: marker, end } of entry.ends ?? []) {
    const m = marker as SVGElement;
    const colour = colourAt(end);
    if (!colour) {
      continue;
    }
    for (const prop of ['fill', 'stroke'] as const) {
      if (paints(m, prop)) {
        writeStyle(m, prop, colour);
      }
    }
  }
}

/** The halves of a link, or the status colour of a link without halves (`status` is `linkStatusPaint`). */
function applyLink(entry: CellEntry, patch: CellPatch, status: string | undefined): void {
  const l = patch.link;
  if (!l || (!l.a2b && !l.b2a)) {
    // a status rule on an edge with no link binding: the stroke and the end dots take the status colour, as the
    // no-data grey does for the stroke
    if (status) {
      if (entry.line) {
        writeStyle(entry.line, 'stroke', status);
      }
      paintEnds(entry, () => status);
    }
    return;
  }
  paintEnds(entry, (end) => status ?? (end === 'start' ? (l.a2b ?? l.b2a) : (l.b2a ?? l.a2b))?.color);
  if (entry.line) {
    entry.line.style.strokeOpacity = '0';
  }
  for (const a of entry.arrows) {
    a.style.opacity = '0';
  }
}

/**
 * The fill of `shape` mixed with the status colour. The computed fill is the one the shape shows (`light-dark()` and
 * `var()` resolved for the colour scheme of the root); a host without one gives the inline style, then the attribute.
 * Undefined when that fill is not an opaque colour: the border alone shows the status then.
 */
function tintedFill(shape: SVGElement, status: string): string | undefined {
  let computed = '';
  try {
    computed = getComputedStyle(shape).getPropertyValue('fill').trim();
  } catch {
    // no computed style in this host
  }
  const fills = computed ? [computed] : [shape.style.getPropertyValue('fill'), shape.getAttribute('fill') ?? ''];
  for (const fill of fills) {
    const tint = fill ? tintFill(fill, status) : undefined;
    if (tint) {
      return tint;
    }
  }
  return undefined;
}

/**
 * A device whose status is not normal: a border in the status colour, wider than the stroke the shape had
 * (`width`, read before the shape binding wrote its own), and a light tint of the fill it shows now. It runs after
 * `applyShape`, so the border wins over a `stroke` target and the tint goes over a `shape` target. A bitmap device
 * (an `<image>`) takes no fill and no stroke: the overlay draws its border (`renderOverlay`).
 */
function applyStatus(entry: CellEntry, patch: PlanCellPatch, width: number, theme: GrafanaTheme2): void {
  const shape = entry.shape as SVGElement | undefined;
  const paint = entry.line || shape?.localName === 'image' ? undefined : statusPaint(patch.statusView, theme);
  if (!shape || !paint) {
    return;
  }
  writeStyle(shape, 'stroke', paint);
  writeStyle(shape, 'stroke-width', String(statusBorderWidth(width)));
  const tint = tintedFill(shape, paint);
  if (tint) {
    writeStyle(shape, 'fill', tint);
  }
}

/**
 * A cell that is configured but cannot bind: the no-data colour on the fill of a node or the stroke of a link. The
 * patch exists, so the reset of the next apply never puts the drawn fill (for example green) back by mistake.
 */
function applyUnavailable(entry: CellEntry, patch: CellPatch): void {
  const u = patch.unavailable;
  if (!u) {
    return;
  }
  if (entry.line) {
    writeStyle(entry.line, 'stroke', u.color);
  } else if (entry.shape) {
    writeStyle(entry.shape as SVGElement, 'fill', u.color);
  }
}

function tag(entry: CellEntry, patch: PlanCellPatch, target: string | undefined, interactive: boolean): void {
  if (target) {
    entry.group.setAttribute('data-dmap-target', target);
  }
  // Keyboard access: Tab moves to the cell, Enter or Space opens its card. A cell without a card is not a button.
  // tabindex, role and aria-label go into the applier layer: the binding editor writes the same attributes.
  const label = entry.meta.title || entry.meta.labelText || entry.meta.key;
  const view = patch.unavailable ? { state: 'unavailable', reason: patch.unavailable.reason } : patch.statusView;
  setOwnedAttrs(entry.group, 'applier', {
    ...(interactive ? { tabindex: '0', role: 'button' } : {}),
    'aria-label': view ? `${label}: ${view.state}. ${view.reason}` : label,
  });
  if (view) {
    entry.group.setAttribute('data-dmap-status', view.state);
    entry.group.setAttribute('data-dmap-reason', view.reason);
    return;
  }
  const states = [patch.shape, patch.link?.a2b, patch.link?.b2a].filter(Boolean) as Array<{
    status: string;
    stepIndex: number;
  }>;
  if (!states.length) {
    return;
  }
  const status = states.some((s) => s.status === 'ok')
    ? 'ok'
    : states.some((s) => s.status === 'unbound')
      ? 'unbound'
      : 'nodata';
  const step = Math.max(...states.map((s) => s.stepIndex));
  entry.group.setAttribute('data-dmap-status', status);
  entry.group.setAttribute('data-dmap-step', String(step));
}

function reset(entry: CellEntry, index: CellIndex): void {
  const shape = entry.shape as SVGElement | undefined;
  if (shape) {
    restoreStyle(shape);
  }
  const iconEntry = entry.iconId ? index.get(entry.iconId) : undefined;
  const icon = iconEntry?.shape as SVGElement | undefined;
  if (icon && iconOwner.get(icon) === entry) {
    restoreStyle(icon, ['fill']);
    iconOwner.delete(icon);
  }
  if (entry.line) {
    entry.line.style.strokeOpacity = '';
    restoreStyle(entry.line);
  }
  for (const a of entry.arrows) {
    a.style.opacity = '';
  }
  for (const { el: marker } of entry.ends ?? []) {
    restoreStyle(marker as SVGElement);
  }
  const label = entry.label;
  if (label && written.has(label)) {
    const nodes = entry.original.labelNodes;
    if (label.localName === 'g' && nodes) {
      // A multi-line plain-text label: put each line's text back in place.
      const originals = nodes.filter((n) => (n as Element).localName === 'text');
      Array.from(label.children)
        .filter((el) => el.localName === 'text')
        .forEach((line, i) =>
          line.replaceChildren(...Array.from(originals[i]?.childNodes ?? [], (n) => n.cloneNode(true)))
        );
    } else if (nodes) {
      // Put back the exact markup: a text write flattens the HTML lines of a foreignObject label.
      label.replaceChildren(...nodes.map((n) => n.cloneNode(true)));
    } else if (entry.original.text !== undefined) {
      setText(label, entry.original.text);
    }
    written.delete(label);
  }
  entry.group.removeAttribute('data-dmap-status');
  entry.group.removeAttribute('data-dmap-reason');
  entry.group.removeAttribute('data-dmap-step');
  entry.group.removeAttribute('data-dmap-target');
  clearOwnedAttrs(entry.group, 'applier');
}

/**
 * The two inputs a `light-dark()` paint resolves against: the Grafana theme, which the panel writes as the
 * `color-scheme` of the root, and the OS preference, which an element that sets its own `color-scheme` follows.
 * `paints()` reads the effective paint of an end marker, so a change of either must evaluate every cell again.
 */
export interface ColourScheme {
  isDark: boolean;
  osDark: boolean;
  /** the status colours of the theme (`statusPalette`): a theme with another palette paints every cell again */
  palette: string;
}

/** What an apply runs under: the theme (its colour scheme, and the status colours) and the OS preference. */
export interface ApplyContext {
  theme: GrafanaTheme2;
  osDark: boolean;
}

let fallbackTheme: GrafanaTheme2 | undefined;
/** The context of a call without one (the tests): the default theme of `createTheme()`, no OS preference. */
const defaultContext = (): ApplyContext => ({ theme: (fallbackTheme ??= createTheme()), osDark: false });

/** What one apply left in the DOM: the key of the applied patch per cell, for the index and the colour scheme it ran under. */
export interface Applied {
  index: CellIndex;
  scheme: ColourScheme;
  keys: Map<string, string>;
}

const sameScheme = (a: ColourScheme, b: ColourScheme) =>
  a.isDark === b.isDark && a.osDark === b.osDark && a.palette === b.palette;

/**
 * The fields of a patch that the writes above read, as one string. Two patches with the same key draw the same
 * picture, so a cell whose key did not change is not touched on a refresh. The cell label of `aria-label` comes
 * from the entry, constant per index.
 */
export function applyKey(patch: PlanCellPatch, interactive: boolean): string {
  const half = (h: HalfState | undefined) => (h ? [h.status, h.color, h.width, h.stepIndex] : null);
  const s = patch.shape;
  const u = patch.unavailable;
  const l = patch.link;
  const v = patch.statusView;
  return JSON.stringify([
    s ? [s.status, s.stepIndex, s.target, s.color, s.text ?? null] : null,
    u ? [u.color, u.reason] : null,
    l ? [half(l.a2b), half(l.b2a)] : null,
    v ? [v.state, v.reason] : null,
    interactive,
  ]);
}

/**
 * Write patches into the SVG DOM and return what is applied now. Only the `interactive` cells become buttons;
 * without the set, all patched cells do. A cell whose key equals the one of `previous` is not touched; `previous`
 * of another index counts as empty (a new stage has new elements), and another colour scheme (the theme or the OS
 * preference) resets and writes every cell.
 */
export function applyPatches(
  index: CellIndex,
  patches: PatchMap,
  previous?: Applied,
  interactive?: Set<string>,
  ctx: ApplyContext = defaultContext()
): Applied {
  const scheme: ColourScheme = { isDark: ctx.theme.isDark, osDark: ctx.osDark, palette: statusPalette(ctx.theme) };
  const same = previous?.index === index;
  const before = same ? previous.keys : new Map<string, string>();
  const all = same && !sameScheme(previous.scheme, scheme);
  const keys = new Map<string, string>();
  const changed = new Set<string>();
  for (const [id, patch] of patches) {
    if (!index.has(id)) {
      continue;
    }
    const key = applyKey(patch, !interactive || interactive.has(id));
    keys.set(id, key);
    if (all || before.get(id) !== key) {
      changed.add(id);
    }
  }
  for (const id of before.keys()) {
    if (all || !keys.has(id)) {
      changed.add(id);
    }
  }
  // A node colours the shape of its icon cell, and the reset of the icon cell puts the icon's own fill back. A part
  // of a node (its icon, a description) leads to its node, and a node to its icon: the closure over both relations
  // changes together, else a cell that is skipped loses its paint.
  const queue = [...changed];
  while (queue.length) {
    const entry = index.get(queue.pop()!);
    for (const other of [entry?.iconId, entry?.ownerId]) {
      if (other && !changed.has(other) && (keys.has(other) || before.has(other))) {
        changed.add(other);
        queue.push(other);
      }
    }
  }
  // Reset everything first: a node colours the shape of another cell (its icon), so a later reset must not undo it.
  for (const id of changed) {
    const entry = before.has(id) ? index.get(id) : undefined;
    if (entry) {
      reset(entry, index);
    }
  }
  for (const [id, patch] of patches) {
    const entry = changed.has(id) ? index.get(id) : undefined;
    if (!entry) {
      continue;
    }
    // the width the shape had, before the shape binding writes its own
    const width = entry.shape && !entry.line ? originalStrokeWidth(entry.shape, entry.original.strokeWidth) : 0;
    const target = applyShape(entry, patch, index);
    applyUnavailable(entry, patch);
    applyLink(entry, patch, linkStatusPaint(patch, ctx.theme));
    applyStatus(entry, patch, width, ctx.theme);
    tag(entry, patch, target, !interactive || interactive.has(id));
  }
  return { index, scheme, keys };
}

export const INTERACTIVE_ATTR = 'data-dmap-interactive';

/** The cells that `markInteractive` marked, for the index it marked them in. */
export interface Marked {
  index: CellIndex;
  ids: Set<string>;
}

/**
 * Marks the cells that open a card (the panel CSS gives them the hand cursor) and returns what is marked now. A cell
 * that was marked before is not written again; `previous` of another index counts as empty, as in `applyPatches`.
 */
export function markInteractive(index: CellIndex, ids: Set<string>, previous?: Marked): Marked {
  const before = previous?.index === index ? previous.ids : new Set<string>();
  for (const id of before) {
    if (!ids.has(id)) {
      index.get(id)?.group.removeAttribute(INTERACTIVE_ATTR);
    }
  }
  const marked = new Set<string>();
  for (const id of ids) {
    const entry = index.get(id);
    if (entry) {
      if (!before.has(id)) {
        entry.group.setAttribute(INTERACTIVE_ATTR, '');
      }
      marked.add(id);
    }
  }
  return { index, ids: marked };
}
