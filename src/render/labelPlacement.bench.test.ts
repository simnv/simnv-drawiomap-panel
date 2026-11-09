import { describe, expect, it } from 'vitest';
import { bendLengths, polylineLength, type Point } from './geometry';
import {
  boundsOf,
  obstacleIndex,
  placeHalfLabel,
  placeLinkLabels,
  type LegInput,
  type Obstacle,
  type Placement,
} from './labelPlacement';

/**
 * The cost bound of the spec (section 7): 1,000 halves on legs of 100 units against 2,000 rect obstacles and the
 * edge strokes. The measured figure goes into docs/acceptance.md.
 */
/**
 * The time budget of each bench. A CI runner (GitHub Actions or Woodpecker, both set CI) is up to 7 times slower
 * than a developer machine, so the budget is 6 times larger there. DMAP_BENCH_BUDGET_SCALE sets another multiplier.
 */
const onCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI ?? '');
const BUDGET_SCALE = Number(process.env.DMAP_BENCH_BUDGET_SCALE) || (onCi ? 6 : 1);
const BUDGET_MS = 250 * BUDGET_SCALE;
const EDGES = 500;
const RECTS = 2000;
const COLUMNS = 25;
/** the sheet: 25 × 20 edges of 200 units on a 240-unit grid, alternating horizontal and vertical */
const edge = (i: number): Point[] => {
  const x = (i % COLUMNS) * 240;
  const y = Math.floor(i / COLUMNS) * 240;
  return i % 2
    ? [
        { x, y },
        { x, y: y + 200 },
      ]
    : [
        { x, y },
        { x: x + 200, y },
      ];
};
const legOf = (points: Point[], which: 'a2b' | 'b2a'): LegInput => {
  const [a, b] = points;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // both legs run from the end of the link towards the split
  const pts = which === 'a2b' ? [a, mid] : [b, mid];
  return { points: pts, bends: [], length: 100, size: { width: 24, height: 10 }, strokeRoot: 10 };
};

