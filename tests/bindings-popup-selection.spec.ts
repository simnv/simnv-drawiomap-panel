import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { DiagramConfigV2 } from '../src/model/config';
import {
  chooseEditorOption,
  closeBindingsPopup,
  openBindingsPopup,
  popupInspector,
  selectStageCell,
} from './authoring-controls';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';
import { expect, test } from './authoring-fixtures';

const SHOTS = '/tmp/dmap-popup-p3';
const port = () => new URL(process.env.GRAFANA_URL ?? 'http://localhost:3012').port;

// Three routers and two switches, in a grid. Each node has a `role` attribute and a label.
const NODES = [
  ['r1', 'router', 'core-1', 20, 20],
  ['r2', 'router', 'core-2', 160, 20],
  ['r3', 'router', 'edge-3', 300, 20],
  ['s1', 'switch', 'sw-1', 20, 120],
  ['s2', 'switch', 'sw-2', 160, 120],
] as const;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="200" viewBox="0 0 440 200">
  <g data-cell-id="0" data-meta-pg-schema="1">${NODES.map(
    ([id, role, label, x, y]) =>
      `<g data-cell-id="${id}" data-meta-pg-id="${id}" data-meta-pg-kind="node" data-meta-pg-schema="1" data-meta-role="${role}" transform="translate(${x} ${y})"><rect width="100" height="50" fill="#d5e8d4" stroke="#82b366"/><text x="8" y="30">${label}</text></g>`
  ).join('')}</g>
