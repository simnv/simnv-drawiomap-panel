import { afterEach, describe, expect, it } from 'vitest';
import { parsePathPoints, pointAt, polylineLength, type Point } from '../render/geometry';
import { clearFakeLayout, fakeLayout } from '../render/layoutTestKit';
import { linkSegments, nearestLink, NearLinkFinder, SegmentGrid, type Segment } from './nearLink';
import { nearStage } from './nearLink.testKit';

/**
 * The cost bound of the near-link check: 1,000 pointer moves on a diagram of the size of the largest live L2 sheet
 * (13 links, 44 segments) at a 0.7 zoom, under 0.05 ms for each move. The screen transform is read once, not on each
 * move. A CI runner is up to 7 times slower than a developer machine, so the budget is 6 times larger there (as in
 * the other benches); DMAP_BENCH_BUDGET_SCALE sets another multiplier.
 */
const onCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI ?? '');
const BUDGET_SCALE = Number(process.env.DMAP_BENCH_BUDGET_SCALE) || (onCi ? 6 : 1);
const BUDGET_MS_PER_MOVE = 0.05 * BUDGET_SCALE;
const MOVES = 1000;

/** 13 links in a tree from a core at the top: 5 with 4 segments, 8 with 3 (44 segments). */
function l2Links(): Record<string, string> {
  const links: Record<string, string> = {};
  for (let i = 0; i < 13; i++) {
    const x = 40 + i * 70;
    const y = 400 + (i % 3) * 60;
    links[`l${i}`] =
      i < 5
        ? `M 500 100 L 500 ${150 + i * 14} L ${x} ${150 + i * 14} L ${x} ${y - 40} L ${x} ${y}`
        : `M 500 100 L 500 ${230 + i * 14} L ${x} ${230 + i * 14} L ${x} ${y}`;
  }
  return links;
}

describe('near-link bench, diagonal links', () => {
  it('keeps a move cheap on a map of 565 straight diagonal links, and equal to the plain scan', () => {
    let x = 4242;
    const rand = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const segments: Segment[] = [];
    for (let i = 0; i < 565; i++) {
      // a point-to-point link: one straight diagonal of 300 to 3,000 units on a 5,000 square map
      const ax = rand() * 5000;
      const ay = rand() * 5000;
      const len = 300 + rand() * 2700;
      const angle = rand() * Math.PI * 2;
      segments.push({ cellId: `l${i}`, ax, ay, bx: ax + Math.cos(angle) * len, by: ay + Math.sin(angle) * len });
    }
    const build0 = performance.now();
    const grid = new SegmentGrid(segments);
    const buildMs = performance.now() - build0;
    const wide = (grid as unknown as { wide: number[] }).wide.length;
    const pointers = Array.from({ length: 20000 }, () => ({ x: rand() * 5000, y: rand() * 5000 }));
    const accept = () => true;
    // the same pointers twice, to warm the code
    for (const p of pointers) {
      grid.nearest(p, 8, accept);
    }
    const t0 = performance.now();
    let gridHits = 0;
    for (const p of pointers) {
      if (grid.nearest(p, 8, accept)) {
        gridHits++;
      }
    }
    const gridUs = ((performance.now() - t0) / pointers.length) * 1000;
    const t1 = performance.now();
    let plainHits = 0;
    for (const p of pointers) {
      if (nearestLink(segments, p, 8, accept)) {
        plainHits++;
      }
    }
    const plainUs = ((performance.now() - t1) / pointers.length) * 1000;
    console.log(
      `near-link bench, 565 diagonal links: build ${buildMs.toFixed(2)} ms, ${wide} wide segments, ` +
        `${gridUs.toFixed(2)} us per move with the grid vs ${plainUs.toFixed(2)} us by the plain scan`
    );
    expect(gridHits).toBe(plainHits);
    expect(gridUs).toBeLessThan(BUDGET_MS_PER_MOVE * 1000);
  });
});

