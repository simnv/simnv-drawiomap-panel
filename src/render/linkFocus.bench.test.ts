import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { CellEntry, CellIndex } from '../types';
import { LINK_LABEL_LAYER_CLASS } from './linkLabels';
import { FOCUS_LAYER, focusCells, focusMap, followView } from './linkFocus';

/**
 * The cost bound of the hover focus on a large map: 565 links between 200 nodes (a core node with 40 links), a port
 * at each end of a link, an icon outside each node, the overlay halves of each link and 1,130 value labels. A hover
 * switch (a link, another link, the core node, a clear) costs under 15 ms each in jsdom (about 3 ms on a developer
 * machine, most of it the clone of the kept cells; with searches of the whole svg at each switch it was 6.3 ms), and it
 * reads the layout (the computed style and the transforms) before it writes to the svg: no layout read after a write.
 * A CI runner is up to 7 times slower than a developer machine, so the budget is 6 times larger there (as in the
 * other benches); DMAP_BENCH_BUDGET_SCALE sets another multiplier. A pan or a zoom with a pinned card does not copy
 * the cells again.
 */
const onCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI ?? '');
const BUDGET_SCALE = Number(process.env.DMAP_BENCH_BUDGET_SCALE) || (onCi ? 6 : 1);
const BUDGET_MS_PER_SWITCH = 15 * BUDGET_SCALE;
const NODES = 200;
const LINKS = 565;
const CORE_LINKS = 40;
const ROUNDS = 40;

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

/** A plain 2D matrix with the part of the DOMMatrix API that the focus uses (jsdom has no DOMMatrix). */
function matrix(m: Matrix) {
  return {
    ...m,
    get isIdentity() {
      return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
    },
    inverse() {
      const det = m.a * m.d - m.b * m.c;
      return matrix({
        a: m.d / det,
        b: -m.b / det,
        c: -m.c / det,
        d: m.a / det,
        e: (m.c * m.f - m.d * m.e) / det,
        f: (m.b * m.e - m.a * m.f) / det,
      });
    },
    multiply(n: Matrix) {
      return matrix({
        a: m.a * n.a + m.c * n.b,
        b: m.b * n.a + m.d * n.b,
        c: m.a * n.c + m.c * n.d,
        d: m.b * n.c + m.d * n.d,
        e: m.a * n.e + m.c * n.f + m.e,
        f: m.b * n.e + m.d * n.f + m.f,
      });
    },
  };
}

/** The synthetic map in the panel stage, with its index and the kept cells of each cell (`focusOf`). */
function largeMap() {
  let seed = 7;
  const next = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < LINKS; i++) {
    if (i < CORE_LINKS) {
      pairs.push([0, i + 1]);
    } else {
      const a = 1 + next(NODES - 1);
      pairs.push([a, 1 + ((a + next(NODES - 2)) % (NODES - 1))]);
    }
  }
  const html = (text: string) =>
    `<switch><foreignObject pointer-events="none" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; pointer-events: all;"><div style="box-sizing: border-box;"><div style="display: inline-block; pointer-events: all;">${text}</div></div></div></foreignObject></switch>`;
  const nodes = Array.from({ length: NODES }, (_, i) => {
    const x = (i % 20) * 100;
    const y = Math.floor(i / 20) * 100;
    const ports = pairs.flatMap(([a, b], l) =>
      [a, b].includes(i)
        ? [
            `<g data-cell-id="port-${i}-${l}" data-meta-pg-kind="port"><rect x="${x}" y="${y}" width="6" height="6" fill="#999" pointer-events="all"/></g>`,
          ]
        : []
    );
    return (
      `<g data-cell-id="node-${i}" data-meta-pg-kind="node"><g><rect x="${x}" y="${y}" width="60" height="40" fill="#eee" stroke="#333" pointer-events="all"/></g>` +
      `<g>${html(`node ${i}`)}</g>${ports.join('')}</g>` +
      `<g data-cell-id="icon-${i}"><g><image x="${x}" y="${y}" width="16" height="16" href="data:image/png;base64,AA==" pointer-events="all"/></g></g>`
    );
  });
  const links = pairs.map(([a, b], l) => {
    const d = `M ${(a % 20) * 100} ${Math.floor(a / 20) * 100} L ${(b % 20) * 100} ${Math.floor(b / 20) * 100}`;
    return (
      `<g data-cell-id="link-${l}" data-meta-pg-kind="link"><g><path d="${d}" fill="none" stroke="#333" pointer-events="stroke"/>` +
      `<path d="${d}" fill="#333" pointer-events="all"/></g>` +
      `<g class="dmap-overlay" data-dmap-cell="link-${l}" pointer-events="visiblePainted">` +
      `<polyline class="dmap-half" data-dmap-cell="link-${l}" points="0,0 1,1" pointer-events="stroke"/>` +
      `<polygon class="dmap-arrow" data-dmap-cell="link-${l}" points="0,0 1,1 2,0" pointer-events="none"/>` +
      `<polyline class="dmap-half" data-dmap-cell="link-${l}" points="1,1 2,2" pointer-events="stroke"/>` +
      `<polygon class="dmap-arrow" data-dmap-cell="link-${l}" points="1,1 2,2 3,1" pointer-events="none"/></g></g>`
    );
  });
  const labels = pairs.flatMap((_, l) =>
    ['a2b', 'b2a'].map(
      (w) => `<text data-dmap-cell="link-${l}" data-dmap-half="${w}" pointer-events="visiblePainted">41%</text>`
    )
  );
  const stage = document.createElement('div');
  stage.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1000"><g data-cell-id="0"><g data-cell-id="1">` +
    `${nodes.join('')}${links.join('')}</g></g>` +
    `<g class="${LINK_LABEL_LAYER_CLASS}">${labels.join('')}</g></svg>`;
  document.body.appendChild(stage);
  const root = stage.querySelector('svg') as SVGSVGElement;
  const index: CellIndex = new Map();
  for (const group of root.querySelectorAll<SVGGElement>('g[data-cell-id]')) {
    const id = group.getAttribute('data-cell-id')!;
    const kind = id.startsWith('node-') ? 'node' : id.startsWith('port-') ? 'port' : 'other';
    const line = id.startsWith('link-') ? group.querySelector('path')! : undefined;
    index.set(id, {
      meta: { ...cellMetaFromAttrs(id, {}, !!line, id), kind },
      group,
      line,
      arrows: [],
      original: {},
      ...(id.startsWith('icon-') ? { ownerId: `node-${id.slice(5)}` } : {}),
    } as unknown as CellEntry);
  }
  const ends = new Map(pairs.map(([a, b], l) => [`link-${l}`, { source: `port-${a}-${l}`, target: `port-${b}-${l}` }]));
  return { root, index, focusOf: focusMap(index, ends) };
}

