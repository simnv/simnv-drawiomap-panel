import { attachJson, expect, observeQueries, svg, test } from './authoring-fixtures';
import { nativeQuery } from '../src/fixtures/authoring-config';

test('value and history rows wait for display, share demand, reuse fresh cache and follow dashboard context', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
  selectors,
}, testInfo) => {
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  const detail = () => requests.filter((r) => r.queries.some((q) => q.refId === 'DETAIL'));
  const dashboard = await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await expect(panel.locator('[data-dmap-widget] canvas').first()).toBeVisible();
  expect(detail()).toHaveLength(0);
  const device = panel.locator('[data-cell-id="device-1"]');
  await device.hover();
  const card = panel.getByTestId('dmap-card');
  await expect(card).toContainText('Detail value');
  await expect(card).toContainText('23');
  await expect(card.locator('canvas')).toBeVisible();
  expect(detail()).toHaveLength(1);
  await page.mouse.move(1, 1);
  await expect(card).toHaveCount(0);
  await device.hover();
  await expect(card).toContainText('23');
  expect(detail()).toHaveLength(1);
  await page.mouse.move(1, 1);
  await dashboard
    .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemValueDropDownValueLinkTexts('23'))
    .click();
  await page.getByRole('option', { name: '47', exact: true }).click();
  await expect(panel.locator('[data-dmap-widget] canvas').first()).toBeVisible();
  expect(detail()).toHaveLength(1);
  await device.hover();
  await expect(card).toContainText('47');
  expect(detail()).toHaveLength(2);
  expect(detail()[1].queries[0].expr).toContain('device-1');
  expect(detail()[1].queries[0].expr).toContain('47');
  await page.mouse.move(1, 1);
  await dashboard.timeRange.set({ from: 'now-2h', to: 'now' });
  expect(detail()).toHaveLength(2);
  await device.hover();
  await expect(card).toContainText('47');
  await expect.poll(() => detail().length).toBe(3);
  expect(Number(detail()[2].to) - Number(detail()[2].from)).toBe(7200000);
  await attachJson(testInfo, 'request-counts', {
    initial: 0,
    firstOpen: 1,
    freshReopen: 1,
    changedVariableOpen: 2,
    changedRangeOpen: detail().length,
    requests,
  });
});

test('switching cells rejects an old response even when the server completed its work', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  config.queries[1] = nativeQuery('detail', 'label_replace(vector($dm_sample), "device", "$dm_key", "", "")', {
    dm_key: 'cell.key',
    dm_sample: 'cell.sample',
  });
  config.patterns[0].display.hover!.rows.unshift({ kind: 'metadata', label: 'Identity', path: 'cell.key' });
  const uid = await createDiagram(config, {
    svg: svg
      .replace('data-meta-device="router-1"', 'data-meta-device="router-1" data-meta-sample="23"')
      .replace('data-meta-device="router-2"', 'data-meta-device="router-2" data-meta-sample="47"'),
  });
  let completeOld!: () => void;
  const oldReleased = new Promise<void>((resolve) => {
    completeOld = resolve;
  });
  let fetchedOld = false;
  let attemptedDelivery = false;
  await page.route('**/api/ds/query*', async (route) => {
    const body = route.request().postDataJSON();
    const old = body.queries.some(
      (q: { refId: string; expr?: string }) => q.refId === 'DETAIL' && q.expr?.includes('device-1')
    );
    if (!old) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    fetchedOld = true;
    await oldReleased;
    await route.fulfill({ response }).catch(() => {}); // Browser transport may already be cancelled.
    attemptedDelivery = true;
  });
  const requests = observeQueries(page);
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await panel.locator('[data-cell-id="device-1"]').hover();
  await expect.poll(() => fetchedOld).toBe(true);
  await expect(panel.getByTestId('dmap-card')).toContainText('Loading');
  await panel.locator('[data-cell-id="device-2"]').hover();
  await expect(panel.getByTestId('dmap-card')).toContainText('device-2');
  await expect(panel.getByTestId('dmap-card')).toContainText('47');
  completeOld();
  await expect.poll(() => attemptedDelivery).toBe(true);
  await expect(panel.getByTestId('dmap-card')).toContainText('device-2');
  await expect(panel.getByTestId('dmap-card')).not.toContainText('device-1');
  await expect(panel.getByTestId('dmap-card')).not.toContainText('23');
  expect(requests.filter((r) => r.queries.some((q) => q.refId === 'DETAIL'))).toHaveLength(2);
});

test('dashboard refresh updates an absolute range with an empty eager target list', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
  selectors,
}) => {
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  const dashboard = await gotoDashboardPage({ uid });
  await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]')).toHaveAttribute(
    'data-dmap-status',
    'normal'
  );
  const initial = requests.filter((r) => r.queries.some((q) => q.refId === 'HEALTH')).length;
  await dashboard.timeRange.set({ from: '2026-10-17T00:00:00Z', to: '2026-10-17T01:00:00Z' });
  await expect.poll(() => requests.filter((r) => r.queries.some((q) => q.refId === 'HEALTH')).length).toBe(initial + 3);
  await expect(page.getByTestId('dmap-panel').locator('[data-dmap-widget] canvas')).toBeVisible();
  const before = requests.filter((r) => r.queries.some((q) => q.refId === 'HEALTH')).length;
  await dashboard.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2).click();
  await expect
    .poll(() => requests.filter((r) => r.queries.some((q) => q.refId === 'HEALTH')).length)
    .toBeGreaterThan(before);
  expect(requests.filter((r) => r.queries.some((q) => q.refId === 'DETAIL'))).toHaveLength(0);
});

test('one panel executes Prometheus and TestData queries through their installed plugins', async ({
  page,
  request,
  config,
  createDiagram,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await expect(panel.locator('[data-dmap-widget] canvas').first()).toBeVisible();
  await expect(panel.locator('[data-cell-id="device-1"]')).toHaveAttribute('data-dmap-status', 'normal');
  expect(new Set(requests.flatMap((r) => r.queries.map((q) => q.datasource.type)))).toEqual(
    new Set(['prometheus', 'grafana-testdata-datasource'])
  );
  const plugins = await Promise.all(
    ['prometheus', 'grafana-testdata-datasource'].map(async (id) => {
      const result = await request.get(`/api/plugins/${id}/settings`);
      expect(result.ok()).toBe(true);
      const plugin = await result.json();
      return {
        id,
        version: plugin.info?.version ?? '',
        grafana: (await (await request.get('/api/health')).json()).version,
      };
    })
  );
  await attachJson(testInfo, 'installed-datasources', { plugins, requests });
});
