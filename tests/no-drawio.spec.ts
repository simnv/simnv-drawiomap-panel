import { expect, test } from './authoring-fixtures';

/**
 * The message texts of the `yaml` package of spec 5.3, as in scripts/check-bundle.sh. A minifier keeps string literals.
 */
const YAML_TEXTS = ['Implicit keys need to be on a single line', 'Map keys must be unique'];

test('view mode loads no draw.io code', async ({ gotoDashboardPage, page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  // The scripts of the plugin: module.js and each chunk that view mode loads. Each request counts, also one that
  // fails: a script that the check cannot read must fail the test, not drop out of it.
  const pluginScript = (url: string) => {
    const path = new URL(url).pathname;
    return path.includes('/plugins/simnv-drawiomap-panel/') && path.endsWith('.js') ? path : undefined;
  };
  const requested: string[] = [];
  const aborted: string[] = [];
  const failed: string[] = [];
  const scripts: Array<Promise<{ url: string; yaml: string[] }>> = [];
  page.on('request', (r) => {
    const path = pluginScript(r.url());
    if (path) {
      requested.push(path);
    }
  });
  page.on('requestfailed', (r) => {
    const path = pluginScript(r.url());
    if (path) {
      aborted.push(`${path}: ${r.failure()?.errorText ?? 'failed'}`);
    }
  });
  page.on('requestfinished', (r) => {
    const path = pluginScript(r.url());
    if (path) {
      scripts.push(
        r.response().then(async (response) => {
          if (!response?.ok()) {
            // a finished request with an error status
            failed.push(`${path}: HTTP ${response?.status() ?? 'no response'}`);
            return { url: path, yaml: [] };
          }
          const body = await response.text();
          return { url: path, yaml: YAML_TEXTS.filter((text) => body.includes(text)) };
        })
      );
    }
  });
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.locator('polyline.dmap-half').first()).toBeAttached();
  const offenders = urls.filter((u) => /diagrams\.net|viewer-static|mxgraph|\/drawio\//i.test(u));
  expect(offenders).toEqual([]);
  // The bindings popup is a panel editor feature: view mode loads neither its chunk nor its entry button. No P1 build
  // emits a `bindings-popup` chunk; the guard stays for the popup of P3.
  expect(urls.filter((u) => /bindings-popup/.test(new URL(u).pathname))).toEqual([]);
  await expect(page.getByTestId('dmap-edit-bindings')).toHaveCount(0);
  // The YAML option editor and its parser are lazy chunks of panel edit (spec 5.0, 5.3): view mode requests neither.
  // The parser chunk has a number as its name, so the check reads the text of each script.
  expect(urls.filter((u) => /config-yaml-editor/.test(new URL(u).pathname))).toEqual([]);
  // each script request is done: it finished or it failed
  await expect.poll(() => scripts.length + aborted.length).toBe(requested.length);
  const loaded = await Promise.all(scripts);
  expect([...aborted, ...failed]).toEqual([]);
  expect(loaded.map((s) => s.url).sort()).toEqual([...requested].sort());
  expect(loaded.map((s) => s.url).some((u) => u.endsWith('/module.js'))).toBe(true);
  expect(loaded.filter((s) => s.yaml.length).map((s) => `${s.url}: ${s.yaml.join(', ')}`)).toEqual([]);
  // Only the panel counts: the Grafana frontend sandbox adds its own iframe to the page.
  expect(await panel.locator.locator('iframe').count()).toBe(0);
  expect(await page.getByTestId('dmap-editor-frame').count()).toBe(0);
});
