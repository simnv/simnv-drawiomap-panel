import type { Locator, Page } from '@playwright/test';
import { expect, saveDashboard, test } from './authoring-fixtures';

const PANE_WIDTH = 300;

// Set DMAP_SCREENSHOTS=1 to write local/options-bindings.png. The documentation image of the Diagram options comes
// from tests/docs/screenshots.spec.ts (`npm run docs:screenshots`).
const BINDINGS_SCREENSHOT = process.env.DMAP_SCREENSHOTS ? 'local/options-bindings.png' : undefined;

/** Drag the vertical splitter between the panel and the options pane to the right: the pane gets about 300 px. */
async function narrowPane(page: Page) {
  await expect(page.locator('[role=separator]').first()).toBeVisible();
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
}

test('the Diagram option buttons, the Edit bindings button and the YAML option stay inside the options pane at the narrowest width', async ({
  gotoPanelEditPage,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2' });
  await panelEditPage.getCustomOptions('Diagram').expand();
  const group = page.getByTestId('data-testid Options group Diagram');
  await expect(page.getByTestId('dmap-diagram-status')).toBeVisible();

  await narrowPane(page);

  const pane = await group.boundingBox();
  expect(pane!.width).toBeLessThanOrEqual(PANE_WIDTH + 10);

  const inside = async (element: Locator, name: string) => {
    await expect(element, name).toBeVisible();
    const box = (await element.boundingBox())!;
    const paneBox = (await group.boundingBox())!;
    expect(box.x, `${name}: left edge`).toBeGreaterThanOrEqual(paneBox.x);
    expect(box.x + box.width, `${name}: right edge`).toBeLessThanOrEqual(paneBox.x + paneBox.width);
  };
  await expect(page.getByTestId('dmap-open-editor')).toHaveText('Edit in draw.io');
  await inside(page.getByTestId('dmap-open-editor'), 'Edit in draw.io');
  await inside(group.getByRole('button', { name: 'Import .drawio' }), 'Import .drawio');
  await inside(group.getByRole('button', { name: 'Clear', exact: true }), 'Clear');
  await expect(group.getByTestId('dmap-edit-bindings-option')).toHaveCount(0);

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
  // The "Edit bindings" button opens the split editor (spec 5.1). It stands in the Bindings option, above the YAML.
  const edit = bindings.getByTestId('dmap-edit-bindings-option');
  await expect(edit).toBeVisible();
  await expect(edit).toBeEnabled();
  const editBox = (await edit.boundingBox())!;
  expect(editBox.x, 'Edit bindings: left edge').toBeGreaterThanOrEqual(bindingsBox.x);
  expect(editBox.x + editBox.width, 'Edit bindings: right edge').toBeLessThanOrEqual(bindingsBox.x + bindingsBox.width);
  expect(editBox.y + editBox.height, 'Edit bindings: above the YAML').toBeLessThanOrEqual(codeBox.y);
  expect(codeBox.y - (editBox.y + editBox.height), 'Edit bindings: next to the YAML').toBeLessThan(80);
  if (BINDINGS_SCREENSHOT) {
    await edit.scrollIntoViewIfNeeded();
    const top = Math.max(0, (await edit.boundingBox())!.y - 60);
    const pane = (await bindings.boundingBox())!;
    await page.screenshot({
      path: BINDINGS_SCREENSHOT,
      clip: { x: pane.x, y: top, width: pane.width, height: Math.min(360, 800 - top) },
    });
  }
});

test('Zoom, Align and the legend Corner are rows of icons with tooltips that fit the narrowest options pane', async ({
  gotoPanelEditPage,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '1' });
  await expect(page.getByTestId('dmap-panel')).toBeVisible();
  await narrowPane(page);
  await panelEditPage.getCustomOptions('View').expand();
  await panelEditPage.getCustomOptions('Legend').expand();
  const view = page.getByTestId('data-testid Options group View');
  const legend = page.getByTestId('data-testid Options group Legend');
  const zoom = view.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: 'Fit width' }) });
  const align = view.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: 'Center' }) });
  const corner = legend.getByRole('radiogroup', { name: 'Legend corner' });
  for (const [name, group, pane, count] of [
    ['Zoom', zoom, view, 4],
    ['Align', align, view, 2],
    ['Corner', corner, legend, 4],
  ] as const) {
    await expect(group, name).toBeVisible();
    const labels = await group.locator('label').all();
    expect(labels, name).toHaveLength(count);
    const paneBox = (await pane.boundingBox())!;
    expect(paneBox.width).toBeLessThanOrEqual(PANE_WIDTH + 10);
    const boxes = await Promise.all(labels.map(async (l) => (await l.boundingBox())!));
    for (const b of boxes) {
      // one row, no wrap, inside the pane
      expect(Math.abs(b.y - boxes[0].y), `${name}: one row`).toBeLessThan(1);
      expect(b.x, `${name}: left edge`).toBeGreaterThanOrEqual(paneBox.x);
      expect(b.x + b.width, `${name}: right edge`).toBeLessThanOrEqual(paneBox.x + paneBox.width);
    }
  }
  await expect(zoom.getByRole('radio', { name: 'Fit', exact: true })).toBeChecked();
  await expect(align.getByRole('radio', { name: 'Top' })).toBeChecked();
  await expect(corner.getByRole('radio', { name: 'Bottom right' })).toBeChecked();
  if (process.env.DMAP_SCREENSHOTS) {
    // the Zoom and Align options, and the legend options: two parts of the pane, one above the other
    const part = async (from: Locator, to: Locator) => {
      await from.scrollIntoViewIfNeeded();
      await to.scrollIntoViewIfNeeded();
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;
      const paneBox = (await legend.boundingBox())!;
      const top = a.y - 32;
      return page.screenshot({
        clip: { x: paneBox.x, y: top, width: paneBox.width, height: b.y + b.height + 12 - top },
      });
    };
    const shots = [await part(zoom, align), await part(legend.getByText('Show legend', { exact: true }), corner)];
    const sheet = await page.context().newPage();
    await sheet.setContent(
      `<body style="margin:0;background:#111217"><div id="sheet" style="display:inline-block">${shots
        .map((png) => `<img style="display:block" src="data:image/png;base64,${png.toString('base64')}">`)
        .join('<hr style="margin:0;border:0;border-top:1px dashed #555">')}</div></body>`
    );
    await sheet.locator('#sheet').screenshot({ path: 'local/options-icons.png' });
    await sheet.close();
  }
  // each icon has a Grafana tooltip: the pointer on the icon shows it
  for (const [group, name, tip] of [
    [zoom, 'Fit width', /^Fit width: /],
    [align, 'Center', /^Center: /],
    [corner, 'Top left', /^Top left$/],
  ] as const) {
    // Grafana 13 lays the radio input over the label, Grafana 12 hides it: hover the button box
    await group.getByRole('radio', { name }).hover({ force: true });
    await expect(page.getByRole('tooltip').filter({ hasText: tip })).toBeVisible();
  }
  // the saved values do not change: a click on a corner moves the legend of the panel
  await corner.getByRole('radio', { name: 'Top left' }).click({ force: true });
  await expect(page.getByTestId('dmap-panel').getByTestId('dmap-legend')).toHaveAttribute(
    'data-dmap-corner',
    'top-left'
  );
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
