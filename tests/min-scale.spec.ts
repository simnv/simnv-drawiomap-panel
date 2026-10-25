import { devices, type Locator, type Page } from '@playwright/test';
import type { DiagramConfig } from '../src/model/config';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';
import { expect, test } from './authoring-fixtures';

// A wide fictional sheet with 11 px labels: 14 columns of switches in three rows.
const COLUMNS = 14;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="600" viewBox="0 0 1900 600">
  <g data-cell-id="0" data-meta-pg-schema="1">${Array.from({ length: COLUMNS * 3 }, (_, i) => {
    const x = 20 + (i % COLUMNS) * 134;
    const y = 40 + Math.floor(i / COLUMNS) * 190;
    return `<g data-cell-id="sw-${i}" data-meta-pg-id="sw-${i}" data-meta-pg-kind="node"><rect x="${x}" y="${y}" width="110" height="60" fill="#d5e8d4" stroke="#82b366"/><text x="${x + 10}" y="${y + 35}" font-size="11" font-family="sans-serif">sw-${i}</text></g>`;
  }).join('')}</g>
</svg>`;
// the last switch of the middle row
const LAST = `sw-${COLUMNS * 2 - 1}`;

/** A card on every switch; one switch is down, so the status band has a row. */
function minScaleConfig(config: DiagramConfig): DiagramConfig {
  return {
    ...config,
    queries: [nativeQuery('health', 'vector(0)')],
    widgets: [],
    patterns: [
      {
        id: 'switches',
        name: 'Switches',
        select: { kind: 'node' },
        display: { hover: { rows: [{ kind: 'metadata', label: 'Device', path: 'cell.key' }] } },
      },
    ],
    overrides: [
      {
        cellId: 'sw-0',
        display: {
          status: {
            kind: 'mapping',
            binding: binding('health'),
            default: { state: 'normal', reason: 'Healthy' },
            mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
          },
        },
      },
    ],
  };
}

const scroll = (stage: Locator) =>
  stage.evaluate((el) => ({
    left: el.scrollLeft,
    top: el.scrollTop,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

/** The rendered height in CSS px of the text of a cell. */
const labelHeight = (panel: Locator, cell: string) =>
  panel
    .locator(`[data-cell-id="${cell}"] text`)
    .filter({ hasText: new RegExp(`^${cell}$`) })
    .evaluate((el) => el.getBoundingClientRect().height);

async function open(page: Page, gotoDashboardPage: (args: { uid: string }) => Promise<unknown>, uid: string) {
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await expect(panel).toHaveAttribute('data-dmap-cells', String(COLUMNS * 3 + 1));
  await expect(panel.locator('[data-cell-id="sw-0"][data-dmap-status="down"]')).toHaveCount(1);
  return { panel, stage: panel.getByTestId('dmap-stage'), band: panel.getByTestId('dmap-status-band') };
}

test.describe('Minimum scale on the desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const mode of ['fit', 'fit-width'] as const) {
    test(`${mode}: a wide sheet in a narrow panel keeps 11 px labels and the stage scrolls`, async ({
      page,
      config,
      createDiagram,
      gotoDashboardPage,
    }) => {
      // 14 of 24 grid columns: about 550 px for a 1900 px sheet (a hover card, not a sheet)
      const uid = await createDiagram(minScaleConfig(config), {
        svg,
        width: 14,
        height: 14,
        zoom: { mode, minScale: 1.3 },
      });
      const { panel, stage } = await open(page, gotoDashboardPage, uid);
      expect(await labelHeight(panel, 'sw-0')).toBeGreaterThanOrEqual(11);
      const s = await scroll(stage);
      expect(s.scrollWidth).toBeGreaterThan(s.clientWidth);
      expect(s.left).toBe(0);
      expect(s.top).toBe(0);
    });
  }

  test('the band stays above the stage after a scroll, the card opens at the pointer, reset goes to the top left', async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }, testInfo) => {
    const uid = await createDiagram(minScaleConfig(config), {
      svg,
      width: 14,
      height: 14,
      zoom: { mode: 'fit-width', minScale: 1.3 },
    });
    const { panel, stage, band } = await open(page, gotoDashboardPage, uid);
    const reset = panel.getByRole('button', { name: 'Reset zoom' });
    await expect(band).toBeVisible();

    // At the configured view the plain wheel scrolls the stage natively and does not zoom.
    const stageBox = (await stage.boundingBox())!;
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
    await page.mouse.wheel(4000, 0);
    await expect.poll(async () => (await scroll(stage)).left).toBeGreaterThan(0);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await scroll(stage)).top).toBeGreaterThan(0);
    await expect(reset).toHaveCount(0);

    // The band does not scroll with the stage.
    const bandBox = (await band.boundingBox())!;
    const stageNow = (await stage.boundingBox())!;
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(stageNow.y + 0.5);
    await expect(band).toBeInViewport();

    // The last switch of the middle row is in view after the scroll; its card opens next to the pointer.
    const cell = panel.locator(`[data-cell-id="${LAST}"] rect`);
    const cellBox = (await cell.boundingBox())!;
    expect(cellBox.x).toBeGreaterThanOrEqual(stageNow.x);
    expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(stageNow.x + stageNow.width);
    const pointer = { x: cellBox.x + cellBox.width / 2, y: cellBox.y + cellBox.height / 2 };
    await page.mouse.move(pointer.x, pointer.y);
    const tooltip = panel.getByRole('tooltip');
    await expect(tooltip).toContainText(LAST);
    const card = (await tooltip.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    const gap = Math.min(Math.abs(card.x - pointer.x), Math.abs(card.x + card.width - pointer.x));
    expect(gap).toBeLessThanOrEqual(24);
    expect(card.x).toBeGreaterThanOrEqual(panelBox.x - 1);
    expect(card.x + card.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    const screenshot = testInfo.outputPath('min-scale-scrolled-card.png');
    await page.screenshot({ path: screenshot, clip: panelBox });
    await testInfo.attach('min-scale-scrolled-card', { path: screenshot, contentType: 'image/png' });

    // Ctrl+wheel (a trackpad pinch) zooms beyond the configured view; reset gives the configured view at the top left.
    await page.keyboard.down('Control');
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -20);
    }
    await page.keyboard.up('Control');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(reset).toHaveCount(0);
    await expect(panel.locator('svg').first()).toHaveAttribute('viewBox', '0 0 1900 600');
    await expect.poll(async () => scroll(stage)).toMatchObject({ left: 0, top: 0 });
  });
});

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

/** One finger through the browser input pipeline, so that touch-action applies. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => [{ id: 0, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('Minimum scale on a phone', () => {
  test.use(iPhone);

  test('one finger scrolls the stage and does not zoom; a tap opens the sheet in the viewport', async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }, testInfo) => {
    const uid = await createDiagram(minScaleConfig(config), { svg, height: 14, zoom: { mode: 'fit', minScale: 1.3 } });
    const { panel, stage } = await open(page, gotoDashboardPage, uid);
    expect(await labelHeight(panel, 'sw-0')).toBeGreaterThanOrEqual(11);
    const box = (await stage.boundingBox())!;
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + box.width - 20, y }, { x: box.x + 20, y });
    await expect.poll(async () => (await scroll(stage)).left).toBeGreaterThan(0);
    // The swipe ends in a momentum scroll. Read the positions of the switches only after it stopped.
    let lastLeft = -1;
    await expect
      .poll(
        async () => {
          const { left } = await scroll(stage);
          const stopped = left === lastLeft;
          lastLeft = left;
          return stopped;
        },
        { intervals: [150] }
      )
      .toBe(true);
    await expect(panel.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);

    // a switch that is in view after the scroll
    let target: { id: string; x: number; y: number } | undefined;
    for (let i = 0; i < COLUMNS && !target; i++) {
      const b = (await panel.locator(`[data-cell-id="sw-${i}"] rect`).boundingBox())!;
      if (b.x >= box.x && b.x + b.width <= box.x + box.width && b.y >= box.y && b.y + b.height <= box.y + box.height) {
        target = { id: `sw-${i}`, x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
    }
    expect(target).toBeDefined();
    await page.touchscreen.tap(target!.x, target!.y);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('data-sheet', 'true');
    await expect(dialog).toContainText(target!.id);
    await expect(dialog).toBeInViewport({ ratio: 1 });
    const sheet = (await dialog.boundingBox())!;
    expect(sheet.y + sheet.height).toBeCloseTo(page.viewportSize()!.height, 0);
    const screenshot = testInfo.outputPath('min-scale-phone-sheet.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('min-scale-phone-sheet', { path: screenshot, contentType: 'image/png' });
  });
});
