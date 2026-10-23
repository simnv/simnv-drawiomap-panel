export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Keep a box of `box` size inside a content box of `area` size. A box larger than the area sits at 0. */
export function clampPoint(p: Point, box: Size, area: Size): Point {
  const within = (v: number, room: number) => Math.min(Math.max(0, room), Math.max(0, v));
  return { x: within(p.x, area.width - box.width), y: within(p.y, area.height - box.height) };
}

/** The distance in px of a pointer move that starts a drag. A smaller move is a click. */
export const DRAG_THRESHOLD = 4;
/** The step of an arrow key, in px. Shift makes it bigger. */
export const KEY_STEP = 10;
export const KEY_STEP_SHIFT = 50;

export const isDrag = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_THRESHOLD;

/** The move of an arrow key, or null for another key. */
export function keyMove(key: string, shift: boolean): Point | null {
  const step = shift ? KEY_STEP_SHIFT : KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}
