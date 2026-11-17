import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellEntry, CellIndex } from '../types';
import { FOCUS_ACTIVE, FOCUS_LAYER, FOCUS_SCRIM, focusLink, refreshFocus } from './linkFocus';

/** A zone with node a (with its port and an icon outside it), node b, links L and M, the label cell of L, labels. */
function stage() {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="layer">
    <g data-cell-id="zone"><rect class="zone"/>
      <g data-cell-id="a"><rect class="a"/><g data-cell-id="a-port" role="button" tabindex="0"><rect class="a-port"/></g></g>
      <g data-cell-id="L"><path class="L"/></g>
    </g>
    <g data-cell-id="b" id="own-id"><rect class="b"/></g>
    <g data-cell-id="M"><path class="M"/><g data-cell-id="M-text"><foreignObject class="M-text"/></g></g>
    <g data-cell-id="L-label"><text class="L-label">uplink</text></g>
    <g data-cell-id="a-icon"><image class="a-icon" href="data:image/png;base64,AA=="/><a href="https://example.com"><text>doc</text></a></g>
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
  /** The cells and labels copied above the scrim: the class of the first shape of each copy, or its text. */
  const copied = () =>
    [...root.querySelectorAll(`g.${FOCUS_LAYER} > :not(.${FOCUS_SCRIM})`)].map(
      (c) => (c.localName === 'text' ? c.textContent : c.querySelector('[class]')?.getAttribute('class')) ?? '?'
    );
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

  it('copies the ends, the node that holds a port end once, and the parts of the node, with no ids', () => {
    const { root, index, copied } = stage();
    focusLink(root, index, 'M', ['a-port', 'b']);
    // a holds a-port: a is drawn with its port; the icon of a lies outside a
    // a classic draw.io edge label (a child of the edge, no owner) is drawn with the edge
    expect(copied().sort()).toEqual(['7%', 'M', 'a', 'a-icon', 'b']);
    const layer = root.querySelector(`g.${FOCUS_LAYER}`)!;
    // the HTML label of the edge is in its copy (a <use> would not draw it)
    expect(layer.querySelector('foreignObject.M-text')).not.toBeNull();
    // a copy has no id, cell id, role or tab stop: the hit test and the screen reader see only the original
    expect(layer.querySelectorAll('[id], [data-cell-id], [data-dmap-cell], [role], [tabindex]')).toHaveLength(0);
    expect(root.querySelectorAll('#own-id')).toHaveLength(1);
    // an icon keeps its picture; a link in a label is no tab stop
    expect(layer.querySelector('image')?.getAttribute('href')).toMatch(/^data:/);
    expect(layer.querySelector('a')?.hasAttribute('href')).toBe(false);
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

describe('refreshFocus', () => {
  it('draws the copies again after a paint, and clears for a new index', () => {
    const { root, index, copied } = stage();
    focusLink(root, index, 'L');
    root.querySelector('[data-dmap-cell="L"]')!.textContent = '55%';
    refreshFocus(root, index);
    expect(copied()).toEqual(['L', 'L-label', '55%']);
    refreshFocus(root, new Map(index));
    expect(copied()).toEqual([]);
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
  });
});

describe('focusLink labels', () => {
  it('copies no value label while the label layer is hidden at this zoom', () => {
    const { root, index, copied } = stage();
    root.querySelector('g.labels')!.setAttribute('visibility', 'hidden');
    focusLink(root, index, 'L');
    expect(copied()).toEqual(['L', 'L-label']);
  });
});
