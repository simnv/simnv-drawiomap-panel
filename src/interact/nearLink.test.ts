import { afterEach, describe, expect, it } from 'vitest';
import { clearFakeLayout, clientRect, fakeLayout } from '../render/layoutTestKit';
import { createTheme } from '@grafana/data';
import { markNearLink, NEAR_CLASS, renderOverlay } from '../render/overlay';
import {
  catchRadius,
  nearestLink,
  NearLinkFinder,
  SegmentGrid,
  segmentDistance2,
  segmentsOf,
  type Segment,
} from './nearLink';
import { nearStage } from './nearLink.testKit';

const all = () => true;

describe('the distance to a polyline', () => {
  const corner = segmentsOf('l', [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ]);
  const distance = (x: number, y: number) => Math.sqrt(Math.min(...corner.map((s) => segmentDistance2(x, y, s))));

  it('is the distance to the nearest segment, and to an end beyond the ends', () => {
    expect(distance(50, 6)).toBeCloseTo(6);
    expect(distance(106, 25)).toBeCloseTo(6);
    expect(distance(-3, -4)).toBeCloseTo(5);
    expect(distance(103, 54)).toBeCloseTo(5);
    // at the bend: the corner point
    expect(distance(103, -4)).toBeCloseTo(5);
  });

  it('is the distance to the point for a segment of zero length', () => {
    expect(segmentDistance2(3, 4, { cellId: 'p', ax: 0, ay: 0, bx: 0, by: 0 })).toBeCloseTo(25);
  });
});

describe('nearestLink', () => {
  // two parallel links 14 units apart, as in a bundle
  const segments = [
    ...segmentsOf('top', [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]),
    ...segmentsOf('bottom', [
      { x: 0, y: 14 },
      { x: 200, y: 14 },
    ]),
  ];

  it('gives the closer of two parallel links: the middle line splits them', () => {
    expect(nearestLink(segments, { x: 50, y: 6.9 }, 8, all)).toBe('top');
    expect(nearestLink(segments, { x: 50, y: 7.1 }, 8, all)).toBe('bottom');
    expect(nearestLink(segments, { x: 50, y: -5 }, 8, all)).toBe('top');
    expect(nearestLink(segments, { x: 50, y: 20 }, 8, all)).toBe('bottom');
  });

  it('gives nothing outside the radius', () => {
    expect(nearestLink(segments, { x: 50, y: -8.5 }, 8, all)).toBeUndefined();
    expect(nearestLink(segments, { x: 250, y: 0 }, 8, all)).toBeUndefined();
  });

  it('skips a link that opens no card: the next one in the radius wins', () => {
    expect(nearestLink(segments, { x: 50, y: 3 }, 16, (id) => id !== 'top')).toBe('bottom');
    expect(nearestLink(segments, { x: 50, y: 3 }, 8, (id) => id !== 'top')).toBeUndefined();
  });
});

describe('catchRadius', () => {
  it('is 8 px for a mouse or a pen and 16 px for a finger', () => {
    expect(catchRadius('mouse')).toBe(8);
    expect(catchRadius('pen')).toBe(8);
    expect(catchRadius('touch')).toBe(16);
  });
});

describe('NearLinkFinder', () => {
  afterEach(() => {
    clearFakeLayout();
    document.body.innerHTML = '';
  });

  const zoom = (k: number, e = 0, f = 0) => ({ a: k, b: 0, c: 0, d: k, e, f });

  it('measures the radius in screen px at every zoom: 8 px for a mouse, 16 px for a finger', () => {
    let screen = zoom(1);
    fakeLayout(
      () => undefined,
      clientRect(0, 0, 800, 600),
      () => screen
    );
    const { root, index } = nearStage({ l1: 'M 0 100 L 400 100' });
    const finder = new NearLinkFinder();
    expect(finder.find(root, index, 200, 107, 'mouse', all)).toBe('l1');
    expect(finder.find(root, index, 200, 109, 'mouse', all)).toBeUndefined();
    expect(finder.find(root, index, 200, 115, 'touch', all)).toBe('l1');
    expect(finder.find(root, index, 200, 117, 'touch', all)).toBeUndefined();
    // at a 0.5 zoom the link is at y 50 on the screen; 7 px off is 14 units off
    screen = zoom(0.5);
    finder.invalidate();
    expect(finder.find(root, index, 100, 57, 'mouse', all)).toBe('l1');
    expect(finder.find(root, index, 100, 59, 'mouse', all)).toBeUndefined();
  });

  it('keeps the screen transform until invalidate', () => {
    let screen = zoom(1);
    fakeLayout(
      () => undefined,
      clientRect(0, 0, 800, 600),
      () => screen
    );
    const { root, index } = nearStage({ l1: 'M 0 100 L 400 100' });
    const finder = new NearLinkFinder();
    expect(finder.find(root, index, 200, 104, 'mouse', all)).toBe('l1');
    // a pan of 300 px down: the old transform still holds until the view tells the finder
    screen = zoom(1, 0, 300);
    expect(finder.find(root, index, 200, 104, 'mouse', all)).toBe('l1');
    finder.invalidate();
    expect(finder.find(root, index, 200, 104, 'mouse', all)).toBeUndefined();
    expect(finder.find(root, index, 200, 404, 'mouse', all)).toBe('l1');
  });

  it('reads the links of a new index, and catches a link the overlay did not draw', () => {
    fakeLayout(() => undefined);
    const { root, index } = nearStage({ l1: 'M 0 100 L 400 100', l2: 'M 0 200 L 400 200' });
    const finder = new NearLinkFinder();
    expect(finder.find(root, index, 200, 204, 'mouse', all)).toBe('l2');
    // a link with no traffic halves has no overlay layer: its draw.io path still counts
    root.querySelector('[data-cell-id="l2"] g.dmap-overlay')!.remove();
    expect(finder.find(root, index, 200, 204, 'mouse', all)).toBe('l2');
    const fewer = new Map(index);
    fewer.delete('l2');
    expect(finder.find(root, fewer, 200, 204, 'mouse', all)).toBeUndefined();
  });
});

