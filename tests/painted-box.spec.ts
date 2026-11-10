import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { demoConfigV4 } from '../src/fixtures/demo-config';
import { cursorToLine, inspector, openSplitEditor, popupCell, popupStage } from './authoring-controls';
import { expect, promTarget, test, withDemoBindings, type PanelTarget } from './authoring-fixtures';

/**
 * The overlays of a cell (the outline of the selection, the focus ring, the card that Enter pins) go around what the
 * cell draws. A draw.io HTML label is a foreignObject of 100% x 100%: the box of its cell group is the whole diagram,
 * and a CSS outline on the group showed as two bars at the sides of the stage. The overlays follow the view (the zoom
 * to the highlighted cells, the wheel, a drag) and a new root (a write of a cell attribute).
 */

const handHtml = fs.readFileSync('fixtures/demo/svg/hand-html-labels.svg', 'utf8');
const legacyHtml = withDemoBindings(fs.readFileSync('fixtures/demo/svg/legacy-html-labels.svg', 'utf8'));
const outline = (dialog: Locator, id: string) =>
  dialog.locator(`[data-testid="dmap-cell-outline"][data-dmap-outline="${id}"]`);
const ring = (scope: Locator | Page) => scope.locator('[data-testid="dmap-cell-focus"]');
type Box = { x: number; y: number; width: number; height: number };
const box = async (el: Locator) => (await el.boundingBox())!;
/** The client rectangle: the box of a CSS outline (Playwright's boundingBox adds half the stroke of an svg shape). */
const client = (el: Locator): Promise<Box> =>
  el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
/** The largest gap between the edges of two boxes, in px. */
const gap = (a: Box, b: Box) =>
  Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.x + a.width - (b.x + b.width)),
    Math.abs(a.y + a.height - (b.y + b.height))
  );
/** The outline of a cell without an HTML label sits on the client rectangle of its group. */
const outlineGap = async (dialog: Locator, id: string) =>
  gap(await client(outline(dialog, id)), await client(popupCell(dialog, id)));
const viewBox = (dialog: Locator) => popupStage(dialog).locator(':scope > svg').getAttribute('viewBox');

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
  // the defect: the group of an HTML-label cell is as large as the diagram
  expect(group.width * group.height).toBeGreaterThan(4 * drawn.width * drawn.height);
  // the outline is on the shape (the label text sits inside it), within 2 px on each side
  const shown = await box(outline(dialog, 'node-a'));
  expect(gap(shown, drawn), JSON.stringify({ shown, drawn })).toBeLessThanOrEqual(2);
  expect(shown.width).toBeLessThan(stage.width / 2);
  await testInfo.attach('outline', { body: await dialog.screenshot(), contentType: 'image/png' });
  if (process.env.PAINTED_BOX_SHOTS) {
    await dialog.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/outline-html-label.png` });
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
  // select it with the keyboard: in the WebKit viewport the trend chart covers the rect of device-1
  await cell.focus();
  await page.keyboard.press('Enter');
  await expect(outline(dialog, 'device-1')).toHaveAttribute('data-dmap-selected', 'true');
  expect(await outlineGap(dialog, 'device-1')).toBeLessThanOrEqual(0.5);
  // the group has the focus; neither a selection rule nor the focus ring of the browser outlines it
  await expect(cell).toBeFocused();
  expect(await cell.evaluate((g) => getComputedStyle(g).outlineStyle)).toBe('none');
});

test('the outlines follow the zoom to the highlighted cells, a wheel step and a drag', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  await expect(popupCell(dialog, 'device-1')).toHaveAttribute('data-dmap-status', 'normal');

  // the cursor on a class: its cells light up, and the split editor zooms to them
  const fitted = await viewBox(dialog);
  await cursorToLine(dialog, /^ {2}routers:$/);
  await expect.poll(() => viewBox(dialog)).not.toBe(fitted);
  for (const id of ['device-1', 'device-2']) {
    await expect(outline(dialog, id)).toHaveAttribute('data-dmap-highlight', 'true');
    await expect
      .poll(() => outlineGap(dialog, id), { message: `the outline of ${id} after the zoom` })
      .toBeLessThanOrEqual(0.5);
  }
  if (process.env.PAINTED_BOX_SHOTS) {
    await dialog.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/outline-zoom-to-cells.png` });
  }

  // a click selects device-1; one wheel step, then a drag of one step
  await popupCell(dialog, 'device-1').locator('rect').first().click();
  await expect(outline(dialog, 'device-1')).toHaveAttribute('data-dmap-selected', 'true');
  const stage = await box(popupStage(dialog));
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  let before = await viewBox(dialog);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => viewBox(dialog)).not.toBe(before);
  await expect.poll(() => outlineGap(dialog, 'device-1'), { message: 'after a wheel step' }).toBeLessThanOrEqual(0.5);
  before = await viewBox(dialog);
  await page.mouse.move(stage.x + stage.width - 40, stage.y + stage.height - 40);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width - 140, stage.y + stage.height - 100, { steps: 1 });
  await page.mouse.up();
  await expect.poll(() => viewBox(dialog)).not.toBe(before);
  await expect.poll(() => outlineGap(dialog, 'device-1'), { message: 'after a drag' }).toBeLessThanOrEqual(0.5);
});

