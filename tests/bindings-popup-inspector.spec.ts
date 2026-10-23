import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  closeBindingsPopup,
  openBindingsPopup,
  openEditorSection,
  popupInspector,
  selectStageCell,
} from './authoring-controls';
import { expect, test } from './authoring-fixtures';

const SHOTS = '/tmp/dmap-popup-p2';
const port = () => new URL(process.env.GRAFANA_URL ?? 'http://localhost:3012').port;

const list = (dialog: Locator) => dialog.getByTestId('dmap-pane-list');
const group = (dialog: Locator, name: string, count: number) =>
  list(dialog).getByRole('button', { name: `${name} (${count})`, exact: true });
const undoButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Redo', exact: true });
const labelField = (dialog: Locator) => popupInspector(dialog).getByLabel('Label template', { exact: true });
const preview = (dialog: Locator) => popupInspector(dialog).getByRole('region', { name: 'Hover card preview' });

/** The rows of a card as the user reads them, once no row loads any more. */
async function readRows(card: Locator): Promise<string[]> {
  const rows = card.getByTestId('dmap-card-row');
  await expect.poll(async () => (await rows.allInnerTexts()).length).toBeGreaterThan(0);
  await expect.poll(async () => (await rows.allInnerTexts()).some((text) => /Loading|No data/.test(text))).toBe(false);
  return (await rows.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());
}

test.describe('bindings popup: live card and field sources', () => {
  test('the card preview shows the rows of the panel card for the same element', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await expect(preview(dialog)).toBeVisible();
    // The preview is the first block of the inspector.
    await expect(popupInspector(dialog).locator('section').first()).toHaveAttribute('aria-label', 'Hover card preview');
    const previewRows = await readRows(preview(dialog));
    expect(previewRows).toHaveLength(2);
    expect(previewRows[0]).toContain('Detail value');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/inspector-desktop-${port()}.png` });
    await closeBindingsPopup(page);
    await page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]').first().hover();
    const card = page.getByTestId('dmap-panel').getByRole('tooltip');
    await expect(card).toBeVisible();
    expect(await readRows(card)).toEqual(previewRows);
  });

  test('a cell without hover rows shows an empty card preview', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'chart-1');
    await expect(preview(dialog)).toContainText('No card for this element');
  });

  test('a pattern field shows its chip; a reset inside a hover row resets the whole rows array', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const inspector = popupInspector(dialog);
    await selectStageCell(dialog, 'device-1');
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await expect(
      inspector.getByTestId('dmap-field-source').filter({ hasText: 'Pattern Repeated routers' }).first()
    ).toBeVisible();
    await expect(inspector.getByRole('button', { name: /^Reset / })).toHaveCount(0);

    // Edit a label of a hover row: the override copies the rows and owns them.
    await openEditorSection(inspector, 'Hover rows');
    const rowLabel = inspector.getByLabel('Hover row 1 label', { exact: true });
    await expect(rowLabel).toHaveValue('Detail value');
    await rowLabel.fill('Own detail');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await expect(preview(dialog)).toContainText('Own detail');
    const reset = inspector.getByRole('button', { name: 'Reset hover rows to pattern' }).first();
    await expect(reset).toBeVisible();
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/sources-desktop-${port()}.png` });
    await reset.click();
    // The override held nothing else: it is gone, and the rows of the pattern show again.
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await expect(rowLabel).toHaveValue('Detail value');
    await expect(preview(dialog)).not.toContainText('Own detail');
    await expect(inspector.getByRole('button', { name: /^Reset / })).toHaveCount(0);
    // The Effective binding preview agrees.
    await openEditorSection(inspector, 'Effective binding preview');
    await expect(inspector.locator('pre').filter({ hasText: '"rows"' })).toContainText('Detail value');
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
  });

  test('a reset of a field in element scope and in pattern scope', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const inspector = popupInspector(dialog);
    await selectStageCell(dialog, 'device-1');
    await labelField(dialog).fill('Mine');
    await expect(inspector.getByTestId('dmap-field-source').filter({ hasText: 'Override' }).first()).toBeVisible();
    await inspector.getByRole('button', { name: 'Reset Label template to pattern' }).click();
    await expect(labelField(dialog)).toHaveValue('Router ${cell.key}');
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    // Pattern scope: the words change to "default".
    await inspector.getByRole('combobox', { name: 'Edit scope', exact: true }).click();
    await page.getByRole('option', { name: 'All elements matching this pattern', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Reset Label template to default' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
  });
});

