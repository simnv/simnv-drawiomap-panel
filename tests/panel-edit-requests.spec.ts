import type { Page, Request } from '@playwright/test';
import type { DiagramConfigV2 } from '../src/model/config';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';
import { openBindingsPopup, popupInspector, selectStageCell } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

/**
 * Entering panel edit and opening the bindings popup must not run the diagram queries again (Grafana does not run the
 * panel's own queries then either), must not call datasource resources, and must show no error toast. Cancel closes
 * the popup. Regression for the "refresh on panel edit" and "Cancel does nothing" reports.
 */

/** Three fictional devices with one health query each: scalar bindings whose resolution does not follow the width. */
function statusConfig(config: DiagramConfigV2): DiagramConfigV2 {
  const queries = ['device-1', 'device-2', 'link-1'].map((id) => nativeQuery(`health-${id}`, 'vector(1)'));
  return {
    ...config,
    queries,
    patterns: [],
    widgets: [],
    overrides: queries.map((query, i) => ({
      cellId: ['device-1', 'device-2', 'link-1'][i],
      display: {
        label: 'Saved ${value}',
        status: {
          kind: 'mapping',
          binding: binding(query.id),
          default: { state: 'normal', reason: 'Healthy' },
          mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
        },
      },
    })),
  };
}

/** The API requests of the page: the diagram queries, the Grafana panel queries and the datasource resource calls. */
function observeApi(page: Page) {
  const log: Array<{ kind: 'diagram' | 'panel' | 'resource' | 'other'; method: string; path: string }> = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.includes('/api/')) {
      return;
    }
    const path = url.pathname + url.search;
    const kind = path.includes('/api/ds/query')
      ? path.includes('requestId=drawiomap-')
        ? 'diagram'
        : 'panel'
      : path.includes('/resources/')
        ? 'resource'
        : 'other';
    log.push({ kind, method: request.method(), path });
  });
  return log;
}

test('panel edit and the popup run no diagram query again, call no datasource resource, and Cancel closes', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(statusConfig(config));
  const log = observeApi(page);
  const toasts = page.getByRole('alert');
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await expect(panel.locator('[data-dmap-status="normal"]')).toHaveCount(3);
  await expect.poll(() => log.filter((r) => r.kind === 'diagram').length).toBe(3);
  await page.waitForTimeout(2000);
  const before = log.length;

  // Enter panel edit in the app, as the panel menu does: the panel component mounts again in the editor.
  await panel.hover();
  await page.keyboard.press('e');
  await page.waitForURL(/editPanel=1/);
  await expect(page.getByTestId('dmap-edit-bindings')).toBeVisible();
  await expect(page.getByTestId('dmap-panel').locator('[data-dmap-status="normal"]')).toHaveCount(3);
  await page.waitForTimeout(5000);
  const afterEdit = log.slice(before);
  expect(
    afterEdit.filter((r) => r.kind === 'diagram'),
    JSON.stringify(afterEdit)
  ).toEqual([]);
  expect(
    afterEdit.filter((r) => r.kind === 'resource'),
    JSON.stringify(afterEdit)
  ).toEqual([]);
  await expect(toasts).toHaveCount(0);

  // The popup shares the panel cache: its draft bindings add no request.
  const dialog = await openBindingsPopup(page);
  await expect(dialog.getByTestId('dmap-popup-stage').locator('[data-dmap-status="normal"]')).toHaveCount(3);
  await page.waitForTimeout(3000);
  const afterPopup = log.slice(before);
  expect(
    afterPopup.filter((r) => r.kind === 'diagram' || r.kind === 'resource'),
    JSON.stringify(afterPopup)
  ).toEqual([]);
  await expect(toasts).toHaveCount(0);

  // Cancel closes a clean draft at once.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // With a dirty draft, Cancel asks first; Keep editing stays, Discard closes. Discard keeps the popup open.
  const again = await openBindingsPopup(page);
  await selectStageCell(again, 'device-1');
  const label = popupInspector(again).getByRole('textbox', { name: 'Label template', exact: true });
  await label.fill('Draft ${value}');
  await again.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(again).toBeVisible();
  await again.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(again).toBeVisible();
  await expect(label).toHaveValue('Saved ${value}');
  await label.fill('Draft ${value}');
  await again.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('dmap-panel').locator('[data-dmap-status="normal"]')).toHaveCount(3);
});
