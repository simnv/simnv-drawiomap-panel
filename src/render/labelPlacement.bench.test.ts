import { describe, expect, it } from 'vitest';
import { crowdedMap, pairBenchMap, runMap, singleBenchMap } from './labelPlacementMaps';

/**
 * The time budget of each bench. A CI runner (GitHub Actions or Woodpecker, both set CI) is up to 7 times slower
 * than a developer machine, so the budget is 6 times larger there. DMAP_BENCH_BUDGET_SCALE sets another multiplier.
 */
const onCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI ?? '');
const BUDGET_SCALE = Number(process.env.DMAP_BENCH_BUDGET_SCALE) || (onCi ? 6 : 1);
const BUDGET_MS = 250 * BUDGET_SCALE;
/** The crowded map took about 3 s with the general collision tests and about 0.45 s with the quick tests first. */
const CROWDED_BUDGET_MS = 2000 * BUDGET_SCALE;

/** Runs the map and gives the results with the time of the run, the obstacle index included. */
const timed = (map: ReturnType<typeof singleBenchMap>) => {
  const start = performance.now();
  const results = runMap(map);
  return { results, ms: performance.now() - start };
};

describe('labelPlacement bench', () => {
  /*
   * The cost bound of the spec (section 7): 1,000 halves on legs of 100 units against 2,000 rect obstacles and the
   * edge strokes. The measured figure goes into docs/acceptance.md.
   */
  it('places 1,000 halves against 2,000 rects and 500 strokes under 250 ms, each half once', () => {
    const map = singleBenchMap();
    const { results, ms } = timed(map);
    const placed = results.filter((p) => p && 'centre' in p).length;
    const dropped = results.length - placed;
    console.info(
      `labelPlacement bench: ${placed} placed, ${dropped} dropped, ${map.obstacles.length} obstacles, ${ms.toFixed(1)} ms`
    );
    expect(placed + dropped).toBe(1000);
    expect(placed).toBeGreaterThan(500);
    expect(dropped).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('labelPlacement bench: pairs and the last resort', () => {
  /*
   * The pair path and the last resort: 500 links placed in pairs (`placeLinkLabels`), each half with its strokes and
   * its widest head. A third are bent links of 200 units (the near places), a third are links of 36 units (only the
   * sides beside the heads hold a box), and a third lie under a body that covers both sides (every ladder runs to its
   * end: the near pairs, the strict ladder, the bend spots, ±3 and ±4, each strict and at a bend, then the drop).
   */
  it('places 500 pairs, a third beside their heads and a third under a body, under 250 ms', () => {
    const map = pairBenchMap();
    const { results, ms } = timed(map);
    const sides = new Map<number, number>();
    let dropped = 0;
    for (const p of results) {
      if (p && 'centre' in p) {
        sides.set(Math.abs(p.side), (sides.get(Math.abs(p.side)) ?? 0) + 1);
      } else {
        dropped++;
      }
    }
    const placed = [...sides.values()].reduce((sum, n) => sum + n, 0);
    console.info(
      `labelPlacement pair bench: ${placed} placed (by |side| ${JSON.stringify(Object.fromEntries(sides))}), ` +
        `${dropped} dropped, ${map.obstacles.length} obstacles, ${ms.toFixed(1)} ms`
    );
    expect(placed + dropped).toBe(1000);
    // the short links stand beside their heads; the links under a body drop after the whole ladder
    expect((sides.get(3) ?? 0) + (sides.get(4) ?? 0)).toBeGreaterThan(500 / 3);
    expect(dropped).toBeGreaterThanOrEqual(2 * Math.floor(500 / 3));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  /*
   * A crowded map: 565 links between 200 nodes, many on shared lanes, so that about half of the halves run the whole
   * ladder and drop.
   */
  it('places 565 crowded links under 2 s', () => {
    const map = crowdedMap();
    const { results, ms } = timed(map);
    const placed = results.filter((p) => p && 'centre' in p).length;
    console.info(
      `labelPlacement crowded bench: ${placed} placed, ${results.length - placed} dropped, ` +
        `${map.obstacles.length} obstacles, ${ms.toFixed(1)} ms`
    );
    expect(results).toHaveLength(1130);
    expect(ms).toBeLessThan(CROWDED_BUDGET_MS);
  });
});
