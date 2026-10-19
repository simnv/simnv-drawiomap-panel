import { devices } from '@playwright/test';
import type { DiagramConfigV2 } from '../src/model/config';
import { expect, test } from './authoring-fixtures';

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

// A tall fictional sheet: the link is in the middle, far above the bottom edge of the panel.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="2000" viewBox="0 0 390 2000">
  <g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-node~top" data-meta-pg-kind="node" data-meta-pg-id="top"><rect x="20" y="40" width="120" height="60" fill="#d5e8d4" stroke="#82b366"/><text x="30" y="75">top</text></g>
    <g data-cell-id="pg-node~a" data-meta-pg-kind="node" data-meta-pg-id="a"><rect x="20" y="970" width="100" height="60" fill="#d5e8d4" stroke="#82b366"/><text x="30" y="1005">rtr-a</text></g>
    <g data-cell-id="pg-node~b" data-meta-pg-kind="node" data-meta-pg-id="b"><rect x="270" y="970" width="100" height="60" fill="#d5e8d4" stroke="#82b366"/><text x="280" y="1005">rtr-b</text></g>
    <g data-cell-id="pg-link~a-b" data-meta-pg-kind="link" data-meta-pg-id="a-b" data-meta-pg-from="a" data-meta-pg-to="b"><path d="M120 1000 L270 1000" fill="none" stroke="#888" stroke-width="10" pointer-events="stroke"/></g>
  </g>
</svg>`;

function linkCard(config: DiagramConfigV2): DiagramConfigV2 {
  return {
    ...config,
    queries: [],
    widgets: [],
    overrides: [],
    patterns: [
      {
        id: 'link',
        name: 'Link',
        select: { ids: ['a-b'] },
        display: {
          hover: {
            rows: [
              { kind: 'metadata', label: 'From', path: 'from.node' },
              { kind: 'metadata', label: 'To', path: 'to.node' },
            ],
          },
        },
      },
    ],
  };
}

test.describe('sheet on a phone', () => {
  test.use(iPhone);

  test('a tap on a link in a 2000 px tall panel opens the sheet inside the viewport', async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }, testInfo) => {
    // 53 grid rows: about 2000 px
    const uid = await createDiagram(linkCard(config), { svg, height: 53 });
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel');
    expect((await panel.boundingBox())!.height).toBeGreaterThan(1900);
    const link = panel.locator('[data-cell-id="pg-link~a-b"]');
    await link.scrollIntoViewIfNeeded();
    const box = (await link.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('data-sheet', 'true');
    await expect(dialog).toContainText('From');
    await expect(dialog).toBeInViewport({ ratio: 1 });
    const sheet = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(sheet.y + sheet.height).toBeCloseTo(viewport.height, 0);
    expect(sheet.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1);
    // the panel bottom edge is far below the viewport
    expect((await panel.boundingBox())!.y + 1900).toBeGreaterThan(viewport.height);
    const screenshot = testInfo.outputPath('phone-sheet.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('phone-sheet', { path: screenshot, contentType: 'image/png' });
    // a tap outside the panel and the sheet closes it; the page did not scroll to the panel bottom
    const scrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).tap();
    await expect(dialog).toHaveCount(0);
    expect(
      Math.abs((await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)) - scrollBefore)
    ).toBeLessThan(2);
  });
});
