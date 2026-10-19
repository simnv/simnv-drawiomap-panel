import { expect, observeQueries, svg, test } from './authoring-fixtures';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';

test('visible health becomes stale without another response or network request', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  config.queries[0] = nativeQuery('health', 'vector(1)');
  config.queries[0].source = {
    kind: 'datasource',
    target: { refId: 'HEALTH', ...{ expr: 'vector(1)', instant: true } },
    parameters: {},
  };
  config.patterns[0].display.status!.freshness = { expectedIntervalMs: 1000, staleAfterMs: 5000 };
  config.widgets = [];
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  await gotoDashboardPage({ uid });
  const device = page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]');
  await expect(device).toHaveAttribute('data-dmap-status', 'normal');
  const count = requests.length;
  await expect(device).toHaveAttribute('data-dmap-status', 'stale', { timeout: 8000 });
  expect(requests).toHaveLength(count);
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`desktop ${theme}`, () => {
    test.use({ viewport: { width: 1450, height: 950 } });
    for (const state of [
      'normal',
      'partial outage',
      'widespread outage',
      'zero',
      'missing',
      'stale',
      'loading',
      'error',
    ]) {
      test(`${state}: reasons stay visible and charts remain explicit`, async ({
        page,
        config,
        createDiagram,
        gotoDashboardPage,
      }, testInfo) => {
        const expr =
          state === 'error'
            ? 'vector('
            : state === 'missing'
              ? 'absent(vector(1))'
              : state.includes('outage')
                ? 'vector(0)'
                : 'vector(1)';
        config.queries[0] = nativeQuery('health', expr);
        if (state === 'partial outage') {
          config.queries.push(nativeQuery('healthy-peer', 'vector(1)'));
          config.overrides.push({
            cellId: 'device-2',
            display: { status: { ...config.patterns[0].display.status!, binding: binding('healthy-peer') } },
          });
        }
        if (state === 'stale')
          config.patterns[0].display.status!.freshness = { expectedIntervalMs: 1, staleAfterMs: 2 };
        if (state === 'zero') {
          config.queries[2] = nativeQuery('trend', 'vector(0)');
        }
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        if (state === 'loading')
          await page.route('**/api/ds/query*', async (route) => {
            if (!route.request().postData()?.includes('HEALTH')) {
              await route.continue();
              return;
            }
            const response = await route.fetch();
            await gate;
            await route.fulfill({ response }).catch(() => {});
          });
        const uid = await createDiagram(config);
        try {
          const dashboard = await gotoDashboardPage({ uid });
          await dashboard.goto({ queryParams: new URLSearchParams({ theme }) });
          const panel = page.getByTestId('dmap-panel');
          await expect(panel).toHaveCSS('color-scheme', theme);
          const device = panel.locator('[data-cell-id="device-1"]');
          const expected = state.includes('outage')
            ? 'down'
            : state === 'stale'
              ? 'stale'
              : ['missing', 'loading', 'error'].includes(state)
                ? 'missing'
                : 'normal';
          await expect(device).toHaveAttribute('data-dmap-status', expected);
          if (state === 'partial outage')
            await expect(panel.locator('[data-cell-id="device-2"]')).toHaveAttribute('data-dmap-status', 'normal');
          if (state === 'widespread outage') {
            await expect(panel.locator('.dmap-status-marker')).toHaveCount(2);
            await expect(panel.locator('.dmap-status-summary')).toHaveCount(1);
            await expect(panel.locator('.dmap-status-summary')).toHaveAttribute(
              'title',
              'down: Health check failed (2 elements)'
            );
          }
          if (expected !== 'normal') {
            const reason = state.includes('outage')
              ? 'Health check failed'
              : state === 'missing'
                ? 'No data'
                : state === 'error'
                  ? 'Query failed'
                  : state === 'loading'
                    ? 'Loading data'
                    : 'Sample is stale';
            await expect(panel.locator('.dmap-status-summary').filter({ hasText: reason })).toBeVisible();
          }
          await expect(panel.locator('[data-dmap-widget]')).toHaveCount(1);
          await expect(panel.locator('[data-cell-id^="device-"] [data-dmap-widget]')).toHaveCount(0);
          await expect(panel.getByTestId('dmap-card')).toHaveCount(0);
          if (state === 'zero') {
            await expect(panel.locator('[data-dmap-widget]')).toContainText('0');
            await expect(panel.locator('[data-dmap-widget] [data-state="ready"]')).toBeVisible();
          } else await expect(panel.locator('[data-dmap-widget] canvas')).toBeVisible();
          const screenshot = testInfo.outputPath(`${state}-${theme}.png`);
          await panel.screenshot({ path: screenshot });
          await testInfo.attach(`${state}-${theme}`, { path: screenshot, contentType: 'image/png' });
        } finally {
          release();
        }
      });
    }
    test('crowded topology keeps a widespread reason readable', async ({
      page,
      config,
      createDiagram,
      gotoDashboardPage,
    }, testInfo) => {
      config.queries[0] = nativeQuery('health', 'vector(0)');
      const uid = await createDiagram(config, { svg: svg.replace('translate(35 35)', 'translate(0 0)') });
      const dashboard = await gotoDashboardPage({ uid });
      await dashboard.goto({ queryParams: new URLSearchParams({ theme }) });
      const panel = page.getByTestId('dmap-panel');
      await expect(panel.locator('.dmap-status-summary[title="down: Health check failed (2 elements)"]')).toBeVisible();
      const top = (await panel.boundingBox())!.y;
      for (const marker of await panel.locator('.dmap-status-marker text').all()) {
        expect((await marker.boundingBox())!.y).toBeGreaterThanOrEqual(top);
      }
      const screenshot = testInfo.outputPath(`crowded-${theme}.png`);
      await panel.screenshot({ path: screenshot });
      await testInfo.attach(`crowded-${theme}`, { path: screenshot, contentType: 'image/png' });
    });
  });
}
