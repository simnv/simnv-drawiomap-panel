/** Distance in px between the anchor and the tooltip box, and between the box and the edge of the view. */
export const TOOLTIP_OFFSET = 10;

/**
 * One axis: after the anchor (after the end of an anchor of `extent` px); before it when the box would cross the far
 * edge; then held inside the view with the margin on both sides. A box wider than the view sits at the near margin.
 */
function side(pos: number, size: number, view: number, margin: number, gap: number, extent = 0): number {
  const after = pos + extent + gap;
  const before = pos - gap - size;
  const want = after + size <= view - margin ? after : before >= margin ? before : after;
  return Math.max(margin, Math.min(want, view - size - margin));
}

/**
 * Top-left corner of a tooltip box of w × h px for an anchor at (x, y) in a view of vw × vh px. The box sits
 * below and to the right of the anchor, flips to the other side of the anchor when it would leave the view, and
 * always stays inside the view (with the margin), also for an anchor outside the view.
 */
export function placeTooltip(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = TOOLTIP_OFFSET,
  /** Distance to the anchor, when it differs from the margin to the edge of the view. */
  gap = margin,
  /** The height of an anchor box with its top at y: the tooltip goes below its bottom or above its top. */
  anchorHeight = 0
): { x: number; y: number } {
  return { x: side(x, w, vw, margin, gap), y: side(y, h, vh, margin, gap, anchorHeight) };
}
