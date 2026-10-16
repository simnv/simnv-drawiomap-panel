import { useLayoutEffect, useMemo } from 'react';
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
}

const EMPTY: Stage = { index: new Map(), warnings: [] };

function buildStage(svg: string | undefined): Stage {
  if (!svg) {
    return EMPTY;
  }
  try {
    const clean = sanitizeSvg(svg);
    // Mount into a detached holder. The layout effect moves the same root into the panel,
    // so the index keeps references to the live elements.
    const root = mountSvg(document.createElement('div'), clean.svg);
    return { index: buildCellIndex(root), root, base: readViewBox(root), warnings: clean.warnings };
  } catch (e) {
    return { index: new Map(), warnings: [], error: (e as Error).message };
  }
}

/** Sanitise and index the SVG once per hash, then put its root into the container. */
export function useStage(
  containerRef: React.RefObject<HTMLDivElement>,
  svg: string | undefined,
  hash: string | undefined
): Stage {
  // The hash identifies the diagram. Without a hash, the svg text is the key.
  const key = hash ?? svg;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stage = useMemo(() => buildStage(svg), [key]);
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
