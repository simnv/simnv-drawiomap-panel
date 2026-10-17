import type { CellEntry, CellIndex, CellPatch, PatchMap } from '../types';

/** Labels that a patch wrote text into. Only these need a label reset. */
const written = new WeakSet<Element>();

function setText(label: Element | undefined, text: string): void {
  if (!label) {
    return;
  }
  written.add(label);
  if (label.localName === 'g') {
    // A multi-line plain-text label: the first line takes the text, the others are removed. Reset
    // puts the original lines back from the clones.
    const lines = Array.from(label.children).filter((el) => el.localName === 'text');
    lines.slice(1).forEach((l) => l.remove());
    setText(lines[0], text);
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

function applyShape(entry: CellEntry, patch: CellPatch): void {
  const s = patch.shape;
  if (!s) {
    return;
  }
  const shape = entry.shape as SVGElement | undefined;
  if (shape) {
    if (s.fill) {
      shape.style.fill = s.color;
    }
    if (s.stroke) {
      shape.style.stroke = s.color;
    }
  }
  if (s.text !== undefined) {
    setText(entry.label, s.text);
  }
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

function tag(entry: CellEntry, patch: CellPatch): void {
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

function reset(entry: CellEntry): void {
  const shape = entry.shape as SVGElement | undefined;
  if (shape) {
    shape.style.fill = entry.original.fill ?? '';
    shape.style.stroke = entry.original.stroke ?? '';
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
    if (nodes) {
      // Put back the exact markup: a text write flattens the HTML lines of a foreignObject label.
      label.replaceChildren(...nodes.map((n) => n.cloneNode(true)));
    } else if (entry.original.text !== undefined) {
      setText(label, entry.original.text);
    }
    written.delete(label);
  }
  entry.group.removeAttribute('data-dmap-status');
  entry.group.removeAttribute('data-dmap-step');
}

/** Write patches into the SVG DOM. Returns the ids that are patched now. */
export function applyPatches(index: CellIndex, patches: PatchMap, previous: Set<string>): Set<string> {
  const done = new Set<string>();
  for (const id of previous) {
    if (!patches.has(id)) {
      const entry = index.get(id);
      if (entry) {
        reset(entry);
      }
    }
  }
  for (const [id, patch] of patches) {
    const entry = index.get(id);
    if (!entry) {
      continue;
    }
    if (previous.has(id)) {
      reset(entry);
    }
    applyShape(entry, patch);
    applyLink(entry, patch);
    tag(entry, patch);
    done.add(id);
  }
  return done;
}
