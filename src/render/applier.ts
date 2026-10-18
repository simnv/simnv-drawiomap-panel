import type { CellEntry, CellIndex, CellPatch, PatchMap } from '../types';
import type { PlanCellPatch } from '../binding/engine';

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

function applyLink(entry: CellEntry, patch: CellPatch): void {
  const l = patch.link;
  if (!l || (!l.a2b && !l.b2a)) {
    return;
  }
  if (entry.line) {
    entry.line.style.strokeOpacity = '0';
  }
  for (const a of entry.arrows) {
    a.style.opacity = '0';
  }
}

function tag(entry: CellEntry, patch: PlanCellPatch, target: string | undefined): void {
  if (target) {
    entry.group.setAttribute('data-dmap-target', target);
  }
  // Keyboard access: Tab moves to the cell, Enter or Space opens its card.
  entry.group.setAttribute('tabindex', '0');
  entry.group.setAttribute('role', 'button');
  entry.group.setAttribute('aria-label', entry.meta.labelText || entry.meta.key);
  if (patch.statusView) {
    const status = patch.statusView;
    entry.group.setAttribute('data-dmap-status', status.state);
    entry.group.setAttribute('data-dmap-reason', status.reason);
    entry.group.setAttribute(
      'aria-label',
      `${entry.meta.labelText || entry.meta.key}: ${status.state}. ${status.reason}`
    );
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
  }
  for (const a of entry.arrows) {
    a.style.opacity = '';
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
  entry.group.removeAttribute('tabindex');
  entry.group.removeAttribute('role');
  entry.group.removeAttribute('aria-label');
}

/** Write patches into the SVG DOM. Returns the ids that are patched now. */
export function applyPatches(index: CellIndex, patches: PatchMap, previous: Set<string>): Set<string> {
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
    applyLink(entry, patch);
    tag(entry, patch, target);
    done.add(id);
  }
  return done;
}
