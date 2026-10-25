import { describe, expect, it } from 'vitest';
import { bendLengths, polylineLength, type Point } from './geometry';
import {
  boundsOf,
  labelsVisible,
  LINK_LABEL_GEOMETRY,
  obstacleIndex,
  placeHalfLabel,
  placeLinkLabels,
  runHeading,
  type LegInput,
  type Obstacle,
  type ObstacleIndex,
  type Placed,
  type Placement,
  type Rect,
} from './labelPlacement';

/** A leg from its vertices; the slot is 24 × 10 (the fixed percent slot in jsdom) and the stroke 10 (linkWidth.max). */
const leg = (points: Point[], over: Partial<LegInput> = {}): LegInput => ({
  points,
  bends: bendLengths(points),
  length: polylineLength(points),
  size: { width: 24, height: 10 },
  strokeRoot: 10,
  ...over,
});
/** The box is 26 × 12 with the halo; the centre stands gap (4 + 5) + 6 = 15 from the centreline. */
const OFFSET = 15;
const placed = (p: Placement): Placed => {
  if (!('centre' in p)) {
    throw new Error(`dropped: ${p.dropped}`);
  }
  return p;
};
const rect = (x: number, y: number, width: number, height: number, clearance = 0): Obstacle => ({
  kind: 'rect',
  rect: { x, y, width, height },
  clearance,
});
const segment = (a: Point, b: Point, owner: string, clearance = 5): Extract<Obstacle, { kind: 'segment' }> => ({
  kind: 'segment',
  a,
  b,
  clearance,
  owner,
});
const horizontal = (from: number, to: number, y = 0) => [
  { x: from, y },
  { x: to, y },
];

describe('runHeading', () => {
  it('a horizontal run reads left to right either way, the first side is up', () => {
    expect(runHeading(100, 0)).toEqual({ degrees: 0, first: { x: 0, y: -1 } });
    expect(runHeading(-100, 0).degrees).toBe(0);
    expect(runHeading(-100, 0).first).toEqual({ x: 0, y: -1 });
  });
  it('a vertical run reads bottom to top either way, the first side is the right', () => {
    expect(runHeading(0, 100)).toEqual({ degrees: -90, first: { x: 1, y: 0 } });
    expect(runHeading(0, -100)).toEqual({ degrees: -90, first: { x: 1, y: 0 } });
  });
  it('a diagonal keeps its text upright: 45 down-right and its reverse, −45 up-right and its reverse', () => {
    expect(runHeading(100, 100).degrees).toBeCloseTo(45);
    expect(runHeading(-100, -100).degrees).toBeCloseTo(45);
    expect(runHeading(100, -100).degrees).toBeCloseTo(-45);
    expect(runHeading(-100, 100).degrees).toBeCloseTo(-45);
    // the first side is above the run: up-right at 45, up-left at −45
    const a = runHeading(100, 100).first;
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0);
    const b = runHeading(100, -100).first;
    expect(b.x).toBeLessThan(0);
    expect(b.y).toBeLessThan(0);
  });
  it('a steep run never reads with its letters upside down', () => {
    expect(runHeading(1, 57.29).degrees).toBeCloseTo(89, 0);
    expect(runHeading(-1, 57.29).degrees).toBeCloseTo(-89, 0);
    expect(runHeading(1, -57.29).degrees).toBeCloseTo(-89, 0);
    expect(runHeading(-1, -57.29).degrees).toBeCloseTo(89, 0);
    for (const [dx, dy] of [
      [1, 57.29],
      [-1, 57.29],
      [1, -57.29],
      [-1, -57.29],
      [100, 100],
      [-100, 0],
    ]) {
      // the glyphs' down vector (−sin θ, cos θ) points down the screen (cos θ ≥ 0)
      expect(Math.cos((runHeading(dx, dy).degrees * Math.PI) / 180)).toBeGreaterThanOrEqual(0);
    }
  });
  it('the vertical tolerance is 0.01 user units', () => {
    expect(runHeading(0.005, 100).degrees).toBe(-90);
    expect(runHeading(0.02, 100).degrees).not.toBe(-90);
    expect(runHeading(0.02, 100).degrees).toBeCloseTo(89.99, 1);
  });
});

