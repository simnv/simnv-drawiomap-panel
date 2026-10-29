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
  await expect(row.locator('.uplot')).toHaveCount(3);
  // The lines hold about 20, 40 and 60, and the row sets no min or max. One shared range from zero puts each line
  // at a height in proportion to its value. A range for each line puts each line near the top of its own chart.
  const heights = await row.locator('.uplot canvas').evaluateAll((canvases) =>
    canvases.map((el) => {
      const canvas = el as HTMLCanvasElement;
      const { width, height } = canvas;
      const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
      // the mean height above the bottom of the top painted pixel of each column
      let sum = 0;
      let columns = 0;
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          if (data[(y * width + x) * 4 + 3] > 0) {
            sum += (height - y) / height;
            columns++;
            break;
          }
        }
      }
      return columns ? sum / columns : 0;
    })
  );
  heights.sort((a, b) => a - b);
  expect(heights[0]).toBeGreaterThan(0);
  expect(heights[0] / heights[2]).toBeGreaterThan(0.2);
  expect(heights[0] / heights[2]).toBeLessThan(0.5);
  expect(heights[1] / heights[2]).toBeGreaterThan(0.5);
  expect(heights[1] / heights[2]).toBeLessThan(0.8);
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
  request,
}, testInfo) => {
  // A fixed range in the past: the samples do not change while the test reads them.
  const to = Math.floor(Date.now() / 5000) * 5000 - 60_000;
  const dashboard = await gotoDashboardPage({
    ...DEMO,
    queryParams: new URLSearchParams({ viewPanel: 'panel-1', from: String(to - 120_000), to: String(to) }),
  });
  const panel = dashboard.getPanelByTitle('demo-lab L3').locator;
  await panel.locator('[data-cell-id="pg-node~rtr-a"] rect').first().click({ force: true });
  const row = panel.getByRole('dialog').getByTestId('dmap-card-row').filter({ hasText: 'Nine lines' });
  await expect(row).toContainText('+1 more');
  await expect(row.locator('.uplot')).toHaveCount(8);
  const chart = row.getByTestId('dmap-chart-hover');
  const tooltip = page.getByTestId('dmap-chart-tooltip');
  const stamp = tooltip.getByLabel('Timestamp');
  // the time of the tooltip in ms; the dashboard shows the browser time zone
  const timeOf = async () => {
    await expect(stamp).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const text = await stamp.innerText();
    return page.evaluate((t) => new Date(t.replace(' ', 'T')).getTime(), text);
  };
  // the stored values of the nine lines at a time, read from the datasource
  const stored = async (ms: number) => {
    const params = new URLSearchParams({ query: 'dmap_v4_nine', time: String(ms / 1000) });
    const response = await request.get(`/api/datasources/proxy/uid/victoriametrics/api/v1/query?${params}`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    return new Map<string, string>(
      body.data.result.map((r: { metric: { line: string }; value: [number, string] }) => [r.metric.line, r.value[1]])
    );
  };
  // Keyboard navigation: the first step selects the latest sample, three more steps a sample before it.
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tooltip).toBeVisible();
  const latest = await timeOf();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowLeft');
  }
  await expect.poll(timeOf).toBeLessThan(latest);
  const hovered = await timeOf();
  const [then, last] = [await stored(hovered), await stored(latest)];
  for (let i = 0; i < 8; i++) {
    const line = `line-${i}`;
    // each value differs between the two times, so a value of the latest sample fails the check below
    expect(then.get(line)).toBeDefined();
    expect(then.get(line)).not.toBe(last.get(line));
    const entry = tooltip.getByTestId('SeriesTableRow').filter({ hasText: `{line="${line}"}` });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(new RegExp(`\\}${then.get(line)}$`));
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
  // percentencode formats a multi value as an encoded glob (spec 3.3, Grafana docs "Variable syntax").
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
