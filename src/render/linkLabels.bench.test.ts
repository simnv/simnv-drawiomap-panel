import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTheme } from '@grafana/data';
import type { CellPatch, HalfState, PatchMap } from '../types';
import { buildCellIndex } from './svgStage';
import { renderOverlay } from './overlay';
import { LINK_LABEL_CLASS, renderLinkLabels, watchLinkLabelFonts } from './linkLabels';

/**
 * The cost of a refresh that changes the text of one link on a large map: 565 straight links of 320 units in five
 * columns, each with two value labels on its stroke. The refresh reads the text boxes (`getBBox`) of that link only,
 * not of the 1,130 labels; a font that arrives reads every one, and both give the same dash patterns. A CI runner is up
 * to 7 times slower than a developer machine, so the budget is 6 times larger there (as in the other benches);
 * DMAP_BENCH_BUDGET_SCALE sets another multiplier.
 */
const onCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI ?? '');
const BUDGET_SCALE = Number(process.env.DMAP_BENCH_BUDGET_SCALE) || (onCi ? 6 : 1);
const BUDGET_MS_PER_REFRESH = 15 * BUDGET_SCALE;
const LINKS = 565;
const COLUMNS = 5;
const ROUNDS = 40;

/** The synthetic map: link `l` runs from x to x + 320 on its row, between two nodes. */
function largeMap() {
  const rows = Math.ceil(LINKS / COLUMNS);
  const cells = Array.from({ length: LINKS }, (_, l) => {
    const x = (l % COLUMNS) * 440 + 40;
    const y = Math.floor(l / COLUMNS) * 60 + 30;
    return (
      `<g data-cell-id="a${l}"><g><rect x="${x - 40}" y="${y - 20}" width="40" height="40"/></g></g>` +
      `<g data-cell-id="l${l}"><g><path d="M ${x} ${y} L ${x + 320} ${y}" fill="none" stroke="#333" pointer-events="stroke"/></g></g>` +
      `<g data-cell-id="b${l}"><g><rect x="${x + 320}" y="${y - 20}" width="40" height="40"/></g></g>`
    );
  });
  const host = document.createElement('div');
  host.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLUMNS * 440} ${rows * 60}" ` +
    `style="background-color: #1d2d3d">${cells.join('')}</svg>`;
  document.body.appendChild(host);
  const root = host.querySelector('svg') as SVGSVGElement;
  root.getBoundingClientRect = () => ({ width: COLUMNS * 440, height: rows * 60 }) as DOMRect;
  return { root, index: buildCellIndex(root) };
}

const half = (text: string): HalfState => ({
  status: 'ok',
  color: '#00ff00',
  width: 4,
  label: `${text} Mb/s`,
  stepIndex: 0,
  display: { text, suffix: ' Mb/s', numeric: Number(text) },
});
/** the patches with link `changed` at `text` (the same slot as 41: one digit pair) */
const patchesOf = (changed = -1, text = '41'): PatchMap =>
  new Map(
    Array.from({ length: LINKS }, (_, l): [string, CellPatch] => {
      const t = l === changed ? text : '41';
      return [
        `l${l}`,
        { cellId: `l${l}`, scope: { cell: {} }, urls: [], link: { a2b: half(t), b2a: half(t), labelMode: 'value' } },
      ];
    })
  );

describe('link labels bench: the cuts of a refresh', () => {
  afterEach(() => {
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    Reflect.deleteProperty(document, 'fonts');
    vi.restoreAllMocks();
  });

  it(`a text change of one link reads the boxes of that link only, under ${BUDGET_MS_PER_REFRESH} ms`, () => {
    // the painted box of a text: 6 units per glyph, centred on its x
    let boxes = 0;
    Object.assign(SVGElement.prototype, {
      getBBox(this: SVGElement) {
        if (this.localName === 'text') {
          boxes++;
        }
        const w = 6 * (this.textContent ?? '').length;
        return { x: Number(this.getAttribute('x') ?? 0) - w / 2, y: 0, width: w, height: 10 };
      },
    });
    const fonts = Object.assign(new EventTarget(), { ready: new Promise<void>(() => {}) });
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    const theme = createTheme();
    const opts = { theme, linkWidth: { min: 2, max: 10 } };
    const { root, index } = largeMap();
    // the time of the labels only: the overlay draws first, as in paintStage
    let labelsMs = 0;
    const paint = (patches: PatchMap) => {
      renderOverlay(root, index, patches, { theme, maxWidth: 10, minWidth: 2 });
      const started = performance.now();
      renderLinkLabels(root, index, patches, opts);
      labelsMs += performance.now() - started;
    };
    paint(patchesOf());
    const onStroke = root.querySelectorAll(`text.${LINK_LABEL_CLASS}[data-dmap-side="line"]`).length;
    const styles = vi.spyOn(globalThis, 'getComputedStyle');
    boxes = 0;
    labelsMs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      paint(patchesOf(7, i % 2 ? '41' : '42'));
    }
    const perRefresh = labelsMs / ROUNDS;
    const perRefreshBoxes = boxes / ROUNDS;
    const perRefreshStyles = styles.mock.calls.length / ROUNDS;
    // the state after the last refresh, then a full pass over the same state (a font that arrives)
    paint(patchesOf(7, '43'));
    const dashes = () =>
      Array.from(
        root.querySelectorAll('.dmap-half'),
        (el) => `${el.getAttribute('data-dmap-cell')}:${el.getAttribute('stroke-dasharray')}`
      );
    const partial = dashes();
    const stop = watchLinkLabelFonts(root);
    boxes = 0;
    const fullStart = performance.now();
    for (let i = 0; i < ROUNDS; i++) {
      fonts.dispatchEvent(new Event('loadingdone'));
    }
    const full = (performance.now() - fullStart) / ROUNDS;
    const fullBoxes = boxes / ROUNDS;
    stop();
    console.info(
      `link labels bench: ${onStroke} labels on the stroke; a one-link text change ${perRefresh.toFixed(3)} ms, ` +
        `${perRefreshBoxes} getBBox, ${perRefreshStyles} getComputedStyle per refresh; a full cut pass ` +
        `${full.toFixed(3)} ms, ${fullBoxes} getBBox`
    );
    expect(onStroke).toBeGreaterThan(LINKS);
    expect(perRefreshBoxes).toBe(2);
    expect(perRefreshStyles).toBe(0);
    expect(fullBoxes).toBe(onStroke);
    expect(partial.filter((d) => !d.endsWith(':null')).length).toBeGreaterThan(LINKS);
    expect(dashes()).toEqual(partial);
    expect(perRefresh).toBeLessThan(BUDGET_MS_PER_REFRESH);
  });
});
