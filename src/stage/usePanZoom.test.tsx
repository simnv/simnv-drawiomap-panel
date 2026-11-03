import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildCellIndex } from '../render/svgStage';
import { readViewBox, type ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, type ZoomOptions } from '../types';
import type { Stage } from './useStage';
import { usePanZoom } from './usePanZoom';
import { useStageLayout } from './useStageLayout';

const FIT: ZoomOptions = { ...DEFAULT_OPTIONS.zoom, mode: 'fit', percent: 100, align: 'top', minScale: 0 };

function mounted(): Stage {
  const container = document.createElement('div');
  container.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="n1"/></svg>';
  const root = container.querySelector('svg') as SVGSVGElement;
  return { index: buildCellIndex(root), root, base: readViewBox(root), warnings: [], pending: false };
}

/** The stage layout and the gesture hook wired as the panel wires them; `reset` is the reset button. */
function Harness({ stage, height }: { stage: Stage; height: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewBox | null>(null);
  const { live } = useStageLayout(stage, FIT, { width: 400, height }, view, wrapperRef);
  const { zoomed } = usePanZoom({
    wrapperRef,
    root: stage.root,
    base: stage.base,
    view,
    setView,
    live,
    wheel: true,
    dragPan: true,
    align: 'top',
    ignore: () => false,
  });
  return (
    <div ref={wrapperRef} data-testid="wrapper" data-view={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : ''}>
      {zoomed && <button onClick={() => setView(null)}>Reset zoom</button>}
    </div>
  );
}

// three Ctrl+wheel steps of 10: the width of the base view times exp(-0.3)
const THREE_STEPS = 400 * Math.exp(-0.3);

describe('usePanZoom with the stage layout', () => {
  it('a commit batched with later wheel events carries the newest view, not the one that flipped zoomed', () => {
    const stage = mounted();
    render(<Harness stage={stage} height={200} />);
    const wrapper = screen.getByTestId('wrapper');
    // one batch: the first event flips `zoomed` and commits, the two others only write the live view
    act(() => {
      for (let i = 0; i < 3; i++) {
        wrapper.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true }));
      }
    });
    expect(readViewBox(stage.root!).w).toBeCloseTo(THREE_STEPS);
    // the committed state is the newest view too
    expect(wrapper.getAttribute('data-view')).toBe(stage.root!.getAttribute('viewBox'));
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeTruthy();
  });

  it('a layout pass during a gesture (a band reflow changes the stage height) keeps the live view', () => {
    const stage = mounted();
    const r = render(<Harness stage={stage} height={200} />);
    const wrapper = screen.getByTestId('wrapper');
    // each event flushed on its own: the first one commits, the view of the others is live only
    for (let i = 0; i < 3; i++) {
      fireEvent.wheel(wrapper, { deltaY: -10, ctrlKey: true });
    }
    const live = stage.root!.getAttribute('viewBox');
    expect(readViewBox(stage.root!).w).toBeCloseTo(THREE_STEPS);
    r.rerender(<Harness stage={stage} height={160} />);
    expect(stage.root!.getAttribute('viewBox')).toBe(live);
  });

  it('a reset during a gesture is authoritative: a later layout pass does not bring the live view back', () => {
    const stage = mounted();
    const r = render(<Harness stage={stage} height={200} />);
    const wrapper = screen.getByTestId('wrapper');
    for (let i = 0; i < 3; i++) {
      fireEvent.wheel(wrapper, { deltaY: -10, ctrlKey: true });
    }
    expect(readViewBox(stage.root!).w).toBeCloseTo(THREE_STEPS);
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(stage.root!.getAttribute('viewBox')).toBe('0 0 400 200');
    r.rerender(<Harness stage={stage} height={160} />);
    expect(stage.root!.getAttribute('viewBox')).toBe('0 0 400 200');
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
  });
});
