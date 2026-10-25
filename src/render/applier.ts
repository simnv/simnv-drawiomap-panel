import type { CellEntry, CellIndex, CellPatch, PatchMap } from '../types';
import type { PlanCellPatch } from '../binding/engine';
import { clearOwnedAttrs, setOwnedAttrs } from './cellAttrs';

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
      icon.style.fill = s.color;
      iconOwner.set(icon, entry);
      return target;
    }
    target = 'stroke';
  }
  const shape = entry.shape as SVGElement | undefined;
  if (shape && target === 'shape') {
    shape.style.fill = s.color;
  }
  if (shape && target === 'stroke') {
    shape.style.stroke = s.color;
    shape.style.strokeWidth = String((parseFloat(shape.getAttribute('stroke-width') ?? '') || 1) + 1);
  }
  return target;
}

type Paint = { value: string; priority: string };

/** The inline paint of an end marker before the first patch, so that a reset puts it back with its priority. */
const endOriginal = new WeakMap<Element, { fill: Paint; stroke: Paint }>();

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

const snapshot = (m: SVGElement, prop: 'fill' | 'stroke'): Paint => ({
  value: m.style.getPropertyValue(prop),
  priority: m.style.getPropertyPriority(prop),
});

/** Paints the end markers (the dot of a bare end) with the colour of the half that they close. */
function paintEnds(entry: CellEntry, l: NonNullable<CellPatch['link']>): void {
  for (const { el: marker, end } of entry.ends ?? []) {
    const m = marker as SVGElement;
    const half = end === 'start' ? (l.a2b ?? l.b2a) : (l.b2a ?? l.a2b);
    if (!half) {
      continue;
    }
    if (!endOriginal.has(m)) {
      endOriginal.set(m, { fill: snapshot(m, 'fill'), stroke: snapshot(m, 'stroke') });
    }
    for (const prop of ['fill', 'stroke'] as const) {
      if (paints(m, prop)) {
        m.style.setProperty(prop, half.color, endOriginal.get(m)![prop].priority);
      }
    }
  }
}

function applyLink(entry: CellEntry, patch: CellPatch): void {
  const l = patch.link;
  if (!l || (!l.a2b && !l.b2a)) {
    return;
  }
  paintEnds(entry, l);
  if (entry.line) {
    entry.line.style.strokeOpacity = '0';
  }
  for (const a of entry.arrows) {
    a.style.opacity = '0';
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
    entry.line.style.stroke = u.color;
  } else if (entry.shape) {
    (entry.shape as SVGElement).style.fill = u.color;
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
    shape.style.fill = entry.original.fill ?? '';
    shape.style.stroke = entry.original.stroke ?? '';
    if (!entry.line) {
      shape.style.strokeWidth = entry.original.strokeWidth ?? '';
    }
  }
  const iconEntry = entry.iconId ? index.get(entry.iconId) : undefined;
  const icon = iconEntry?.shape as SVGElement | undefined;
  if (icon && iconOwner.get(icon) === entry) {
    icon.style.fill = iconEntry!.original.fill ?? '';
    iconOwner.delete(icon);
  }
  if (entry.line) {
    entry.line.style.strokeOpacity = '';
    entry.line.style.strokeWidth = entry.original.strokeWidth ?? '';
    entry.line.style.stroke = entry.original.stroke ?? '';
  }
  for (const a of entry.arrows) {
    a.style.opacity = '';
  }
  for (const { el: marker } of entry.ends ?? []) {
    const original = endOriginal.get(marker);
    if (original) {
      for (const prop of ['fill', 'stroke'] as const) {
        const { value, priority } = original[prop];
        if (value) {
          (marker as SVGElement).style.setProperty(prop, value, priority);
        } else {
          (marker as SVGElement).style.removeProperty(prop);
        }
      }
      endOriginal.delete(marker);
    }
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
 * Write patches into the SVG DOM. Returns the ids that are patched now. Only the `interactive` cells become
 * buttons; without the set, all patched cells do.
 */
export function applyPatches(
  index: CellIndex,
  patches: PatchMap,
  previous: Set<string>,
  interactive?: Set<string>
): Set<string> {
  const done = new Set<string>();
  // Reset everything first: a node colours the shape of another cell (its icon), so a later reset must not undo it.
  for (const id of previous) {
    const entry = index.get(id);
    if (entry) {
      reset(entry, index);
    }
  }
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    if (!entry) {
      continue;
    }
    const target = applyShape(entry, patch, index);
    applyUnavailable(entry, patch);
    applyLink(entry, patch);
    tag(entry, patch, target, !interactive || interactive.has(id));
    done.add(id);
  }
  return done;
}

export const INTERACTIVE_ATTR = 'data-dmap-interactive';

/** Marks the cells that open a card (the panel CSS gives them the hand cursor). Returns the ids that are marked now. */
export function markInteractive(index: CellIndex, ids: Set<string>, previous: Set<string>): Set<string> {
  for (const id of previous) {
    if (!ids.has(id)) {
      index.get(id)?.group.removeAttribute(INTERACTIVE_ATTR);
    }
  }
  const done = new Set<string>();
  for (const id of ids) {
    const entry = index.get(id);
    if (entry) {
      entry.group.setAttribute(INTERACTIVE_ATTR, '');
      done.add(id);
    }
  }
  return done;
}
