import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSanitizeCache, sanitizeCacheStats } from '../render/sanitize';
import { DEFER_ABOVE, type Stage, useStage } from './useStage';

const svgOf = (id: string, pad = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>${'x'.repeat(pad)}</desc><g data-cell-id="${id}"><rect width="1" height="1"/></g></svg>`;
const small = (id: string) => svgOf(id);
const large = (id: string) => svgOf(id, DEFER_ABOVE);

function Harness({
  svg,
  onStage,
  deferAbove = DEFER_ABOVE,
}: {
  svg?: string;
  onStage: (s: Stage) => void;
  deferAbove?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stage = useStage(ref, svg, deferAbove);
  onStage(stage);
  return <div data-testid="stage" ref={ref} />;
}

/** One frame, then the timer of the deferred build. */
const settle = async () => {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
    await new Promise((done) => setTimeout(done, 0));
  });
};

const cellsOf = (stage: Stage) => [...stage.index.keys()];

describe('useStage', () => {
  beforeEach(() => clearSanitizeCache());

  it('builds a small diagram during the render', () => {
    let stage!: Stage;
    const { container } = render(<Harness svg={small('a')} onStage={(s) => (stage = s)} />);
    expect(cellsOf(stage)).toEqual(['a']);
    expect(stage.pending).toBe(false);
    expect(container.querySelector('[data-testid="stage"] svg')).toBe(stage.root!);
  });

  it('builds a large diagram during the render without a limit (the split editor)', () => {
    let stage!: Stage;
    render(<Harness svg={large('a')} deferAbove={Infinity} onStage={(s) => (stage = s)} />);
    expect(cellsOf(stage)).toEqual(['a']);
    expect(stage.pending).toBe(false);
  });

  it('returns the empty stage without a diagram', () => {
    let stage!: Stage;
    render(<Harness onStage={(s) => (stage = s)} />);
    expect(stage.root).toBeUndefined();
    expect(cellsOf(stage)).toEqual([]);
    expect(sanitizeCacheStats().misses).toBe(0);
  });

  it('builds a large diagram after the first paint and shows nothing until then', async () => {
    let stage!: Stage;
    const { container } = render(<Harness svg={large('a')} onStage={(s) => (stage = s)} />);
    expect(stage.root).toBeUndefined();
    expect(stage.pending).toBe(true);
    expect(container.querySelector('svg')).toBeNull();
    expect(sanitizeCacheStats().misses).toBe(0);
    await settle();
    expect(cellsOf(stage)).toEqual(['a']);
    expect(stage.pending).toBe(false);
    expect(container.querySelector('[data-testid="stage"] svg')).toBe(stage.root!);
    expect(sanitizeCacheStats().misses).toBe(1);
  });

  it('shows nothing of the previous diagram while the next large one builds', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    const first = stage.root!;
    rerender(<Harness svg={large('b')} onStage={onStage} />);
    expect(stage.pending).toBe(true);
    expect(stage.root).toBeUndefined();
    expect(cellsOf(stage)).toEqual([]);
    expect(container.querySelector('svg')).toBeNull();
    await settle();
    expect(cellsOf(stage)).toEqual(['b']);
    expect(stage.pending).toBe(false);
    expect(container.querySelector('svg')).toBe(stage.root!);
    expect(stage.root).not.toBe(first);
  });

  it('never shows a build whose completion batches with the request of a newer diagram', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    rerender(<Harness svg={large('b')} onStage={onStage} />);
    // the build of b completes in the same batch as the request of c
    await act(async () => {
      await new Promise((done) => requestAnimationFrame(() => done(undefined)));
      await new Promise((done) => setTimeout(done, 0));
      rerender(<Harness svg={large('c')} onStage={onStage} />);
    });
    expect(sanitizeCacheStats().misses).toBe(2);
    expect(stage.pending).toBe(true);
    expect(cellsOf(stage)).toEqual([]);
    expect(container.querySelector('svg')).toBeNull();
    await settle();
    expect(cellsOf(stage)).toEqual(['c']);
    expect(stage.pending).toBe(false);
    expect(container.querySelector('svg')).toBe(stage.root!);
  });

  it('shows a small diagram at once in the place of a large one', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    rerender(<Harness svg={small('b')} onStage={onStage} />);
    expect(cellsOf(stage)).toEqual(['b']);
    expect(container.querySelector('svg')).toBe(stage.root!);
    await settle();
    expect(cellsOf(stage)).toEqual(['b']);
  });

  it('cancels a deferred build that a new diagram replaces before it starts', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    rerender(<Harness svg={large('b')} onStage={onStage} />);
    await settle();
    expect(cellsOf(stage)).toEqual(['b']);
    // only b was sanitised
    expect(sanitizeCacheStats().misses).toBe(1);
  });

  it('does not build after an unmount', async () => {
    const { unmount } = render(<Harness svg={large('a')} onStage={() => {}} />);
    unmount();
    await settle();
    expect(sanitizeCacheStats().misses).toBe(0);
  });

  it('builds once per svg text across renders', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    const root = stage.root;
    rerender(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    expect(stage.root).toBe(root);
    expect(sanitizeCacheStats().misses).toBe(1);
    rerender(<Harness svg={small('c')} onStage={onStage} />);
    expect(cellsOf(stage)).toEqual(['c']);
    expect(sanitizeCacheStats().misses).toBe(2);
  });

  it('drops the stage when the diagram goes away', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    expect(stage.root).toBeDefined();
    rerender(<Harness onStage={onStage} />);
    expect(stage.root).toBeUndefined();
    expect(container.querySelector('svg')).toBeNull();
  });

  // Two diagrams with one saved hash: fnv1a(svg + '<mxfile/>') of both is 3e3baa48 (a 32-bit hash collides).
  // The hook compares the svg text itself, so the second diagram builds.
  const collide = (id: string, pad: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>${'x'.repeat(pad)}</desc><g data-cell-id="${id}"><rect width="1" height="1"/></g></svg>`;

  it('builds a different large diagram again, also when its saved hash is the same', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={collide('316bfc8d', DEFER_ABOVE)} onStage={onStage} />);
    await settle();
    expect(cellsOf(stage)).toEqual(['316bfc8d']);
    rerender(<Harness svg={collide('5cfda2c7', DEFER_ABOVE)} onStage={onStage} />);
    expect(stage.pending).toBe(true);
    expect(cellsOf(stage)).toEqual([]);
    await settle();
    expect(cellsOf(stage)).toEqual(['5cfda2c7']);
    expect(sanitizeCacheStats().misses).toBe(2);
  });

  it('builds a different small diagram again in the render', () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={collide('316bfc8d', 0)} onStage={onStage} />);
    expect(cellsOf(stage)).toEqual(['316bfc8d']);
    rerender(<Harness svg={collide('5cfda2c7', 0)} onStage={onStage} />);
    expect(cellsOf(stage)).toEqual(['5cfda2c7']);
  });

  it('keeps the stage for an equal svg text in a new string', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={large('a')} onStage={onStage} />);
    await settle();
    const root = stage.root;
    rerender(<Harness svg={large('a').slice(0)} onStage={onStage} />);
    expect(stage.pending).toBe(false);
    expect(stage.root).toBe(root);
    await settle();
    expect(sanitizeCacheStats().misses).toBe(1);
  });
});
