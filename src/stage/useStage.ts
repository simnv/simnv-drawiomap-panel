import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { sanitizeSvg } from '../render/sanitize';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { readViewBox, ViewBox } from '../render/zoom';
import type { CellIndex } from '../types';

export interface Stage {
  index: CellIndex;
  root?: SVGSVGElement;
  base?: ViewBox;
  warnings: string[];
  error?: string;
  /** True while the deferred build of the current diagram runs: the stage is empty until then. */
  pending: boolean;
}

const EMPTY: Stage = { index: new Map(), warnings: [], pending: false };
const PENDING: Stage = { index: new Map(), warnings: [], pending: true };

/**
 * The limit of the dashboard panel: an svg text longer than this builds after the first paint. The build (sanitise,
 * parse, index) costs about 0.1 ms per KB in Chromium on a fast machine: a diagram below the limit builds inside one
 * frame budget, so a deferred build would only add a blank frame. Above it, the panel chrome paints first and the
 * diagram follows.
 */
export const DEFER_ABOVE = 256 * 1024;

function buildStage(svg: string | undefined): Stage {
  if (!svg) {
    return EMPTY;
  }
  try {
    const clean = sanitizeSvg(svg);
    // Mount into a detached holder. The layout effect moves the same root into the panel,
    // so the index keeps references to the live elements.
    const root = mountSvg(document.createElement('div'), clean.svg);
    return { index: buildCellIndex(root), root, base: readViewBox(root), warnings: clean.warnings, pending: false };
  } catch (e) {
    return { index: new Map(), warnings: [], error: (e as Error).message, pending: false };
  }
}

interface Deferred {
  /** The input the stage was built from. */
  svg: string | undefined;
  stage: Stage;
}

const NONE: Deferred = { svg: undefined, stage: EMPTY };

/**
 * Sanitise and index the SVG once per svg text, then put its root into the container.
 *
 * The identity of a diagram is its svg text, the only input of the build, compared as a string: a saved hash is 32
 * bits and two diagrams can share one. Without `deferAbove` the stage builds during the render. With it, a diagram
 * whose svg text is longer builds after the first paint: the panel chrome paints at once and the diagram follows.
 * Until then the hook returns the empty stage with `pending` set. The hook never returns a stage of another diagram:
 * a deferred result carries the svg it was built from, and a result for an older svg (its timer ran in the same
 * batch as a newer diagram) is not shown. Without a diagram the hook returns the empty stage at once.
 */
export function useStage(
  containerRef: React.RefObject<HTMLDivElement>,
  svg: string | undefined,
  deferAbove = Infinity
): Stage {
  const defer = svg !== undefined && svg.length > deferAbove;
  const direct = useMemo(() => (defer ? undefined : buildStage(svg)), [svg, defer]);
  const [deferred, setDeferred] = useState<Deferred>(NONE);
  if (!defer && deferred !== NONE) {
    // A small diagram took the place of a deferred one: release its stage (state adjustment during render).
    setDeferred(NONE);
  }
  useEffect(() => {
    if (!defer) {
      return;
    }
    // A passive effect runs before the browser paints. The build starts after the next frame: a timer set in the
    // frame callback runs after the paint. A new key or an unmount cancels a build that has not started.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setDeferred({ svg, stage: buildStage(svg) }), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [svg, defer]);
  const stage = direct ?? (deferred.svg === svg ? deferred.stage : PENDING);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    if (!stage.root) {
      el.replaceChildren();
    } else if (stage.root.parentNode !== el) {
      el.replaceChildren(stage.root);
    }
  });
  return stage;
}
