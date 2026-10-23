import { PanelEditPage } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';
import { nativeQuery } from '../src/fixtures/authoring-config';
import {
  chooseEditorOption,
  openBindingsPopup,
  openEditorSection,
  popupInspector,
  selectStageCell,
} from './authoring-controls';
import { attachJson, expect, observeQueries, saveDashboard, svg, test } from './authoring-fixtures';

const openQuery = (dialog: Locator, name: string) => dialog.getByRole('button', { name: `Edit query ${name}` }).click();
const stageText = (dialog: Locator, cell: string) =>
  dialog.getByTestId('dmap-popup-stage').locator(`[data-cell-id="${cell}"] text`).last();

test('the popup keeps one watch for its own chart size and reuses it for selection and previews', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
  selectors,
}, testInfo) => {
  config.queries = [nativeQuery('saved', 'vector(42)')];
  config.patterns = [{ id: 'chart', name: 'Chart region', select: { ids: ['chart-1'] }, display: {} }];
  config.widgets = [
    {
      id: 'saved-chart',
      anchorCellId: 'chart-1',
      kind: 'sparkline',
      label: 'Saved value',
      binding: { queryId: 'saved', match: {}, reducer: 'last' },
    },
  ];
  const uid = await createDiagram(config);
  const requests = observeQueries(page, uid);
  const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const chart = page.getByTestId('dmap-panel').locator('[data-dmap-widget="saved-chart"]');
  const count = () => requests.filter((r) => r.queries.some((q) => q.refId === 'SAVED')).length;
  await expect(chart).toContainText('42');
  expect(count()).toBe(1);
  const dialog = await openBindingsPopup(page);
  const inspector = popupInspector(dialog);
  // The popup stage has another size than the panel, so the popup asks once for its own chart result.
  await expect(dialog.getByTestId('dmap-popup-stage').locator('[data-dmap-widget="saved-chart"]')).toContainText('42');
  await expect.poll(count).toBe(2);
  await selectStageCell(dialog, 'chart-1');
  await chooseEditorOption(inspector, 'Edit scope', 'All elements matching this pattern');
  await inspector.getByRole('button', { name: 'Preview all pattern matches', exact: true }).click();
  await expect(inspector.getByLabel('Pattern preview progress')).toContainText('1 / 1');
  await expect(inspector.getByLabel('Affected metric resolution')).toContainText('chart-1: resolved');
  expect(count()).toBe(2);
  await openQuery(dialog, 'saved');
  await inspector.getByRole('button', { name: 'Preview query', exact: true }).click();
  await expect(inspector.getByLabel('Query preview result')).toContainText('ready');
  expect(count()).toBe(2);
  await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close bindings', exact: true }).click();
  await edit.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2).click();
  await expect.poll(count).toBeGreaterThan(2);
  await expect(chart).toContainText('42');
  await attachJson(testInfo, 'saved-chart-reuse-requests', { requests, nativeExecutions: count() });
});

