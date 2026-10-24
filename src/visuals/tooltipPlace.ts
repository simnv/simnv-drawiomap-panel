/** Distance in px between the anchor and the tooltip box, as in the Grafana tooltip. */
export const TOOLTIP_OFFSET = 10;

/** One axis: after the anchor; before it when the box would leave the view; held in the view when it fits on no side. */
function side(pos: number, size: number, view: number, offset: number): number {
  const after = pos + offset;
  if (after + size <= view) {
    return after;
  }
  const before = pos - offset - size;
  if (before >= 0) {
    return before;
  }
  return Math.max(0, Math.min(after, view - size));
}

/**
 * Top-left corner of a tooltip box of w × h px for an anchor at (x, y) in a view of vw × vh px. The box sits
 * below and to the right of the anchor, flips to the other side of the anchor when it would leave the view, and
 * stays inside the view when it fits on neither side.
 */
export function placeTooltip(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  offset = TOOLTIP_OFFSET
): { x: number; y: number } {
  return { x: side(x, w, vw, offset), y: side(y, h, vh, offset) };
}
