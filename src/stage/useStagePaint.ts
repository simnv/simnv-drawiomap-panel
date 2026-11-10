import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Applied } from '../render/applier';
import { watchLinkLabelFonts } from '../render/linkLabels';
import { type PaintOptions, paintStage } from '../render/paintStage';
import type { PatchMap } from '../types';
import { useOsDark } from '../visuals/useOsDark';
import type { Stage } from './useStage';

/**
 * The event that the root gets after each paint. A paint can change the box of a cell (a stroke width, a label), and
 * the cell places (`useCellPlaces`) measure again on it. It does not bubble.
 */
export const PAINTED_EVENT = 'dmap-painted';

/** The paint inputs that the caller gives. The hook adds the OS preference and the stage bounds. */
export type StagePaintOptions = Pick<PaintOptions, 'theme' | 'linkWidth' | 'interactive'>;

/**
 * Paints the patches into the stage once per frame (`paintStage`) and keeps the paint current. The root colour scheme
 * follows the Grafana theme. The OS preference is an input of the applier's colour scheme: a change of it writes
 * every cell again. A web font that loads late cuts the strokes under the labels again. Each caller keeps its own
 * applied state, so the panel and the popup stage never share one.
 */
export function useStagePaint(stage: Stage, patches: PatchMap, options: StagePaintOptions): void {
  const { theme, interactive } = options;
  const applied = useRef<Applied>();

  // draw.io writes color-scheme: light dark on the root, so light-dark() colours follow the OS preference. Override
  // it with the Grafana theme. The effect sets it on the root object itself: the editor attaches a new root to the
  // container after this effect, so a lookup in the container would find the old one.
  const isDark = theme.isDark;
  useLayoutEffect(() => {
    stage.root?.style.setProperty('color-scheme', isDark ? 'dark' : 'light');
  }, [stage.root, isDark]);

  const osDark = useOsDark();
  const { min, max } = options.linkWidth;
  useEffect(() => {
    const root = stage.root;
    if (!root) {
      return;
    }
    const linkWidth = { min, max };
    const id = requestAnimationFrame(() => {
      const paint = { theme, osDark, linkWidth, bounds: stage.base, interactive };
      applied.current = paintStage(root, stage.index, patches, applied.current, paint);
      root.dispatchEvent(new Event(PAINTED_EVENT));
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, stage.base, patches, theme, osDark, interactive, min, max]);

  useEffect(() => (stage.root ? watchLinkLabelFonts(stage.root) : undefined), [stage.root]);
}
