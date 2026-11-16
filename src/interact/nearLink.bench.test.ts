import { afterEach, describe, expect, it } from 'vitest';
import { clearFakeLayout, fakeLayout } from '../render/layoutTestKit';
import { linkSegments, NearLinkFinder } from './nearLink';
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
});
