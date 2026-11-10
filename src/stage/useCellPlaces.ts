import { useEffect, useMemo, useRef, useState } from 'react';
import { mapRect, paintedBox, screenCtm } from '../render/paintedBox';
import type { Rect } from '../render/labelPlacement';
import type { Stage } from './useStage';
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
 * The places of the cells `ids` on the screen, for the overlays of the stage (the outlines, the focus ring, the
 * badges). One concept: the painted box of the cell (`paintedBox`), so a draw.io HTML label (a 100% foreignObject)
 * does not make the box the whole viewport.
 *
 * The boxes are measured in root units, once for each root, set of ids, paint (`PAINTED_EVENT`) and web font load:
 * a root box does not change with the view. Each new `layout` (a new view box, a new size of the stage) maps them to
 * px with one read of the screen matrix. Both run in a passive effect, so call the hook after `useStageLayout`: the
 * view box of the new view is written then, and a root that the parent attaches in its layout effect is in the
 * document. A cell without a box has no place.
 */
export function useCellPlaces(
  stage: Stage,
  ids: readonly string[],
  wrapperRef: React.RefObject<HTMLElement>,
  layout: unknown,
  /** Something else moves the stage under the wrapper (a scroll): the element whose `scroll` maps the places again. */
  scroller?: HTMLElement | null
): CellPlace[] {
  const key = ids.join('\n');
  const list = useMemo(() => (key ? key.split('\n') : []), [key]);
  const [revision, setRevision] = useState(0);
  const [scrolled, setScrolled] = useState(0);
  const [places, setPlaces] = useState<CellPlace[]>([]);
  const measured = useRef<Measured>();
  const root = stage.root;
  const watch = list.length > 0;

  // A paint or a web font can change the boxes: measure again.
  useEffect(() => {
    if (!root || !watch) {
      return;
    }
    let live = true;
    const bump = () => live && setRevision((n) => n + 1);
    root.addEventListener(PAINTED_EVENT, bump);
    const fonts = typeof document === 'undefined' ? undefined : (document.fonts as FontFaceSet | undefined);
    fonts?.addEventListener?.('loadingdone', bump);
    return () => {
      live = false;
      root.removeEventListener(PAINTED_EVENT, bump);
      fonts?.removeEventListener?.('loadingdone', bump);
    };
  }, [root, watch]);

  useEffect(() => {
    if (!scroller || !watch) {
      return;
    }
    const onScroll = () => setScrolled((n) => n + 1);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller, watch]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const next: CellPlace[] = [];
    if (root?.isConnected && wrapper && list.length) {
      // the screen matrix of this view; a root without one (jsdom) keeps root units as px
      const ctm = screenCtm(root);
      let m = measured.current;
      if (!m || m.root !== root || m.index !== stage.index || m.key !== key || m.revision !== revision) {
        const boxes: Array<[string, Rect]> = [];
        for (const id of list) {
          const group = stage.index.get(id)?.group;
          const box = group && paintedBox(group, root, ctm);
          if (box && (box.width > 0 || box.height > 0)) {
            boxes.push([id, box]);
          }
        }
        m = { root, index: stage.index, key, revision, boxes };
        measured.current = m;
      }
      const origin = wrapper.getBoundingClientRect();
      for (const [id, box] of m.boxes) {
        const r = ctm ? mapRect(box, ctm) : box;
        next.push({ id, left: r.x - origin.left, top: r.y - origin.top, width: r.width, height: r.height });
      }
    }
    // The places come from the layout of the external SVG DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaces((old) => (samePlaces(old, next) ? old : next));
  }, [root, stage.index, key, list, revision, layout, scrolled, wrapperRef]);

  return places;
}
