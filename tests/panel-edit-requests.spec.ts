import type { Page, Request } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

/**
 * Entering panel edit must not run the panel queries again (Grafana does not run them then either), must not call
 * datasource resources besides those of the Grafana query editors, and must show no error toast. Discard closes panel
 * edit. Regression for the "refresh on panel edit" and "Cancel does nothing" reports. The bindings popup (the split
 * editor, spec 5.1) reads the data of the panel: it runs no query either, and Close drops its draft after a
 * confirmation. A draft in the YAML option is dropped by Discard of the panel editor.
 */

/**
 * The resource calls of the Grafana query editors below the panel in panel edit: the TestData scenario list and the
 * Prometheus metric metadata, labels and series for the code completion. The panel itself calls no resource.
 */
const QUERY_EDITOR_RESOURCE =
  /\/resources\/(?:scenarios|api\/v1\/(?:metadata|labels|label\/[^/]+\/values|series))(?:\?|$)/;

/**
 * The window for a request that a late effect could send, after the network was quiet for 500 ms. Grafana mounts the
 * query editors in panel edit and they call their resources within 0.6 s (measured on Grafana 13.2 with the
 * VictoriaMetrics editors; 12.4 calls only the TestData scenario list). The panel has no timer that sends a request,
 * and the dashboard refresh is one day. The window is longer than the delay of the editors.
 */
const NO_REQUEST_WINDOW_MS = 1000;

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

test('panel edit and the popup run no query again, call no datasource resource of their own, and Close and Discard drop the drafts', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  // The test runs no query after the first one, and it runs longer than three samples of 5 s. With the freshness 3x the
  // routers become stale (spec 3.5) during the test, the slow frontend sandbox first. One hour keeps them normal.
  const uid = await createDiagram({ ...config, freshness: '1h' });
  const log = observeApi(page);
  // Monaco (the query editors) adds two empty `alert` live regions to the page: a toast has a text.
  const toasts = page.getByRole('alert').filter({ hasText: /\S/ });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  // The two routers of the authoring config have their status from the `health` target.
  const normal = () => page.getByTestId('dmap-panel').locator('[data-dmap-status="normal"]');
  await expect(normal()).toHaveCount(2);
  await expect.poll(() => log.filter((r) => r.kind === 'query').length).toBeGreaterThan(0);
  // The first load is done when the network is quiet: later requests belong to panel edit.
  await page.waitForLoadState('networkidle');
  const before = log.length;

  // Enter panel edit in the app, as the panel menu does: the panel component mounts again in the editor.
  await panel.hover();
  await page.keyboard.press('e');
  await page.waitForURL(/editPanel=1/);
  await expect(page.getByTestId('dmap-edit-bindings')).toBeVisible();
  await expect(normal()).toHaveCount(2);
  // The query editors below the panel mount in panel edit and call their resources (the TestData scenario list on all
  // versions). A query that panel edit would run again comes with them. Wait for the first call, then for a quiet
  // network, then observe.
  await expect.poll(() => log.slice(before).some((r) => r.kind === 'query-editor')).toBe(true);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(NO_REQUEST_WINDOW_MS);
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

  // The popup reads the data of the panel (spec 5.1): its stage binds with no request.
  const popup = page.getByTestId('dmap-bindings-popup');
  const dialog = page.getByRole('dialog', { name: 'Edit bindings' });
  const popupLines = popup.getByTestId('data-testid Code editor container').locator('.view-lines');
  const popupNormal = () => popup.getByTestId('dmap-popup-stage').locator('[data-dmap-status="normal"]');
  const openPopup = async () => {
    await page.getByTestId('dmap-edit-bindings').click();
    // Monaco loads lazily (spec 5.2); a code box with text is loaded.
    await expect(popupLines).toContainText(/\S/, { timeout: 30_000 });
  };
  await openPopup();
  await expect(popupLines).toContainText('version: 4');
  await expect(popupNormal()).toHaveCount(2);
  // The popup is loaded and bound. Its queries would start with its mount; Monaco has loaded, so only a late effect remains.
  await page.waitForTimeout(NO_REQUEST_WINDOW_MS);
  const afterPopup = log.slice(before);
  expect(
    afterPopup.filter((r) => r.kind === 'query' || r.kind === 'resource'),
    JSON.stringify(afterPopup)
  ).toEqual([]);
  await expect(toasts).toHaveCount(0);

  // Close closes a clean draft at once.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(popup).toHaveCount(0);

  // With a dirty draft, Close asks first: Cancel keeps the draft, Discard closes and drops it.
  await openPopup();
  // Monaco renders only the lines in view: page down in the code box until the line of the router status is there.
  const statusLine = popupLines.locator('.view-line').filter({ hasText: /status:\s+health/ });
  await popupLines.locator('.view-line').first().click();
  await expect
    .poll(async () => {
      if (await statusLine.count()) {
        return true;
      }
      await page.keyboard.press('PageDown');
      return false;
    })
    .toBe(true);
  await statusLine.click();
  await page.keyboard.press('End');
  await page.keyboard.type('-draft');
  // The draft binds the popup stage only: the panel keeps the saved bindings.
  await expect(popupNormal()).toHaveCount(0);
  await expect(normal()).toHaveCount(2);
  const confirm = page.getByRole('dialog', { name: 'Discard changes?' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(popupLines).toContainText('health-draft');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(normal()).toHaveCount(2);
  // A new draft starts from the saved config: the routers have their status again.
  await openPopup();
  await expect(popupNormal()).toHaveCount(2);
  await expect(popupLines).not.toContainText('health-draft');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(popup).toHaveCount(0);
  expect(
    log.slice(before).filter((r) => r.kind === 'query' || r.kind === 'resource'),
    JSON.stringify(log.slice(before))
  ).toEqual([]);

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
