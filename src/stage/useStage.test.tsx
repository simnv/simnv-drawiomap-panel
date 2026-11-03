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
  hash,
  onStage,
  deferAbove = DEFER_ABOVE,
}: {
  svg?: string;
  hash?: string;
  onStage: (s: Stage) => void;
  deferAbove?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stage = useStage(ref, svg, hash, deferAbove);
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
    const { container } = render(<Harness svg={small('a')} hash="h1" onStage={(s) => (stage = s)} />);
    expect(cellsOf(stage)).toEqual(['a']);
    expect(stage.pending).toBe(false);
    expect(container.querySelector('[data-testid="stage"] svg')).toBe(stage.root!);
  });

  it('builds a large diagram during the render without a limit (the split editor)', () => {
    let stage!: Stage;
    render(<Harness svg={large('a')} hash="h1" deferAbove={Infinity} onStage={(s) => (stage = s)} />);
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
    const { container } = render(<Harness svg={large('a')} hash="h1" onStage={(s) => (stage = s)} />);
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

  it('keeps the previous large diagram on screen until the next one is built', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} hash="h1" onStage={onStage} />);
    await settle();
    const first = stage.root!;
    rerender(<Harness svg={large('b')} hash="h2" onStage={onStage} />);
    expect(stage.root).toBe(first);
    expect(cellsOf(stage)).toEqual(['a']);
    expect(stage.pending).toBe(true);
    expect(container.querySelector('svg')).toBe(first);
    await settle();
    expect(cellsOf(stage)).toEqual(['b']);
    expect(stage.pending).toBe(false);
    expect(container.querySelector('svg')).toBe(stage.root!);
    expect(stage.root).not.toBe(first);
  });

  it('shows a small diagram at once in the place of a large one', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} hash="h1" onStage={onStage} />);
    await settle();
    rerender(<Harness svg={small('b')} hash="h2" onStage={onStage} />);
    expect(cellsOf(stage)).toEqual(['b']);
    expect(container.querySelector('svg')).toBe(stage.root!);
    await settle();
    expect(cellsOf(stage)).toEqual(['b']);
  });

  it('cancels a deferred build that a new diagram replaces before it starts', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={large('a')} hash="h1" onStage={onStage} />);
    rerender(<Harness svg={large('b')} hash="h2" onStage={onStage} />);
    await settle();
    expect(cellsOf(stage)).toEqual(['b']);
    // only b was sanitised
    expect(sanitizeCacheStats().misses).toBe(1);
  });

  it('does not build after an unmount', async () => {
    const { unmount } = render(<Harness svg={large('a')} hash="h1" onStage={() => {}} />);
    unmount();
    await settle();
    expect(sanitizeCacheStats().misses).toBe(0);
  });

  it('builds once per hash across renders', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { rerender } = render(<Harness svg={large('a')} hash="h1" onStage={onStage} />);
    await settle();
    const root = stage.root;
    rerender(<Harness svg={large('a')} hash="h1" onStage={onStage} />);
    await settle();
    expect(stage.root).toBe(root);
    expect(sanitizeCacheStats().misses).toBe(1);
    rerender(<Harness svg={small('c')} hash="h3" onStage={onStage} />);
    expect(cellsOf(stage)).toEqual(['c']);
    expect(sanitizeCacheStats().misses).toBe(2);
  });

  it('drops the stage when the diagram goes away', async () => {
    let stage!: Stage;
    const onStage = (s: Stage) => (stage = s);
    const { container, rerender } = render(<Harness svg={large('a')} hash="h1" onStage={onStage} />);
    await settle();
    expect(stage.root).toBeDefined();
    rerender(<Harness onStage={onStage} />);
    expect(stage.root).toBeUndefined();
    expect(container.querySelector('svg')).toBeNull();
  });
});