describe('near-link bench', () => {
  afterEach(() => {
    clearFakeLayout();
    document.body.innerHTML = '';
  });

  it(`checks 1,000 pointer moves on an L2-size diagram under ${BUDGET_MS_PER_MOVE} ms each, with one CTM read`, () => {
    let ctmReads = 0;
    fakeLayout(
      () => undefined,
      undefined,
      () => {
        ctmReads++;
        return { a: 0.7, b: 0, c: 0, d: 0.7, e: 12, f: 34 };
      }
    );
    const { root, index } = nearStage(l2Links());
    expect(linkSegments(root, index)).toHaveLength(44);
    const finder = new NearLinkFinder();
    const accept = (id: string) => id !== 'l12';
    // the first move builds the segments and reads the transform
    finder.find(root, index, 300, 200, 'mouse', accept);
    const readsAfterFirst = ctmReads;
    let hits = 0;
    const start = performance.now();
    for (let i = 0; i < MOVES; i++) {
      // a pointer that sweeps the sheet in small steps, as a real move does
      const x = 12 + ((i * 7) % 700);
      const y = 34 + ((i * 3) % 400);
      if (finder.find(root, index, x, y, i % 4 ? 'mouse' : 'touch', accept)) {
        hits++;
      }
    }
    const perMove = (performance.now() - start) / MOVES;
    console.log(`near-link bench: ${(perMove * 1000).toFixed(2)} us per move, ${hits} hits in ${MOVES} moves`);
    expect(hits).toBeGreaterThan(0);
    expect(ctmReads).toBe(readsAfterFirst);
    expect(perMove).toBeLessThan(BUDGET_MS_PER_MOVE);
  });

  it('keeps the first build and each move cheap on a map of 565 orthogonal links, with no sampling of straight paths', () => {
    // jsdom has no getPointAtLength: stub it on the prototypes, as a browser measures a straight path, and count the calls
    const parsed = new WeakMap<Element, Point[]>();
    const vertices = (el: Element): Point[] => {
      let pts = parsed.get(el);
      if (!pts) {
        pts = parsePathPoints(el.getAttribute('d') ?? '');
        parsed.set(el, pts);
      }
      return pts;
    };
    let sampled = 0;
    Object.assign(SVGElement.prototype, {
      getCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    });
    Object.assign(SVGElement.prototype, {
      getTotalLength(this: SVGPathElement) {
        return polylineLength(vertices(this));
      },
      getPointAtLength(this: SVGPathElement, d: number) {
        sampled++;
        return pointAt(vertices(this), d);
      },
    });
    try {
      let x = 12345;
      const rand = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const links: Record<string, string> = {};
      for (let i = 0; i < 565; i++) {
        const x0 = Math.round(rand() * 5000);
        const y0 = Math.round(rand() * 5000);
        const dx = Math.round(100 + rand() * 400) * (rand() < 0.5 ? -1 : 1);
        const dy = Math.round(100 + rand() * 400) * (rand() < 0.5 ? -1 : 1);
        links[`l${i}`] = `M ${x0} ${y0} H ${x0 + dx} V ${y0 + dy} H ${x0 + 2 * dx} V ${y0 + 2 * dy}`;
      }
      fakeLayout(
        () => undefined,
        undefined,
        () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
      );
      const t0 = performance.now();
      const { root, index } = nearStage(links);
      const overlayMs = performance.now() - t0;
      const sampledByOverlay = sampled;
      const finder = new NearLinkFinder();
      const accept = () => true;
      const t1 = performance.now();
      finder.find(root, index, 1, 1, 'mouse', accept); // builds the segments and the grid
      const buildMs = performance.now() - t1;
      const segments = linkSegments(root, index);
      const sampledByFinder = sampled - sampledByOverlay;
      const pointers = Array.from({ length: MOVES }, () => ({ x: rand() * 2600, y: rand() * 2600 }));
      const radius = 8 / 0.5;
      let hits = 0;
      const t2 = performance.now();
      for (const p of pointers) {
        if (finder.find(root, index, p.x * 0.5, p.y * 0.5, 'mouse', accept)) {
          hits++;
        }
      }
      const gridUs = ((performance.now() - t2) / MOVES) * 1000;
      const t3 = performance.now();
      let plainHits = 0;
      for (const p of pointers) {
        if (nearestLink(segments, p, radius, accept)) {
          plainHits++;
        }
      }
      const plainUs = ((performance.now() - t3) / MOVES) * 1000;
      console.log(
        `near-link bench, 565 links (${segments.length} segments): overlay ${overlayMs.toFixed(1)} ms ` +
          `(${sampledByOverlay} getPointAtLength calls), finder build ${buildMs.toFixed(1)} ms ` +
          `(${sampledByFinder} calls), ${gridUs.toFixed(2)} us per move with the grid vs ${plainUs.toFixed(2)} us by the plain scan`
      );
      // a straight path needs no sampling for the finder: the tangent reads of the overlay are a few points per link
      expect(sampledByFinder).toBe(0);
      expect(sampledByOverlay).toBeLessThan(565 * 40);
      expect(segments).toHaveLength(565 * 4);
      expect(hits).toBe(plainHits);
      expect(gridUs).toBeLessThan(BUDGET_MS_PER_MOVE * 1000);
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'getCTM');
      Reflect.deleteProperty(SVGElement.prototype, 'getTotalLength');
      Reflect.deleteProperty(SVGElement.prototype, 'getPointAtLength');
    }
  });
});
