import { expect, test } from '@grafana/plugin-e2e';

test('clicking a link opens a menu with the rule url and the field link', async ({ gotoDashboardPage, page }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const half = panel.locator.locator(
    'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~wan1:pppoe->rtr-a:wan1"]'
  );
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await half.click({ force: true });
  const rule = page.getByRole('menuitem', { name: 'links' });
  await expect(rule).toBeVisible();
  await expect(rule).toHaveAttribute('href', /var-job=node-wan1&var-device=pppoe/);
  await expect(page.getByRole('menuitem', { name: 'Field link' })).toBeVisible();
  // switching cells replaces the items
  await page.keyboard.press('Escape');
  await panel.locator
    .locator('polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~wan2:dhcp->rtr-a:wan2"]')
    .click({ force: true });
  await expect(page.getByRole('menuitem', { name: 'links' })).toHaveAttribute(
    'href',
    /var-job=node-wan2&var-device=dhcp/
  );
});

test('hovering shows the tooltip with both directions', async ({ gotoDashboardPage, page }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const half = panel.locator.locator(
    'polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="pg-link~wan2:dhcp->rtr-a:wan2"]'
  );
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await half.hover({ force: true });
  await expect(page.getByTestId('dmap-tooltip')).toContainText('A→B');
  await expect(page.getByTestId('dmap-tooltip')).toContainText('90%');
});
