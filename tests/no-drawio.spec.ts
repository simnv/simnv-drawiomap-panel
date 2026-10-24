import { expect, test } from './authoring-fixtures';

test('view mode loads no draw.io code', async ({ gotoDashboardPage, page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.locator('polyline.dmap-half').first()).toBeAttached();
  const offenders = urls.filter((u) => /diagrams\.net|viewer-static|mxgraph|\/drawio\//i.test(u));
  expect(offenders).toEqual([]);
  // The bindings popup is a panel editor feature: view mode loads neither its chunk nor its entry button.
  expect(urls.filter((u) => /bindings-popup/.test(new URL(u).pathname))).toEqual([]);
  await expect(page.getByTestId('dmap-edit-bindings')).toHaveCount(0);
  // Only the panel counts: the Grafana frontend sandbox adds its own iframe to the page.
  expect(await panel.locator.locator('iframe').count()).toBe(0);
  expect(await page.getByTestId('dmap-editor-frame').count()).toBe(0);
});