test('a write of a cell attribute (Set bind and key) keeps the outline of the selected cell', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  await popupCell(dialog, 'ordinary-chart').click();
  await expect(outline(dialog, 'ordinary-chart')).toHaveCount(1);
  await inspector(dialog).getByTestId('dmap-inspector-key').fill('chart-key');
  await inspector(dialog).getByRole('button', { name: 'Set bind and key', exact: true }).click();
  // a new root with the written attribute
  await expect(popupCell(dialog, 'ordinary-chart')).toHaveAttribute('data-meta-key', 'chart-key');
  await expect(popupCell(dialog, 'ordinary-chart')).toHaveAttribute('data-dmap-selected', 'true');
  await expect(outline(dialog, 'ordinary-chart')).toHaveCount(1);
  await expect.poll(() => outlineGap(dialog, 'ordinary-chart')).toBeLessThanOrEqual(0.5);
});

test('the keyboard focus ring: after a click and a key, on Tab, and beside the outline of a selected cell', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config, { svg: handHtml });
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  const cell = popupCell(dialog, 'node-a');
  await cell.locator('rect').first().click();
  // the focus of a click shows no ring
  await expect(cell).toBeFocused();
  await expect(ring(dialog)).toHaveCount(0);
  // Shift+Enter takes the cell out of the selection: the keyboard is in use, so the ring shows
  await page.keyboard.press('Shift+Enter');
  await expect(cell).not.toHaveAttribute('data-dmap-selected', 'true');
  await expect(ring(dialog)).toHaveAttribute('data-dmap-focus', 'node-a');
  // on the painted box of the cell, at a gap of 6 px: about the size of the shape, not of the diagram
  const shape = await box(cell.locator('rect').first());
  expect(gap(await box(ring(dialog)), shape)).toBeLessThanOrEqual(2);
  // Tab to the next cell: the ring follows
  await page.keyboard.press('Tab');
  await expect(ring(dialog)).toHaveAttribute('data-dmap-focus', 'node-b');
  // Enter selects it: the outline and the ring both show
  await page.keyboard.press('Enter');
  await expect(outline(dialog, 'node-b')).toHaveAttribute('data-dmap-selected', 'true');
  await expect(ring(dialog)).toHaveAttribute('data-dmap-focus', 'node-b');
  expect(await ring(dialog).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  if (process.env.PAINTED_BOX_SHOTS) {
    await dialog.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/focus-and-outline.png` });
  }
});

/** The v4 demo targets on the provisioned VictoriaMetrics datasource, as the provisioned demo panel has them. */
const demoPanel: { targets: PanelTarget[]; fieldConfig: { defaults: Record<string, unknown>; overrides: unknown[] } } =
  JSON.parse(fs.readFileSync('provisioning/dashboards/demo.json', 'utf8')).panels[0];

test('view mode: the focus ring and the card that Enter pins sit at a cell with an HTML label', async ({
  page,
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  const prom = await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' });
  const datasource = { uid: prom.uid, type: prom.type };
  const uid = await createDiagram(demoConfigV4, {
    panels: [{ config: demoConfigV4, svg: legacyHtml, title: 'html labels' }],
    targets: demoPanel.targets.map((t) => promTarget(t.refId, String(t.expr), { ...t, datasource })),
    fieldConfig: demoPanel.fieldConfig,
    height: 18,
  });
  const dashboardPage = await gotoDashboardPage({ uid });
  const panel = (await dashboardPage.getPanelByTitle('html labels')).locator;
  const cell = panel.locator('[data-cell-id="pg-node~rtr-a"]').first();
  await expect(cell).toHaveAttribute('tabindex', '0');
  const shape = await box(cell.locator('path, rect').first());
  const group = await box(cell);
  // the HTML label makes the group as large as the diagram
  expect(group.width).toBeGreaterThan(2 * shape.width);

  await cell.focus();
  // a key that is keyboard use for the browser (a modifier alone is not) and that does not scroll the page
  await page.keyboard.press('ArrowRight');
  await expect(ring(panel)).toHaveAttribute('data-dmap-focus', 'pg-node~rtr-a');
  const shown = await box(ring(panel));
  expect(shown.width, JSON.stringify({ shown, shape })).toBeLessThan(1.5 * shape.width);
  expect(shown.x).toBeGreaterThanOrEqual(shape.x - 4);
  expect(await cell.evaluate((g) => getComputedStyle(g).outlineStyle)).toBe('none');
  if (process.env.PAINTED_BOX_SHOTS) {
    await panel.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/view-focus-ring.png` });
  }

  // Enter pins the card at the bottom centre of the painted box, not of the diagram
  await page.keyboard.press('Enter');
  const card = page.getByTestId('dmap-card');
  await expect(card).toHaveAttribute('data-pinned', 'true');
  const at = await box(card);
  expect(at.y, JSON.stringify({ at, shape })).toBeLessThan(shape.y + shape.height + 40);
  expect(at.x, JSON.stringify({ at, shape })).toBeLessThan(shape.x + shape.width);
  if (process.env.PAINTED_BOX_SHOTS) {
    await page.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/view-card-pinned.png` });
  }
});

/** The gaps between the ring and the client rectangle of a cell group, right after each of `steps` wheel steps. */
async function ringGapsInWheelSteps(scope: Locator, cellId: string, steps: number, ms: number) {
  return scope.evaluate(
    async (el, { cellId, steps, ms }) => {
      // the diagram, not an icon of a control
      const svg = el.querySelector('[data-testid="dmap-stage"] > svg, [data-testid="dmap-popup-stage"] > svg')!;
      const group = el.querySelector(`[data-cell-id="${cellId}"]`)!;
      const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
      const out: number[] = [];
      for (let i = 0; i < steps; i++) {
        const r = svg.getBoundingClientRect();
        const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, ...at }));
        await frame();
        await frame();
        const ring = el.querySelector('[data-testid="dmap-cell-focus"]')?.getBoundingClientRect();
        const g = group.getBoundingClientRect();
        out.push(
          ring
            ? Math.max(
                Math.abs(ring.left - g.left),
                Math.abs(ring.top - g.top),
                Math.abs(ring.right - g.right),
                Math.abs(ring.bottom - g.bottom)
              )
            : Infinity
        );
        await new Promise((done) => setTimeout(done, ms));
      }
      return out;
    },
    { cellId, steps, ms }
  );
}

test('the focus ring follows each wheel step in the split editor', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  const cell = popupCell(dialog, 'device-1');
  await cell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ring(dialog)).toHaveAttribute('data-dmap-focus', 'device-1');
  const before = await viewBox(dialog);
  // each step is a commit of the view in the split editor; measure right after it, with no later paint to help
  const gaps = await ringGapsInWheelSteps(popupStage(dialog).locator('..'), 'device-1', 3, 300);
  expect(await viewBox(dialog)).not.toBe(before);
  expect(Math.max(...gaps), JSON.stringify(gaps)).toBeLessThanOrEqual(0.5);
  if (process.env.PAINTED_BOX_SHOTS) {
    await dialog.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/ring-after-wheel.png` });
  }
});

