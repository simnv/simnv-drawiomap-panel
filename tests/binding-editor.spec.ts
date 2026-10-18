import { attachJson, expect, observeQueries, saveDashboard, test } from './authoring-fixtures';

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

test('representative selection focuses the inspector, previews a pattern and saves an isolated element override', async ({
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
  const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
  await expect(inspector).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
  await page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]').click();
  await expect(inspector.getByRole('heading', { name: 'device-1 bindings' })).toBeFocused();
  await inspector.getByLabel('Edit scope', { exact: true }).selectOption('pattern');
  await expect(inspector.getByLabel('Affected binding preview')).toContainText('device-2');
  await inspector.getByLabel('Shape query', { exact: true }).selectOption('health');
  await inspector.getByLabel('Write value to shape label', { exact: true }).check();
  await inspector.getByLabel('Label template', { exact: true }).fill('Shared ${cell.key}');
  await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-2"] text').last()).toHaveText(
    'Shared device-2'
  );
  await inspector.getByLabel('Edit scope', { exact: true }).selectOption('element');
  await inspector.getByLabel('Label template', { exact: true }).fill('Override α');
  await expect(inspector.getByText('Element override: Yes', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Apply bindings', exact: true }).click();
  await saveDashboard(page);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(saved.dashboard.panels[0].options.config.overrides).toContainEqual({
    cellId: 'device-1',
    display: { label: 'Override α' },
  });
  expect(saved.dashboard.panels[1].options.config.overrides).toEqual([]);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await inspector.getByRole('button', { name: 'Select device-1', exact: true }).click();
  await expect(inspector.getByLabel('Label template', { exact: true })).toHaveValue('Override α');
  await inspector.getByRole('button', { name: 'Select device-2', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'device-2 bindings' })).toBeFocused();
  await expect(inspector.getByLabel('Label template', { exact: true })).toHaveValue('Shared ${cell.key}');
});

test('portable patterns keep their datasource across panels and importing or cancelling alone runs no query', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const source = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid: source }, id: '1' });
  const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
  await inspector.getByRole('button', { name: 'Export patterns', exact: true }).click();
  const document = await inspector.getByLabel('Exported pattern document', { exact: true }).inputValue();
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
  await expect(inspector).toBeVisible();
  expect(requests).toHaveLength(0);
  const importDraft = async () => {
    await inspector.getByLabel('Pattern document', { exact: true }).fill(document);
    await inspector.getByRole('button', { name: 'Preview pattern import', exact: true }).click();
    await inspector.getByRole('button', { name: 'Import into draft', exact: true }).click();
  };
  await importDraft();
  expect(requests).toHaveLength(0);
  await inspector.getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await inspector.getByRole('button', { name: 'Export patterns', exact: true }).click();
  expect(
    JSON.parse(await inspector.getByLabel('Exported pattern document', { exact: true }).inputValue()).config.patterns
  ).toEqual([]);
  expect(requests).toHaveLength(0);
  await importDraft();
  expect(requests).toHaveLength(0);
  await inspector.getByRole('button', { name: 'Apply bindings', exact: true }).click();
  await expect
    .poll(() =>
      requests.some((r) =>
        r.queries.some((q) => q.refId === 'HEALTH' && q.datasource.uid === config.defaultDatasource!.uid)
      )
    )
    .toBe(true);
  await expect(inspector.getByLabel('Default datasource UID', { exact: true })).toHaveValue(defaultDatasource!.uid!);
});

test('native query drafts require Preview, chart assignments and portable imports require Apply, and survive reopen', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
  await expect(inspector).toBeVisible();
  await expect
    .poll(() => requests.filter((r) => r.queries.some((q) => q.refId === 'HEALTH')).length)
    .toBeGreaterThan(0);
  const detail = () => requests.filter((r) => r.queries.some((q) => q.refId === 'DETAIL'));
  expect(detail()).toHaveLength(0);
  await inspector.getByLabel('Named query', { exact: true }).selectOption('trend');
  await inspector.getByRole('textbox', { name: 'Alias', exact: true }).fill('Saved native alias');
  await inspector.getByRole('textbox', { name: 'Alias', exact: true }).press('Tab');
  await inspector.getByLabel('Named query', { exact: true }).selectOption('detail');
  await inspector.getByText('Import native target JSON', { exact: true }).click();
  const target = { refId: 'DETAIL', expr: 'vector(84)', range: true, opaque: { keep: ['native', 7] } };
  await inspector.getByLabel('Native target JSON', { exact: true }).fill(JSON.stringify(target));
  await inspector.getByRole('button', { name: 'Import native target', exact: true }).click();
  expect(detail()).toHaveLength(0);
  await inspector.getByRole('button', { name: 'Select device-1', exact: true }).click();
  await inspector.getByRole('button', { name: 'Preview query', exact: true }).click();
  await expect(inspector.getByLabel('Query preview result', { exact: true })).toContainText('ready');
  expect(detail()).toHaveLength(1);
  await expect(inspector.getByLabel('Hover row preview')).toContainText('84');
  await inspector.getByRole('button', { name: 'Select ordinary-chart', exact: true }).click();
  await inspector.getByRole('button', { name: 'Assign chart region', exact: true }).click();
  await inspector.getByLabel('Chart query', { exact: true }).selectOption('detail');
  await inspector.getByLabel('Chart label', { exact: true }).fill('Explicit trend α');
  expect(detail()).toHaveLength(1);
  await inspector.getByRole('button', { name: 'Export patterns', exact: true }).click();
  const exported = JSON.parse(await inspector.getByLabel('Exported pattern document', { exact: true }).inputValue());
  expect(exported.config.queries.find((q: { id: string }) => q.id === 'detail').source.target).toEqual(target);
  expect(exported.config.queries.find((q: { id: string }) => q.id === 'trend').source.target.alias).toBe(
    'Saved native alias'
  );
  await inspector.getByLabel('Pattern document', { exact: true }).fill(JSON.stringify(exported));
  await inspector.getByRole('button', { name: 'Preview pattern import', exact: true }).click();
  const preview = inspector.getByRole('region', { name: 'Pattern import preview' });
  await expect(preview).toContainText('Preview does not execute queries');
  expect(detail()).toHaveLength(1);
  await preview.getByRole('button', { name: 'Cancel pattern import' }).click();
  await inspector.getByRole('button', { name: 'Preview pattern import', exact: true }).click();
  for (const section of ['queries', 'patterns', 'widgets']) {
    for (const item of exported.config[section]) {
      await preview.getByLabel(`${section} ${item.id} conflict`, { exact: true }).selectOption('replace');
    }
  }
  await preview.getByRole('button', { name: 'Import into draft', exact: true }).click();
  expect(detail()).toHaveLength(1);
  await inspector.getByRole('button', { name: 'Apply bindings', exact: true }).click();
  await expect(page.getByTestId('dmap-panel').locator('[data-dmap-widget="chart-1"]')).toContainText('84');
  await saveDashboard(page);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  const persisted = saved.dashboard.panels[0].options.config;
  expect(persisted.widgets.find((w: { id: string }) => w.id === 'chart-1').anchorCellId).toBe('ordinary-chart');
  expect(persisted.queries.find((q: { id: string }) => q.id === 'detail').source.target).toEqual(target);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await inspector.getByRole('button', { name: 'Select ordinary-chart', exact: true }).click();
  await expect(inspector.getByLabel('Chart label', { exact: true })).toHaveValue('Explicit trend α');
});