describe('placeHalfLabel: position', () => {
  it('a horizontal link of 400 split at 200 puts the labels at 100 and 300, both above, angle 0', () => {
    const y0 = 50;
    const a2b = placed(placeHalfLabel(leg(horizontal(0, 200, y0)), 'e', obstacleIndex([])));
    // b2a runs from the end of the link to the split
    const b2a = placed(placeHalfLabel(leg(horizontal(400, 200, y0)), 'e', obstacleIndex([])));
    expect(a2b.centre).toEqual({ x: 100, y: y0 - (4 + 5 + 12 / 2) });
    expect(b2a.centre).toEqual({ x: 300, y: y0 - OFFSET });
    expect(a2b.degrees).toBe(0);
    expect(b2a.degrees).toBe(0);
    expect(a2b.box).toEqual({ centre: a2b.centre, width: 26, height: 12, degrees: 0 });
    expect(a2b.along).toBe(100);
  });
  it('a vertical link puts the label to the right, reading bottom to top', () => {
    const p = placed(
      placeHalfLabel(
        leg([
          { x: 30, y: 0 },
          { x: 30, y: 200 },
        ]),
        'e',
        obstacleIndex([])
      )
    );
    expect(p.centre).toEqual({ x: 30 + OFFSET, y: 100 });
    expect(p.degrees).toBe(-90);
  });
  it('an L-shaped edge: a2b on the vertical run reads −90, b2a on the horizontal run reads 0', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 150 },
      { x: 250, y: 150 },
    ];
    // length 400, split at 200: a2b holds the vertical run and 50 units of the horizontal one
    const a2b = placed(
      placeHalfLabel(
        leg([
          { x: 0, y: 0 },
          { x: 0, y: 150 },
          { x: 50, y: 150 },
        ]),
        'e',
        obstacleIndex([])
      )
    );
    const b2a = placed(placeHalfLabel(leg([points[2], { x: 50, y: 150 }]), 'e', obstacleIndex([])));
    expect(a2b.degrees).toBe(-90);
    expect(a2b.centre).toEqual({ x: OFFSET, y: 100 });
    expect(b2a.degrees).toBe(0);
    expect(b2a.centre).toEqual({ x: 150, y: 150 - OFFSET });
  });
  it('a 45° diagonal turns the box by 45 and keeps its near edge 4 units from the stroke edge', () => {
    const p = placed(
      placeHalfLabel(
        leg([
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ]),
        'e',
        obstacleIndex([])
      )
    );
    expect(p.degrees).toBeCloseTo(45);
    // the distance of the centre from the line y = x, less half the box height, less half the stroke
    const distance = Math.abs(p.centre.x - p.centre.y) / Math.SQRT2;
    expect(distance - 12 / 2 - 10 / 2).toBeCloseTo(LINK_LABEL_GEOMETRY.normalGap);
    expect(p.centre.y).toBeLessThan(p.centre.x);
  });
  it('the stroke width sets the gap: a thin edge brings the label nearer', () => {
    const p = placed(placeHalfLabel(leg(horizontal(0, 200), { strokeRoot: 2 }), 'e', obstacleIndex([])));
    expect(p.centre.y).toBe(-(4 + 1 + 6));
  });
});

