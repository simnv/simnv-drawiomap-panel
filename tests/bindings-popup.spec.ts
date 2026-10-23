import fs from 'node:fs';
import { binding } from '../src/fixtures/authoring-config';
import {
  chooseEditorOption,
  closeBindingsPopup,
  filterBindings,
  openBindingsPopup,
  popupInspector,
  selectStageCell,
} from './authoring-controls';
import { expect, observeQueries, saveDashboard, test } from './authoring-fixtures';

const SHOTS = '/tmp/dmap-popup-p1';

test.describe('bindings popup: entry points and layout', () => {
  test('opens from the corner button of the panel editor and from the options pane button', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);
    const dialog = await openBindingsPopup(page);
    await expect(page.getByRole('dialog', { name: 'Edit bindings' })).toBeVisible();
    await closeBindingsPopup(page);
    await page.getByTestId('dmap-edit-bindings-option').click();
    await expect(page.getByTestId('dmap-bindings-popup')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('the warning badge opens the popup on the first problem', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    config.patterns.push({
      id: 'broken',
      name: 'Broken pattern',
      select: { ids: ['device-1'] },
      display: {
        status: { kind: 'mapping', binding: binding('missing-query'), default: { state: 'normal' }, mappings: [] },
      },
    });
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await page.getByTestId('dmap-warning-badge').click();
    const dialog = page.getByTestId('dmap-bindings-popup');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert', { name: 'Binding diagnostics' })).toContainText('patterns[2]');
  });

  test('shows three panes; the splitters resize them and the sizes survive a reopen', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const list = dialog.getByTestId('dmap-pane-list');
    const stage = dialog.getByTestId('dmap-pane-stage');
    const inspector = dialog.getByTestId('dmap-pane-inspector');
    await expect(list).toBeVisible();
    await expect(stage).toBeVisible();
    await expect(inspector).toBeVisible();
    const before = (await list.boundingBox())!.width;
    const handle = dialog.getByRole('separator', { name: 'Resize list pane' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const after = (await list.boundingBox())!.width;
    expect(after).toBeGreaterThan(before + 40);
    await closeBindingsPopup(page);
    const reopened = await openBindingsPopup(page);
    expect((await reopened.getByTestId('dmap-pane-list').boundingBox())!.width).toBeCloseTo(after, -1);
    // A selected element fills the inspector: the typical state of the popup.
    await selectStageCell(reopened, 'device-1');
    await expect(reopened.getByTestId('dmap-popup-stage').locator('[data-cell-id="device-1"] text').last()).toHaveText(
      'Router α'
    );
    fs.mkdirSync(SHOTS, { recursive: true });
    const version = new URL(process.env.GRAFANA_URL ?? 'http://localhost:3012').port;
    await page.screenshot({ path: `${SHOTS}/popup-desktop-${version}.png` });
    if (process.env.DMAP_SCREENSHOTS) {
      await page.screenshot({ path: `${process.env.DMAP_SCREENSHOTS}/bindings-popup.png` });
    }
  });

  test('a stage click focuses the heading and marks the cell in the popup stage only', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await expect(dialog.getByTestId('dmap-popup-stage').locator('[data-cell-id="device-1"]')).toHaveAttribute(
      'data-dmap-selected',
      'true'
    );
    await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]')).not.toHaveAttribute(
      'data-dmap-selected',
      'true'
    );
    await filterBindings(dialog, 'device-2');
    await dialog.getByRole('button', { name: 'Select cell device-2' }).click();
    await expect(popupInspector(dialog).getByRole('heading', { name: 'device-2 bindings' })).toBeVisible();
  });
});

