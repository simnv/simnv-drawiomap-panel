import type { Locator, TestInfo } from '@playwright/test';
import { expect, saveDashboard, svg, test } from './authoring-fixtures';
import type { ConfigV4 } from '../src/model/v4';

const DEMO = { uid: 'drawiomap-demo' };

async function screenshot(target: Locator, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await target.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('the v4 demo paints link halves, a down node and a grey node with no data', async ({ gotoDashboardPage }) => {
  const dashboard = await gotoDashboardPage(DEMO);
  const panel = dashboard.getPanelByTitle('demo-lab L3').locator;
  const half = panel.locator(
    'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~net-a:lan->rtr-a:br-lan"]'
  );
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  // The LAN receive rate is 9.6% of 1 Gb/s, below the first threshold.
  await expect(half).toHaveCSS('stroke', 'rgb(115, 191, 105)');
  const down = panel.locator('[data-cell-id="pg-node~lte"]');
  const missing = panel.locator('[data-cell-id="pg-node~proxy-b"]');
  await expect(down).toHaveAttribute('data-dmap-status', 'down');
  await expect(missing).toHaveAttribute('data-dmap-status', 'missing');
  const paint = (node: Locator) =>
    node
      .locator('rect')
      .first()
      .evaluate((el) => getComputedStyle(el).stroke);
  expect(await paint(down)).not.toBe(await paint(missing));
  const grey = (await paint(missing)).match(/\d+/g)!.slice(0, 3).map(Number);
  expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(25);
});

test('the v4 demo shows three history lines on one axis and a history chart region', async ({
  gotoDashboardPage,
}, testInfo) => {
  const dashboard = await gotoDashboardPage({
    ...DEMO,
    queryParams: new URLSearchParams({ viewPanel: 'panel-1', from: 'now-2m', to: 'now' }),
  });
  const panel = dashboard.getPanelByTitle('demo-lab L3').locator;
  await panel.locator('[data-cell-id="pg-node~rtr-a"] rect').first().click({ force: true });
  const row = panel.getByRole('dialog').getByTestId('dmap-card-row').filter({ hasText: 'Three lines' });
  // All three lines share one chart box.
  await expect(row.locator('.uplot')).toHaveCount(3);
  const ranges = await row
    .locator('[data-state="ready"] > div > div')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  expect(ranges).toHaveLength(3);
  expect(new Set(ranges.map((r) => `${r.x},${r.y},${r.width},${r.height}`)).size).toBe(1);
  await screenshot(panel, testInfo, 'three-lines');
  const regions = await gotoDashboardPage({
    ...DEMO,
    queryParams: new URLSearchParams({ from: 'now-2m', to: 'now' }),
  });
  const chartPanel = regions.getPanelByTitle('v4 chart regions').locator;
  await chartPanel.scrollIntoViewIfNeeded();
  const region = chartPanel.locator('[data-dmap-chart="history-region"]');
  await expect(region.locator('.uplot')).toHaveCount(3);
  await screenshot(region, testInfo, 'history-region');
});

test('nine series show eight lines, +1 more and eight values at the hovered time', async ({
  gotoDashboardPage,
  page,
}, testInfo) => {
  const dashboard = await gotoDashboardPage({
    ...DEMO,
    queryParams: new URLSearchParams({ viewPanel: 'panel-1', from: 'now-2m', to: 'now' }),
  });
  const panel = dashboard.getPanelByTitle('demo-lab L3').locator;
  await panel.locator('[data-cell-id="pg-node~rtr-a"] rect').first().click({ force: true });
  const row = panel.getByRole('dialog').getByTestId('dmap-card-row').filter({ hasText: 'Nine lines' });
  await expect(row).toContainText('+1 more');
  await expect(row.locator('.uplot')).toHaveCount(8);
  const chart = row.getByTestId('dmap-chart-hover');
  // Keyboard navigation selects a real sample and keeps the tooltip at one time.
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  const tooltip = page.getByTestId('dmap-chart-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  for (let i = 0; i < 8; i++) {
    await expect(tooltip.getByText(`{line="line-${i}"}`, { exact: true })).toBeVisible();
    await expect(tooltip.getByText(String((i + 1) * 10), { exact: true })).toBeVisible();
  }
  await expect(tooltip.getByText('{line="line-8"}', { exact: true })).toHaveCount(0);
  await expect(tooltip).toContainText('+1 more');
  await screenshot(page.locator('body'), testInfo, 'eight-lines-tooltip');
});

test('a value chart region draws a Grafana bar gauge', async ({ gotoDashboardPage }, testInfo) => {
  const dashboard = await gotoDashboardPage(DEMO);
  const panel = dashboard.getPanelByTitle('v4 chart regions').locator;
  await panel.scrollIntoViewIfNeeded();
  const gauge = panel.locator('[data-dmap-chart="value-region"]');
  await expect(gauge).toContainText('Gauge');
  await expect(gauge).toContainText('42');
  await expect(gauge.getByText('Set a meaningful minimum and maximum to show a bar.')).toHaveCount(0);
  await expect(gauge.getByTestId('data-testid Bar gauge value')).toBeVisible();
  await screenshot(gauge, testInfo, 'value-bar-gauge');
});

test('the YAML option saves a valid config and keeps build after save and reload', async ({
  createDiagram,
  config,
  gotoPanelEditPage,
  gotoDashboardPage,
  page,
  request,
  selectors,
}) => {
  const uid = await createDiagram(config, { options: { build: 'x' } });
  const editor = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await editor.getCustomOptions('Bindings').expand();
  const code = editor.getByGrafanaSelector(selectors.components.CodeEditor.container);
  await expect(code.locator('.view-lines')).toContainText('version: 4');
  await code.locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect(code.locator('.view-lines')).toHaveText('');
  const updated = { ...config, freshness: '7m' };
  // JSON is valid YAML. Keep the class map and change one scalar through the real editor.
  await page.keyboard.insertText(JSON.stringify(updated, null, 2));
  await page.keyboard.press('Control+Home');
  await expect(code.locator('.view-lines')).toContainText('7m');
  await expect(code.locator('.view-lines')).not.toContainText('3x');
  await saveDashboard(page, editor);
  const response = await request.get(`/api/dashboards/uid/${uid}`);
  expect(response.ok()).toBe(true);
  const stored = (await response.json()).dashboard.panels[0].options;
  expect(stored.config).toEqual(updated);
  expect(stored.build).toBe('x');
  await gotoDashboardPage({ uid });
  const reloaded = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await reloaded.getCustomOptions('Bindings').expand();
  await expect(reloaded.getByGrafanaSelector(selectors.components.CodeEditor.container)).toContainText('7m');
});

for (const scenario of [
  { name: 'query delimiters', values: ['a&var-site=b'], encoded: 'a%26var-site%3Db' },
  { name: 'fragment delimiter', values: ['#'], encoded: '%23' },
  // Grafana scenes percentencode formats a multi value as an encoded glob (P1-03 interface note).
  { name: 'multiple values', values: ['a', 'b'], encoded: '%7Ba%2Cb%7D' },
]) {
  test(`real Grafana URL formats encode ${scenario.name} and keep the time range raw`, async ({
    createDiagram,
    gotoDashboardPage,
    request,
  }) => {
    const config: ConfigV4 = {
      version: 4,
      freshness: '3x',
      classes: {
        routers: {
          match: { key: 'device' },
          rows: [
            { kind: 'drilldown', label: 'Encoded', url: '/d/host?var-job=$job&$__url_time_range' },
            { kind: 'drilldown', label: 'Query parameters', url: '/d/host?${job:queryparam}' },
            { kind: 'drilldown', label: 'Cell and dashboard', url: '/d/host?var-node=${job}&${job:queryparam}' },
          ],
        },
      },
      overrides: {},
    };
    const uid = await createDiagram(config, {
      svg: svg.replace('data-meta-key="router-1"', 'data-meta-key="router-1" data-meta-job="cell-a"'),
    });
    const response = await request.get(`/api/dashboards/uid/${uid}`);
    const { dashboard } = await response.json();
    dashboard.templating.list = [
      {
        name: 'job',
        type: 'custom',
        multi: scenario.values.length > 1,
        query: scenario.values.join(','),
        current: { text: scenario.values, value: scenario.values },
        options: scenario.values.map((value) => ({ text: value, value, selected: true })),
      },
    ];
    const saved = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
    expect(saved.ok()).toBe(true);
    const opened = await gotoDashboardPage({ uid });
    const panel = opened.getPanelByTitle('Sanitized topology 1').locator;
    await panel.locator('[data-cell-id="device-1"] rect').click({ force: true });
    const card = panel.getByRole('dialog');
    const href = await card.getByRole('link', { name: 'Encoded', exact: true }).getAttribute('href');
    expect(href).toMatch(new RegExp(`^/d/host\\?var-job=${scenario.encoded}&from=[^&]+&to=[^&]+(?:&timezone=[^&]+)?$`));
    const params = scenario.values.map((v) => `var-job=${encodeURIComponent(v)}`).join('&');
    await expect(card.getByRole('link', { name: 'Query parameters', exact: true })).toHaveAttribute(
      'href',
      `/d/host?${params}`
    );
    await expect(card.getByRole('link', { name: 'Cell and dashboard', exact: true })).toHaveAttribute(
      'href',
      `/d/host?var-node=cell-a&${params}`
    );
  });
}