test('view mode: the focus ring follows a stream of wheel steps (the live view of the gesture)', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(config, { zoom: { mode: 'fit', wheel: true, pan: true } });
  const dashboardPage = await gotoDashboardPage({ uid });
  const panel = (await dashboardPage.getPanelByTitle('Sanitized topology 1')).locator;
  const cell = panel.locator('[data-cell-id="device-1"]').first();
  await expect(cell).toHaveAttribute('tabindex', '0');
  await cell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ring(panel)).toHaveAttribute('data-dmap-focus', 'device-1');
  const before = await panel.getByTestId('dmap-stage').locator(':scope > svg').getAttribute('viewBox');
  // 40 ms apart: the panel commits the view only after the stream, each step is a live write of the view box
  const gaps = await ringGapsInWheelSteps(panel.getByTestId('dmap-panel'), 'device-1', 4, 40);
  expect(await panel.getByTestId('dmap-stage').locator(':scope > svg').getAttribute('viewBox')).not.toBe(before);
  expect(Math.max(...gaps), JSON.stringify(gaps)).toBeLessThanOrEqual(0.5);
});

test('view mode: a linked legend row of the diagram shows one focus ring, not the ring of the browser too', async ({
  page,
  gotoDashboardPage,
}) => {
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = page.getByTestId('dmap-panel').first();
  const row = panel.locator('[data-cell-id="pg-legendRow~symbol:provider"]');
  await expect(row).toHaveAttribute('tabindex', '0');
  await row.focus();
  await page.keyboard.press('ArrowRight');
  await expect(row).toBeFocused();
  await expect(ring(panel)).toHaveAttribute('data-dmap-focus', 'pg-legendRow~symbol:provider');
  await expect(ring(panel)).toHaveCount(1);
  expect(await row.evaluate((g) => getComputedStyle(g).outlineStyle)).toBe('none');
  if (process.env.PAINTED_BOX_SHOTS) {
    await panel.screenshot({ path: `${process.env.PAINTED_BOX_SHOTS}/legend-row-ring.png` });
  }
});