test.describe('bindings popup: Esc ownership', () => {
  test('a clean popup closes on Esc; a dirty one asks first; Esc in the question keeps editing', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const again = await openBindingsPopup(page);
    await selectStageCell(again, 'device-1');
    await popupInspector(again).getByLabel('Label template', { exact: true }).fill('Dirty ${cell.key}');
    await page.keyboard.press('Escape');
    const question = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(question).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Esc inside an open Select closes the menu only', async ({ page, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    const scope = popupInspector(dialog).getByRole('combobox', { name: 'Edit scope', exact: true });
    await scope.click();
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Esc with a pinned panel card closes the popup question first, and leaving panel edit drops the popup', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]').click();
    const card = page.getByTestId('dmap-panel').getByRole('dialog');
    await expect(card).toBeVisible();
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await popupInspector(dialog).getByLabel('Label template', { exact: true }).fill('Dirty');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);
    await openBindingsPopup(page);
    // The modal covers the button, so send the click event to it directly, as a keyboard shortcut or a link would.
    await page.getByTestId('data-testid Back to dashboard button').dispatchEvent('click');
    await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);
    await expect(page.getByTestId('dmap-edit-bindings')).toHaveCount(0);
  });

  test('Esc in the draw.io modal closes only it', async ({ page, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await popupInspector(dialog).getByRole('button', { name: 'Edit geometry in draw.io' }).click();
    await expect(page.getByTitle('draw.io')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTitle('draw.io')).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
});

test.describe('bindings popup: persistence and loading', () => {
  test('Apply and close persists after the dashboard saves', async ({
    page,
    request,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await popupInspector(dialog).getByLabel('Label template', { exact: true }).fill('Popup α');
    await dialog.getByRole('button', { name: 'Apply and close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await saveDashboard(page, edit);
    const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
    expect(saved.dashboard.panels[0].options.config.overrides).toContainEqual({
      cellId: 'device-1',
      display: { label: 'Popup α' },
    });
  });

  test('the popup chunk loads once in panel edit and never in view mode', async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    const chunks: string[] = [];
    page.on('request', (r) => {
      if (/bindings-popup/.test(new URL(r.url()).pathname)) chunks.push(r.url());
    });
    const dashboard = await gotoDashboardPage({ uid });
    await expect(page.getByTestId('dmap-panel')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(chunks).toHaveLength(0);
    expect(await dashboard.ctx.page.getByTestId('dmap-edit-bindings').count()).toBe(0);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await openBindingsPopup(page);
    expect(chunks.length).toBeGreaterThan(0);
    const first = chunks.length;
    await closeBindingsPopup(page);
    await openBindingsPopup(page);
    expect(chunks).toHaveLength(first);
  });

  test('the popup runs queries for the draft and the panel keeps its own subscription', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    const requests = observeQueries(page, uid);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    const before = requests.length;
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    await expect(dialog.getByTestId('dmap-popup-stage')).toBeVisible();
    expect(requests.length).toBeGreaterThanOrEqual(before);
  });
});

test.describe('bindings popup: datasource query editors', () => {
  test('the TestData editor works with the keyboard and the menu, and the focus returns on close', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await dialog.getByRole('button', { name: 'Edit query Standalone trend' }).click();
    const inspector = popupInspector(dialog);
    const scenario = inspector.getByRole('combobox', { name: /scenario/i });
    await scenario.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'CSV Content', exact: true })).toBeVisible();
    // Esc closes the menu and leaves the popup open
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    // the mouse picks an option
    await scenario.click();
    await page.getByRole('option', { name: 'CSV Content', exact: true }).click();
    await expect(inspector.getByText('CSV Content', { exact: true })).toBeVisible();
    // the keyboard picks an option
    await scenario.focus();
    await page.keyboard.type('Random Walk');
    await page.keyboard.press('Enter');
    await expect(inspector.getByText('Random Walk', { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
    await expect(page.getByTestId('dmap-edit-bindings')).toBeFocused();
  });

  test('the Prometheus code editor takes typing and keeps Esc for its suggestions', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await dialog.getByRole('button', { name: 'Edit query health' }).click();
    const editor = popupInspector(dialog).locator('.monaco-editor .view-lines');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('node_netw');
    await expect(editor).toContainText('node_netw');
    const suggest = page.locator('.suggest-widget.visible');
    await page.keyboard.press('ControlOrMeta+Space');
    if (await suggest.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(suggest).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    }
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    // The editor shows the saved text again, and the draft stays clean after the editor loses its focus.
    await expect(popupInspector(dialog).locator('.monaco-editor .view-lines')).toContainText('label_replace');
    await expect(dialog.getByText('Unsaved changes')).toHaveCount(0);
    await closeBindingsPopup(page);
  });

  test('the Prometheus metrics explorer opens above the popup and Esc closes only it', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await dialog.getByRole('button', { name: 'Edit query health' }).click();
    const inspector = popupInspector(dialog);
    await inspector.getByRole('radio', { name: 'Builder' }).click({ force: true });
    await inspector.getByRole('button', { name: 'Open metrics explorer' }).click();
    const explorer = page.getByRole('dialog').filter({ hasNotText: 'Edit bindings' }).first();
    await expect(explorer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explorer).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await closeBindingsPopup(page);
  });
});

