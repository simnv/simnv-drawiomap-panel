import { bendLengths, pointAt, polylineLength, type Point } from './geometry';
import * as live from './labelPlacement';
import {
  LABEL_SIDES,
  NEAR_SIDES,
  type LabelSide,
  type LegInput,
  type Obstacle,
  type Placement,
  type Rect,
} from './labelPlacement';

/*
 * Synthetic label maps for the bench and the identity test of the placement: the obstacles and the order of the
 * placement calls. `runMap` places every job in order and holds each placed box, as `linkLabels` does.
 */

export type Job =
  | { kind: 'pair'; a: LegInput; b: LegInput; own: string }
  | { kind: 'half'; leg: LegInput; own: string; sides?: readonly LabelSide[]; bendSpot?: boolean }
  /** a half placed, then placed again (`placeAgain`) with the slot width `width` */
  | { kind: 'again'; leg: LegInput; own: string; width: number };

export interface LabelMap {
  obstacles: Obstacle[];
  jobs: Job[];
}

/** The functions `runMap` calls: the module, or another build of it to compare with. */
export type PlacementApi = Pick<
  typeof live,
  'boundsOf' | 'obstacleIndex' | 'placeAgain' | 'placeHalfLabel' | 'placeLinkLabels'
>;

/** Every result of the map, in the order of the calls. */
export function runMap(map: LabelMap, api: PlacementApi = live): Array<Placement | undefined> {
  const { boundsOf, obstacleIndex, placeAgain, placeHalfLabel, placeLinkLabels } = api;
  const index = obstacleIndex(map.obstacles);
  const out: Array<Placement | undefined> = [];
  const hold = (p: Placement | undefined) => {
    out.push(p);
    if (p && 'centre' in p) {
      index.add({ kind: 'rect', rect: boundsOf(p.box), clearance: 0 });
    }
  };
  for (const job of map.jobs) {
    if (job.kind === 'pair') {
      const [a, b] = placeLinkLabels(job.a, job.b, job.own, index);
      hold(a);
      hold(b);
    } else if (job.kind === 'half') {
      hold(placeHalfLabel(job.leg, job.own, index, job.sides, job.bendSpot));
    } else {
      const first = placeHalfLabel(job.leg, job.own, index);
      out.push(first);
      if ('centre' in first) {
        const wider = { ...job.leg, size: { ...job.leg.size, width: job.width } };
        hold(placeAgain(wider, job.own, index, first));
      }
    }
  }
  return out;
}

/* ---------- the benches ---------- */

const COLUMNS = 25;
const SMALL_RECTS = 2000;

/** small boxes scattered over the 25 × 20 sheet, many near the strokes */
const scattered = (): Obstacle[] =>
  Array.from({ length: SMALL_RECTS }, (_, i) => ({
    kind: 'rect' as const,
    rect: { x: (i * 97) % (COLUMNS * 240), y: ((i * 61) % 20) * 240 + ((i % 4) - 2) * 9, width: 16, height: 10 },
    clearance: 1,
  }));

/** the strokes of a leg, each piece with its index */
const piecesOf = (points: Point[], owner: string, leg: string, clearance = 5): Obstacle[] =>
  points
    .slice(1)
    .map((b, index) => ({ kind: 'segment', a: points[index], b, clearance, owner, piece: { leg, index } }));

/** the widest head of a leg: the tip at its end, `depth` back along its last run, `2 × half` wide */
export const headOf = (points: Point[], owner: string, leg: string, depth = 12, half = 12): Obstacle => {
  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  const run = Math.hypot(tip.x - before.x, tip.y - before.y);
  const ux = (tip.x - before.x) / run;
  const uy = (tip.y - before.y) / run;
  const base = { x: tip.x - depth * ux, y: tip.y - depth * uy };
  return {
    kind: 'polygon',
    points: [tip, { x: base.x - half * uy, y: base.y + half * ux }, { x: base.x + half * uy, y: base.y - half * ux }],
    owner,
    leg,
  };
};

/**
 * The single-half bench (spec section 7): 1,000 halves on legs of 100 units against 2,000 rects and 500 strokes.
 * Every fortieth horizontal edge has a wide body across both sides of its a2b leg: that half drops.
 */
export function singleBenchMap(): LabelMap {
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
  const obstacles: Obstacle[] = scattered().map((o, i) => {
    if (i % 40 !== 0) {
      return o;
    }
    const [a] = edge((i / 40) * 2);
    return { kind: 'rect', rect: { x: a.x - 10, y: a.y - 40, width: 120, height: 80 }, clearance: 0 };
  });
  const jobs: Job[] = [];
  for (let i = 0; i < 500; i++) {
    const [a, b] = edge(i);
    obstacles.push({ kind: 'segment', a, b, clearance: 5, owner: `e${i}` });
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const pts of [
      [a, mid],
      [b, mid],
    ]) {
      jobs.push({
        kind: 'half',
        own: `e${i}`,
        leg: { points: pts, bends: [], length: 100, size: { width: 24, height: 10 }, strokeRoot: 10 },
      });
    }
  }
  return { obstacles, jobs };
}

