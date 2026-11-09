import { devices, type Locator, type Page } from '@playwright/test';
import { cursorToLine, hoverHalf, matchReport, openSplitEditor, pointOnHalf, splitDialog } from '../authoring-controls';
import { expect, test } from '../authoring-fixtures';
import { dark, half, LABELLED, quiet, useLabelledCopy } from './shared';

/**
 * The documentation images. `npm run docs:screenshots` runs this file (the Playwright project `docs`) against the
 * demo stack and then turns the hero video into a GIF (scripts/docs-hero-gif.sh). No other spec writes an image into
 * src/img/screenshots or docs/guide/images. Every image shows the dark theme of Grafana and the synthetic demo network.
 */
const CATALOG = 'src/img/screenshots';
const GUIDE = 'docs/guide/images';
const RADIO = 'pg-link~radio:dhcp->rtr-a:wan2';
const ISP_A = 'pg-link~isp-a:pppoe->rtr-a:wan1';
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

test.use({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
  // the timestamp of the last data shows in the time zone of the browser: a fixed zone keeps the test machine out
  timezoneId: 'Europe/Berlin',
});

useLabelledCopy(LABELLED);

type Goto = (a: { uid: string; queryParams?: URLSearchParams }) => Promise<{
  getPanelByTitle: (title: string) => Promise<{ locator: Locator }>;
}>;

/**
 * Opens the dashboard and returns the whole Grafana panel, after the half-link `cell` has data. `view` opens only that
 * panel; Grafana 13 then adds a sidebar on the right, so only the panels below the fold use it.
 */
async function openPanel(
  gotoDashboardPage: Goto,
  uid: string,
  { title = 'demo-lab L3', view, cell = RADIO }: { title?: string; view?: string; cell?: string } = {}
) {
  const dashboardPage = await gotoDashboardPage({ uid, queryParams: quiet(view ? { viewPanel: view } : {}) });
  const panel = (await dashboardPage.getPanelByTitle(title)).locator;
  await expect(half(panel, cell)).toHaveAttribute('data-dmap-status', 'ok');
  return panel;
}

async function zoomIn(page: Page, stage: Locator) {
  const b = (await stage.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -20);
  }
  await page.keyboard.up('Control');
}

