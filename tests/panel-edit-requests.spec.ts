import type { Page, Request } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

/**
 * Entering panel edit must not run the panel queries again (Grafana does not run them then either), must not call
 * datasource resources besides those of the Grafana query editors, and must show no error toast. Discard closes panel
 * edit. Regression for the "refresh on panel edit" and "Cancel does nothing" reports. P1 has no bindings popup
 * (spec 5.0): the draft is an edit in the YAML option, and Discard of the panel editor is the Cancel. The popup part
 * of this check comes with P3.
 */

/**
 * The resource calls of the Grafana query editors below the panel in panel edit: the TestData scenario list and the
 * Prometheus metric metadata, labels and series for the code completion. The panel itself calls no resource.
 */
const QUERY_EDITOR_RESOURCE =
  /\/resources\/(?:scenarios|api\/v1\/(?:metadata|labels|label\/[^/]+\/values|series))(?:\?|$)/;

/** The API requests of the page: the panel queries, the other datasource resource calls and the other calls. */
function observeApi(page: Page) {
  const log: Array<{ kind: 'query' | 'resource' | 'query-editor' | 'other'; method: string; path: string }> = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.includes('/api/')) {
      return;
    }
    const path = url.pathname + url.search;
    const kind = path.includes('/api/ds/query')
      ? 'query'
      : QUERY_EDITOR_RESOURCE.test(path)
        ? 'query-editor'
        : path.includes('/resources/')
          ? 'resource'
          : 'other';
    log.push({ kind, method: request.method(), path });
  });
  return log;
}

test('panel edit runs no query again, calls no datasource resource of its own, and Discard drops a YAML edit', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(config);
  const log = observeApi(page);
  // Monaco (the query editors) adds two empty `alert` live regions to the page: a toast has a text.
  const toasts = page.getByRole('alert').filter({ hasText: /\S/ });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  // The two routers of the authoring config have their status from the `health` target.
  const normal = () => page.getByTestId('dmap-panel').locator('[data-dmap-status="normal"]');
  await expect(normal()).toHaveCount(2);
  await expect.poll(() => log.filter((r) => r.kind === 'query').length).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  const before = log.length;

  // Enter panel edit in the app, as the panel menu does: the panel component mounts again in the editor.
  await panel.hover();
  await page.keyboard.press('e');
  await page.waitForURL(/editPanel=1/);
  // P1 has no "Edit bindings" button (spec 5.0); the corner of the panel is there.
  await expect(page.getByTestId('dmap-corner')).toBeAttached();
  await expect(page.getByTestId('dmap-edit-bindings')).toHaveCount(0);
  await expect(normal()).toHaveCount(2);
  await page.waitForTimeout(5000);
  const afterEdit = log.slice(before);
  expect(
    afterEdit.filter((r) => r.kind === 'query'),
    JSON.stringify(afterEdit)
  ).toEqual([]);
  expect(
    afterEdit.filter((r) => r.kind === 'resource'),
    JSON.stringify(afterEdit)
  ).toEqual([]);
  await expect(toasts).toHaveCount(0);

  // An edit in the YAML option changes the panel at once: the routers read a refId that no target has.
  const bindings = page.getByTestId('data-testid Options group Bindings');
  const toggle = bindings.locator('[aria-expanded]').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await bindings
    .getByTestId('data-testid Code editor container')
    .locator('.view-line')
    .filter({ hasText: /status:\s+health/ })
    .click();
  await page.keyboard.press('End');
  await page.keyboard.type('-draft');
  await expect(normal()).toHaveCount(0);
  // Discard closes panel edit and drops the edit: the panel shows the saved bindings. 12.4 names the button
  // "Discard panel changes".
  await page.getByRole('button', { name: /^Discard( panel changes)?$/ }).click();
  await expect(page).not.toHaveURL(/editPanel=/);
  await expect(normal()).toHaveCount(2);
  await expect(toasts).toHaveCount(0);
});
