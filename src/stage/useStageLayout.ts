import { useCallback, useEffect, useRef } from 'react';
import { setLinkLabelScale, type StageRect } from '../render/linkLabels';
import { applyLayout, viewBoxFor, type ViewBox } from '../render/zoom';
import type { ZoomOptions } from '../types';
import type { Stage } from './useStage';

/**
 * The event that the root gets after each write of its view box: a layout pass and each live step of a gesture.
 * The cell places (`useCellPlaces`) map their boxes on it, so they never depend on the order of the effects of a
 * component tree, and they follow a gesture that renders nothing. It does not bubble.
 */
export const LAYOUT_EVENT = 'dmap-layout';

/**
 * Lays the stage out in its box: the view box of the zoom options, then the scale of the value labels, then the
 * overflow of the container. A live view (pan or zoom) changes the view box only. Without a box the stage keeps its
 * layout. `zoom` must keep its identity while its values stay the same.
 *
 * The scale of the value labels needs the rendered size of the svg. A `ResizeObserver` on the root keeps it, so a
 * pan or a zoom reads no layout here; a layout that changes the size of the svg (a new zoom mode, a new box) reads it
 * once, before the observer reports the new size. A listener of `LAYOUT_EVENT` can read layout: while a cell shows
 * its focus ring or outline, `useCellPlaces` reads one screen matrix and one wrapper box for each live step.
 *
 * Returns `live`: writes a view of a gesture in progress (the view box and the label scale, nothing else changes
 * during a gesture) without a render. The gesture commits its view to `view` when it ends; the effect then writes the
 * same layout again. Until then the live view is the newest view: a layout pass during the gesture (a new stage
 * height) and a commit older than the live view (one batched behind later moves) keep it. A reset (`view` null) ends
 * the live view.
 */
export function useStageLayout(
  stage: Stage,
  zoom: ZoomOptions,
  box: { width: number; height: number } | undefined,
  view: ViewBox | null,
  containerRef: React.RefObject<HTMLDivElement>
): { live: (next: ViewBox) => void } {
  const width = box?.width;
  const height = box?.height;
  const rect = useRef<StageRect>();
  // the size of the svg the known rect belongs to: the layout sizes (percent or pixels) and the box they resolve in
  const sized = useRef<string>();
  // the view of the gesture in progress; the gesture commits the same object to `view`
  const pending = useRef<ViewBox>();
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
    if (view === null || view === pending.current) {
      pending.current = undefined;
    }
    const layout = viewBoxFor(zoom, stage.base, { width, height }, pending.current ?? view ?? stage.base);
    applyLayout(stage.root, layout);
    const size = `${layout.width}|${layout.height}|${width}|${height}`;
    const known = size === sized.current ? rect.current : undefined;
    sized.current = size;
    setLinkLabelScale(stage.root, known);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
    stage.root.dispatchEvent(new Event(LAYOUT_EVENT));
  }, [stage.root, stage.base, zoom, width, height, view, containerRef]);
  const root = stage.root;
  const live = useCallback(
    (next: ViewBox) => {
      if (!root) {
        return;
      }
      pending.current = next;
      root.setAttribute('viewBox', `${next.x} ${next.y} ${next.w} ${next.h}`);
      setLinkLabelScale(root, rect.current);
      root.dispatchEvent(new Event(LAYOUT_EVENT));
    },
    [root]
  );
  return { live };
}
