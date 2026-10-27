import { useEffect } from 'react';
import { setLinkLabelScale } from '../render/linkLabels';
import { applyLayout, viewBoxFor, type ViewBox } from '../render/zoom';
import type { ZoomOptions } from '../types';
import type { Stage } from './useStage';

/**
 * Lays the stage out in its box: the view box of the zoom options, then the scale of the value labels, then the
 * overflow of the container. A live view (pan or zoom) changes the view box only. Without a box the stage keeps its
 * layout. `zoom` must keep its identity while its values stay the same.
 */
export function useStageLayout(
  stage: Stage,
  zoom: ZoomOptions,
  box: { width: number; height: number } | undefined,
  view: ViewBox | null,
  containerRef: React.RefObject<HTMLDivElement>
): void {
  const width = box?.width;
  const height = box?.height;
  useEffect(() => {
    if (!stage.root || !stage.base || width === undefined || height === undefined) {
      return;
    }
    const layout = viewBoxFor(zoom, stage.base, { width, height }, view ?? stage.base);
    applyLayout(stage.root, layout);
    setLinkLabelScale(stage.root);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, zoom, width, height, view, containerRef]);
}