test('representative selection focuses the heading, previews a pattern in the popup and saves an isolated override', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(config, { clones: 2 });
  const dashboard = await gotoDashboardPage({ uid });
  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  await (await dashboard.getPanelByTitle('Sanitized topology 1')).clickOnMenuItem('Edit');
  const panelEditPage = new PanelEditPage(dashboard.ctx, { dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const inspector = popupInspector(dialog);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
  await selectStageCell(dialog, 'device-1');
  await chooseEditorOption(inspector, 'Edit scope', 'All elements matching this pattern');
  await openEditorSection(inspector, 'Pattern match details');
  await expect(inspector.getByLabel('Affected binding preview')).toContainText('device-2');
  await openEditorSection(inspector, 'Shape');
  await chooseEditorOption(inspector, 'Shape query', 'health');
  await inspector.getByRole('switch', { name: 'Write value to shape label', exact: true }).check({ force: true });
  await inspector.getByLabel('Label template', { exact: true }).fill('Shared ${cell.key}');
  // The popup stage shows the draft. The panel behind it keeps the saved paint.
  await expect(stageText(dialog, 'device-2')).toHaveText('Shared device-2');
  await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-2"] text').last()).toHaveText('Router α');
  await chooseEditorOption(inspector, 'Edit scope', 'This element');
  await inspector.getByLabel('Label template', { exact: true }).fill('Override α');
  await expect(inspector.getByText('Element override: Yes', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply and close', exact: true }).click();
  await saveDashboard(page, panelEditPage);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(saved.dashboard.panels[0].options.config.overrides).toContainEqual({
    cellId: 'device-1',
    display: { label: 'Override α' },
  });
  expect(saved.dashboard.panels[1].options.config.overrides).toEqual([]);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const again = await openBindingsPopup(page);
  await selectStageCell(again, 'device-1');
  await expect(popupInspector(again).getByLabel('Label template', { exact: true })).toHaveValue('Override α');
  await selectStageCell(again, 'device-2');
  await expect(popupInspector(again).getByLabel('Label template', { exact: true })).toHaveValue('Shared ${cell.key}');
});

test('portable patterns keep their datasource across panels; Cancel drops an import and Apply runs its queries', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const source = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid: source }, id: '1' });
  const exportDialog = await openBindingsPopup(page);
  await openEditorSection(exportDialog, 'Portable patterns');
  await exportDialog.getByRole('button', { name: 'Export patterns', exact: true }).click();
  const document = await exportDialog.getByLabel('Exported pattern document', { exact: true }).inputValue();
  const trend = config.queries.find((q) => q.id === 'trend')!;
  const defaultDatasource = trend.source.kind === 'datasource' ? trend.source.datasource : undefined;
  const destination = await createDiagram({
    version: 2,
    defaultDatasource,
    queries: [],
    patterns: [],
    overrides: [],
    widgets: [],
  });
  const requests = observeQueries(page, destination);
  await gotoPanelEditPage({ dashboard: { uid: destination }, id: '1' });
  const dialog = await openBindingsPopup(page);
  await openEditorSection(dialog, 'Portable patterns');
  expect(requests).toHaveLength(0);
  const importDraft = async () => {
    await dialog.getByLabel('Pattern document', { exact: true }).fill(document);
    await dialog.getByRole('button', { name: 'Preview pattern import', exact: true }).click();
    await dialog.getByRole('button', { name: 'Import into draft', exact: true }).click();
  };
  await importDraft();
  await expect(dialog.getByRole('button', { name: /^Edit pattern Repeated routers/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Edit pattern Repeated routers/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Export patterns', exact: true }).click();
  expect(
    JSON.parse(await dialog.getByLabel('Exported pattern document', { exact: true }).inputValue()).config.patterns
  ).toEqual([]);
  // Nothing was applied: the panel behind the popup runs no query.
  const applied = () =>
    requests.filter((r) =>
      r.queries.some((q) => q.refId === 'HEALTH' && q.datasource.uid === config.defaultDatasource!.uid)
    ).length;
  await importDraft();
  await dialog.getByRole('button', { name: 'Apply and close', exact: true }).click();
  // The imported query keeps the datasource of the panel it came from.
  await expect.poll(applied).toBeGreaterThan(0);
  await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"] text').last()).toHaveText('Router α');
  const again = await openBindingsPopup(page);
  await expect(again.getByLabel('Default datasource UID', { exact: true })).toHaveValue(defaultDatasource!.uid!);
});

test('native query drafts, chart assignments and portable imports apply together, and survive reopen', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const inspector = popupInspector(dialog);
  await expect
    .poll(() => requests.filter((r) => r.queries.some((q) => q.refId === 'HEALTH')).length)
    .toBeGreaterThan(0);
  const detail = () => requests.filter((r) => r.queries.some((q) => q.refId === 'DETAIL'));
  // A cell gives the query its parameters, also while the query pane is open.
  await selectStageCell(dialog, 'device-1');
  await openQuery(dialog, 'Standalone trend');
  await inspector.getByRole('textbox', { name: 'Alias', exact: true }).fill('Saved native alias');
  await inspector.getByRole('textbox', { name: 'Alias', exact: true }).press('Tab');
  await openQuery(dialog, 'detail');
  await inspector.getByText('Import native target JSON', { exact: true }).click();
  const target = { refId: 'DETAIL', expr: 'vector(84)', range: true, opaque: { keep: ['native', 7] } };
  await inspector.getByLabel('Native target JSON', { exact: true }).fill(JSON.stringify(target));
  await inspector.getByRole('button', { name: 'Import native target', exact: true }).click();
  await inspector.getByRole('button', { name: 'Preview query', exact: true }).click();
  await expect(inspector.getByLabel('Query preview result', { exact: true })).toContainText('ready');
  // The popup runs the draft query itself; the preview shows that result.
  await expect.poll(() => detail().some((r) => r.queries.some((q) => q.expr === 'vector(84)'))).toBe(true);
  await selectStageCell(dialog, 'ordinary-chart');
  await inspector.getByRole('button', { name: 'Assign chart region', exact: true }).click();
  await chooseEditorOption(inspector, 'Chart query', 'detail');
  await inspector.getByLabel('Chart label', { exact: true }).fill('Explicit trend α');
  await openEditorSection(dialog, 'Portable patterns');
  await dialog.getByRole('button', { name: 'Export patterns', exact: true }).click();
  const exported = JSON.parse(await dialog.getByLabel('Exported pattern document', { exact: true }).inputValue());
  expect(exported.config.queries.find((q: { id: string }) => q.id === 'detail').source.target).toEqual(target);
  expect(exported.config.queries.find((q: { id: string }) => q.id === 'trend').source.target.alias).toBe(
    'Saved native alias'
  );
  await dialog.getByLabel('Pattern document', { exact: true }).fill(JSON.stringify(exported));
  await dialog.getByRole('button', { name: 'Preview pattern import', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'Pattern import preview' });
  await expect(preview).toContainText('Preview does not execute queries');
  await preview.getByRole('button', { name: 'Cancel pattern import' }).click();
  await dialog.getByRole('button', { name: 'Preview pattern import', exact: true }).click();
  for (const section of ['queries', 'patterns', 'widgets']) {
    for (const item of exported.config[section]) {
      await chooseEditorOption(preview, `${section} ${item.id} conflict`, 'Replace');
    }
  }
  await preview.getByRole('button', { name: 'Import into draft', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply and close', exact: true }).click();
  await expect(page.getByTestId('dmap-panel').locator('[data-dmap-widget="chart-1"]')).toContainText('84');
  await saveDashboard(page, panelEditPage);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  const persisted = saved.dashboard.panels[0].options.config;
  expect(persisted.widgets.find((w: { id: string }) => w.id === 'chart-1').anchorCellId).toBe('ordinary-chart');
  expect(persisted.queries.find((q: { id: string }) => q.id === 'detail').source.target).toEqual(target);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const again = await openBindingsPopup(page);
  await selectStageCell(again, 'ordinary-chart');
  await expect(popupInspector(again).getByLabel('Chart label', { exact: true })).toHaveValue('Explicit trend α');
});

test('native TestData scenario replacement deletes obsolete fields and persists after reopen', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
  selectors,
}) => {
  const trend = config.queries.find((q) => q.id === 'trend')!;
  if (trend.source.kind !== 'datasource') throw new Error('Expected native fixture');
  const target = { ...trend.source.target, obsoleteMode: true, opaque: { oldScenario: true } };
  const uid = await createDiagram({
    ...config,
    queries: [{ ...trend, source: { ...trend.source, target } }],
    patterns: [
      {
        id: 'trend-hover',
        name: 'Trend hover',
        select: { ids: ['device-1'] },
        display: {
          hover: {
            rows: [{ kind: 'value', label: 'Trend', binding: { queryId: 'trend', match: {}, reducer: 'last' } }],
          },
        },
      },
    ],
    overrides: [],
    widgets: [],
  });
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const inspector = popupInspector(dialog);
  await openQuery(dialog, 'Standalone trend');
  const scenario = panelEditPage
    .getByGrafanaSelector(selectors.components.DataSource.TestData.QueryTab.scenarioSelectContainer, {
      root: inspector,
    })
    .getByRole('combobox');
  await scenario.click();
  await page.getByRole('option', { name: 'CSV Content', exact: true }).click();
  const exportedTarget = async (scope: Locator) => {
    await openEditorSection(scope, 'Portable patterns');
    await scope.getByRole('button', { name: 'Export patterns', exact: true }).click();
    const document = JSON.parse(await scope.getByLabel('Exported pattern document', { exact: true }).inputValue());
    return document.config.queries[0].source.target;
  };
  const replacement = await exportedTarget(dialog);
  expect(replacement.refId).toBe('TREND');
  expect(replacement.scenarioId).toBe('csv_content');
  expect(replacement).not.toHaveProperty('obsoleteMode');
  expect(replacement).not.toHaveProperty('opaque');
  await dialog.getByRole('button', { name: 'Apply and close', exact: true }).click();
  await saveDashboard(page, panelEditPage);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(saved.dashboard.panels[0].options.config.queries[0].source.target).toEqual(replacement);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const again = await openBindingsPopup(page);
  await openQuery(again, 'Standalone trend');
  await expect(scenario).toBeVisible();
  expect(await exportedTarget(again)).toEqual(replacement);
});

test('shared parameterized preview labels other matches unvalidated until a full preview', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const detail = config.queries.find((q) => q.id === 'detail')!;
  const uid = await createDiagram({
    ...config,
    queries: [detail],
    widgets: [],
    overrides: [],
    patterns: [
      {
        id: 'shared',
        name: 'Shared',
        select: { ids: ['device-1', 'device-2'] },
        display: {
          hover: {
            rows: [{ kind: 'value', label: 'Detail', binding: { queryId: 'detail', match: {}, reducer: 'last' } }],
          },
        },
      },
    ],
  });
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const inspector = popupInspector(dialog);
  await selectStageCell(dialog, 'device-1');
  await chooseEditorOption(inspector, 'Edit scope', 'All elements matching this pattern');
  await openEditorSection(inspector, 'Pattern match details');
  const preview = inspector.getByLabel('Metric resolution preview');
  await expect(preview).toContainText('device-1: resolved');
  await expect(preview).toContainText('device-2: unvalidated');
  await expect(preview).not.toContainText('No resolution failures');
  await inspector.getByRole('button', { name: 'Preview all pattern matches', exact: true }).click();
  await expect(inspector.getByLabel('Pattern preview progress')).toContainText('2 / 2');
  await expect(preview).toContainText('device-2: resolved');
  await expect(dialog.getByRole('button', { name: 'Apply bindings', exact: true })).toBeEnabled();
});

