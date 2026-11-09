import { describe, expect, it } from 'vitest';
import { polylineLength, slicePolyline, type Point } from './geometry';
import { pointTaper } from './pointTaper';

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

// the distance from p to the segment a-b; the property loops call it often, so it allocates nothing
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function distance(p: Point, path: Point[]): number {
  let shortest = Infinity;
  for (let i = 1; i < path.length; i++) {
    shortest = Math.min(shortest, segmentDistance(p, path[i - 1], path[i]));
  }
  return shortest;
}

function simple(head: Point[], path?: Point[]): void {
  expect(head.length).toBeGreaterThanOrEqual(3);
  let crossed = false;
  let witness = '';
  let shortest = Infinity;
  for (let i = 0; i < head.length; i++) {
    const a = head[i],
      b = head[(i + 1) % head.length];
    shortest = Math.min(shortest, Math.hypot(a.x - b.x, a.y - b.y));
    for (let j = i + 2; j < head.length; j++) {
      if (i === 0 && j === head.length - 1) {
        continue;
      }
      const c = head[j],
        d = head[(j + 1) % head.length];
      const o = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
      const overlap =
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
      const epsilon =
        64 *
        Number.EPSILON *
        Math.max(
          1,
          Math.abs(a.x),
          Math.abs(a.y),
          Math.abs(b.x),
          Math.abs(b.y),
          Math.abs(c.x),
          Math.abs(c.y),
          Math.abs(d.x),
          Math.abs(d.y)
        );
      const touch =
        Math.min(
          segmentDistance(a, c, d),
          segmentDistance(b, c, d),
          segmentDistance(c, a, b),
          segmentDistance(d, a, b)
        ) <= epsilon;
      if (touch || (overlap && o[0] * o[1] < 0 && o[2] * o[3] < 0)) {
        crossed = true;
        witness = JSON.stringify({ path, a, b, c, d, o });
      }
    }
  }
  expect(shortest).toBeGreaterThan(1e-12);
  expect(crossed, witness || 'nonadjacent edges must not cross').toBe(false);
}

