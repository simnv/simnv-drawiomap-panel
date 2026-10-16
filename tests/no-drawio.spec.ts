import { expect, test } from '@grafana/plugin-e2e';

test('view mode loads no draw.io code', async ({ gotoDashboardPage, page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.locator('polyline.dmap-half').first()).toBeAttached();
  const offenders = urls.filter((u) => /localhost:8080|diagrams\.net|viewer-static|mxgraph|\/drawio\//i.test(u));
  expect(offenders).toEqual([]);
  expect(await page.locator('iframe').count()).toBe(0);
});