/**
 * A browser-like layout in jsdom: each svg element has a screen transform, and a read of the layout (a transform or a
 * computed style) after a write to the svg counts as a forced layout. `frame()` ends a frame: the browser lays out.
 */
function layoutProbe(root: SVGSVGElement) {
  const writes = new MutationObserver(() => {});
  writes.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  let forced = 0;
  const read = () => {
    if (writes.takeRecords().length) {
      forced++;
    }
  };
  Object.assign(SVGElement.prototype, {
    getCTM(this: SVGElement) {
      read();
      let depth = 0;
      for (let p = this.parentElement; p; p = p.parentElement) {
        depth++;
      }
      return matrix({ a: 0.5, b: 0, c: 0, d: 0.5, e: 10 + depth, f: 20 });
    },
  });
  const style = window.getComputedStyle.bind(window);
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el, pseudo) => {
    read();
    return style(el, pseudo);
  });
  return {
    frame: () => void writes.takeRecords(),
    forced: () => forced,
    stop: () => writes.disconnect(),
  };
}

describe('hover focus bench', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(SVGElement.prototype, 'getCTM');
  });

  it(`switches the focus on a 565-link map under ${BUDGET_MS_PER_SWITCH} ms each, with no layout read after a write`, () => {
    const { root, index, focusOf } = largeMap();
    const probe = layoutProbe(root);
    const hover = (id: string | undefined) => focusCells(root, index, id, id === undefined ? [] : focusOf(id));
    const order = (i: number) => [`link-${100 + i}`, `link-${300 + i}`, 'node-0', undefined];
    // the first focus makes the layer (a write before the reads, once)
    hover('link-1');
    hover(undefined);
    probe.frame();
    const firstForced = probe.forced();
    let switches = 0;
    const start = performance.now();
    for (let i = 0; i < ROUNDS; i++) {
      for (const id of order(i)) {
        hover(id);
        // the browser draws a frame between two pointer moves
        probe.frame();
        switches++;
      }
    }
    const perSwitch = (performance.now() - start) / switches;
    const forced = probe.forced() - firstForced;
    // the copies of the core node: the node, its 40 links, their other ends and the labels
    hover('node-0');
    const copies = root.querySelector(`g.${FOCUS_LAYER}`)!.childElementCount - 1;
    probe.stop();
    console.log(
      `hover focus bench: ${perSwitch.toFixed(3)} ms per switch, ${forced} forced layouts in ${switches} switches, ${copies} copies for the core node`
    );
    expect(copies).toBeGreaterThan(2 * CORE_LINKS);
    expect(forced).toBe(0);
    expect(perSwitch).toBeLessThan(BUDGET_MS_PER_SWITCH);
  });

  it('keeps the copies of a pinned core node on each pan or zoom step, and copies again when the labels hide', () => {
    const { root, index, focusOf } = largeMap();
    const probe = layoutProbe(root);
    focusCells(root, index, 'node-0', focusOf('node-0'));
    const layer = root.querySelector(`g.${FOCUS_LAYER}`)!;
    const first = layer.lastElementChild;
    const steps = 200;
    // the cost of a step that copies the cells again (the view event before this change)
    let start = performance.now();
    for (let i = 0; i < steps; i++) {
      focusCells(root, index, 'node-0', focusOf('node-0'));
    }
    const copyStep = (performance.now() - start) / steps;
    const kept = layer.lastElementChild;
    start = performance.now();
    for (let i = 0; i < steps; i++) {
      expect(followView(root, 'node-0')).toBe(true);
    }
    const followStep = (performance.now() - start) / steps;
    console.log(
      `hover focus bench: a pinned pan step ${followStep.toFixed(4)} ms, ${copyStep.toFixed(3)} ms when it copies again`
    );
    expect(first).not.toBe(kept);
    expect(layer.lastElementChild).toBe(kept);
    // a zoom out hides the label layer: the labels of the copies go
    const labelCopies = () => layer.querySelectorAll('text').length;
    expect(labelCopies()).toBe(2 * CORE_LINKS);
    root.querySelector(`g.${LINK_LABEL_LAYER_CLASS}`)!.setAttribute('visibility', 'hidden');
    expect(followView(root, 'node-0')).toBe(true);
    expect(labelCopies()).toBe(0);
    expect(followView(root, 'link-1')).toBe(false);
    expect(followStep).toBeLessThan(copyStep / 10);
    probe.stop();
  });
});
