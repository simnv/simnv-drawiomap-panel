import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The centre of a link half in the viewport, after the half scrolled into view and has a layout box.
 *
 * Playwright never calls a vertical or horizontal link half visible: its polyline has a bounding box with zero width
 * or height. A pointer action on it works only with `force: true`, and it then depends on the half being laid out at
 * that moment ("Element is not visible" otherwise, see the flake in sparkline-range.spec.ts). Wait for a layout box
 * with a plain poll, scroll with the DOM (that needs no size) and give the point to `page.mouse`.
 */
export async function pointOnHalf(half: Locator) {
  const read = () =>
    half.evaluate((el) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
  let point: { x: number; y: number } | null = null;
  await expect.poll(async () => (point = await read()), { message: 'the link half has a layout box' }).not.toBeNull();
  return point!;
}

/** Move the pointer onto a link half: from a point beside it, so the page sees an enter. */
export async function hoverHalf(half: Locator) {
  const { x, y } = await pointOnHalf(half);
  const mouse = half.page().mouse;
  await mouse.move(x + 24, y);
  await mouse.move(x, y, { steps: 4 });
}

export type TouchPoint = { x: number; y: number };

/** Real touch input through the browser input pipeline (Chromium), so touch-action applies. */
export async function touch(page: Page, from: TouchPoint[], to: TouchPoint[], steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => from.map((p, i) => ({ id: i, x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
