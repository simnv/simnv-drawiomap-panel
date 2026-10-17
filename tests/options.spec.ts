import { expect, test } from '@grafana/plugin-e2e';

const PANE_WIDTH = 300;

// Set DMAP_SCREENSHOTS=1 to write docs/screenshots/options-diagram.png.
const SCREENSHOT = process.env.DMAP_SCREENSHOTS ? 'docs/screenshots/options-diagram.png' : undefined;

test('the Diagram option buttons stay inside the options pane at the narrowest width', async ({
  gotoPanelEditPage,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2' });
  await panelEditPage.getCustomOptions('Diagram').expand();
  const group = page.getByTestId('data-testid Options group Diagram');
  await expect(page.getByTestId('dmap-diagram-status')).toBeVisible();

  // Drag the vertical splitter between the panel and the options pane to the right: the pane gets about 300 px.
  const splitters = await page.locator('[role=separator]').all();
  let vertical;
  for (const s of splitters) {
    const b = await s.boundingBox();
    if (b && b.height > b.width) {
      vertical = b;
    }
  }
  expect(vertical, 'vertical splitter').toBeTruthy();
  const y = vertical!.y + vertical!.height / 2;
  await page.mouse.move(vertical!.x + vertical!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(1280 - PANE_WIDTH - vertical!.width / 2, y, { steps: 10 });
  await page.mouse.up();

  const pane = await group.boundingBox();
  expect(pane!.width).toBeLessThanOrEqual(PANE_WIDTH + 10);

  const buttons = [
    page.getByTestId('dmap-open-editor'),
    group.getByRole('button', { name: 'Import .drawio' }),
    group.getByRole('button', { name: 'Clear', exact: true }),
  ];
  for (const button of buttons) {
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const paneBox = (await group.boundingBox())!;
    expect(box.x, 'left edge').toBeGreaterThanOrEqual(paneBox.x);
    expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(paneBox.x + paneBox.width);
  }

  if (SCREENSHOT) {
    const paneBox = (await group.boundingBox())!;
    const top = (await page.getByTestId('dmap-diagram-status').boundingBox())!.y - 80;
    await page.screenshot({
      path: SCREENSHOT,
      clip: { x: paneBox.x, y: Math.max(0, top), width: paneBox.width, height: 360 },
    });
  }
});