describe('placeHalfLabel: collisions', () => {
  it('a rect on the anchor slides the label towards the end of the link, not towards the split', () => {
    const index = obstacleIndex([rect(86, -30, 28, 30)]);
    const p = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', index));
    expect(p.centre).toEqual({ x: 72, y: -OFFSET });
    expect(p.degrees).toBe(0);
  });
  it('a rect grown by its clearance counts', () => {
    const index = obstacleIndex([rect(86, -34, 28, 10, 8)]);
    const p = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', index));
    expect(p.centre.x).toBeLessThan(100);
    const far = obstacleIndex([rect(86, -34, 28, 10, 2)]);
    expect(placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', far)).centre.x).toBe(100);
  });
  it('a label touching an obstacle is free', () => {
    const p = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', obstacleIndex([rect(114, -30, 20, 30)])));
    expect(p.centre.x).toBe(100);
  });
  it('the first side blocked along the whole leg sends the label to the second side', () => {
    const index = obstacleIndex([rect(-10, -40, 220, 35)]);
    const p = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', index));
    expect(p.centre).toEqual({ x: 100, y: OFFSET });
  });
  it('both sides blocked along the whole leg: no free spot', () => {
    const index = obstacleIndex([rect(-10, -40, 220, 35), rect(-10, 5, 220, 35)]);
    expect(placeHalfLabel(leg(horizontal(0, 200)), 'e', index)).toEqual({ dropped: 'no-free-spot' });
  });
  it('a leg of 20 units with a 30-unit slot is a short leg, before any candidate', () => {
    const calls: Rect[] = [];
    const index: ObstacleIndex = { add() {}, remove() {}, near: (box) => (calls.push(box), []) };
    expect(placeHalfLabel(leg(horizontal(0, 20), { size: { width: 30, height: 10 } }), 'e', index)).toEqual({
      dropped: 'short-leg',
    });
    expect(calls).toEqual([]);
  });
  it('two halves on one trunk: the second sits past the first', () => {
    const index = obstacleIndex([]);
    const first = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e1', index));
    index.add({ kind: 'rect', rect: boundsOf(first.box), clearance: 0 });
    const second = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e2', index));
    expect(first.centre.x).toBe(100);
    expect(second.centre.x).toBe(72);
    expect(second.centre.y).toBe(first.centre.y);
  });
  it("another edge's stroke within its half width slides the label; a stroke under the own run does not", () => {
    const near = obstacleIndex([segment({ x: 80, y: -6 }, { x: 120, y: -6 }, 'other')]);
    expect(placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', near)).centre.x).not.toBe(100);
    const under = obstacleIndex([
      segment({ x: 0, y: 0 }, { x: 200, y: 0 }, 'e'),
      segment({ x: 0, y: 0 }, { x: 200, y: 0 }, 'parallel'),
    ]);
    expect(placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', under)).centre).toEqual({ x: 100, y: -OFFSET });
  });
  it('the own run is no obstacle; another run of the own edge is (a U-shaped edge)', () => {
    const index = obstacleIndex([
      segment({ x: 0, y: 0 }, { x: 200, y: 0 }, 'e'),
      segment({ x: 0, y: -20 }, { x: 200, y: -20 }, 'e'),
    ]);
    const p = placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', index));
    expect(p.centre).toEqual({ x: 100, y: OFFSET });
  });
  it('the pieces of the own run with a turn of 5° or less are no obstacle; a piece of another run is', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: -8.57 },
    ];
    const own = obstacleIndex([segment(points[0], points[1], 'e'), segment(points[1], points[2], 'e')]);
    const p = placed(placeHalfLabel(leg(points), 'e', own));
    expect(p.along).toBeCloseTo(polylineLength(points) / 2);
    expect(p.centre.y).toBeLessThan(0);
    // a piece of another edge beside the run, within its clearance, is an obstacle
    const other = obstacleIndex([segment({ x: 100, y: -6 }, { x: 200, y: -14.57 }, 'f')]);
    expect(placed(placeHalfLabel(leg(points), 'e', other)).along).not.toBeCloseTo(polylineLength(points) / 2);
  });
  it('a piece of the own edge is known by its leg and index, not by where it lies: a crossing piece collides', () => {
    // the a2b leg of `M 0 100 L 443.05 100 L 221.53 0 L 221.53 200`, split at 427; the b2a leg crosses it at 221.53
    const a2b = leg(horizontal(0, 427, 100), { id: 'e:a2b' });
    const b2a = [
      { x: 221.53, y: 200 },
      { x: 221.53, y: 0 },
      { x: 443.05, y: 100 },
      { x: 427, y: 100 },
    ];
    const pieces: Obstacle[] = [
      { ...segment(a2b.points[0], a2b.points[1], 'e'), piece: { leg: 'e:a2b', index: 0 } },
      ...b2a.slice(1).map((b, i) => ({ ...segment(b2a[i], b, 'e'), piece: { leg: 'e:b2a', index: i } })),
    ];
    const p = placed(placeHalfLabel(a2b, 'e', obstacleIndex(pieces)));
    // the anchor at 213.5 would put the box over the crossing stroke at 221.53
    expect(Math.abs(p.centre.x - 221.53)).toBeGreaterThan(14 + 5);
    // the own piece under the run is still no obstacle
    expect(p.centre.y).toBe(100 - OFFSET);
  });
  it('a segment that crosses the box collides even with a clearance of 0', () => {
    const index = obstacleIndex([segment({ x: 100, y: -40 }, { x: 100, y: -12 }, 'other', 0)]);
    expect(placed(placeHalfLabel(leg(horizontal(0, 200)), 'e', index)).centre.x).not.toBe(100);
  });
  it('a bend under the box rejects the candidate: the label stops short of the corner', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const p = placed(placeHalfLabel(leg(points), 'e', obstacleIndex([])));
    // the middle is the corner; the first run holds d ≤ 100 − 4 − 14 = 82, the lower side comes first
    expect(p.centre).toEqual({ x: 80, y: -OFFSET });
    expect(p.degrees).toBe(0);
  });
  it('a turn of 5° or less is no bend: the label sits on the middle of the whole leg', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 3 },
    ];
    const p = placed(placeHalfLabel(leg(points), 'e', obstacleIndex([])));
    expect(p.along).toBeCloseTo(polylineLength(points) / 2);
  });
});

