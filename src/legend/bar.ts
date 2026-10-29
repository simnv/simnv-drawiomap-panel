import type { LegendBarSegment } from './model';

/** The width of a bar in the legend, in px. It fits the most width of the legend (280 px). */
export const BAR_WIDTH = 200;
/** The font size of a tick text, in px. */
export const TICK_FONT = 10;
/** The most width of a tick text: tabular digits are about 0.6 em, a point is narrow, '%' is wide. */
const textWidth = (text: string) =>
  [...text].reduce((w, c) => w + TICK_FONT * (c === '.' || c === ',' ? 0.35 : c === '%' ? 0.9 : 0.65), 0);
/** The least free space between two tick texts, in px. */
const TICK_GAP = 6;

/**
 * The tick texts of the step values that fit under a bar of `width` px, low to high. Each text is centred on its
 * stop. A text that goes past an end of the bar, or comes nearer than `TICK_GAP` to the last text that shows, does not
 * show.
 */
export function barTicks(segments: LegendBarSegment[], width = BAR_WIDTH): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  let right = -Infinity;
  for (const s of segments) {
    if (s.tick === undefined) {
      continue;
    }
    const half = textWidth(s.tick) / 2;
    const centre = s.from * width;
    if (centre - half >= Math.max(0, right + TICK_GAP) && centre + half <= width) {
      out.push({ at: s.from, text: s.tick });
      right = centre + half;
    }
  }
  return out;
}
