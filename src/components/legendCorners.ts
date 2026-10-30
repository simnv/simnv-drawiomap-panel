import type { CSSProperties } from 'react';
import { SHEET_BELOW } from '../interact/Card';
import type { Box, Size } from '../legend/position';
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

/** The space in px between the panel edge, the legend and the timestamp. */
const EDGE = 4;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The place of the last data timestamp. It shares the bottom row with a legend at a bottom corner: it sits beside the
 * legend, on the side of the panel middle (left of a bottom-right legend), or above the legend when the row is too
 * narrow for both. A legend at a top corner, or no legend, leaves the bottom-right corner to the timestamp; the
 * bottom-left corner when a long legend reaches down to it.
 * `legend`: the box of the legend at its corner, null when the panel shows no legend. A legend that the user moved
 * keeps the box of its corner: the timestamp stays in its row, and the moved legend can cover it.
 */
export function stampCorner(corner: LegendCorner, legend: Box | null, stamp: Size, area: Size): CSSProperties {
  const corners: CSSProperties[] = [
    { right: EDGE, bottom: EDGE },
    { left: EDGE, bottom: EDGE },
  ];
  if (!legend) {
    return corners[0];
  }
  let candidates = corners;
  if (corner === 'bottom-right') {
    const right = area.width - legend.x + EDGE;
    candidates = [
      { right, bottom: EDGE },
      { right: EDGE, bottom: area.height - legend.y + EDGE },
    ];
  } else if (corner === 'bottom-left') {
    candidates = [
      { left: legend.x + legend.width + EDGE, bottom: EDGE },
      { left: EDGE, bottom: area.height - legend.y + EDGE },
    ];
  }
  const box = (c: CSSProperties): Box => {
    const x = typeof c.left === 'number' ? c.left : area.width - Number(c.right) - stamp.width;
    return { x, y: area.height - Number(c.bottom) - stamp.height, ...stamp };
  };
  const inside = (b: Box) =>
    b.x >= EDGE && b.y >= EDGE && b.x + b.width <= area.width - EDGE && b.y + b.height <= area.height - EDGE;
  // In a tiny panel no place fits: a place that leaves the panel is better than one that covers the legend.
  return (
    candidates.find((c) => inside(box(c)) && !overlaps(box(c), legend)) ??
    candidates.find((c) => !overlaps(box(c), legend)) ??
    candidates[0]
  );
}
