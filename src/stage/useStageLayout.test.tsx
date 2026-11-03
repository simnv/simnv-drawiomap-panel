import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildCellIndex } from '../render/svgStage';
import { readViewBox, type ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, type ZoomOptions } from '../types';
import type { Stage } from './useStage';
import { useStageLayout } from './useStageLayout';

const FIT: ZoomOptions = { ...DEFAULT_OPTIONS.zoom, mode: 'fit', percent: 100, align: 'center', minScale: 0 };

function mounted(): { stage: Stage; container: { current: HTMLDivElement } } {
  const container = document.createElement('div');
  container.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="n1"/></svg>';
  const root = container.querySelector('svg') as SVGSVGElement;
  return {
    stage: { index: buildCellIndex(root), root, base: readViewBox(root), warnings: [], pending: false },
    container: { current: container },
  };
}

describe('useStageLayout', () => {
  it('lays the stage out in its box and writes the overflow of the container', () => {
    const { stage, container } = mounted();
    renderHook(() => useStageLayout(stage, FIT, { width: 800, height: 600 }, null, container));
    expect(stage.root!.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(stage.root!.getAttribute('width')).toBe('100%');
    expect(container.current.style.overflow).toBe('hidden');
  });

  it('a live view changes the view box; without a box the stage keeps its layout', () => {
    const { stage, container } = mounted();
    const view: ViewBox = { x: 100, y: 50, w: 200, h: 100 };
    const hook = renderHook(
      ({ box }: { box?: { width: number; height: number } }) => useStageLayout(stage, FIT, box, view, container),
      { initialProps: { box: undefined } as { box?: { width: number; height: number } } }
    );
    expect(stage.root!.getAttribute('preserveAspectRatio')).toBeNull();
    hook.rerender({ box: { width: 800, height: 600 } });
    expect(stage.root!.getAttribute('viewBox')).toBe('100 50 200 100');
  });
});
