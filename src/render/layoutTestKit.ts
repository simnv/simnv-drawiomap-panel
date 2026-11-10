import { vi } from 'vitest';

/*
 * A browser-like client layout for jsdom tests, where every `getBoundingClientRect` is 0 x 0 and ranges have none.
 * An svg element has the box that `pick` gives it, else the union of the boxes of its children. A 100% foreignObject
 * has the box of the viewport, as draw.io HTML labels have in a browser, so a group that holds one has it too.
 */

const SVG = 'http://www.w3.org/2000/svg';

export const clientRect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;

const NONE = clientRect(0, 0, 0, 0);
const isEmpty = (r: DOMRect) => r.width === 0 && r.height === 0;
const isFluid = (el: Element) => el.localName === 'foreignObject' && /%/.test(el.getAttribute('width') ?? '');

/** Mock `getBoundingClientRect` of every element. Restore it with `vi.restoreAllMocks()`. */
export function fakeLayout(pick: (el: Element) => DOMRect | undefined, viewport = clientRect(0, 0, 800, 600)) {
  const boxOf = (el: Element): DOMRect => {
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
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxOf(this);
  });
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