describe('obstacleIndex', () => {
  const items: Obstacle[] = [
    rect(10, 10, 20, 20),
    rect(60, 60, 10, 10, 6), // its grown box reaches cell (0, 0) at 54
    rect(500, 500, 10, 10),
    segment({ x: 0, y: 200 }, { x: 300, y: 200 }, 'e'), // crosses five cells of the row y = 3
  ];
  it('near returns every obstacle a box touches and none from far cells', () => {
    const index = obstacleIndex(items);
    expect([...index.near({ x: 0, y: 0, width: 50, height: 50 })]).toEqual([items[0], items[1]]);
    expect([...index.near({ x: 100, y: 190, width: 10, height: 10 })]).toEqual([items[3]]);
    expect([...index.near({ x: 300, y: 300, width: 10, height: 10 })]).toEqual([]);
    expect([...index.near({ x: 495, y: 495, width: 1, height: 1 })]).toEqual([items[2]]);
  });
  it('an obstacle filed in several cells comes back once; add files a later obstacle', () => {
    const index = obstacleIndex(items);
    expect([...index.near({ x: 0, y: 150, width: 300, height: 100 })]).toEqual([items[3]]);
    const late = rect(300, 300, 5, 5);
    index.add(late);
    expect([...index.near({ x: 300, y: 300, width: 10, height: 10 })]).toEqual([late]);
  });
  it('a placement with the grid equals a placement with a flat list', () => {
    const obstacles: Obstacle[] = [];
    for (let i = 0; i < 40; i++) {
      obstacles.push(rect((i * 37) % 300, ((i * 53) % 120) - 60, 20, 12));
      obstacles.push(
        segment(
          { x: (i * 29) % 300, y: -30 + (i % 5) * 15 },
          { x: ((i * 29) % 300) + 40, y: -30 + (i % 5) * 15 },
          `o${i}`
        )
      );
    }
    const flat: ObstacleIndex = { add: (o) => obstacles.push(o), remove() {}, near: () => obstacles };
    const legs = [horizontal(0, 300), horizontal(300, 0, 20), horizontal(0, 300, -45)].map((p) => leg(p));
    const withFlat = legs.map((l) => placeHalfLabel(l, 'e', flat));
    const withGrid = legs.map((l) => placeHalfLabel(l, 'e', obstacleIndex(obstacles)));
    expect(withGrid).toEqual(withFlat);
    expect(withGrid.some((p) => 'centre' in p && p.along !== 150)).toBe(true);
  });
  it('two runs give deep-equal output, and so does a shuffled obstacle list', () => {
    const obstacles: Obstacle[] = Array.from({ length: 30 }, (_, i) =>
      rect((i * 41) % 280, -40 + (i % 3) * 30, 24, 14)
    );
    const legs = [horizontal(0, 300), horizontal(0, 300, 30)].map((p) => leg(p));
    const run = (list: Obstacle[]) => legs.map((l) => placeHalfLabel(l, 'e', obstacleIndex(list)));
    const first = run(obstacles);
    expect(run(obstacles)).toEqual(first);
    const shuffled = [...obstacles].sort(
      (a, b) => ((a.kind === 'rect' ? a.rect.x : 0) % 7) - ((b.kind === 'rect' ? b.rect.x : 0) % 7)
    );
    expect(shuffled).not.toEqual(obstacles);
    expect(run(shuffled)).toEqual(first);
  });
});

