import { afterEach, describe, expect, it } from 'vitest';
import { clearFakeLayout, clientRect, fakeLayout } from '../render/layoutTestKit';
import { createTheme } from '@grafana/data';
import { markNearLink, NEAR_CLASS, NEAR_MARK_CLASS, renderOverlay } from '../render/overlay';
import { catchRadius, nearestLink, NearLinkFinder, segmentDistance2, segmentsOf } from './nearLink';
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
  it('puts one class on the layer of the link and an underlay under its halves; another link takes it', () => {
    const { root, index, patches } = nearStage({ l1: 'M 0 100 L 400 100', l2: 'M 0 200 L 400 200' });
    const layer = (id: string) => root.querySelector(`[data-cell-id="${id}"] g.dmap-overlay`)!;
    markNearLink(root, 'l1');
    expect(layer('l1').classList.contains(NEAR_CLASS)).toBe(true);
    const marks = layer('l1').querySelectorAll(`.${NEAR_MARK_CLASS}`);
    expect(marks).toHaveLength(2);
    // the underlay comes first, below the halves: a glow of three strokes, wide and faint to narrow and strong
    expect(layer('l1').firstElementChild).toBe(marks[0]);
    expect(marks[0].getAttribute('pointer-events')).toBe('none');
    const strokes = [...marks[0].querySelectorAll('polyline')];
    expect(strokes.map((p) => [p.getAttribute('stroke-width'), p.getAttribute('stroke-opacity')])).toEqual([
      ['15', '0.25'],
      ['9', '0.4'],
      ['5', '0.75'],
    ]);
    expect(strokes.every((p) => p.getAttribute('stroke') === 'currentColor')).toBe(true);
    markNearLink(root, 'l2');
    expect(layer('l1').classList.contains(NEAR_CLASS)).toBe(false);
    // a new width range draws the layers again: the mark stays on its link
    renderOverlay(root, index, patches, { theme: createTheme(), maxWidth: 12 });
    expect(layer('l2').classList.contains(NEAR_CLASS)).toBe(true);
    expect(layer('l2').querySelectorAll(`.${NEAR_MARK_CLASS}`)).toHaveLength(2);
    expect(layer('l2').classList.contains(NEAR_CLASS)).toBe(true);
    markNearLink(root, undefined);
    expect(root.querySelectorAll(`.${NEAR_CLASS}`)).toHaveLength(0);
  });
});