function contained(head: Point[], path: Point[], width: number): void {
  let farthest = 0;
  for (let i = 0; i < head.length; i++) {
    const a = head[i],
      b = head[(i + 1) % head.length];
    for (const t of [0, 0.25, 0.5, 0.75]) {
      farthest = Math.max(farthest, distance({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, path));
    }
  }
  expect(farthest).toBeLessThanOrEqual(width / 2 + 1e-7);
}

function paired(head: Point[], taper: Point[], width: number): void {
  expect(head.length % 2).toBe(1);
  const n = (head.length - 1) / 2;
  const baseA = head[n],
    baseB = head[n + 1];
  expect(Math.hypot(baseA.x - baseB.x, baseA.y - baseB.y)).toBeCloseTo(width, 9);
  expect(head[0].x).toBeCloseTo(taper.at(-1)!.x, 9);
  expect(head[0].y).toBeCloseTo(taper.at(-1)!.y, 9);
  for (let i = 1; i <= n; i++) {
    const a = head[i],
      b = head[head.length - i];
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(distance(centre, taper)).toBeLessThan(1e-8);
    expect(Math.hypot(a.x - centre.x, a.y - centre.y)).toBeCloseTo(Math.hypot(b.x - centre.x, b.y - centre.y), 9);
  }
}

const pathOf = (pairs: number[][]): Point[] => pairs.map(([x, y]) => ({ x, y }));

describe('point taper properties', () => {
  it('keeps paired joins, a full-width base and the envelope for nonfolding paths', () => {
    let seed = 0x51a793;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const cases = [
      pathOf([
        [0, 0],
        [80, 0],
        [80, 20],
        [86, 20],
      ]),
      pathOf([
        [0, 0],
        [4, 0],
        [4, 4],
      ]),
      pathOf([
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2],
      ]),
      pathOf([
        [0, 0],
        [0.02, 0],
        [0.02, 0.01],
      ]),
      pathOf([
        [0, 0],
        [0.00002, 0],
        [0.00002, 0.00001],
      ]),
    ];
    for (let i = 0; i < 240; i++) {
      const path = [{ x: 0, y: 0 }];
      const rotation = random() * Math.PI * 2;
      for (let j = 0; j < 2 + (i % 5); j++) {
        const angle = rotation + (random() * Math.PI) / 2;
        const size = 0.01 + random() * 12;
        const last = path.at(-1)!;
        path.push({ x: last.x + Math.cos(angle) * size, y: last.y + Math.sin(angle) * size });
      }
      cases.push(path);
    }
    for (const path of cases) {
      for (const reverse of [false, true]) {
        const p = reverse ? [...path].reverse() : path;
        const width = 2 + random() * 8;
        const length = polylineLength(p),
          headLength = 8 + (width - 2) / 2;
        const result = pointTaper(p, width, headLength);
        expect(result.folded, JSON.stringify(p)).toBe(false);
        simple(result.head, p);
        contained(result.head, p, width);
        paired(result.head, slicePolyline(p, Math.max(0, length - headLength), length), width);
        if (length <= headLength) {
          expect(result.line).toEqual([]);
        } else {
          expect(result.line.at(-1)).toEqual(slicePolyline(p, 0, length - headLength).at(-1));
        }
      }
    }
  });

  it('keeps the full base and paired boundaries through acute nonfolding turns', () => {
    let seed = 0x31876;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 100; i++) {
      // The first run fixes the base normal. Every later segment advances along x, within the taper length.
      const path = pathOf([
        [0, 0],
        [6, 0],
      ]);
      for (let j = 0; j < 2 + (i % 4); j++) {
        const angle = ((random() - 0.5) * 170 * Math.PI) / 180;
        const size = 0.01 + random() * 0.2;
        const last = path.at(-1)!;
        path.push({ x: last.x + Math.cos(angle) * size, y: last.y + Math.sin(angle) * size });
      }
      const result = pointTaper(path, 10, 12);
      expect(result.folded, JSON.stringify(path)).toBe(false);
      simple(result.head, path);
      contained(result.head, path, 10);
      paired(result.head, path, 10);
    }
    for (const sign of [-1, 1]) {
      const path = pathOf([
        [0, 0],
        [4, 0],
        [2, sign * 0.1],
      ]);
      const result = pointTaper(path, 10, 12);
      expect(result.folded).toBe(false);
      simple(result.head, path);
      contained(result.head, path, 10);
      paired(result.head, path, 10);
    }
  });

  it('keeps a simple contained tip for acute returns and true centreline crossings', () => {
    for (let y = 0.1; y <= 3; y += 0.2) {
      for (const sign of [-1, 1]) {
        const path = pathOf([
          [0, 0],
          [4, 0],
          [-1, y * sign],
        ]);
        const result = pointTaper(path, 10, 12);
        expect(result.folded).toBe(true);
        expect(result.head[0]).toEqual(path.at(-1));
        simple(result.head);
        contained(result.head, path, 10);
      }
    }
    for (const path of [
      pathOf([
        [0, 0],
        [4, 0],
        [0, 1],
      ]),
      pathOf([
        [0, 0],
        [4, 0],
        [0, 0],
      ]),
      pathOf([
        [0, 0],
        [4, 0],
        [2, 0],
      ]),
      pathOf([
        [0, 0],
        [3, 3],
        [0, 3],
        [3, 0],
      ]),
    ]) {
      const result = pointTaper(path, 10, 12);
      expect(result.folded).toBe(true);
      expect(result.head[0]).toEqual(path.at(-1));
      simple(result.head);
      contained(result.head, path, 10);
    }
  });

  it('reflects both boundaries together for clockwise and counterclockwise elbows', () => {
    const path = pathOf([
      [0, 0],
      [80, 0],
      [80, 20],
      [86, 20],
    ]);
    const head = pointTaper(path, 10, 12).head;
    const reflected = pointTaper(
      path.map(({ x, y }) => ({ x, y: -y })),
      10,
      12
    ).head;
    expect(reflected[0]).toEqual({ x: head[0].x, y: -head[0].y });
    for (let i = 1; i < head.length; i++) {
      expect(reflected[head.length - i].x).toBeCloseTo(head[i].x, 9);
      expect(reflected[head.length - i].y).toBeCloseTo(-head[i].y, 9);
    }
  });

  it('preserves straight point coordinates and omits shafts below the head length', () => {
    for (const length of [0.0001, 0.01, 0.05, 0.1, 1, 8, 20]) {
      const result = pointTaper(
        pathOf([
          [0, 0],
          [length, 0],
        ]),
        10,
        12
      );
      expect(result.head).toEqual(
        pathOf([
          [length, 0],
          [Math.max(0, length - 12), -5],
          [Math.max(0, length - 12), 5],
        ])
      );
      expect(result.line).toEqual(
        length <= 12
          ? []
          : pathOf([
              [0, 0],
              [length - 12, 0],
            ])
      );
    }
    expect(
      pointTaper(
        pathOf([
          [0, 0],
          [0, 0],
        ]),
        10,
        12
      )
    ).toEqual({ line: [], head: [], folded: false });
  });
});
