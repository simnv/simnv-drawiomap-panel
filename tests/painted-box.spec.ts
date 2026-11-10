import fs from 'node:fs';
import type { Locator } from '@playwright/test';
import { openSplitEditor, popupCell, popupStage } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

/**
 * The outline of a selected cell in the split editor goes around what the cell draws. A draw.io HTML label is a
 * foreignObject of 100% x 100%: the box of its cell group is the whole diagram, and a CSS outline on the group showed
 * as two bars at the sides of the stage.
 */

const handHtml = fs.readFileSync('fixtures/demo/svg/hand-html-labels.svg', 'utf8');
const outline = (dialog: Locator, id: string) =>
  dialog.locator(`[data-testid="dmap-cell-outline"][data-dmap-outline="${id}"]`);
const box = async (el: Locator) => (await el.boundingBox())!;

test('the outline of a hand-drawn cell with an HTML label is about the size of the cell', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}, testInfo) => {
  const uid = await createDiagram(config, { svg: handHtml });
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  const cell = popupCell(dialog, 'node-a');
  const shape = cell.locator('rect').first();
  await shape.click();
  await expect(cell).toHaveAttribute('data-dmap-selected', 'true');
  await expect(outline(dialog, 'node-a')).toHaveAttribute('data-dmap-selected', 'true');

  const stage = await box(popupStage(dialog));
  const group = await box(cell);
  const drawn = await box(shape);
  const shown = await box(outline(dialog, 'node-a'));
  // the defect: the group of an HTML-label cell is as large as the diagram
  expect(group.width * group.height).toBeGreaterThan(4 * drawn.width * drawn.height);
  // the outline is on the shape (the label text sits inside it), within 2 px on each side
  for (const [a, b] of [
    [shown.x, drawn.x],
    [shown.y, drawn.y],
    [shown.x + shown.width, drawn.x + drawn.width],
    [shown.y + shown.height, drawn.y + drawn.height],
  ]) {
    expect(Math.abs(a - b), JSON.stringify({ shown, drawn })).toBeLessThanOrEqual(2);
  }
  expect(shown.width).toBeLessThan(stage.width / 2);
  await testInfo.attach('outline', { body: await dialog.screenshot(), contentType: 'image/png' });
  if (process.env.PAINTED_BOX_SHOT) {
    await dialog.screenshot({ path: process.env.PAINTED_BOX_SHOT });
  }
});

test('the outline of a cell without an HTML label is the box of its group, as before', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  const cell = popupCell(dialog, 'device-1');
  await cell.locator('rect').first().click();
  await expect(outline(dialog, 'device-1')).toHaveAttribute('data-dmap-selected', 'true');
  // the box of a CSS outline on the group: its client rectangle (Playwright's boundingBox adds half the stroke)
  const client = (el: Locator) =>
    el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  const group = await client(cell);
  const shown = await client(outline(dialog, 'device-1'));
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(shown[key] - group[key]), JSON.stringify({ shown, group })).toBeLessThanOrEqual(0.5);
  }
  // the clicked group has the focus; neither a selection rule nor the focus ring outlines the group itself
  await expect(cell).toBeFocused();
  expect(await cell.evaluate((g) => getComputedStyle(g).outlineStyle)).toBe('none');
});
