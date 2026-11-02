import { useEffect, useRef } from 'react';
import { setLinkLabelScale, type StageRect } from '../render/linkLabels';
import { applyLayout, viewBoxFor, type ViewBox } from '../render/zoom';
import type { ZoomOptions } from '../types';
import type { Stage } from './useStage';

/**
 * Lays the stage out in its box: the view box of the zoom options, then the scale of the value labels, then the
 * overflow of the container. A live view (pan or zoom) changes the view box only. Without a box the stage keeps its
 * layout. `zoom` must keep its identity while its values stay the same.
 *
 * The scale of the value labels needs the rendered size of the svg. A `ResizeObserver` on the root keeps it, so a
 * pan or a zoom (a new view box on every pointer move) reads no layout; a layout that changes the size of the svg
 * (a new zoom mode, a new box) reads it once, before the observer reports the new size.
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
  const rect = useRef<StageRect>();
  // the size of the svg the known rect belongs to: the layout sizes (percent or pixels) and the box they resolve in
  const sized = useRef<string>();
  useEffect(() => {
    const root = stage.root;
    rect.current = undefined;
    if (!root || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      // the last entry of the root; a test double may call back with none
      const r = entries?.length ? entries[entries.length - 1].contentRect : undefined;
      if (r && r.width > 0 && r.height > 0) {
        rect.current = { width: r.width, height: r.height };
        setLinkLabelScale(root, rect.current);
      }
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      rect.current = undefined;
    };
  }, [stage.root]);
  useEffect(() => {
    if (!stage.root || !stage.base || width === undefined || height === undefined) {
      return;
    }
    const layout = viewBoxFor(zoom, stage.base, { width, height }, view ?? stage.base);
    applyLayout(stage.root, layout);
    const size = `${layout.width}|${layout.height}|${width}|${height}`;
    const known = size === sized.current ? rect.current : undefined;
    sized.current = size;
    setLinkLabelScale(stage.root, known);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, zoom, width, height, view, containerRef]);
}
