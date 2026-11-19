import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellEntry, CellIndex } from '../types';
import {
  CHART_LAYER_ATTR,
  FOCUS_ACTIVE,
  FOCUS_KEPT,
  FOCUS_LAYER,
  FOCUS_SCRIM,
  focusCells,
  focusMap,
  refreshFocus,
} from './linkFocus';

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

describe('focusCells', () => {
  it('puts one scrim last in the root and copies of the link, its label cell and its value labels above it', () => {
    const { root, index, copied } = stage();
    focusCells(root, index, 'L');
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(true);
    const layer = root.lastElementChild!;
    expect(layer.classList.contains(FOCUS_LAYER)).toBe(true);
    expect(layer.firstElementChild?.classList.contains(FOCUS_SCRIM)).toBe(true);
    expect(layer.getAttribute('pointer-events')).toBe('none');
    expect(copied()).toEqual(['L', 'L-label', '41%']);
    // no class goes on the other cells
    expect(root.querySelector('[data-cell-id="M"]')!.getAttribute('class')).toBeNull();
  });

  it('copies the ends once (a port inside its node is drawn with it), the parts of the node, with no ids', () => {
    const { root, index, copied } = stage();
    focusCells(root, index, 'M', ['a-port', 'a', 'b']);
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
    focusCells(root, index, 'L');
    focusCells(root, index, 'M');
    expect(root.querySelectorAll(`g.${FOCUS_LAYER}`)).toHaveLength(1);
    expect(copied()).toEqual(['M', '7%']);
    focusCells(root, index, undefined);
    expect(copied()).toEqual([]);
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
    focusCells(root, index, 'nope');
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
  });
});

describe('focusCells scrim colour', () => {
  it('fills the scrim with the page colour of the diagram, and leaves it to the panel CSS when there is none', () => {
    const { root, index } = stage();
    // the computed style needs the svg in the document
    document.body.appendChild(root.parentElement!);
    root.style.backgroundColor = 'rgb(250, 240, 220)';
    focusCells(root, index, 'L');
    const scrim = root.querySelector<SVGElement>(`.${FOCUS_SCRIM}`)!;
    expect(scrim.style.fill).toBe('rgb(250, 240, 220)');
    root.style.backgroundColor = 'transparent';
    focusCells(root, index, 'M');
    expect(scrim.style.fill).toBe('');
    root.parentElement!.remove();
  });
});

describe('focusCells charts', () => {
  it('marks the chart regions of the kept cells, so only the other charts fade; a clear unmarks them', () => {
    const { root, index } = stage();
    const layer = document.createElement('div');
    layer.setAttribute(CHART_LAYER_ATTR, '');
    layer.innerHTML =
      '<div><div data-dmap-chart="a" data-dmap-cell="a"></div><div data-dmap-chart="zone" data-dmap-cell="zone"></div></div>';
    root.parentElement!.append(layer);
    const kept = () => [...layer.querySelectorAll(`.${FOCUS_KEPT}`)].map((r) => r.getAttribute('data-dmap-cell'));
    focusCells(root, index, 'M', ['b', 'a']);
    expect(kept()).toEqual(['a']);
    focusCells(root, index, undefined);
    expect(kept()).toEqual([]);
  });
});

describe('refreshFocus', () => {
  it('draws the copies again after a paint, and clears for a new index', () => {
    const { root, index, copied } = stage();
    focusCells(root, index, 'L');
    root.querySelector('[data-dmap-cell="L"]')!.textContent = '55%';
    refreshFocus(root, index);
    expect(copied()).toEqual(['L', 'L-label', '55%']);
    refreshFocus(root, new Map(index));
    expect(copied()).toEqual([]);
    expect(root.classList.contains(FOCUS_ACTIVE)).toBe(false);
  });
});

describe('focusCells labels', () => {
  it('copies no value label while the label layer is hidden at this zoom', () => {
    const { root, index, copied } = stage();
    root.querySelector('g.labels')!.setAttribute('visibility', 'hidden');
    focusCells(root, index, 'L');
    expect(copied()).toEqual(['L', 'L-label']);
  });
});

describe('focusMap', () => {
  it('keeps the ends of a link, and for a node its links (also those on its ports) and their other ends', () => {
    const { index } = stage();
    // L joins the port of a and b; M joins b and a
    const ends = new Map([
      ['L', { source: 'a-port', target: 'b' }],
      ['M', { source: 'b', target: 'a' }],
    ]);
    const focusOf = focusMap(index, ends);
    // a port end brings the node that holds it
    expect(focusOf('L')).toEqual(['a-port', 'a', 'b']);
    expect(focusOf('a').sort()).toEqual(['L', 'M', 'a', 'a-port', 'b']);
    // a port keeps only its own links, and its node
    expect(focusOf('a-port').sort()).toEqual(['L', 'a', 'a-port', 'b']);
    // a cell with no link keeps nothing
    expect(focusOf('zone')).toEqual([]);
  });

  it('finds the node of a port by its parents when the port is not inside the node; a self-loop keeps its node once', () => {
    const { index } = stage();
    // the port b-port lies outside node b in the SVG; pg-node names b
    const focusOf = focusMap(
      index,
      new Map([
        ['L', { source: 'L-label', target: 'b' }],
        ['M', { source: 'b', target: 'b' }],
      ]),
      new Map([['L-label', 'b']])
    );
    expect(focusOf('b').sort()).toEqual(['L', 'L-label', 'M', 'b']);
    expect(focusOf('M')).toEqual(['b']);
  });

  it('a node focus copies the node, its links with their value labels and the other ends', () => {
    const { root, index, copied } = stage();
    const focusOf = focusMap(index, new Map([['L', { source: 'a-port', target: 'b' }]]));
    focusCells(root, index, 'a', focusOf('a'));
    expect(copied().sort()).toEqual(['41%', 'L', 'L-label', 'a', 'a-icon', 'b']);
  });
});