test.describe('bindings popup: plugin-owned dialog', () => {
  test('the stage is attached to the page and holds no sandbox mock element', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const stage = dialog.getByTestId('dmap-popup-stage');
    await expect(stage.locator('svg [data-cell-id="device-1"]')).toBeAttached();
    expect(
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="dmap-popup-stage"]');
        return !!el && document.contains(el) && !!el.querySelector('svg');
      })
    ).toBe(true);
    await expect(page.locator('[data-grafana-plugin-sandbox-element]')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit bindings' })).toBeVisible();
  });

  test('the focus moves into the dialog, Tab wraps inside it and the focus returns to the opener on close', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = page.getByRole('dialog', { name: 'Edit bindings' });
    await openBindingsPopup(page);
    const inside = () =>
      page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"][aria-label], [role="dialog"][aria-labelledby]')
      );
    expect(await inside()).toBe(true);
    // Tab and Shift+Tab never leave the dialog
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab');
      expect(await inside(), `Tab ${i}`).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside(), `Shift+Tab ${i}`).toBe(true);
    }
    await closeBindingsPopup(page);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('dmap-edit-bindings')).toBeFocused();
  });

  test('the discard question, a Select menu and the draw.io modal paint above the dialog', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    await selectStageCell(dialog, 'device-1');
    // a Select menu: the click on its option needs an unobscured target
    await chooseEditorOption(popupInspector(dialog), 'Edit scope', 'All elements matching this pattern');
    await expect(popupInspector(dialog).getByText('All elements matching this pattern', { exact: true })).toBeVisible();
    // the draw.io modal opens on top and takes the focus
    await popupInspector(dialog).getByRole('button', { name: 'Edit geometry in draw.io' }).click();
    const editor = page.getByRole('dialog').filter({ has: page.getByTestId('dmap-editor-modal') });
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('dmap-editor-modal')).toHaveCount(0);
    // the discard question
    await popupInspector(dialog).getByLabel('Label template', { exact: true }).fill('Dirty');
    await dialog.getByRole('button', { name: 'Close bindings', exact: true }).click();
    const question = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(question).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('the diagram fills the stage pane and ignores the zoom options of the panel', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config, {
      zoom: { mode: 'fit', percent: 300, wheel: false, pan: false, minScale: 3 },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const pane = dialog.getByTestId('dmap-pane-stage');
    const svg = dialog.getByTestId('dmap-popup-stage').locator('> svg');
    await expect(svg).toBeVisible();
    await expect
      .poll(async () => {
        const [p, s] = [(await pane.boundingBox())!, (await svg.boundingBox())!];
        // fitted: the svg touches the pane on one axis and stays inside it on both
        const fillsWidth = s.width >= p.width * 0.9;
        const fillsHeight = s.height >= p.height * 0.9;
        const inside = s.width <= p.width + 1 && s.height <= p.height + 1;
        return inside && (fillsWidth || fillsHeight);
      })
      .toBe(true);
  });
});
