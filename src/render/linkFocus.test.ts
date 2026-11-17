import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellEntry, CellIndex } from '../types';
import { FOCUS_ACTIVE, FOCUS_LAYER, FOCUS_SCRIM, focusLink } from './linkFocus';

/** A zone with node a (with its port and an icon outside it), node b, links L and M, the label cell of L, labels. */
function stage() {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="layer">
    <g data-cell-id="zone"><rect/>
      <g data-cell-id="a"><rect/><g data-cell-id="a-port"><rect/></g></g>
      <g data-cell-id="L"><path/></g>
    </g>
    <g data-cell-id="b" id="own-id"><rect/></g>
    <g data-cell-id="M"><path/><g data-cell-id="M-text"><text>classic</text></g></g>
    <g data-cell-id="L-label"><text>uplink</text></g>
    <g data-cell-id="a-icon"><rect/></g>
  </g>
  <g class="labels"><text data-dmap-cell="L">41%</text><text data-dmap-cell="M">7%</text></g>
  </svg>`;
  const root = host.querySelector('svg') as SVGSVGElement;
  const owners: Record<string, string> = { 'L-label': 'L', 'a-icon': 'a' };
  const index: CellIndex = new Map();
  for (const g of root.querySelectorAll('[data-cell-id]')) {
    const id = g.getAttribute('data-cell-id')!;
    const kind = id === 'a' || id === 'b' ? 'node' : id === 'a-port' ? 'port' : 'other';
    index.set(id, {
      meta: { ...cellMetaFromAttrs(id, {}, false, id), kind },
      group: g,
      arrows: [],
      original: {},
      ...(owners[id] ? { ownerId: owners[id] } : {}),
    } as unknown as CellEntry);
  }
  /** The cells and labels copied above the scrim, by cell id or text. */
  const copied = () =>
    [...root.querySelectorAll(`g.${FOCUS_LAYER} use`)].map((u) => {
      const el = root.querySelector(u.getAttribute('href')!)!;
      return el.getAttribute('data-cell-id') ?? el.textContent;
    });
  return { root, index, copied };
}

describe('focusLink', () => {
  it('puts one scrim last in the root and copies of the link, its label cell and its value labels above it', () => {
    const { root, index, copied } = stage();
    focusLink(root, index, 'L');
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(true);
    const layer = root.lastElementChild!;
    expect(layer.classList.contains(FOCUS_LAYER)).toBe(true);
    expect(layer.firstElementChild?.classList.contains(FOCUS_SCRIM)).toBe(true);
    expect(layer.getAttribute('pointer-events')).toBe('none');
    expect(copied()).toEqual(['L', 'L-label', '41%']);
    // no class goes on the other cells
    expect(root.querySelector('[data-cell-id="M"]')!.getAttribute('class')).toBeNull();
  });

  it('copies the ends, the node that holds a port end once, and the parts of the node; a cell keeps its own id', () => {
    const { root, index, copied } = stage();
    focusLink(root, index, 'M', ['a-port', 'b']);
    // a holds a-port: a is drawn with its port; the icon of a lies outside a
    // a classic draw.io edge label (a child of the edge, no owner) is drawn with the edge
    expect(copied().sort()).toEqual(['7%', 'M', 'a', 'a-icon', 'b']);
    expect(root.querySelector('[data-cell-id="M-text"]')!.closest('[data-cell-id="M"]')).not.toBeNull();
    expect([...root.querySelectorAll('use')].some((u) => u.getAttribute('href') === '#own-id')).toBe(true);
  });

  it('moves to another link with one layer, and clears with undefined or an unknown cell', () => {
    const { root, index, copied } = stage();
    focusLink(root, index, 'L');
    focusLink(root, index, 'M');
    expect(root.querySelectorAll(`g.${FOCUS_LAYER}`)).toHaveLength(1);
    expect(copied()).toEqual(['M', '7%']);
    focusLink(root, index, undefined);
    expect(copied()).toEqual([]);
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
    focusLink(root, index, 'nope');
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
  });
});
