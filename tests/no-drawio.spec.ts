import { expect, test } from '@grafana/plugin-e2e';

test('view mode loads no draw.io code', async ({ gotoDashboardPage, page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.locator('polyline.dmap-half').first()).toBeAttached();
  const offenders = urls.filter((u) => /diagrams\.net|viewer-static|mxgraph|\/drawio\//i.test(u));
  expect(offenders).toEqual([]);
  // Only the panel counts: the Grafana frontend sandbox adds its own iframe to the page.
  expect(await panel.locator.locator('iframe').count()).toBe(0);
  expect(await page.getByTestId('dmap-editor-frame').count()).toBe(0);
});
