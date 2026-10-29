import type { Locator } from '@playwright/test';
import { expect, saveDashboard, test } from './authoring-fixtures';

const PANE_WIDTH = 300;

// Set DMAP_SCREENSHOTS=1 to write docs/images/options-diagram.png.
const SCREENSHOT = process.env.DMAP_SCREENSHOTS ? 'docs/images/options-diagram.png' : undefined;

test('the Diagram option buttons and the YAML option stay inside the options pane at the narrowest width', async ({
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

  const inside = async (element: Locator, name: string) => {
    await expect(element, name).toBeVisible();
    const box = (await element.boundingBox())!;
    const paneBox = (await group.boundingBox())!;
    expect(box.x, `${name}: left edge`).toBeGreaterThanOrEqual(paneBox.x);
    expect(box.x + box.width, `${name}: right edge`).toBeLessThanOrEqual(paneBox.x + paneBox.width);
  };
  // P1 has no "Edit bindings" button (spec 5.0): the YAML option holds the bindings.
  await expect(page.getByTestId('dmap-edit-bindings-option')).toHaveCount(0);
  await inside(page.getByTestId('dmap-open-editor'), 'Open editor');
  await inside(group.getByRole('button', { name: 'Import .drawio' }), 'Import .drawio');
  await inside(group.getByRole('button', { name: 'Clear', exact: true }), 'Clear');

  // The YAML option (spec 5.0) shows the stored config as YAML, inside the same pane width.
  await panelEditPage.getCustomOptions('Bindings').expand();
  const bindings = page.getByTestId('data-testid Options group Bindings');
  const code = bindings.getByTestId('data-testid Code editor container');
  await expect(code.locator('.view-lines')).toContainText('version: 4', { timeout: 30_000 });
  const codeBox = (await code.boundingBox())!;
  const bindingsBox = (await bindings.boundingBox())!;
  expect(codeBox.x, 'YAML option: left edge').toBeGreaterThanOrEqual(bindingsBox.x);
  expect(codeBox.x + codeBox.width, 'YAML option: right edge').toBeLessThanOrEqual(bindingsBox.x + bindingsBox.width);
  expect(bindingsBox.width).toBeLessThanOrEqual(PANE_WIDTH + 10);

  if (SCREENSHOT) {
    const paneBox = (await group.boundingBox())!;
    const top = (await page.getByTestId('dmap-diagram-status').boundingBox())!.y - 80;
    await page.screenshot({
      path: SCREENSHOT,
      clip: { x: paneBox.x, y: Math.max(0, top), width: paneBox.width, height: 360 },
    });
  }
});

// Grafana merges an options update into the old options key by key, so a removed class came back (P1-14b).
test('the YAML option saves an empty class map as empty', async ({
  createDiagram,
  config,
  gotoPanelEditPage,
  page,
  request,
  selectors,
}) => {
  expect(Object.keys(config.classes)).toContain('routers');
  const uid = await createDiagram(config);
  const editor = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await editor.getCustomOptions('Bindings').expand();
  const lines = editor.getByGrafanaSelector(selectors.components.CodeEditor.container).locator('.view-lines');
  await expect(lines).toContainText('routers');
  await lines.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect(lines).toHaveText('');
  const empty = { version: 4, freshness: '7m', classes: {}, overrides: {} };
  await page.keyboard.insertText(JSON.stringify(empty));
  await expect(lines).toContainText('7m');
  await expect(lines).not.toContainText('routers');
  await saveDashboard(page, editor);
  const response = await request.get(`/api/dashboards/uid/${uid}`);
  expect(response.ok()).toBe(true);
  expect((await response.json()).dashboard.panels[0].options.config).toEqual(empty);
  const reloaded = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await reloaded.getCustomOptions('Bindings').expand();
  const reloadedLines = reloaded.getByGrafanaSelector(selectors.components.CodeEditor.container).locator('.view-lines');
  await expect(reloadedLines).toContainText('7m');
  await expect(reloadedLines).not.toContainText('routers');
});
