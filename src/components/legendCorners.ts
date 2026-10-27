import type { CSSProperties } from 'react';
import { SHEET_BELOW } from '../interact/Card';
import type { LegendCorner } from '../types';

/**
 * Height in px that the top-right corner keeps free for the Grafana panel menu button. A panel without a title
 * has a hover header: its menu button is 24 px high, 3 px below the top edge of the panel.
 */
const MENU_CLEARANCE = 32;

/**
 * The start place of the legend in each corner (the user can drag it). The top-left legend is below the band and
 * the top-left row (the reset button and the warning badge, `rowHeight` 0 when the row is empty). The top-right
 * legend starts below the area of the Grafana panel menu button. On a narrow panel the open legend can reach the
 * left side: the top-right legend goes below the row too.
 */
export function legendCorners(
  bandHeight: number,
  rowHeight: number,
  width: number
): Record<LegendCorner, CSSProperties> {
  const belowRow = bandHeight + 4 + (rowHeight ? rowHeight + 4 : 0);
  return {
    'top-left': { left: 4, top: belowRow },
    'top-right': {
      right: 4,
      top: width < SHEET_BELOW && rowHeight ? belowRow : Math.max(bandHeight + 4, MENU_CLEARANCE),
    },
    'bottom-left': { left: 4, bottom: 4 },
    'bottom-right': { right: 4, bottom: 4 },
  };
}
