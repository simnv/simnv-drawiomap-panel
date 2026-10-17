import { devices, type Locator, type Page } from '@playwright/test';
import { type DashboardPage, expect, test } from '@grafana/plugin-e2e';

const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there

/** The gaps in px between the diagram (the viewBox on the screen) and the edges of the svg box. */
const gaps = (panel: Locator) =>
  panel
    .locator('[data-testid="dmap-panel"] svg')
    .first()
    .evaluate((el) => {
      const svg = el as SVGSVGElement;
      const m = svg.getScreenCTM()!;
      const vb = svg.viewBox.baseVal;
      const r = svg.getBoundingClientRect();
      return {
        top: vb.y * m.d + m.f - r.top,
        bottom: r.bottom - ((vb.y + vb.height) * m.d + m.f),
        left: vb.x * m.a + m.e - r.left,
        right: r.right - ((vb.x + vb.width) * m.a + m.e),
      };
    });

const viewBox = (panel: Locator) => panel.locator('[data-testid="dmap-panel"] svg').first().getAttribute('viewBox');
const width = (vb: string | null) => Number((vb ?? '').split(' ')[2]);

async function openPanel(dashboardPage: DashboardPage) {
  const panel = (await dashboardPage.getPanelByTitle('demo-lab L3')).locator;
  await expect(panel.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '108');
  return panel;
}

test.describe('live zoom on the desktop', () => {
  test('Ctrl+wheel (a trackpad pinch) zooms; the reset button shows and restores the view', async ({
    gotoDashboardPage,
    page,
  }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    const reset = panel.getByRole('button', { name: 'Reset zoom' });
    const base = await viewBox(panel);
    await expect(reset).toHaveCount(0);

    // the plain wheel does not zoom: "Wheel zoom" is off in the demo
    const box = (await panel.getByTestId('dmap-panel').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    expect(await viewBox(panel)).toBe(base);

    await page.keyboard.down('Control');
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -20);
    }
    await page.keyboard.up('Control');
    await expect(reset).toBeVisible();
    expect(width(await viewBox(panel))).toBeLessThan(width(base));
    // a 32 px touch target
    const b = (await reset.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(32);
    expect(b.height).toBeGreaterThanOrEqual(32);
    if (SHOTS) {
      await page.mouse.move(1, 1);
      await panel.screenshot({ path: `${SHOTS}/zoomed-reset-button.png` });
    }

    await reset.click();
    await expect(reset).toHaveCount(0);
    expect(await viewBox(panel)).toBe(base);
  });

  test('a wide panel centres the fitted diagram horizontally, its top at the top', async ({ gotoDashboardPage }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    const g = await gaps(panel);
    expect(Math.abs(g.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1);
  });
});

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

type TouchPoint = { x: number; y: number };

/** Real touch input through the browser input pipeline, so touch-action applies. */
async function touch(page: Page, from: TouchPoint[], to: TouchPoint[], steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => from.map((p, i) => ({ id: i, x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('live zoom on a phone', () => {
  test.use(iPhone);

  test('a one-finger swipe at the configured view does not zoom; a pinch zooms; the reset button restores', async ({
    gotoDashboardPage,
    page,
  }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    const stage = panel.getByTestId('dmap-panel');
    await stage.scrollIntoViewIfNeeded();
    const reset = panel.getByRole('button', { name: 'Reset zoom' });
    const base = await viewBox(panel);
    await expect(stage).toHaveCSS('touch-action', 'pan-x pan-y');

    let box = (await stage.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const scrollY = await page.evaluate(() => window.scrollY);
    await touch(page, [{ x: cx, y: cy + 40 }], [{ x: cx, y: cy - 40 }]);
    // the page scrolls
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollY);
    await expect(reset).toHaveCount(0);
    expect(await viewBox(panel)).toBe(base);

    box = (await stage.boundingBox())!;
    const my = box.y + box.height / 2;
    await touch(
      page,
      [
        { x: cx - 30, y: my },
        { x: cx + 30, y: my },
      ],
      [
        { x: cx - 120, y: my },
        { x: cx + 120, y: my },
      ]
    );
    await expect(reset).toBeVisible();
    // the panel zooms, the page does not
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    const zoomed = await viewBox(panel);
    expect(width(zoomed)).toBeLessThan(width(base) / 2);
    await expect(stage).toHaveCSS('touch-action', 'none');

    // one finger pans a zoomed view
    await touch(page, [{ x: cx + 40, y: my }], [{ x: cx - 40, y: my }]);
    await expect.poll(() => viewBox(panel)).not.toBe(zoomed);

    await reset.tap();
    await expect(reset).toHaveCount(0);
    expect(await viewBox(panel)).toBe(base);
  });

  test('the fitted diagram is at the top of a tall panel and centred horizontally', async ({ gotoDashboardPage }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    await expect(panel.locator('[data-testid="dmap-panel"] svg').first()).toHaveAttribute(
      'preserveAspectRatio',
      'xMidYMin meet'
    );
    const g = await gaps(panel);
    expect(Math.abs(g.top)).toBeLessThanOrEqual(1);
    expect(g.bottom).toBeGreaterThan(50);
    expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1);
  });
});
