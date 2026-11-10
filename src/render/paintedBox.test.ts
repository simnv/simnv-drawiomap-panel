import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearTextRanges, clientRect, fakeLayout, fakeTextRanges } from './layoutTestKit';
import { paintedBox, paintedClientBox } from './paintedBox';

const SVG = 'http://www.w3.org/2000/svg';
const handHtml = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/hand-html-labels.svg'), 'utf8');

/** The svg in the document, so that `closest` and `ownerSVGElement` work. */
function mount(text: string): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = text.replace(/^<\?xml[^>]*>\s*<!DOCTYPE[^>]*>\s*/, '');
  document.body.appendChild(host);
  return host.querySelector('svg')!;
}
const cell = (root: Element, id: string) => root.querySelector(`[data-cell-id="${id}"]`)!;
const rect = (x: number, y: number, width: number, height: number) => clientRect(x, y, x + width, y + height);

afterEach(() => {
  vi.restoreAllMocks();
  clearTextRanges();
  document.body.innerHTML = '';
});

describe('paintedClientBox', () => {
  it('a cell without an HTML label: the client box of its group, as before', () => {
    const root = mount(
      `<svg xmlns="${SVG}"><g data-cell-id="a"><rect width="10" height="10"/><text x="1" y="8">a</text></g></svg>`
    );
    const group = cell(root, 'a');
    fakeLayout((el) => (el === group ? rect(10, 20, 120, 60) : undefined));
    expect(paintedClientBox(group)).toEqual({ x: 10, y: 20, width: 120, height: 60 });
  });

  it('a cell with an HTML label: the shape and the text of the label, not the 100% foreignObject', () => {
    const root = mount(handHtml);
    const shape = cell(root, 'node-a').querySelector('rect')!;
    fakeLayout((el) => (el === shape ? rect(100, 50, 120, 60) : undefined));
    fakeTextRanges({ 'rtr-a': rect(145, 72, 30, 14) });
    expect(paintedClientBox(cell(root, 'node-a'))).toEqual({ x: 100, y: 50, width: 120, height: 60 });
  });

  it('a label text outside of the shape widens the box; the fallback text of the switch does not count', () => {
    const root = mount(handHtml);
    const group = cell(root, 'edge-ab');
    const paths = group.querySelectorAll('path');
    const fallback = group.querySelector('switch > text')!;
    fakeLayout((el) =>
      el === paths[0]
        ? rect(120, 30, 194, 30)
        : el === paths[1]
          ? rect(312, 56, 7, 7)
          : el === fallback
            ? rect(-500, -500, 10, 10)
            : undefined
    );
    fakeTextRanges({ uplink: rect(205, 20, 32, 13) });
    expect(paintedClientBox(group)).toEqual({ x: 120, y: 20, width: 199, height: 43 });
  });

  it('a text cell with an empty shape: the text of the label', () => {
    const root = mount(handHtml);
    // a shape that is not drawn (display: none) has an empty box at the origin: it does not stretch the union
    fakeLayout((el) => (el.localName === 'rect' ? rect(0, 0, 0, 0) : undefined));
    fakeTextRanges({ 'site 23 uplinks': rect(180, 210, 80, 14) });
    expect(paintedClientBox(cell(root, 'note'))).toEqual({ x: 180, y: 210, width: 80, height: 14 });
  });

  it('without text ranges (jsdom), the first element child of the foreignObject stands for the text', () => {
    const root = mount(handHtml);
    const group = cell(root, 'note');
    const wrapper = group.querySelector('foreignObject > div')!;
    fakeLayout((el) =>
      el.localName === 'rect' ? rect(0, 0, 0, 0) : el === wrapper ? rect(170, 205, 100, 20) : undefined
    );
    expect(paintedClientBox(group)).toEqual({ x: 170, y: 205, width: 100, height: 20 });
  });

  it('an HTML label with no text box and no shape: no box', () => {
    const root = mount(handHtml);
    fakeLayout(() => rect(0, 0, 0, 0));
    expect(paintedClientBox(cell(root, 'note'))).toBeUndefined();
  });
});

describe('paintedBox (root units)', () => {
  it('a cell without an HTML label: the box of the group from getBBox, as before', () => {
    const root = mount(
      `<svg xmlns="${SVG}"><g data-cell-id="a" transform="translate(5 7)"><rect width="10" height="10"/></g></svg>`
    );
    const group = cell(root, 'a');
    Object.assign(group, { getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }) });
    expect(paintedBox(group, root)).toEqual({ x: 5, y: 7, width: 10, height: 10 });
  });

  it('a cell with an HTML label: the union of its parts, not the getBBox of the group', () => {
    const root = mount(handHtml);
    const group = cell(root, 'node-a');
    // the group box of a browser: the 100% foreignObject makes it the whole viewport
    Object.assign(group, { getBBox: () => ({ x: 0, y: 0, width: 442, height: 282 }) });
    const box = paintedBox(group, root)!;
    // jsdom: the shape from its attributes (in the translate of its group), the label from its first element child
    expect(box).toEqual({ x: 0.5, y: 0.5, width: 120, height: 60 });
  });
});