</svg>`;
const identity = { kind: 'metadata' as const, label: 'Identity', path: 'cell.key' };
const baseConfig = (over: Partial<DiagramConfigV2> = {}): DiagramConfigV2 => ({
  version: 2,
  queries: [],
  widgets: [],
  overrides: [],
  patterns: [
    { id: 'routers', name: 'Routers', select: { ids: ['r1', 'r2', 'r3'] }, display: { hover: { rows: [identity] } } },
  ],
  ...over,
});

const stageOf = (dialog: Locator) => dialog.getByTestId('dmap-popup-stage');
const cell = (dialog: Locator, id: string) => stageOf(dialog).locator(`g[data-cell-id="${id}"]`);
const list = (dialog: Locator) => dialog.getByTestId('dmap-pane-list');
const group = (dialog: Locator, name: string, count: number) =>
  list(dialog).getByRole('button', { name: `${name} (${count})`, exact: true });
const undoButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Redo', exact: true });
const heading = (dialog: Locator, name: string) => popupInspector(dialog).getByRole('heading', { name });
const labelField = (dialog: Locator) => popupInspector(dialog).getByLabel('Label template', { exact: true });
const selected = (dialog: Locator) => stageOf(dialog).locator('[data-dmap-selected="true"]');
const ids = (locator: Locator) => locator.evaluateAll((els) => els.map((el) => el.getAttribute('data-cell-id')));

/** The box of a cell on the page. */
async function boxOf(dialog: Locator, id: string) {
  const box = await cell(dialog, id).locator('rect').first().boundingBox();
  if (!box) {
    throw new Error(`Cell ${id} has no box.`);
  }
  return box;
}

/** Shift + drag with the mouse from one point to another. `finish` runs before the release. */
async function shiftDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  finish?: () => Promise<void>
) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await finish?.();
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.describe('bindings popup: multi-select, pattern from selection, bulk edit', () => {
  test('Shift + click three cells, set a label: one undo removes three overrides, redo restores them, Apply keeps the rows', async ({
    page,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(baseConfig(), { svg });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    let dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'r1');
    await cell(dialog, 'r2').click({ modifiers: ['Shift'] });
    await cell(dialog, 'r3').click({ modifiers: ['Shift'] });
    await expect(heading(dialog, '3 elements')).toBeFocused();
    await expect.poll(() => ids(selected(dialog))).toEqual(['r1', 'r2', 'r3']);
    await expect(cell(dialog, 'r3')).toHaveAttribute('data-dmap-primary', 'true');
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await labelField(dialog).fill('Bulk ${cell.key}');
    await expect(group(dialog, 'Overrides', 3)).toBeVisible();
    // The three overrides are one undo step.
    await undoButton(dialog).click();
    await expect(group(dialog, 'Overrides', 0)).toBeVisible();
    await expect(redoButton(dialog)).toBeEnabled();
    await redoButton(dialog).click();
    await expect(group(dialog, 'Overrides', 3)).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply bindings', exact: true }).click();
    await closeBindingsPopup(page);

    dialog = await openBindingsPopup(page);
    await expect(group(dialog, 'Overrides', 3)).toBeVisible();
    // The hover rows of the pattern are unchanged on a cell of the selection.
    await selectStageCell(dialog, 'r2');
    const rows = popupInspector(dialog)
      .getByRole('region', { name: 'Hover card preview' })
      .getByTestId('dmap-card-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Identity');
    await expect(labelField(dialog)).toHaveValue('Bulk ${cell.key}');
  });

  test('Shift + drag over two routers proposes by extras, marks the extras of the attributes and keeps the ids last', async ({
    page,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(baseConfig({ patterns: [] }), { svg });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const r1 = await boxOf(dialog, 'r1');
    const r2 = await boxOf(dialog, 'r2');
    const band = { from: { x: r1.x - 8, y: r1.y - 8 }, to: { x: r2.x + r2.width + 8, y: r2.y + r2.height + 8 } };
    await shiftDrag(page, band.from, band.to, async () => {
      await expect(stageOf(dialog).locator('xpath=..').getByTestId('dmap-box-select')).toBeVisible();
    });
    await expect(heading(dialog, '2 elements')).toBeFocused();
    await expect.poll(() => ids(selected(dialog))).toEqual(['r1', 'r2']);
    const inspector = popupInspector(dialog);
    // The label proposal has no extra cell: it ranks above the attributes (one extra). The ids stay last.
    await expect(inspector.getByLabel('Proposed label regex', { exact: true })).toHaveValue('/^core-/');
    await expect(inspector.getByTestId('dmap-proposal-counts')).toHaveText('matches 2, extra 0, missed 0');
    await inspector.getByRole('radiogroup', { name: 'Proposal' }).getByRole('radio').nth(1).check({ force: true });
    await expect(inspector.getByLabel('Proposed attributes', { exact: true })).toHaveValue('role=router');
    await expect(inspector.getByTestId('dmap-proposal-counts')).toHaveText('matches 3, extra 1, missed 0');
    await expect.poll(() => ids(stageOf(dialog).locator('[data-dmap-extra="true"]'))).toEqual(['r3']);
    // The proposals: attributes, label, then the ids.
    const proposals = inspector.getByRole('radiogroup', { name: 'Proposal' }).getByRole('radio');
    expect(
      await proposals.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim()))
    ).toEqual(['Label', 'Attributes', 'Element IDs']);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/pattern-from-selection-${port()}.png` });

    // Editing the selector to ids clears the extras.
    // Grafana hides the radio input under its label: check it directly.
    await proposals.nth(2).check({ force: true });
    await expect(inspector.getByTestId('dmap-proposal-counts')).toHaveText('matches 2, extra 0, missed 0');
    await expect(stageOf(dialog).locator('[data-dmap-extra="true"]')).toHaveCount(0);
    // A selector that misses a selected cell marks it.
    await inspector.getByLabel('Proposed element IDs', { exact: true }).fill('r1');
    await expect(cell(dialog, 'r2')).toHaveAttribute('data-dmap-missed', 'true');
    await inspector.getByLabel('Proposed element IDs', { exact: true }).fill('r1,r2');
    await expect(stageOf(dialog).locator('[data-dmap-missed="true"]')).toHaveCount(0);

    // Create adds a pattern row; it is one undo step.
    await expect(group(dialog, 'Patterns', 0)).toBeVisible();
    await inspector.getByRole('button', { name: 'Create pattern', exact: true }).click();
    await expect(group(dialog, 'Patterns', 1)).toBeVisible();
    await expect(heading(dialog, 'r1 bindings')).toBeVisible();
    await undoButton(dialog).click();
    await expect(group(dialog, 'Patterns', 0)).toBeVisible();
  });

  test('a band that ends outside the stage selects the cells in the clipped band', async ({
    page,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(baseConfig({ patterns: [] }), { svg });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const r2 = await boxOf(dialog, 'r2');
    const pane = (await dialog.getByTestId('dmap-pane-stage').boundingBox())!;
    // From the gap left of r2 to the inspector pane, 120 px right of the stage.
    await shiftDrag(page, { x: r2.x - 8, y: r2.y - 8 }, { x: pane.x + pane.width + 120, y: r2.y + r2.height + 8 });
    await expect(heading(dialog, '2 elements')).toBeFocused();
    await expect.poll(() => ids(selected(dialog))).toEqual(['r2', 'r3']);
    // The dialog is still open and the release did not click anything in the inspector.
    await expect(dialog).toBeVisible();
  });

  test('Esc during a band selects nothing and keeps the popup open; the click after a band selects nothing', async ({
    page,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(baseConfig({ patterns: [] }), { svg });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const r1 = await boxOf(dialog, 'r1');
    const r2 = await boxOf(dialog, 'r2');
    await shiftDrag(
      page,
      { x: r1.x - 8, y: r1.y - 8 },
      { x: r2.x + r2.width + 8, y: r2.y + r2.height + 8 },
      async () => {
        await page.keyboard.press('Escape');
        await expect(dialog.getByTestId('dmap-box-select')).toHaveCount(0);
      }
    );
    await expect(selected(dialog)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: /Discard/ })).toHaveCount(0);

    // The Shift + click that a release over a cell would make is suppressed: it would toggle the new selection off.
    await shiftDrag(page, { x: r1.x - 8, y: r1.y - 8 }, { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 });
    await expect.poll(() => ids(selected(dialog))).toEqual(['r1']);
    await expect(heading(dialog, 'r1 bindings')).toBeVisible();
  });

  test('bulk edit shows Mixed on fields that differ and leaves different hover rows to the element', async ({
    page,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const config = baseConfig({
      overrides: [
        { cellId: 'r1', display: { label: 'Core one' } },
        { cellId: 'r2', display: { label: 'Core two', hover: { rows: [{ ...identity, label: 'Other rows' }] } } },
      ],
    });
    const uid = await createDiagram(config, { svg });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'r1');
    await cell(dialog, 'r2').click({ modifiers: ['Shift'] });
    const inspector = popupInspector(dialog);
    await expect(heading(dialog, '2 elements')).toBeFocused();
    await expect(labelField(dialog)).toHaveValue('');
    await expect(inspector.getByTestId('dmap-field-source').filter({ hasText: 'Mixed' }).first()).toBeVisible();
    await inspector.getByRole('button', { name: 'Hover rows', exact: true }).click();
    await expect(inspector.getByText('Mixed, edit per element')).toBeVisible();
    await expect(inspector.getByLabel('Hover row 1 label')).toHaveCount(0);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/bulk-mixed-${port()}.png` });

    // A change writes the label to both overrides and leaves their other fields.
    await labelField(dialog).fill('Core both');
    await dialog.getByRole('button', { name: 'Apply bindings', exact: true }).click();
    await closeBindingsPopup(page);
    const reopened = await openBindingsPopup(page);
    await selectStageCell(reopened, 'r2');
    await expect(labelField(reopened)).toHaveValue('Core both');
    await expect(popupInspector(reopened).getByRole('region', { name: 'Hover card preview' })).toContainText(
      'Other rows'
    );
  });

  test.describe('metric bindings', () => {
    const shapeOf = (match: Record<string, string>) => ({
      shape: { binding: { ...binding('health'), match }, target: 'shape' as const },
    });
    const metrics = (prometheus: string, over: Partial<DiagramConfigV2>): DiagramConfigV2 =>
      baseConfig({
        defaultDatasource: { uid: prometheus, type: 'prometheus' },
        queries: [
          nativeQuery('health', 'label_replace(vector(1), "device", "$dm_key", "", "")', { dm_key: 'cell.key' }),
        ],
        ...over,
      });

    test('a reducer change of an inherited binding writes the whole binding: Apply stays enabled', async ({
      page,
      createDiagram,
      gotoPanelEditPage,
      readProvisionedDataSource,
    }) => {
      const prometheus = (await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' })).uid;
      const config = metrics(prometheus, {
        patterns: [
          {
            id: 'routers',
            name: 'Routers',
            select: { ids: ['r1', 'r2', 'r3'] },
            display: { shape: { binding: binding('health'), target: 'shape' } },
          },
        ],
      });
      const uid = await createDiagram(config, { svg });
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
      const dialog = await openBindingsPopup(page);
      await selectStageCell(dialog, 'r1');
      await cell(dialog, 'r2').click({ modifiers: ['Shift'] });
      await cell(dialog, 'r3').click({ modifiers: ['Shift'] });
      const inspector = popupInspector(dialog);
      await expect(heading(dialog, '3 elements')).toBeFocused();
      await inspector.getByRole('button', { name: 'Shape', exact: true }).click();
      await chooseEditorOption(inspector, 'Shape reducer', 'mean');
      await expect(group(dialog, 'Overrides', 3)).toBeVisible();
      await expect(inspector.getByRole('alert', { name: 'Binding diagnostics' })).toHaveCount(0);
      const apply = dialog.getByRole('button', { name: 'Apply bindings', exact: true });
      await expect(apply).toBeEnabled();
      await apply.click();
      await closeBindingsPopup(page);
      const reopened = await openBindingsPopup(page);
      await selectStageCell(reopened, 'r2');
      await expect(group(reopened, 'Overrides', 3)).toBeVisible();
    });

    test('bindings with different matchers show Mixed and no binding fields, without a crash', async ({
      page,
      createDiagram,
      gotoPanelEditPage,
      readProvisionedDataSource,
    }) => {
      const prometheus = (await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' })).uid;
      const config = metrics(prometheus, {
        patterns: [],
        overrides: [
          { cellId: 'r1', display: shapeOf({ device: 'a' }) },
          { cellId: 'r2', display: shapeOf({ device: 'b' }) },
        ],
      });
      const uid = await createDiagram(config, { svg });
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
      const dialog = await openBindingsPopup(page);
      await selectStageCell(dialog, 'r1');
      await cell(dialog, 'r2').click({ modifiers: ['Shift'] });
      const inspector = popupInspector(dialog);
      await expect(heading(dialog, '2 elements')).toBeFocused();
      await inspector.getByRole('button', { name: 'Shape', exact: true }).click();
      await expect(inspector.getByText('Mixed, edit per element').first()).toBeVisible();
      await expect(inspector.getByRole('combobox', { name: 'Shape query', exact: true })).toHaveCount(0);
      await expect(inspector.getByTestId('dmap-field-source').filter({ hasText: 'Mixed' }).first()).toBeVisible();
      await expect(dialog).toBeVisible();
    });
  });
});