test.describe('bindings popup: undo and redo', () => {
  test('the buttons and the keys undo and redo the draft', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await expect(undoButton(dialog)).toBeDisabled();
    await expect(redoButton(dialog)).toBeDisabled();
    await expect(undoButton(dialog)).toHaveAttribute('aria-keyshortcuts', /Control\+Z/);
    await labelField(dialog).fill('First');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await expect(undoButton(dialog)).toBeEnabled();
    await undoButton(dialog).click();
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await expect(redoButton(dialog)).toBeEnabled();
    await redoButton(dialog).click();
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    // Keys, with the focus on a button.
    await undoButton(dialog).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    // Apply clears the history.
    await dialog.getByRole('button', { name: 'Apply bindings', exact: true }).click();
    await expect(undoButton(dialog)).toBeDisabled();
    await expect(redoButton(dialog)).toBeDisabled();
    await closeBindingsPopup(page);
  });

  test('Ctrl+Z in a text field and in the Prometheus code editor leaves the draft alone', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await labelField(dialog).fill('Typed');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    // Native undo in the input: the draft keeps its override.
    await labelField(dialog).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await expect(undoButton(dialog)).toBeEnabled();
    // The Monaco editor of the query keeps the key too.
    await dialog.getByRole('button', { name: 'Edit query health' }).click();
    const editor = popupInspector(dialog).locator('.monaco-editor .view-lines');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' ');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
  });

  test('Ctrl+Z with the metrics explorer dialog open does nothing to the draft', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await labelField(dialog).fill('Typed');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await dialog.getByRole('button', { name: 'Edit query health' }).click();
    const inspector = popupInspector(dialog);
    await inspector.getByRole('radio', { name: 'Builder' }).click({ force: true });
    await inspector.getByRole('button', { name: 'Open metrics explorer' }).click();
    const explorer = page.getByRole('dialog').filter({ hasNotText: 'Edit bindings' }).first();
    await expect(explorer).toBeVisible();
    // The explorer hides the popup from the accessibility tree: read the draft after it closes.
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('Escape');
    await expect(explorer).toHaveCount(0);
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await expect(undoButton(dialog)).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
  });
});

test.describe('bindings popup: queries', () => {
  test('the query pane shows a result table and the users, and a deletion can be undone', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const inspector = popupInspector(dialog);
    await dialog.getByRole('button', { name: 'Edit query Standalone trend' }).click();
    await inspector.getByRole('button', { name: 'Preview query', exact: true }).click();
    await expect(inspector.getByLabel('Query preview result')).toContainText('ready');
    const table = inspector.getByRole('table', { name: 'Query preview table' });
    await expect(table).toBeVisible();
    expect(await table.getByRole('columnheader').count()).toBeGreaterThan(1);
    expect(await table.getByRole('row').count()).toBeLessThanOrEqual(21);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/query-table-${port()}.png` });

    // A query that patterns use lists them; the deletion asks first and Undo brings the query back.
    await dialog.getByRole('button', { name: 'Edit query health' }).click();
    await expect(inspector.getByRole('list', { name: 'Used by' })).toContainText('Pattern Repeated routers');
    await inspector.getByRole('button', { name: 'Delete query', exact: true }).click();
    const question = page.getByRole('dialog', { name: 'Delete query?' });
    await expect(question).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(group(dialog, 'Queries', 5)).toBeVisible();
    await inspector.getByRole('button', { name: 'Delete query', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(group(dialog, 'Queries', 4)).toBeVisible();
    await undoButton(dialog).click();
    await expect(group(dialog, 'Queries', 5)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
  });
});

test.describe('bindings popup: narrow screens', () => {
  async function tabs(page: Page) {
    return page.getByTestId('dmap-popup-layout');
  }

  test('at 900x700 the panes become tabs and a stage click opens the Inspector tab', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 900, height: 700 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const layout = await tabs(page);
    await expect(layout).toHaveAttribute('data-dmap-layout', 'tabs');
    await expect(dialog.getByRole('tab')).toHaveText(['List', 'Diagram', 'Inspector']);
    await expect(dialog.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    await expect(list(dialog)).toBeVisible();
    await expect(dialog.getByTestId('dmap-pane-stage')).toBeHidden();
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/tabs-list-900-${port()}.png` });
    await dialog.getByRole('tab', { name: 'Diagram' }).click();
    await expect(dialog.getByTestId('dmap-pane-stage')).toBeVisible();
    await expect(list(dialog)).toBeHidden();
    // The stage keeps its fitted diagram: the svg has a size in the tab.
    const box = await dialog.getByTestId('dmap-popup-stage').locator('svg').first().boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    await page.screenshot({ path: `${SHOTS}/tabs-diagram-900-${port()}.png` });
    await dialog.getByTestId('dmap-popup-stage').locator('[data-cell-id="device-1"]').first().click();
    await expect(dialog.getByRole('tab', { name: 'Inspector' })).toHaveAttribute('aria-selected', 'true');
    await expect(popupInspector(dialog).getByRole('heading', { name: 'device-1 bindings' })).toBeVisible();
    await expect(preview(dialog)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/tabs-inspector-900-${port()}.png` });
    // The selection survives a tab change.
    await dialog.getByRole('tab', { name: 'Diagram' }).click();
    await expect(dialog.getByTestId('dmap-popup-stage').locator('[data-cell-id="device-1"]')).toHaveAttribute(
      'data-dmap-selected',
      'true'
    );
    await dialog.getByRole('tab', { name: 'Inspector' }).click();
    await expect(popupInspector(dialog).getByRole('heading', { name: 'device-1 bindings' })).toBeVisible();
    // The popup does not overflow the viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await closeBindingsPopup(page);
  });

  test('at 1280x800 the popup shows three panes', async ({ page, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await expect(page.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'panes');
    await expect(dialog.getByRole('tab')).toHaveCount(0);
    await expect(list(dialog)).toBeVisible();
    await expect(dialog.getByTestId('dmap-pane-stage')).toBeVisible();
    await expect(dialog.getByTestId('dmap-pane-inspector')).toBeVisible();
  });
});
