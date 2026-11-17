import { describe, expect, it } from 'vitest';
import type { CellEntry, CellIndex } from '../types';
import { FOCUS_ACTIVE, FOCUS_DIM, focusLink } from './linkFocus';

/** A zone with node A (and its port), node B outside it, links L and M, the label cell of L, and value labels. */
function stage() {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="layer">
    <g data-cell-id="zone"><rect/>
      <g data-cell-id="a"><rect/><g data-cell-id="a-port"><rect/></g></g>
      <g data-cell-id="L"><path/></g>
    </g>
    <g data-cell-id="b"><rect/></g>
    <g data-cell-id="M"><path/></g>
    <g data-cell-id="L-label"><text>uplink</text></g>
    <g data-cell-id="a-icon"><rect/></g>
  </g>
  <g><text class="dmap-link-label" data-dmap-cell="L">41%</text><text class="dmap-link-label" data-dmap-cell="M">7%</text></g>
  </svg>`;
  const root = host.querySelector('svg') as SVGSVGElement;
  const index: CellIndex = new Map();
  for (const g of root.querySelectorAll('[data-cell-id]')) {
    const id = g.getAttribute('data-cell-id')!;
    index.set(id, {
      group: g,
      arrows: [],
      original: {},
      ...(id === 'L-label' ? { ownerId: 'L' } : id === 'a-icon' ? { ownerId: 'a' } : {}),
    } as unknown as CellEntry);
  }
  const dimmed = () =>
    [...root.querySelectorAll(`.${FOCUS_DIM}`)].map((el) => el.getAttribute('data-cell-id') ?? el.textContent);
  return { root, index, dimmed };
}

describe('focusLink', () => {
  it('dims every cell but the link, its parts and their containers, once for each subtree', () => {
    const { root, index, dimmed } = stage();
    focusLink(root, index, 'L');
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(true);
    // node a dims as one subtree (its port fades with it); the zone and the layer hold the link and stay bright
    expect(dimmed().sort()).toEqual(['7%', 'M', 'a', 'a-icon', 'b']);
  });

  it('keeps the ends of the link bright: a port end keeps its node container open', () => {
    const { root, index, dimmed } = stage();
    focusLink(root, index, 'M', ['a-port', 'b']);
    // the zone and node a hold the port: they stay bright, with the icon of a; the other cells dim on their own
    expect(dimmed().sort()).toEqual(['41%', 'L', 'L-label']);
  });

  it('moves to another link and clears with undefined or an unknown cell', () => {
    const { root, index, dimmed } = stage();
    focusLink(root, index, 'L');
    focusLink(root, index, 'M');
    expect(dimmed().sort()).toEqual(['41%', 'L-label', 'a-icon', 'b', 'zone']);
    focusLink(root, index, undefined);
    expect(dimmed()).toEqual([]);
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
    focusLink(root, index, 'nope');
    expect(dimmed()).toEqual([]);
  });
});