describe('labelsVisible', () => {
  it('shows at 7 CSS px per glyph and above', () => {
    expect(labelsVisible(7 / 8)).toBe(true);
    expect(labelsVisible(1)).toBe(true);
    expect(labelsVisible(0.2)).toBe(false);
  });
});

describe('placeLinkLabels: one side for both halves', () => {
  // a vertical link at x = 0 from y = 0 to 400, split at 200: a2b runs 0 → 200, b2a runs 400 → 200
  const up = leg([
    { x: 0, y: 0 },
    { x: 0, y: 200 },
  ]);
  const down = leg([
    { x: 0, y: 400 },
    { x: 0, y: 200 },
  ]);
  const pair = (obstacles: Obstacle[]) => {
    const index = obstacleIndex(obstacles);
    const [a, b] = placeLinkLabels(up, down, 'e', index);
    return { a, b, index };
  };

  it('puts both halves on the first side when it is free', () => {
    const { a, b } = pair([]);
    expect(placed(a).side).toBe(1);
    expect(placed(b).side).toBe(1);
    expect(placed(a).centre.x).toBe(OFFSET);
    expect(placed(b).centre.x).toBe(OFFSET);
  });
  it('puts both halves on the second side when an obstacle blocks the first side of one half', () => {
    // a wall to the right of the whole b2a leg: b2a has no free spot on the first side
    const { a, b } = pair([rect(10, 200, 40, 200)]);
    expect(placed(a).side).toBe(-1);
    expect(placed(b).side).toBe(-1);
    expect(placed(a).centre.x).toBe(-OFFSET);
    expect(placed(b).centre.x).toBe(-OFFSET);
  });
  it('keeps one side when only a part of the first side is blocked', () => {
    // the spot at the middle of b2a is blocked; the half slides along the first side, it does not change side
    const { a, b } = pair([rect(10, 260, 40, 30)]);
    expect(placed(a).side).toBe(1);
    expect(placed(b).side).toBe(1);
  });
  it('lets each half take its own side only when no side holds both', () => {
    // b2a is blocked on the right, a2b on the left
    const { a, b } = pair([rect(10, 200, 40, 200), rect(-50, 0, 40, 200)]);
    expect(placed(a).side).toBe(1);
    expect(placed(b).side).toBe(-1);
  });
  it('a half that fits on no side drops; the other half keeps the first side', () => {
    const { a, b } = pair([rect(-50, 200, 100, 200)]);
    expect(placed(a).side).toBe(1);
    expect(b).toEqual({ dropped: 'no-free-spot' });
  });
  it('leaves no label of the pair in the index', () => {
    const { index } = pair([]);
    expect([...index.near({ x: -100, y: -100, width: 300, height: 600 })]).toEqual([]);
  });
  it('the first label of the pair is an obstacle for the second', () => {
    // the two legs share the run: both 0 → 200 and 200 → 0 on one side cannot overlap
    const index = obstacleIndex([]);
    const [a, b] = placeLinkLabels(
      up,
      leg([
        { x: 0, y: 200 },
        { x: 0, y: 0 },
      ]),
      'e',
      index
    );
    expect(Math.abs(placed(a).centre.y - placed(b).centre.y)).toBeGreaterThanOrEqual(26);
  });
});

describe('placeHalfLabel: sides', () => {
  it('tries only the given sides, in the given order', () => {
    const l = leg(horizontal(0, 200));
    expect(placed(placeHalfLabel(l, 'e', obstacleIndex([]), [-1])).centre).toEqual({ x: 100, y: OFFSET });
    expect(placeHalfLabel(l, 'e', obstacleIndex([rect(-10, 5, 220, 40)]), [-1])).toEqual({ dropped: 'no-free-spot' });
  });
});