describe('labelPlacement bench', () => {
  it('places 1,000 halves against 2,000 rects and 500 strokes under 250 ms, each half once', () => {
    const obstacles: Obstacle[] = [];
    for (let i = 0; i < RECTS; i++) {
      if (i % 40 === 0) {
        // a wide body across both sides of the a2b leg of every fortieth horizontal edge: that half drops
        const [a] = edge((i / 40) * 2);
        obstacles.push({ kind: 'rect', rect: { x: a.x - 10, y: a.y - 40, width: 120, height: 80 }, clearance: 0 });
        continue;
      }
      // small boxes scattered over the sheet, many near the strokes
      const x = (i * 97) % (COLUMNS * 240);
      const y = ((i * 61) % 20) * 240 + ((i % 4) - 2) * 9;
      obstacles.push({ kind: 'rect', rect: { x, y, width: 16, height: 10 }, clearance: 1 });
    }
    for (let i = 0; i < EDGES; i++) {
      const [a, b] = edge(i);
      obstacles.push({ kind: 'segment', a, b, clearance: 5, owner: `e${i}` });
    }
    const start = performance.now();
    const index = obstacleIndex(obstacles);
    let placed = 0;
    let dropped = 0;
    for (let i = 0; i < EDGES; i++) {
      for (const which of ['a2b', 'b2a'] as const) {
        const result = placeHalfLabel(legOf(edge(i), which), `e${i}`, index);
        if ('centre' in result) {
          placed++;
          index.add({ kind: 'rect', rect: boundsOf(result.box), clearance: 0 });
        } else {
          dropped++;
        }
      }
    }
    const ms = performance.now() - start;
    console.info(
      `labelPlacement bench: ${placed} placed, ${dropped} dropped, ${obstacles.length} obstacles, ${ms.toFixed(1)} ms`
    );
    expect(placed + dropped).toBe(2 * EDGES);
    expect(placed).toBeGreaterThan(EDGES);
    expect(dropped).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

/*
 * The pair path and the last resort: 500 links placed in pairs (`placeLinkLabels`), each half with its strokes and
 * its widest head. A third are bent links of 200 units (the near places), a third are links of 36 units (only the
 * sides beside the heads hold a box), and a third lie under a body that covers both sides (every ladder runs to its
 * end: the near pairs, the strict ladder, the bend spots, ±3 and ±4, each strict and at a bend, then the drop).
 */
const PAIRS = 500;
/** the percent slot on linkWidth 2 to 10: the stroke reservation 10, the heads 8 (thin) to 24 (widest) wide */
const SIZES = { size: { width: 28, height: 10 }, strokeRoot: 10, minRoot: 2, headRoot: 24, headMinRoot: 8 };
/** the two legs of link `i`, each from its end to the split, and the kind of the link */
const pairOf = (i: number): { kind: number; a2b: Point[]; b2a: Point[] } => {
  const x = (i % COLUMNS) * 240;
  const y = Math.floor(i / COLUMNS) * 240;
  const kind = i % 3;
  if (kind === 1) {
    return {
      kind,
      a2b: [
        { x, y },
        { x, y: y + 18 },
      ],
      b2a: [
        { x, y: y + 36 },
        { x, y: y + 18 },
      ],
    };
  }
  // a bent link: 60 to the right, then 140 down; the split 40 below the bend
  return {
    kind,
    a2b: [
      { x, y },
      { x: x + 60, y },
      { x: x + 60, y: y + 40 },
    ],
    b2a: [
      { x: x + 60, y: y + 140 },
      { x: x + 60, y: y + 40 },
    ],
  };
};
const pairLeg = (points: Point[], id: string): LegInput => ({
  id,
  points,
  bends: bendLengths(points),
  length: polylineLength(points),
  bounds: { x: -100, y: -100, width: COLUMNS * 240 + 200, height: 20 * 240 + 200 },
  ...SIZES,
});
/** the widest head of a leg: the tip at its end, 12 back along its last run, 24 wide */
const headOf = (points: Point[], owner: string, leg: string): Obstacle => {
  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  const run = Math.hypot(tip.x - before.x, tip.y - before.y);
  const ux = (tip.x - before.x) / run;
  const uy = (tip.y - before.y) / run;
  const base = { x: tip.x - 12 * ux, y: tip.y - 12 * uy };
  return {
    kind: 'polygon',
    points: [tip, { x: base.x - 12 * uy, y: base.y + 12 * ux }, { x: base.x + 12 * uy, y: base.y - 12 * ux }],
    owner,
    leg,
  };
};

describe('labelPlacement bench: pairs and the last resort', () => {
  it('places 500 pairs, a third beside their heads and a third under a body, under 250 ms', () => {
    const obstacles: Obstacle[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const owner = `e${i}`;
      const { kind, a2b, b2a } = pairOf(i);
      for (const [which, points] of [
        ['a2b', a2b],
        ['b2a', b2a],
      ] as const) {
        const leg = `${owner}:${which}`;
        points.slice(1).forEach((b, index) => {
          obstacles.push({ kind: 'segment', a: points[index], b, clearance: 5, owner, piece: { leg, index } });
        });
        obstacles.push(headOf(points, owner, leg));
      }
      if (kind === 2) {
        const [a] = a2b;
        obstacles.push({ kind: 'rect', rect: { x: a.x - 80, y: a.y - 80, width: 220, height: 300 }, clearance: 0 });
      }
    }
    for (let i = 0; i < RECTS; i++) {
      // small boxes scattered over the sheet, many near the strokes
      const x = (i * 97) % (COLUMNS * 240);
      const y = ((i * 61) % 20) * 240 + ((i % 4) - 2) * 9;
      obstacles.push({ kind: 'rect', rect: { x, y, width: 16, height: 10 }, clearance: 1 });
    }
    const start = performance.now();
    const index = obstacleIndex(obstacles);
    const sides = new Map<number, number>();
    let dropped = 0;
    const keep = (p: Placement) => {
      if ('centre' in p) {
        sides.set(Math.abs(p.side), (sides.get(Math.abs(p.side)) ?? 0) + 1);
        index.add({ kind: 'rect', rect: boundsOf(p.box), clearance: 0 });
      } else {
        dropped++;
      }
    };
    for (let i = 0; i < PAIRS; i++) {
      const { a2b, b2a } = pairOf(i);
      const [a, b] = placeLinkLabels(pairLeg(a2b, `e${i}:a2b`), pairLeg(b2a, `e${i}:b2a`), `e${i}`, index);
      keep(a);
      keep(b);
    }
    const ms = performance.now() - start;
    const placed = [...sides.values()].reduce((sum, n) => sum + n, 0);
    console.info(
      `labelPlacement pair bench: ${placed} placed (by |side| ${JSON.stringify(Object.fromEntries(sides))}), ` +
        `${dropped} dropped, ${obstacles.length} obstacles, ${ms.toFixed(1)} ms`
    );
    expect(placed + dropped).toBe(2 * PAIRS);
    // the short links stand beside their heads; the links under a body drop after the whole ladder
    expect((sides.get(3) ?? 0) + (sides.get(4) ?? 0)).toBeGreaterThan(PAIRS / 3);
    expect(dropped).toBeGreaterThanOrEqual(2 * Math.floor(PAIRS / 3));
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
