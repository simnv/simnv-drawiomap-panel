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
  /**
   * True while a deferred build of a newer diagram runs: `root` and `index` are those of the previous diagram. A
   * consumer must then keep the inputs it bound that stage with and make the stage inert, so the stage and its
   * binding change in one commit.
   */
  pending: boolean;
}

const EMPTY: Stage = { index: new Map(), warnings: [], pending: false };

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
  key: string | undefined;
  stage: Stage;
}

const NONE: Deferred = { key: undefined, stage: EMPTY };

/**
 * Sanitise and index the SVG once per hash, then put its root into the container.
 *
 * Without `deferAbove` the stage builds during the render. With it, a diagram whose svg text is longer builds after
 * the first paint: the panel chrome paints at once and the diagram follows. Until the build is done the hook returns
 * the previous deferred stage with `pending` set, so a large diagram stays on screen when the next large one arrives.
 * Without a diagram the hook returns the empty stage at once.
 */
export function useStage(
  containerRef: React.RefObject<HTMLDivElement>,
  svg: string | undefined,
  hash: string | undefined,
  deferAbove = Infinity
): Stage {
  // The hash identifies the diagram. Without a hash, the svg text is the key.
  const key = hash ?? svg;
  const defer = svg !== undefined && svg.length > deferAbove;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const direct = useMemo(() => (defer ? undefined : buildStage(svg)), [key, defer]);
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
      timer = setTimeout(() => setDeferred({ key, stage: buildStage(svg) }), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, defer]);
  const pending = defer && deferred.key !== key;
  const stage = useMemo(
    () => direct ?? (pending ? { ...deferred.stage, pending: true } : deferred.stage),
    [direct, deferred, pending]
  );
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
