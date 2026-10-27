import type { GrafanaTheme2 } from '@grafana/data';
import type { CellIndex, PatchMap } from '../types';
import { applyPatches, type Applied } from './applier';
import { renderLinkLabels } from './linkLabels';
import { renderOverlay } from './overlay';
import type { ViewBox } from './zoom';

export interface PaintOptions {
  theme: GrafanaTheme2;
  /** The OS prefers a dark colour scheme: an input of the applier's colour scheme. */
  osDark: boolean;
  /** The link width range of the panel: the value labels keep `linkWidth.max / 2` clear of the strokes. */
  linkWidth: { min: number; max: number };
  /** The base view box of the stage. */
  bounds?: ViewBox;
  /** Only these cells become buttons. Without it every patched cell is one (the popup stage). */
  interactive?: Set<string>;
}

/**
 * Paints the patches into one stage root: the applier, then the overlay, then the value labels. The labels come
 * after the overlay because its arrow heads are obstacles of the labels. Returns what the applier applied now: the
 * caller keeps it for the next call on the same root.
 */
export function paintStage(
  root: SVGSVGElement,
  index: CellIndex,
  patches: PatchMap,
  previous: Applied | undefined,
  opts: PaintOptions
): Applied {
  const { theme, osDark, linkWidth, bounds, interactive } = opts;
  const applied = applyPatches(index, patches, previous, interactive, { theme, osDark });
  renderOverlay(root, index, patches, { theme });
  renderLinkLabels(root, index, patches, { theme, linkWidth, bounds });
  return applied;
}
