import { devices } from '@playwright/test';
import { expect, test } from '@grafana/plugin-e2e';

const WAN1 = 'pg-link~wan1:pppoe->rtr-a:wan1';
const CUBE = 'pg-link~wan2:dhcp->rtr-a:wan2';
const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the card screenshots there

test.describe('hover card', () => {
  test('hover shows the card with both directions and sparklines', async ({ gotoDashboardPage, page }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    const half = panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${CUBE}"]`);
    await expect(half).toHaveAttribute('data-dmap-status', 'ok');
    await expect(panel.locator.getByTestId('dmap-card')).toHaveCount(0);
    await half.hover({ force: true });
    const card = panel.locator.getByRole('tooltip');
    await expect(card).toContainText('wan2 ↔ rtr-a');
    await expect(card).toContainText('wan2 → rtr-a');
    await expect(card).toContainText('90%');
    await expect(card.getByTestId('dmap-card-spark')).toHaveCount(2);
    if (SHOTS) {
      await panel.locator.screenshot({ path: `${SHOTS}/card-hover-desktop.png` });
    }
    // the card follows the pointer and goes away when the pointer leaves the cell
    await page.mouse.move(1, 1);
    await expect(panel.locator.getByTestId('dmap-card')).toHaveCount(0);
  });

  test('click pins the card; it has links, Esc closes it, another click moves it', async ({
    gotoDashboardPage,
    page,
  }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    const half = (cell: string) =>
      panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`);
    await expect(half(WAN1)).toHaveAttribute('data-dmap-status', 'ok');
    await half(WAN1).click({ force: true });
    const dialog = panel.locator.getByRole('dialog');
    await expect(dialog).toContainText('wan1 ↔ rtr-a');
    await expect(dialog).toContainText(/41(\.\d)? Mb\/s · 41%/);
    // the footer: the rule url with its urlTitle, then the data link of the field with its title
    const footer = dialog.getByTestId('dmap-card-link');
    await expect(footer).toHaveText(['Traffic of wan1:pppoe', 'Interface details']);
    await expect(dialog.getByRole('link', { name: 'Traffic of wan1:pppoe' })).toHaveAttribute(
      'href',
      /var-job=node-wan1&var-device=pppoe/
    );
    await expect(dialog.getByRole('link', { name: 'Interface details' })).toHaveAttribute('target', '_blank');
    // both open in a new tab: each has the external-link icon
    await expect(footer.first().locator('svg')).toBeVisible();
    await expect(footer.nth(1).locator('svg')).toBeVisible();
    // each sparkline has the full width of its row
    for (const row of await dialog.getByTestId('dmap-card-row').all()) {
      const r = (await row.boundingBox())!;
      const s = (await row.getByTestId('dmap-card-spark').boundingBox())!;
      expect(Math.abs(s.width - (r.width - 8))).toBeLessThanOrEqual(1);
    }
    // a pinned card stays when the pointer moves away
    await page.mouse.move(1, 1);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    if (SHOTS) {
      await panel.locator.screenshot({ path: `${SHOTS}/card-pinned-desktop.png` });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await half(WAN1).click({ force: true });
    await expect(dialog).toContainText('wan1 ↔ rtr-a');
    await half(CUBE).click({ force: true });
    await expect(dialog).toContainText('wan2 ↔ rtr-a');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('a click on a sparkline opens the url of its row', async ({ gotoDashboardPage, page }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    const node = panel.locator.locator('[data-cell-id="pg-node~rtr-a"]');
    await expect(node).toHaveAttribute('data-dmap-status', 'ok');
    // the group box is too big (the foreignObject label has width and height 100%), so click the node shape
    await node.locator('rect').first().click({ force: true });
    const dialog = panel.locator.getByRole('dialog');
    const cpu = dialog.getByTestId('dmap-card-row').filter({ hasText: 'CPU' });
    await expect(cpu).toContainText('%');
    const [popup] = await Promise.all([page.waitForEvent('popup'), cpu.getByTestId('dmap-card-spark').click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/\/d\/drawiomap-demo.*var-job=node-rtr-a&var-metric=cpu/);
    await popup.close();
  });
});

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

test.describe('hover card on a phone', () => {
  test.use(iPhone);

  test('a tap pins the card as a bottom sheet; a tap on the close button closes it', async ({ gotoDashboardPage }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    const half = panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${WAN1}"]`);
    await expect(half).toHaveAttribute('data-dmap-status', 'ok');
    await half.scrollIntoViewIfNeeded();
    await half.tap({ force: true });
    const dialog = panel.locator.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-sheet', 'true');
    await expect(dialog).toContainText('wan1 → rtr-a');
    // the sparkline is responsive: it has the full width of the sheet row
    const row = dialog.getByTestId('dmap-card-row').first();
    const r = (await row.boundingBox())!;
    const s = (await row.getByTestId('dmap-card-spark').boundingBox())!;
    expect(Math.abs(s.width - (r.width - 8))).toBeLessThanOrEqual(1);
    expect(s.width).toBeGreaterThan(300);
    if (SHOTS) {
      await panel.locator.screenshot({ path: `${SHOTS}/card-mobile-sheet.png` });
    }
    await dialog.getByRole('button', { name: 'Close' }).tap();
    await expect(dialog).toHaveCount(0);
  });
});
