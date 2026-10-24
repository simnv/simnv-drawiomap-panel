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

    // The card preview must not widen its pane: the pane keeps its width while the card has charts and rows change.
    const paneWidth = async () => (await dialog.getByTestId('dmap-pane-inspector').boundingBox())!.width;
    const widthBefore = await paneWidth();
    // Edit a label of a hover row: the override copies the rows and owns them.
    await openEditorSection(inspector, 'Hover rows');
    const rowLabel = inspector.getByLabel('Hover row 1 label', { exact: true });
    await expect(rowLabel).toHaveValue('Detail value');
    await rowLabel.fill('Own detail');
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await expect(preview(dialog)).toContainText('Own detail');
    await page.waitForTimeout(500);
    expect(Math.abs((await paneWidth()) - widthBefore)).toBeLessThanOrEqual(1);
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
    await dialog.getByRole('button', { name: 'Revert to saved', exact: true }).click();
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
    await dialog.getByRole('button', { name: 'Revert to saved', exact: true }).click();
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
    const text = async () => (await editor.innerText()).replace(/\s+/g, ' ').trim();
    const original = await text();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    // One insertion is one undo unit for Monaco; typed keys can be several.
    await page.keyboard.insertText('zzz');
    await expect(editor).toContainText('zzz');
    // Monaco takes its own undo: the typed text goes, the draft keeps its step.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).not.toContainText('zzz');
    await expect.poll(text).toBe(original);
    await expect(group(dialog, 'Overrides', 1)).toBeVisible();
    await expect(undoButton(dialog)).toBeEnabled();
    // Outside Monaco the key undoes the last draft step: the label override.
    // The editor syncs its text into the draft as one step: the draft has the label step and that step. Each press of
    // the key outside Monaco undoes one draft step and never changes the query text (a restored draft remounts the
    // editor, which loads its text a moment later).
    await undoButton(dialog).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(text).toBe(original);
    if (await undoButton(dialog).isEnabled()) {
      await expect(group(dialog, 'Overrides', 1)).toBeVisible();
      await page.keyboard.press('ControlOrMeta+z');
    }
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await expect(undoButton(dialog)).toBeDisabled();
    await expect.poll(text).toBe(original);
    await dialog.getByRole('button', { name: 'Revert to saved', exact: true }).click();
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
    await dialog.getByRole('button', { name: 'Revert to saved', exact: true }).click();
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
    await table.scrollIntoViewIfNeeded();
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
    await dialog.getByRole('button', { name: 'Revert to saved', exact: true }).click();
    await closeBindingsPopup(page);
  });
});

// These checks open the popup and close it again without a change. They share one panel edit page, so the page loads
// once. A step leaves the popup closed.
test('bindings popup: card preview and layouts share one page', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  test.setTimeout(150_000);
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });

  await test.step('a cell without hover rows shows an empty card preview', async () => {
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'chart-1');
    await expect(preview(dialog)).toContainText('No card for this element');
    await closeBindingsPopup(page);
  });

  await test.step('the card preview shows the rows of the panel card for the same element', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
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

  await test.step('at 900x700 the panes become tabs and a stage click opens the Inspector tab', async () => {
    await page.setViewportSize({ width: 900, height: 700 });
    const dialog = await openBindingsPopup(page);
    const layout = page.getByTestId('dmap-popup-layout');
    await expect(layout).toHaveAttribute('data-dmap-layout', 'tabs');
    await expect(dialog.getByRole('tab')).toHaveText(['List', 'Diagram', 'Inspector']);
    await expect(dialog.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    await expect(list(dialog)).toBeVisible();
    await expect(dialog.getByTestId('dmap-pane-stage')).toBeHidden();
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/tabs-list-900-${port()}.png` });
    // The ARIA tabs pattern: one tab stop; the arrow keys move focus and selection; Home goes back.
    await expect(dialog.getByRole('tab', { name: 'List' })).toHaveAttribute('tabindex', '0');
    await expect(dialog.getByRole('tab', { name: 'Diagram' })).toHaveAttribute('tabindex', '-1');
    await dialog.getByRole('tab', { name: 'List' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('tab', { name: 'Diagram' })).toBeFocused();
    await expect(dialog.getByRole('tab', { name: 'Diagram' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(dialog.getByRole('tab', { name: 'List' })).toBeFocused();
    await expect(list(dialog)).toBeVisible();
    await dialog.getByRole('tab', { name: 'Diagram' }).click();
    await expect(dialog.getByTestId('dmap-pane-stage')).toBeVisible();
    await expect(list(dialog)).toBeHidden();
    // The stage keeps its fitted diagram: the svg has a size in the tab.
    const box = await dialog.getByTestId('dmap-popup-stage').locator('svg').first().boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    // The chart region loads when its tab shows: a hidden stage has no size, and a shown one fills the chart.
    await expect(dialog.getByTestId('dmap-popup-stage').locator('[data-dmap-widget="trend-region"]')).not.toContainText(
      'Loading'
    );
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

  await test.step('at 1280x800 the popup shows three panes', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openBindingsPopup(page);
    await expect(page.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'panes');
    await expect(dialog.getByRole('tab')).toHaveCount(0);
    await expect(list(dialog)).toBeVisible();
    await expect(dialog.getByTestId('dmap-pane-stage')).toBeVisible();
    await expect(dialog.getByTestId('dmap-pane-inspector')).toBeVisible();
    await closeBindingsPopup(page);
  });
});
