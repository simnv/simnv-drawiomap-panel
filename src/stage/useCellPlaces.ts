import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usable, type Matrix } from '../render/geometry';
import type { Rect } from '../render/labelPlacement';
import { mapRect, paintedBox, screenCtm } from '../render/paintedBox';
import type { Stage } from './useStage';
import { LAYOUT_EVENT } from './useStageLayout';
import { PAINTED_EVENT } from './useStagePaint';

/** The painted box of a cell in px from the top-left corner of the wrapper. */
export interface CellPlace {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Measured {
  root: SVGSVGElement;
  index: Stage['index'];
  key: string;
  revision: number;
  boxes: Array<[string, Rect]>;
}

const samePlaces = (a: CellPlace[], b: CellPlace[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.id === b[i].id &&
      p.left === b[i].left &&
      p.top === b[i].top &&
      p.width === b[i].width &&
      p.height === b[i].height
  );

/**
 * The screen matrix of the root for a measure: identity where the engine has none (jsdom: root units are px), and
 * undefined when it has one that is not usable (a stage of 0 x 0 before its layout): then nothing is measured yet.
 */
function measureCtm(root: SVGSVGElement): { ctm: Matrix | undefined } | undefined {
  if (typeof root.getScreenCTM !== 'function') {
    return { ctm: undefined };
  }
  const ctm = screenCtm(root);
  return ctm && usable(ctm) ? { ctm } : undefined;
}

/**
 * The places of the cells `ids` on the screen, for the overlays of the stage (the outlines, the focus ring, the
 * badges). One concept: the painted box of the cell (`paintedBox`), so a draw.io HTML label (a 100% foreignObject)
 * does not make the box the whole viewport.
 *
 * The boxes are measured in root units, once for each root, set of ids, paint (`PAINTED_EVENT`) and web font load:
 * a root box does not change with the view. Each write of the view box (`LAYOUT_EVENT`, also during a gesture that
 * renders nothing) and each scroll of `scroller` maps them to px with one read of the screen matrix. The event comes
 * from the layout itself, so the hook can be in any component of the stage, before or after `useStageLayout`. A cell
 * without a box has no place.
 */
export function useCellPlaces(
  stage: Stage,
  ids: readonly string[],
  wrapperRef: React.RefObject<HTMLElement>,
  /** Something else moves the stage under the wrapper (a scroll): the element whose `scroll` maps the places again. */
  scroller?: HTMLElement | null
): CellPlace[] {
  const key = ids.join('\n');
  const list = useMemo(() => (key ? key.split('\n') : []), [key]);
  const [revision, setRevision] = useState(0);
  const [places, setPlaces] = useState<CellPlace[]>([]);
  const measured = useRef<Measured>();
  const root = stage.root;
  const index = stage.index;
  const watch = list.length > 0;

  // Map the boxes (measure them first when the cache is stale) and keep the places. The current inputs, for the
  // events: a layout effect sets it, so a layout event of the passive pass sees the inputs of this render.
  const refresh = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    refresh.current = () => {
      const wrapper = wrapperRef.current;
      const next: CellPlace[] = [];
      const screen = root?.isConnected && wrapper && list.length ? measureCtm(root) : undefined;
      if (root && wrapper && screen) {
        const { ctm } = screen;
        let m = measured.current;
        if (!m || m.root !== root || m.index !== index || m.key !== key || m.revision !== revision) {
          const boxes: Array<[string, Rect]> = [];
          for (const id of list) {
            const group = index.get(id)?.group;
            const box = group && paintedBox(group, root, ctm);
            if (box && (box.width > 0 || box.height > 0)) {
              boxes.push([id, box]);
            }
          }
          m = { root, index, key, revision, boxes };
          measured.current = m;
        }
        const origin = wrapper.getBoundingClientRect();
        for (const [id, box] of m.boxes) {
          const r = ctm ? mapRect(box, ctm) : box;
          next.push({ id, left: r.x - origin.left, top: r.y - origin.top, width: r.width, height: r.height });
        }
      }
      setPlaces((old) => (samePlaces(old, next) ? old : next));
    };
  });

  // A paint or a web font can change the boxes: measure again. A write of the view box or a scroll: map again.
  useEffect(() => {
    if (!root || !watch) {
      return;
    }
    let live = true;
    const bump = () => live && setRevision((n) => n + 1);
    const map = () => live && refresh.current();
    root.addEventListener(PAINTED_EVENT, bump);
    root.addEventListener(LAYOUT_EVENT, map);
    scroller?.addEventListener('scroll', map, { passive: true });
    const fonts = typeof document === 'undefined' ? undefined : (document.fonts as FontFaceSet | undefined);
    fonts?.addEventListener?.('loadingdone', bump);
    return () => {
      live = false;
      root.removeEventListener(PAINTED_EVENT, bump);
      root.removeEventListener(LAYOUT_EVENT, map);
      scroller?.removeEventListener('scroll', map);
      fonts?.removeEventListener?.('loadingdone', bump);
    };
  }, [root, watch, scroller]);

  // New inputs: a new root, other cells, a new paint.
  useEffect(() => {
    refresh.current();
  }, [root, index, key, revision, wrapperRef]);

  return places;
}
