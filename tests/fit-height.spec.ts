import { expect, test } from './authoring-fixtures';

// The button writes the dashboard grid through the scene objects of Grafana, which differ between versions: @matrix.
test(
  'Fit height in dashboard edit makes the panel lower to the diagram and saves',
  { tag: '@matrix' },
  async ({ page, request, config, createDiagram, gotoDashboardPage, selectors }) => {
    const uid = await createDiagram(config, { height: 24 });
    const dashboardPage = await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel');
    await expect(panel.locator('[data-dmap-chart] canvas')).toBeVisible();
    // view mode: no control
    await expect(panel.getByTestId('dmap-fit-height')).toHaveCount(0);
    await dashboardPage.getByGrafanaSelector(selectors.components.NavToolbar.editDashboard.editButton).click();
    const fit = panel.getByTestId('dmap-fit-height');
    await expect(fit).toBeVisible();
    const before = (await panel.boundingBox())!.height;
    if (process.env.DMAP_SCREENSHOTS) {
      await panel.screenshot({ path: `${process.env.DMAP_SCREENSHOTS}/fit-height.png` });
    }
    await fit.click();
    // the diagram fits: no free row is left, and the panel is lower
    await expect(fit).toHaveCount(0);
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(before - 38);
    await page.getByRole('button', { name: /^(Save dashboard|Save)$/i }).click();
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() !== 'GET' &&
        r.ok() &&
        (new URL(r.url()).pathname.endsWith('/api/dashboards/db') || r.url().includes('/apis/dashboard.grafana.app/'))
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Save$/ })
      .click();
    await saved;
    const json = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
    const h = json.dashboard.panels[0].gridPos.h;
    expect(h).toBeLessThan(24);
    expect(h).toBeGreaterThanOrEqual(2);
  }
);