test.describe('catalog images', () => {
  test('map.png: the demo network with the value labels of the links', async ({ gotoDashboardPage, page }) => {
    const panel = await openPanel(gotoDashboardPage, LABELLED);
    await expect(panel.locator('text.dmap-link-label').first()).toBeVisible();
    await page.mouse.move(1, 1);
    await panel.screenshot({ path: `${CATALOG}/map.png` });
  });

  test('hover-card.png: the hover card of the radio link', async ({ gotoDashboardPage }) => {
    const panel = await openPanel(gotoDashboardPage, LABELLED);
    await hoverHalf(half(panel, RADIO));
    const card = panel.getByRole('tooltip');
    await expect(card).toContainText('Radio bridge dhcp ↔ rtr-a wan2');
    await expect(card.getByTestId('dmap-mirror-spark')).toBeVisible();
    await panel.screenshot({ path: `${CATALOG}/hover-card.png` });
  });

  test('editor.png: the draw.io editor of the panel options', async ({ gotoPanelEditPage, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const edit = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '1', queryParams: dark() });
    await edit.getCustomOptions('Diagram').expand();
    await page.getByTestId('dmap-open-editor').click();
    const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
    await expect(frame.locator('.geDiagramContainer')).toBeVisible({ timeout: 60_000 });
    await expect(frame.locator('.geMenubarContainer')).toBeVisible();
    // draw.io opens its Layers window on a diagram with layers; it covers the Format panel
    const layers = frame.locator('td.mxWindowTitle', { hasText: 'Layers' }).locator('img[title="Close"]');
    if (await layers.count()) {
      await layers.click();
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${CATALOG}/editor.png` });
  });
});

test.describe('guide images', () => {
  test('colour-legend.png: the open legend', async ({ gotoDashboardPage, page }) => {
    const panel = await openPanel(gotoDashboardPage, 'drawiomap-demo');
    const legend = panel.getByTestId('dmap-legend');
    const handle = legend.getByRole('button', { name: 'Legend' });
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expect(legend.getByRole('group', { name: /^Link load %/ }).first()).toBeVisible();
    await page.mouse.move(1, 1);
    await legend.screenshot({ path: `${GUIDE}/colour-legend.png` });
  });

  test('legend-highlight.png: a legend band lights its elements', async ({ gotoDashboardPage, page }) => {
    const panel = await openPanel(gotoDashboardPage, 'drawiomap-demo');
    const legend = panel.getByTestId('dmap-legend');
    await legend.getByRole('button', { name: 'Legend' }).click();
    const block = legend.getByRole('group', { name: /^Link load % \(lan_rx, lan_tx\)$/ });
    const entries = block.getByTestId('dmap-legend-entry');
    await expect(entries.first()).toBeVisible();
    const labels = await entries.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!));
    const index = labels.findIndex((l) => !l.endsWith(': 0 elements'));
    expect(index).toBeGreaterThanOrEqual(0);
    await entries.nth(index).hover();
    await expect(panel.locator('svg.dmap-legend-active')).toHaveCount(1);
    await expect(panel.locator('g.dmap-legend-hit').first()).toBeVisible();
    await panel.screenshot({ path: `${GUIDE}/legend-highlight.png` });
    await page.mouse.move(1, 1);
  });

  test('last-data-timestamp.png: the timestamp beside the legend, with its tooltip', async ({
    gotoDashboardPage,
    page,
  }) => {
    const panel = await openPanel(gotoDashboardPage, 'drawiomap-demo');
    const stamp = panel.getByTestId('dmap-last-data');
    await expect(stamp).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d$/);
    await stamp.hover();
    const tooltip = page.getByTestId('dmap-last-data-tooltip');
    await expect(tooltip).toBeVisible();
    const p = (await panel.getByTestId('dmap-panel').boundingBox())!;
    const t = (await tooltip.boundingBox())!;
    // the bottom right part of the panel and the tooltip (below or above the timestamp)
    const top = Math.min(t.y, p.y + p.height - 200) - 8;
    const bottom = Math.max(t.y + t.height, p.y + p.height) + 8;
    const left = Math.min(t.x, p.x + p.width - 480) - 8;
    await page.screenshot({
      path: `${GUIDE}/last-data-timestamp.png`,
      clip: { x: left, y: top, width: p.x + p.width + 4 - left, height: bottom - top },
    });
  });

  test('zoomed-reset-button.png: the zoomed map with the reset button', async ({ gotoDashboardPage, page }) => {
    const panel = await openPanel(gotoDashboardPage, 'drawiomap-demo');
    await zoomIn(page, panel.getByTestId('dmap-stage'));
    await expect(panel.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
    await page.mouse.move(1, 1);
    await panel.screenshot({ path: `${GUIDE}/zoomed-reset-button.png` });
  });

  test('link-labels.png: the value labels of the links', async ({ gotoDashboardPage, page }) => {
    const panel = await openPanel(gotoDashboardPage, LABELLED);
    await expect(panel.locator('text.dmap-link-label[data-dmap-mode="value"]').first()).toBeVisible();
    await page.mouse.move(1, 1);
    const box = (await panel.getByTestId('dmap-stage').boundingBox())!;
    // the lower part of the map: the WAN links with a label on each half
    await page.screenshot({
      path: `${GUIDE}/link-labels.png`,
      clip: { x: box.x, y: box.y + box.height * 0.36, width: box.width, height: box.height * 0.52 },
    });
  });

  test('card-pinned.png: the pinned hover card', async ({ gotoDashboardPage, page }) => {
    const panel = await openPanel(gotoDashboardPage, 'drawiomap-demo', { cell: ISP_A });
    await pointOnHalf(half(panel, ISP_A));
    await half(panel, ISP_A).click({ force: true });
    const dialog = panel.getByRole('dialog');
    await expect(dialog).toContainText('ISP A pppoe ↔ rtr-a wan1');
    await expect(dialog.getByTestId('dmap-card-link').first()).toBeVisible();
    await expect(dialog.getByTestId('dmap-mirror-spark').first()).toBeVisible();
    await page.mouse.move(1, 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await panel.screenshot({ path: `${GUIDE}/card-pinned.png` });
  });

  test('sparkline-range.png: the up and down chart of a link card', async ({ gotoDashboardPage }) => {
    const panel = await openPanel(gotoDashboardPage, 'drawiomap-demo', {
      title: 'Sanitized authoring topology',
      view: 'panel-3',
      cell: 'link-1',
    });
    await hoverHalf(half(panel, 'link-1'));
    const card = panel.getByRole('tooltip');
    await expect(card.getByTestId('dmap-mirror-spark')).toBeVisible();
    await expect(card.getByTestId('dmap-card-value')).toContainText('↓');
    await card.screenshot({ path: `${GUIDE}/sparkline-range.png` });
  });

  test('options-diagram.png: the Diagram options in the narrow options pane', async ({ gotoPanelEditPage, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const edit = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2', queryParams: dark() });
    await edit.getCustomOptions('Diagram').expand();
    const group = page.getByTestId('data-testid Options group Diagram');
    await expect(page.getByTestId('dmap-diagram-status')).toBeVisible();
    // drag the vertical splitter to the right: the pane gets about 300 px
    let vertical: { x: number; y: number; width: number; height: number } | undefined;
    for (const s of await page.locator('[role=separator]').all()) {
      const b = await s.boundingBox();
      if (b && b.height > b.width) {
        vertical = b;
      }
    }
    expect(vertical, 'vertical splitter').toBeTruthy();
    const y = vertical!.y + vertical!.height / 2;
    await page.mouse.move(vertical!.x + vertical!.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(1280 - 300 - vertical!.width / 2, y, { steps: 10 });
    await page.mouse.up();
    await page.getByTestId('dmap-diagram-status').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const paneBox = (await group.boundingBox())!;
    const top = Math.max(0, (await page.getByTestId('dmap-diagram-status').boundingBox())!.y - 80);
    // the clip ends below the last button of the group, so no button is cut
    const apply = page.getByRole('button', { name: 'Apply pasted XML' });
    await apply.scrollIntoViewIfNeeded();
    const bottom = (await apply.boundingBox())!.y + (await apply.boundingBox())!.height + 16;
    await page.screenshot({
      path: `${GUIDE}/options-diagram.png`,
      clip: { x: paneBox.x, y: top, width: paneBox.width, height: Math.max(360, bottom - top) },
    });
  });

  test('split-editor.png: the split editor at 1440 x 900', async ({ page, gotoPanelEditPage }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '1', queryParams: dark() });
    const dialog = await openSplitEditor(page);
    await expect(dialog.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'panes');
    // the cursor in a class lights its cells and opens its tab: the image shows text, diagram and report together
    await cursorToLine(dialog, /^ {2}wan:$/);
    const report = matchReport(dialog);
    await expect(report.getByRole('tab', { name: /^wan/ })).toHaveAttribute('aria-selected', 'true');
    await expect(report.getByRole('tabpanel', { name: 'Class wan' })).toBeVisible();
    await page.waitForTimeout(1000);
    await splitDialog(page).screenshot({ path: `${GUIDE}/split-editor.png` });
  });
});

test.describe('guide images on a phone', () => {
  test.use({ ...iPhone, colorScheme: 'dark', deviceScaleFactor: 2, timezoneId: 'Europe/Berlin' });

  test('card-mobile-sheet.png: the card as a bottom sheet', async ({ gotoDashboardPage, page }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo', queryParams: quiet() });
    const panel = (await dashboardPage.getPanelByTitle('demo-lab L3')).locator;
    const target = half(panel, ISP_A);
    await expect(target).toHaveAttribute('data-dmap-status', 'ok');
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      await panel.locator(`[data-cell-id="${ISP_A}"]`).scrollIntoViewIfNeeded();
      await target.tap({ force: true, timeout: 2000 });
      await expect(dialog).toBeVisible({ timeout: 2000 });
    }).toPass();
    await expect(dialog).toContainText('ISP A pppoe ↔ rtr-a wan1');
    await expect(dialog.getByTestId('dmap-mirror-spark').first()).toBeVisible();
    await page.screenshot({ path: `${GUIDE}/card-mobile-sheet.png` });
  });

  test('split-editor-phone.png: the split editor as tabs on a phone', async ({ page, gotoPanelEditPage }) => {
    await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '1', queryParams: dark() });
    const dialog = await openSplitEditor(page);
    await expect(dialog.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'tabs');
    await dialog.getByRole('tab', { name: 'Diagram', exact: true }).click();
    await expect(dialog.getByTestId('dmap-popup-stage')).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${GUIDE}/split-editor-phone.png` });
  });
});
