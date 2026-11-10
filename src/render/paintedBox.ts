import { applyMatrix, invert, parsePathPoints, toMatrix, toRoot, usable, type Matrix } from './geometry';
import { aabbOf, type Rect } from './labelPlacement';

/*
 * The painted box of a cell: the box of what the cell really draws.
 *
 * draw.io draws an HTML label as `<foreignObject width="100%" height="100%" style="overflow: visible">` in the cell
 * group, and puts the text at its place with a padded flex wrapper. The box of that foreignObject, and so the box of
 * the cell group (`getBBox`, `getBoundingClientRect`, a CSS outline), is the whole viewport. The painted box leaves
 * the 100% foreignObject out and takes the box of the text of the label in its place. An element with no such label
 * inside keeps the box of the engine, so a diagram without HTML labels (portograph, `<text>` labels) gets the same
 * box as before.
 *
 * Two spaces, one walk: `paintedBox` in the user units of the svg root (the label placement, the zoom to cells) and
 * `paintedClientBox` in client pixels (the outline, the badges and the box select of the split editor).
 */

/** The axis-aligned box of `rect` mapped through `m`. A root box and `screenCtm(root)` give the client box. */
export function mapRect(rect: Rect, m: Matrix): Rect {
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

const toRect = (r: { x: number; y: number; width: number; height: number }): Rect => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});
/** A client rectangle by its edges. */
const fromClient = (r: DOMRect): Rect => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
const finite = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite);
const empty = (r: { width: number; height: number } | undefined) => !r || !(r.width > 0) || !(r.height > 0);

/** A foreignObject sized in percent (draw.io: 100% x 100%, overflow visible): its own box is the whole viewport. */
const isFluid = (el: Element) =>
  el.localName === 'foreignObject' && ['width', 'height'].some((a) => (el.getAttribute(a) ?? '').trim().endsWith('%'));

const hasFluid = (el: Element) => Array.from(el.querySelectorAll('foreignObject')).some(isFluid);

/** Label content that draws without a text node: an image, a drawing, a rule or a table (a table can be empty). */
const DRAWN = 'img, svg, canvas, video, picture, iframe, object, embed, hr, table';

/**
 * The box of the HTML content of a fluid foreignObject in client pixels: the union of the line boxes of its text nodes
 * (a range per text node; a range over the elements would add the 1 px wide flex wrapper with its padding that
 * draw.io uses to position the text) and of the elements that draw without text (`DRAWN`). Where ranges have no
 * layout (jsdom), the box of its first element child. The foreignObject box is never used. Undefined when the content
 * has no box.
 */
function htmlClientBox(fo: Element): Rect | undefined {
  let r: Rect | undefined;
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
        r = union(r, fromClient(b));
      }
    }
    for (const el of Array.from(fo.querySelectorAll(DRAWN))) {
      const b = el.getBoundingClientRect();
      if (!empty(b)) {
        r = union(r, fromClient(b));
      }
    }
  } else {
    const b = fo.firstElementChild?.getBoundingClientRect();
    r = b && fromClient(b);
  }
  return r && !empty(r) && finite(r) ? r : undefined;
}

/** The screen matrix of the root, read once per pass and passed down: every `toRoot` of the pass needs it. */
export const screenCtm = (root: SVGSVGElement): Matrix | undefined =>
  typeof root.getScreenCTM === 'function' ? toMatrix(root.getScreenCTM()) : undefined;

/** How one space measures the parts of the walk. */
interface Measure {
  /** The box of an element with no fluid foreignObject inside; null when the engine cannot measure it (walk on). */
  whole: (el: Element) => Rect | undefined | null;
  /** The box of the text of a fluid foreignObject. */
  html: (fo: Element) => Rect | undefined;
  /** An element that `whole` could not measure and that has no children to walk. */
  leaf: (el: Element) => Rect | undefined;
}

const GROUPS = new Set(['g', 'a', 'switch']);

function walk(el: Element, m: Measure): Rect | undefined {
  if (isFluid(el)) {
    return m.html(el);
  }
  // a group with a fluid foreignObject inside: its own box would be the viewport, so take the union of the children
  if (!hasFluid(el)) {
    const whole = m.whole(el);
    if (whole !== null) {
      return whole;
    }
  }
  if (GROUPS.has(el.localName)) {
    let box: Rect | undefined;
    // a switch draws its first usable child: the foreignObject, not the image or the text fallback after it
    const fo =
      el.localName === 'switch' ? Array.from(el.children).find((c) => c.localName === 'foreignObject') : undefined;
    for (const child of fo ? [fo] : Array.from(el.children)) {
      const b = walk(child, m);
      // an empty child (a box of 0 x 0 at the origin) would stretch the union
      if (b && (b.width > 0 || b.height > 0)) {
        box = union(box, b);
      }
    }
    return box;
  }
  return m.leaf(el);
}

/** The painted box of an element in root user units, or undefined when it cannot be read. */
export function paintedBox(el: Element, root: SVGSVGElement, rootCtm?: Matrix): Rect | undefined {
  return walk(el, {
    whole: (part) => {
      const g = part as SVGGraphicsElement;
      if (typeof g.getBBox !== 'function') {
        return null;
      }
      try {
        const m = toRoot(part, root, rootCtm);
        const b = toRect(g.getBBox());
        return m && finite(b) ? mapRect(b, m) : undefined;
      } catch {
        return undefined;
      }
    },
    html: (fo) => {
      const r = htmlClientBox(fo);
      if (!r) {
        return undefined;
      }
      // screen pixels into root units; a root without a screen matrix (jsdom) keeps them as they are
      const base = rootCtm ?? screenCtm(root);
      if (!base) {
        return r;
      }
      return usable(base) ? mapRect(r, invert(base)) : undefined;
    },
    leaf: (part) => {
      const local = attributeBox(part);
      const m = local && toRoot(part, root, rootCtm);
      return local && m ? mapRect(local, m) : undefined;
    },
  });
}

/** The client box of an element, or undefined when it is not finite. */
const clientBox = (el: Element): Rect | undefined => {
  const b = fromClient(el.getBoundingClientRect());
  return finite(b) ? b : undefined;
};

/**
 * The painted box of an element in client pixels, or undefined when it cannot be read. For an element with no
 * HTML label inside, this is its `getBoundingClientRect`.
 */
export function paintedClientBox(el: Element): Rect | undefined {
  return walk(el, { whole: clientBox, html: htmlClientBox, leaf: clientBox });
}