test('full pattern preview resolves every device and exposes a nonrepresentative failure', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}, testInfo) => {
  const detail = nativeQuery('detail', 'label_replace(vector($dm_sample), "device", "$dm_key", "", "")', {
    dm_key: 'cell.key',
    dm_sample: 'cell.sample',
  });
  config.queries[1] = detail;
  const uid = await createDiagram(config, {
    svg: svg
      .replace('data-meta-device="router-1"', 'data-meta-device="router-1" data-meta-sample="23"')
      .replace('data-meta-device="router-2"', 'data-meta-device="router-2" data-meta-sample="47"'),
  });
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const inspector = popupInspector(dialog);
  await selectStageCell(dialog, 'device-1');
  await chooseEditorOption(inspector, 'Edit scope', 'All elements matching this pattern');
  await openEditorSection(inspector, 'Pattern match details');
  await openEditorSection(inspector, 'Shape');
  await chooseEditorOption(inspector, 'Shape query', 'detail');
  await inspector.getByRole('switch', { name: 'Write value to shape label', exact: true }).check({ force: true });
  await inspector.getByLabel('Label template', { exact: true }).fill('Sample ${value}');
  const preview = inspector.getByLabel('Affected metric resolution', { exact: true });
  await inspector.getByRole('button', { name: 'Preview all pattern matches', exact: true }).click();
  await expect(inspector.getByLabel('Pattern preview progress')).toContainText('4 / 4');
  await expect(preview).toContainText('device-1: resolved');
  await expect(preview).toContainText('device-2: resolved');
  await expect(stageText(dialog, 'device-1')).toHaveText('Sample 23');
  await expect(stageText(dialog, 'device-2')).toHaveText('Sample 47');
  await testInfo.attach('full-pattern-resolved', { body: await page.screenshot(), contentType: 'image/png' });
  // A new native target returns no metric for device-2.
  await openQuery(dialog, 'detail');
  await inspector.getByText('Import native target JSON', { exact: true }).click();
  const target = {
    refId: 'DETAIL',
    expr: 'label_replace(vector($dm_sample) < 30, "device", "$dm_key", "", "")',
    range: true,
  };
  await inspector.getByLabel('Native target JSON', { exact: true }).fill(JSON.stringify(target));
  await inspector.getByRole('button', { name: 'Import native target', exact: true }).click();
  await selectStageCell(dialog, 'device-1');
  await chooseEditorOption(inspector, 'Edit scope', 'All elements matching this pattern');
  await inspector.getByRole('button', { name: 'Preview all pattern matches', exact: true }).click();
  await expect(inspector.getByLabel('Pattern preview progress')).toContainText('4 / 4');
  await expect(preview).toContainText('device-1: resolved');
  await expect(preview).toContainText('device-2: failed');
  await expect(preview).toContainText('No metric matches query detail');
  await testInfo.attach('full-pattern-failure', { body: await page.screenshot(), contentType: 'image/png' });
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
    if (await inspector.count()) {
      await attachJson(
        info,
        'inspector-layout',
        await inspector.evaluate((el) => {
          const nodes: Element[] = [el, ...el.querySelectorAll('input,button')];
          for (let parent = el.parentElement; parent; parent = parent.parentElement) nodes.push(parent);
          return nodes.map((node) => ({
            tag: node.tagName,
            name: node.getAttribute('aria-label') ?? node.textContent?.slice(0, 60),
            box: node.getBoundingClientRect().toJSON(),
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            overflow: getComputedStyle(node).overflow,
            height: getComputedStyle(node).height,
          }));
        })
      );
    }
  }
});
