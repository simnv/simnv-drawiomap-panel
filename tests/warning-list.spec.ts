import { expect, test } from './authoring-fixtures';

/**
 * The warning badge: the hover tooltip shows one short line for each warning, and a click pins the list, where a line
 * opens its details. A query that no cell uses and that fails gives a warning too.
 */
test('a click on the badge pins the warnings; a failed query that no cell uses shows with its details', async ({
  gotoDashboardPage,
  page,
  request,
}, testInfo) => {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  const uid = `wlist-${testInfo.workerIndex}-${Date.now()}`;
  const dashboard = {
    ...demo.dashboard,
    id: null,
    uid,
    title: uid,
    refresh: '',
    panels: [
      {
        ...panel,
        gridPos: { x: 0, y: 0, w: 24, h: 18 },
        // a query that no class uses, with a query text that the datasource rejects
        targets: [...panel.targets, { ...panel.targets[0], refId: 'broken', expr: 'rate(up[5m]' }],
      },
    ],
  };
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoDashboardPage({ uid });
    const badge = page.getByTestId('dmap-warning-badge');
    await expect(badge).toBeVisible();
    await badge.hover();
    const tip = page.getByTestId('dmap-warning-tooltip');
    await expect(tip).toContainText(/VictoriaMetrics rejects the query \(check the query text\): 1 query fails/);
    await expect(tip).toContainText('Click or press Enter for details');
    // the short line only: no query text in the tooltip
    await expect(tip).not.toContainText('rate(up[5m]');

    await badge.click();
    await expect(tip).toHaveCount(0);
    const list = page.getByRole('dialog', { name: '1 warning' });
    await expect(list).toBeVisible();
    const toggle = list.getByRole('button', { name: /rejects the query/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(list.getByTestId('dmap-warning-details')).toContainText('• broken (not used): rate(up[5m]');
    await expect(list.getByTestId('dmap-warning-details')).toContainText('Error:');
    // a click inside the list does not close it; Esc does
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(badge).toBeFocused();
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});
