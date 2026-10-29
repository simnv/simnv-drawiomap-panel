import { expect, test } from './authoring-fixtures';

/** A message text of the `yaml` package, as in scripts/check-bundle.sh. A minifier keeps string literals. */
const YAML_TEXT = 'Implicit keys need to be on a single line';

test('view mode loads no draw.io code', async ({ gotoDashboardPage, page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  // The scripts of the plugin: module.js and each chunk that view mode loads.
  const scripts: Array<Promise<{ url: string; yaml: boolean }>> = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.includes('/plugins/simnv-drawiomap-panel/') && path.endsWith('.js')) {
      scripts.push(r.text().then((body) => ({ url: path, yaml: body.includes(YAML_TEXT) })));
    }
  });
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.locator('polyline.dmap-half').first()).toBeAttached();
  const offenders = urls.filter((u) => /diagrams\.net|viewer-static|mxgraph|\/drawio\//i.test(u));
  expect(offenders).toEqual([]);
  // The bindings popup is a panel editor feature: view mode loads neither its chunk nor its entry button.
  expect(urls.filter((u) => /bindings-popup/.test(new URL(u).pathname))).toEqual([]);
  await expect(page.getByTestId('dmap-edit-bindings')).toHaveCount(0);
  // The YAML option editor and its parser are lazy chunks of panel edit (spec 5.0, 5.3): view mode requests neither.
  // The parser chunk has a number as its name, so the check reads the text of each script.
  expect(urls.filter((u) => /config-yaml-editor/.test(new URL(u).pathname))).toEqual([]);
  const loaded = await Promise.all(scripts);
  expect(loaded.map((s) => s.url).some((u) => u.endsWith('/module.js'))).toBe(true);
  expect(loaded.filter((s) => s.yaml).map((s) => s.url)).toEqual([]);
  // Only the panel counts: the Grafana frontend sandbox adds its own iframe to the page.
  expect(await panel.locator.locator('iframe').count()).toBe(0);
  expect(await page.getByTestId('dmap-editor-frame').count()).toBe(0);
});
