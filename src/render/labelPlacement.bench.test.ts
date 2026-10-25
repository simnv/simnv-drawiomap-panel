import { describe, expect, it } from 'vitest';
import type { Point } from './geometry';
import { boundsOf, obstacleIndex, placeHalfLabel, type LegInput, type Obstacle } from './labelPlacement';

/**
 * The cost bound of the spec (section 7): 1,000 halves on legs of 100 units against 2,000 rect obstacles and the
 * edge strokes. The measured figure goes into docs/acceptance.md.
 */
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
    expect(ms).toBeLessThan(250);
  });
});