/** the percent slot on linkWidth 2 to 10: the stroke reservation 10, the heads 8 (thin) to 24 (widest) wide */
const PAIR_SIZES = { size: { width: 28, height: 10 }, strokeRoot: 10, minRoot: 2, headRoot: 24, headMinRoot: 8 };

const legInput = (points: Point[], id: string, extra: Partial<LegInput> = {}): LegInput => ({
  id,
  points,
  bends: bendLengths(points),
  length: polylineLength(points),
  ...PAIR_SIZES,
  ...extra,
});

/**
 * The pair bench: 500 links placed in pairs, each half with its strokes and its widest head. A third are bent links
 * of 200 units, a third are links of 36 units (only the sides beside the heads hold a box), and a third lie under a
 * body that covers both sides (every ladder runs to its end).
 */
export function pairBenchMap(): LabelMap {
  const bounds = { x: -100, y: -100, width: COLUMNS * 240 + 200, height: 20 * 240 + 200 };
  const obstacles: Obstacle[] = [];
  const jobs: Job[] = [];
  for (let i = 0; i < 500; i++) {
    const owner = `e${i}`;
    const x = (i % COLUMNS) * 240;
    const y = Math.floor(i / COLUMNS) * 240;
    const kind = i % 3;
    const [a2b, b2a] =
      kind === 1
        ? [
            [
              { x, y },
              { x, y: y + 18 },
            ],
            [
              { x, y: y + 36 },
              { x, y: y + 18 },
            ],
          ]
        : [
            [
              { x, y },
              { x: x + 60, y },
              { x: x + 60, y: y + 40 },
            ],
            [
              { x: x + 60, y: y + 140 },
              { x: x + 60, y: y + 40 },
            ],
          ];
    for (const [which, points] of [
      ['a2b', a2b],
      ['b2a', b2a],
    ] as const) {
      obstacles.push(...piecesOf(points, owner, `${owner}:${which}`), headOf(points, owner, `${owner}:${which}`));
    }
    if (kind === 2) {
      obstacles.push({ kind: 'rect', rect: { x: x - 80, y: y - 80, width: 220, height: 300 }, clearance: 0 });
    }
    jobs.push({
      kind: 'pair',
      own: owner,
      a: legInput(a2b, `${owner}:a2b`, { bounds }),
      b: legInput(b2a, `${owner}:b2a`, { bounds }),
    });
  }
  obstacles.push(...scattered());
  return { obstacles, jobs };
}

/** The two legs of a polyline, split at the middle of its length: each runs from its end towards the split. */
function splitLegs(pts: Point[]): [Point[], Point[]] {
  const length = polylineLength(pts);
  const mid = pointAt(pts, length / 2);
  const split = { x: mid.x, y: mid.y };
  let at = 0;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (run >= length / 2) {
      at = i - 1;
      break;
    }
  }
  return [
    [...pts.slice(0, at + 1), split],
    [...pts.slice(at + 1).reverse(), split],
  ];
}

/**
 * A crowded map: 565 links between 200 nodes of 80 × 40 on a 180-unit grid, each link out of its node by a short
 * diagonal, along a shared lane, and into the other node. Forty links start at one hub. Many halves drop after the
 * whole ladder.
 */
export function crowdedMap(): LabelMap {
  const NODES = 200;
  const LINKS = 565;
  const obstacles: Obstacle[] = [];
  for (let i = 0; i < NODES; i++) {
    const x = 60 + (i % 20) * 180;
    const y = 60 + Math.floor(i / 20) * 180;
    obstacles.push({ kind: 'rect', rect: { x, y, width: 80, height: 40 }, clearance: 2 });
  }
  const bounds = { x: 0, y: 0, width: 3800, height: 2000 };
  const jobs: Job[] = [];
  for (let i = 0; i < LINKS; i++) {
    const a = i < 40 ? 0 : i % NODES;
    const b = i < 40 ? (i + 1) % NODES : (a + 1 + (i % 7)) % NODES;
    const ax = 100 + (a % 20) * 180;
    const ay = 80 + Math.floor(a / 20) * 180;
    const bx = 100 + (b % 20) * 180;
    const by = 80 + Math.floor(b / 20) * 180;
    const lane = ay + ((i % 5) - 2) * 15;
    const pts = [
      { x: ax, y: ay },
      { x: ax + 40, y: lane },
      { x: bx - 40, y: lane },
      { x: bx, y: by },
    ];
    const owner = `l${i}`;
    const [a2b, b2a] = splitLegs(pts);
    obstacles.push(
      ...piecesOf(a2b, owner, `${owner}:a2b`),
      ...piecesOf(b2a, owner, `${owner}:b2a`),
      headOf(a2b, owner, `${owner}:a2b`),
      headOf(b2a, owner, `${owner}:b2a`)
    );
    jobs.push({
      kind: 'pair',
      own: owner,
      a: legInput(a2b, `${owner}:a2b`, { bounds }),
      b: legInput(b2a, `${owner}:b2a`, { bounds }),
    });
  }
  return { obstacles, jobs };
}