describe('markNearLink', () => {
  it('puts the near class on the layer of the link; another link takes it; a rebuilt layer keeps it', () => {
    const { root, index, patches } = nearStage({ l1: 'M 0 100 L 400 100', l2: 'M 0 200 L 400 200' });
    const layer = (id: string) => root.querySelector(`[data-cell-id="${id}"] g.dmap-overlay`)!;
    markNearLink(root, 'l1');
    expect(layer('l1').classList.contains(NEAR_CLASS)).toBe(true);
    markNearLink(root, 'l2');
    expect(layer('l1').classList.contains(NEAR_CLASS)).toBe(false);
    // a new width range draws the layers again: the class stays on its link
    renderOverlay(root, index, patches, { theme: createTheme(), maxWidth: 12 });
    expect(layer('l2').classList.contains(NEAR_CLASS)).toBe(true);
    markNearLink(root, undefined);
    expect(root.querySelectorAll(`.${NEAR_CLASS}`)).toHaveLength(0);
  });
});

describe('the segment grid', () => {
  /** A small fixed pseudo-random sequence, so a failure repeats. */
  function rng(seed: number) {
    let x = seed;
    return () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  }
  function scene(rand: () => number): Segment[] {
    const out: Segment[] = [];
    for (let i = 0; i < 120; i++) {
      const id = `l${i % 40}`; // several segments per link, some crossing and overlapping
      const long = i % 15 === 0;
      const ax = rand() * 1000 - 100;
      const ay = rand() * 1000 - 100;
      const horizontal = rand() < 0.5;
      const len = (long ? 3000 : 20 + rand() * 300) * (rand() < 0.5 ? -1 : 1);
      // some on shared coordinates, so that there are exact ties
      const sx = Math.round(ax / 50) * 50;
      const sy = Math.round(ay / 50) * 50;
      out.push({ cellId: id, ax: sx, ay: sy, bx: horizontal ? sx + len : sx, by: horizontal ? sy : sy + len });
    }
    out.push({ cellId: 'diag', ax: 0, ay: 0, bx: 900, by: 700 }, { cellId: 'dot', ax: 500, ay: 500, bx: 500, by: 500 });
    return out;
  }

  it('answers as the plain scan does, including the ties and the order of the accept calls', () => {
    const rand = rng(7);
    const segments = scene(rand);
    const grid = new SegmentGrid(segments);
    for (let n = 0; n < 3000; n++) {
      const p = { x: rand() * 1200 - 150, y: rand() * 1200 - 150 };
      const radius = [4, 8, 16, 40, 300][n % 5];
      const refused = new Set([`l${n % 40}`, `l${(n * 7) % 40}`]);
      const plainCalls: string[] = [];
      const gridCalls: string[] = [];
      const plain = nearestLink(segments, p, radius, (id) => (plainCalls.push(id), !refused.has(id)));
      const fast = grid.nearest(p, radius, (id) => (gridCalls.push(id), !refused.has(id)));
      expect(fast).toBe(plain);
      // the plain scan asks for every segment in range; the grid for the same, in the same order
      expect(gridCalls).toEqual(plainCalls);
    }
  });

  it('answers a radius bigger than the grid window and a point far outside by the plain result', () => {
    const segments = scene(rng(3));
    const grid = new SegmentGrid(segments);
    for (const p of [
      { x: 1e9, y: -1e9 },
      { x: 400, y: 400 },
    ]) {
      for (const radius of [5000, 1e12]) {
        expect(grid.nearest(p, radius, all)).toBe(nearestLink(segments, p, radius, all));
      }
    }
  });

  it('skips a segment with no position and handles no segments', () => {
    const grid = new SegmentGrid([{ cellId: 'bad', ax: NaN, ay: 0, bx: 1, by: 1 }]);
    expect(grid.nearest({ x: 0, y: 0 }, 8, all)).toBeUndefined();
    expect(new SegmentGrid([]).nearest({ x: 0, y: 0 }, 8, all)).toBeUndefined();
  });
});
