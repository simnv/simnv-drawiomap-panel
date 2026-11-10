import { vi } from 'vitest';

/*
 * A browser-like client layout for jsdom tests, where every `getBoundingClientRect` is 0 x 0 and ranges have none.
 * An svg element has the box that `pick` gives it, else the union of the boxes of its children. A 100% foreignObject
 * has the box of the viewport, as draw.io HTML labels have in a browser, so a group that holds one has it too. An
 * element that is not in the document has no box, as in a browser.
 *
 * The svg elements also get `getBBox` (the same box) and an identity `getScreenCTM`: root units are client px, so the
 * root-unit road (`paintedBox`) and the client road (`paintedClientBox`) see one layout. `screen` replaces the screen
 * matrix of every svg element (a view box of a diagram with no transforms): the picked boxes are then root units for
 * `getBBox`, and only the root-unit road is right. Undo with `clearFakeLayout`.
 */

const SVG = 'http://www.w3.org/2000/svg';

export const clientRect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;

const NONE = clientRect(0, 0, 0, 0);
const isEmpty = (r: DOMRect) => r.width === 0 && r.height === 0;
const isFluid = (el: Element) => el.localName === 'foreignObject' && /%/.test(el.getAttribute('width') ?? '');

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Mock the layout of every element. Restore it with `clearFakeLayout()`. */
export function fakeLayout(
  pick: (el: Element) => DOMRect | undefined,
  viewport = clientRect(0, 0, 800, 600),
  screen?: () => Matrix
) {
  const boxOf = (el: Element): DOMRect => {
    if (!el.isConnected) {
      return NONE;
    }
    const own = pick(el);
    if (own) {
      return own;
    }
    if (el.namespaceURI !== SVG) {
      // the HTML of a label has no box of its own here; the stage, its wrapper and the page have the viewport
      return el.closest('foreignObject') ? NONE : viewport;
    }
    if (el.localName === 'svg' || isFluid(el)) {
      return viewport;
    }
    let box: DOMRect | undefined;
    for (const child of Array.from(el.children)) {
      const b = boxOf(child);
      if (!isEmpty(b)) {
        box = box
          ? clientRect(
              Math.min(box.left, b.left),
              Math.min(box.top, b.top),
              Math.max(box.right, b.right),
              Math.max(box.bottom, b.bottom)
            )
          : b;
      }
    }
    return box ?? NONE;
  };
  Object.assign(SVGElement.prototype, {
    getBBox(this: SVGElement) {
      const r = boxOf(this);
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    getScreenCTM() {
      return screen ? screen() : IDENTITY;
    },
  });
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxOf(this);
  });
}

export function clearFakeLayout() {
  vi.restoreAllMocks();
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  Reflect.deleteProperty(SVGElement.prototype, 'getScreenCTM');
}

/** Give text ranges a layout, as a browser does: the box of a text node by its text. Undo with `clearTextRanges`. */
export function fakeTextRanges(boxes: Record<string, DOMRect>) {
  Object.assign(Range.prototype, {
    getBoundingClientRect(this: Range) {
      return boxes[this.startContainer.textContent ?? ''] ?? NONE;
    },
  });
}

export const clearTextRanges = () => Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