/* ---------- random maps ---------- */

/** mulberry32: a small seeded generator, the same numbers on every run */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random map on a 600 × 400 sheet. The vertices and the obstacles stand on a grid of whole or half units, so many
 * boxes touch an obstacle exactly: the tests at the border decide often. The runs are horizontal, vertical, at 45°
 * or at any angle; some legs have bounds, some halves try the bend spots, some are placed again with a new width.
 */
export function randomMap(seed: number): LabelMap {
  const rnd = seeded(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const snap = (v: number) => Math.round(v * 2) / 2;
  const W = 600;
  const H = 400;
  const obstacles: Obstacle[] = [];
  const jobs: Job[] = [];
  const bounds: Rect = { x: 0, y: 0, width: W, height: H };
  for (let i = int(10, 60); i > 0; i--) {
    obstacles.push({
      kind: 'rect',
      rect: { x: int(0, W), y: int(0, H), width: pick([0, 4, 16, 30, 80]), height: pick([0, 6, 10, 24, 40]) },
      clearance: pick([0, 0, 1, 2]),
    });
  }
  for (let i = int(0, 6); i > 0; i--) {
    const x = int(0, W);
    const y = int(0, H);
    obstacles.push({
      kind: 'polygon',
      points: [
        { x, y },
        { x: x + int(4, 30), y: y + int(-20, 20) },
        { x: x + int(-10, 10), y: y + int(4, 30) },
      ],
    });
  }
  const links = int(8, 40);
  for (let i = 0; i < links; i++) {
    const owner = `r${i}`;
    const pts: Point[] = [{ x: int(20, W - 20), y: int(20, H - 20) }];
    for (let k = int(1, 4); k > 0; k--) {
      const last = pts[pts.length - 1];
      const length = int(10, 160);
      const angle = pick([0, 90, 180, 270, 0, 90, 180, 270, 45, 135, 225, 315, rnd() * 360]);
      const r = (angle * Math.PI) / 180;
      pts.push({ x: snap(last.x + Math.cos(r) * length), y: snap(last.y + Math.sin(r) * length) });
    }
    if (!(polylineLength(pts) > 0) || pts.some((p, k) => k > 0 && p.x === pts[k - 1].x && p.y === pts[k - 1].y)) {
      continue;
    }
    const strokeRoot = pick([2, 4, 10]);
    const sizes: Partial<LegInput> = {
      size: { width: int(8, 40), height: pick([8, 10]) },
      strokeRoot,
      minRoot: pick([undefined, 1, 2, strokeRoot]),
      headRoot: pick([undefined, strokeRoot, 12, 24]),
      headMinRoot: pick([undefined, 4, 8]),
      bounds: rnd() < 0.5 ? bounds : undefined,
    };
    const clearance = pick([0, 2, 5]);
    const style = rnd();
    if (style < 0.6) {
      const [a2b, b2a] = splitLegs(pts);
      obstacles.push(
        ...piecesOf(a2b, owner, `${owner}:a2b`, clearance),
        ...piecesOf(b2a, owner, `${owner}:b2a`, clearance),
        headOf(a2b, owner, `${owner}:a2b`),
        headOf(b2a, owner, `${owner}:b2a`, 8, 6)
      );
      jobs.push({
        kind: 'pair',
        own: owner,
        a: legInput(a2b, `${owner}:a2b`, sizes),
        b: legInput(b2a, `${owner}:b2a`, sizes),
      });
    } else {
      const id = `${owner}:a2b`;
      obstacles.push(...piecesOf(pts, owner, id, clearance), headOf(pts, owner, id));
      const leg = legInput(pts, id, sizes);
      if (style < 0.8) {
        jobs.push({
          kind: 'half',
          leg,
          own: owner,
          sides: pick([LABEL_SIDES, NEAR_SIDES, [1, -1]]),
          bendSpot: rnd() < 0.7,
        });
      } else {
        jobs.push({ kind: 'again', leg, own: owner, width: int(4, 50) });
      }
    }
  }
  return { obstacles, jobs };
}

/** The results as text that keeps every bit of every number (−0 too): two runs match when their texts match. */
export function placementText(results: ReadonlyArray<Placement | undefined>): string {
  return JSON.stringify(results, (_key, value: unknown) =>
    typeof value === 'number' ? (Object.is(value, -0) ? '-0' : value.toString()) : value
  );
}
