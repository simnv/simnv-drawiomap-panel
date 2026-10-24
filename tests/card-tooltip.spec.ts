import { devices, type Locator, type Page } from '@playwright/test';
import { hoverHalf, pointOnHalf } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

const RADIO = 'pg-link~radio:dhcp->rtr-a:wan2';
const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there

type GotoDashboardPage = (args: { uid: string; queryParams?: URLSearchParams }) => Promise<{
  getPanelByTitle: (title: string) => Promise<{ locator: Locator }>;
}>;

/** Opens the demo dashboard and returns the panel, the half-link polyline and the pinned-card dialog. */
async function openPanel(gotoDashboardPage: GotoDashboardPage, title: string, cell: string, view?: string) {
  const dashboardPage = await gotoDashboardPage({
    uid: 'drawiomap-demo',
    queryParams: view ? new URLSearchParams({ viewPanel: view }) : undefined,
  });
  const panel = (await dashboardPage.getPanelByTitle(title)).locator;
  const half = panel.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`);
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  return { panel, half };
}

/** Moves the mouse to a fraction of the width of the chart, at its middle height; returns the pointer x. */
async function moveOnChart(page: Page, chart: Locator, fraction: number) {
  const box = (await chart.boundingBox())!;
  const x = box.x + box.width * fraction;
  await page.mouse.move(x - 3, box.y + box.height / 2);
  await page.mouse.move(x, box.y + box.height / 2, { steps: 2 });
  return x;
}

async function shot(page: Page, name: string, around?: Locator) {
  if (!SHOTS) {
    return;
  }
  const clip = around ? await around.boundingBox() : null;
  await page.screenshot({
    path: `${SHOTS}/${name}.png`,
    clip: clip
      ? {
          x: Math.max(0, clip.x - 40),
          y: Math.max(0, clip.y - 120),
          width: clip.width + 220,
          height: clip.height + 220,
        }
      : undefined,
  });
}

test.describe('tooltip on the charts of the pinned card', () => {
  test('no tooltip while the card is not pinned', async ({ gotoDashboardPage, page }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'demo-lab L3', RADIO);
    await hoverHalf(half);
    const card = panel.getByRole('tooltip');
    await expect(card).toContainText('radio ↔ rtr-a');
    // the hover card ignores the pointer, so the chart under it gets no pointer event
    await expect(card.getByTestId('dmap-chart-hover')).toHaveCount(0);
    await expect(page.getByTestId('dmap-chart-tooltip')).toHaveCount(0);
  });

  test('a pinned chart shows crosshair and a Grafana tooltip at 25, 50 and 90 percent', async ({
    gotoDashboardPage,
    page,
  }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'demo-lab L3', RADIO);
    await pointOnHalf(half);
    await half.click({ force: true });
    const dialog = panel.getByRole('dialog');
    await expect(dialog).toContainText('radio → rtr-a');
    const chart = dialog.getByTestId('dmap-chart-hover').first();
    const tooltip = page.getByTestId('dmap-chart-tooltip');
    const crosshair = chart.getByTestId('dmap-chart-crosshair');
    await page.mouse.move(1, 1);
    await expect(tooltip).toHaveCount(0);
    for (const fraction of [0.25, 0.5, 0.9]) {
      const x = await moveOnChart(page, chart, fraction);
      await expect(tooltip).toBeVisible();
      // time header, series name and the value with its unit: the radio link is a flat 90 Mb/s
      await expect(tooltip).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
      await expect(tooltip).toContainText('radio → rtr-a');
      await expect(tooltip).toContainText(/9\d(\.\d+)? Mb\/s|90/);
      await expect(crosshair).toBeVisible();
      const c = (await crosshair.boundingBox())!;
      expect(Math.abs(c.x + c.width / 2 - x)).toBeLessThanOrEqual(2);
      // a colour swatch before the series name
      await expect(tooltip.locator('[style*="background"], [style*="color"]').first()).toBeAttached();
      await shot(page, `desktop-${Math.round(fraction * 100)}`, chart);
    }
    // the pointer leaves the chart: no tooltip, the card stays pinned
    await page.mouse.move(1, 1);
    await expect(tooltip).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('a combined up/down row shows one tooltip with both directions', async ({ gotoDashboardPage, page }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'Sanitized authoring topology', 'link-1', 'panel-3');
    await pointOnHalf(half);
    await half.click({ force: true });
    const dialog = panel.getByRole('dialog');
    const row = dialog.getByTestId('dmap-card-row').filter({ hasText: 'Traffic' });
    const chart = row.getByTestId('dmap-chart-hover');
    await moveOnChart(page, chart, 0.5);
    const tooltip = page.getByTestId('dmap-chart-tooltip');
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText('↑');
    await expect(tooltip).toContainText('↓');
    // transmit about 10 Mb/s, receive about 41 Mb/s
    await expect(tooltip).toContainText(/Mb\/s/);
    await shot(page, 'combined', chart);
  });

  test('near the right edge the tooltip stays inside the viewport and is not clipped by the panel', async ({
    gotoDashboardPage,
    page,
  }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'demo-lab L3', RADIO);
    await pointOnHalf(half);
    await half.click({ force: true });
    const dialog = panel.getByRole('dialog');
    const chart = dialog.getByTestId('dmap-chart-hover').first();
    await moveOnChart(page, chart, 0.97);
    const tooltip = page.getByTestId('dmap-chart-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toBeInViewport({ ratio: 1 });
    // a portal in the body, not a child of the panel
    expect(await tooltip.evaluate((el, p) => !p?.contains(el), await panel.elementHandle())).toBe(true);
    await shot(page, 'right-edge', chart);
    // also with a narrow window the tooltip stays inside
    const narrow = { width: 700, height: 800 };
    await page.setViewportSize(narrow);
    await page.mouse.move(1, 1);
    await expect(tooltip).toHaveCount(0);
    // Grafana 12.4 lays the dashboard out in steps: the nav undocks, the panel narrows to a width below the sheet
    // breakpoint for one frame (the card is a sheet in the body then), and the panel takes its final width. Wait
    // until the panel is inside the narrow viewport and the pinned card is back in it, then measure the chart.
    const stage = panel.getByTestId('dmap-panel');
    await expect
      .poll(async () => {
        const box = await stage.boundingBox();
        return box ? box.x + box.width : Infinity;
      })
      .toBeLessThanOrEqual(narrow.width);
    await expect(dialog).toHaveAttribute('data-pinned', 'true');
    await expect(dialog).toHaveAttribute('data-sheet', 'false');
    const chartNarrow = dialog.getByTestId('dmap-chart-hover').first();
    await expect(chartNarrow).toBeInViewport({ ratio: 1 });
    await moveOnChart(page, chartNarrow, 0.97);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toBeInViewport({ ratio: 1 });
  });

  test('a click on the chart still follows the row link and the card stays pinned', async ({
    gotoDashboardPage,
    page,
  }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'demo-lab L3', RADIO);
    await pointOnHalf(half);
    await half.click({ force: true });
    const dialog = panel.getByRole('dialog');
    const node = panel.locator('[data-cell-id="pg-node~rtr-a"]');
    await node.locator('rect').first().click({ force: true });
    await expect(dialog).toContainText('CPU');
    const cpu = dialog.getByTestId('dmap-card-row').filter({ hasText: 'CPU' });
    await expect(cpu).toHaveAttribute('href', /var-job=node-rtr-a&var-metric=cpu/);
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      (async () => {
        await moveOnChart(page, cpu.getByTestId('dmap-chart-hover'), 0.5);
        await page.mouse.down();
        await page.mouse.up();
      })(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/\/d\/drawiomap-demo.*var-job=node-rtr-a&var-metric=cpu/);
    await popup.close();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-pinned', 'true');
  });

  test('keyboard: arrows show a value, the first Escape hides the tooltip, the second closes the card', async ({
    gotoDashboardPage,
    page,
  }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'demo-lab L3', RADIO);
    await pointOnHalf(half);
    await half.click({ force: true });
    const dialog = panel.getByRole('dialog');
    const chart = dialog.getByTestId('dmap-chart-hover').first();
    await chart.focus();
    await expect(chart).toBeFocused();
    const tooltip = page.getByTestId('dmap-chart-tooltip');
    await page.keyboard.press('ArrowLeft');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/Mb\/s|%/);
    const first = await tooltip.textContent();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).not.toHaveText(first!);
    await page.keyboard.press('ArrowRight');
    await expect(tooltip).toBeVisible();
    await shot(page, 'keyboard', chart);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

test.describe('tooltip on a phone', () => {
  test.use({ ...iPhone, viewport: { width: 390, height: 844 } });
  // the touch events come from CDP: Chromium only (PW_WEBKIT adds a WebKit project)
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch events need Chromium');

  test('a drag along the chart shows values; a vertical swipe still scrolls the sheet', async ({
    gotoDashboardPage,
    page,
  }) => {
    const { panel, half } = await openPanel(gotoDashboardPage, 'demo-lab L3', RADIO);
    await expect(async () => {
      await panel.locator(`[data-cell-id="${RADIO}"]`).scrollIntoViewIfNeeded();
      await half.tap({ force: true, timeout: 2000 });
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
    }).toPass();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('data-sheet', 'true');
    const chart = dialog.getByTestId('dmap-chart-hover').first();
    const tooltip = page.getByTestId('dmap-chart-tooltip');
    const box = (await chart.boundingBox())!;
    const y = box.y + box.height / 2;
    // CDP touch events: a horizontal drag across the chart
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x: number, yy: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy, id: 1 }],
      });
    await touch('touchStart', box.x + box.width * 0.2, y);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', box.x + box.width * (0.2 + i * 0.08), y);
    }
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/Mb\/s|%|\d/);
    await shot(page, 'phone-drag');
    await touch('touchEnd', 0, 0);
    // a vertical swipe on the chart scrolls the sheet (when it is scrollable) and does not scrub the chart
    const scroller = await dialog.evaluate((el) => el.scrollHeight - el.clientHeight);
    const before = await dialog.evaluate((el) => el.scrollTop);
    await page.mouse.move(0, 0);
    await touch('touchStart', box.x + box.width * 0.5, y + 4);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', box.x + box.width * 0.5, y + 4 - i * 12);
    }
    await touch('touchEnd', 0, 0);
    if (scroller > 0) {
      await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    }
    // the browser took the vertical gesture (pointercancel): no scrubbing tooltip is left
    await expect(tooltip).toHaveCount(0);
    await shot(page, 'phone-swipe');
  });
});
