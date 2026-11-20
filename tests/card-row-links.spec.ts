import fs from 'node:fs';
import type { Page } from '@playwright/test';
import type { ConfigV4, RowV4 } from '../src/model/v4';
import { demoConfigV4 } from '../src/fixtures/demo-config';
import { expect, promTarget, test, type PanelTarget } from './authoring-fixtures';

/*
 * The link of a card row (`url` and `newTab` on a row): in a pinned card a click anywhere on the row, or Enter on it,
 * opens the link. The demo L3 sheet with the demo panel queries; the `router-cpu` class gets row links.
 */

const demoSvg = fs.readFileSync('fixtures/demo/svg/demo-l3.svg', 'utf8');
const demoPanel: { targets: PanelTarget[]; fieldConfig: { defaults: Record<string, unknown>; overrides: unknown[] } } =
  JSON.parse(fs.readFileSync('provisioning/dashboards/demo.json', 'utf8')).panels[0];

/** The demo config; the CPU row opens a new tab, the load row the current tab, the state row has no link. */
function rowLinkConfig(): ConfigV4 {
  const config = structuredClone(demoConfigV4);
  const rows = config.classes['router-cpu'].rows as RowV4[];
  config.classes['router-cpu'].rows = rows.map((row): RowV4 => {
    if (row.kind === 'history' && row.label === 'CPU') {
      return { ...row, url: '/d/drawiomap-demo?var-job=${key}&var-metric=row-cpu' };
    }
    if (row.kind === 'history' && row.label === 'load 1m') {
      return { ...row, url: '/d/drawiomap-demo?var-job=${key}&var-metric=row-load', newTab: false };
    }
    return row;
  });
  return config;
}

/** Opens a new tab with a click or a key, and checks its URL. */
async function opensPopup(page: Page, action: () => Promise<void>, url: RegExp) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), action()]);
  await popup.waitForURL(url);
  await popup.close();
}

test('a click on the label, the value or the chart of a pinned card row, or Enter on it, opens the row link', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
  page,
}) => {
  const prom = await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' });
  const datasource = { uid: prom.uid, type: prom.type };
  const uid = await createDiagram(rowLinkConfig(), {
    panels: [{ config: rowLinkConfig(), svg: demoSvg, title: 'row links L3' }],
    targets: demoPanel.targets.map((t) => promTarget(t.refId, String(t.expr), { ...t, datasource })),
    fieldConfig: demoPanel.fieldConfig,
  });
  const dashboardPage = await gotoDashboardPage({ uid });
  const panel = (await dashboardPage.getPanelByTitle('row links L3')).locator;
  const node = panel.locator('[data-cell-id="pg-node~rtr-a"]');
  await expect(node).toHaveAttribute('data-dmap-status', 'normal');
  // the group box is too big (the foreignObject label has width and height 100%), so click the node shape
  await node.locator('rect').first().click({ force: true });
  const dialog = panel.getByRole('dialog');
  const cpu = dialog.getByRole('link', { name: /^Open CPU/ });
  await expect(cpu).toHaveAttribute('href', /var-job=node-rtr-a&var-metric=row-cpu/);
  await expect(cpu).toHaveAttribute('target', '_blank');
  await expect(cpu).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(cpu).toHaveAttribute('draggable', 'false');
  await expect(cpu.getByTestId('dmap-card-spark')).toBeVisible();
  const cpuUrl = /\/d\/drawiomap-demo.*var-job=node-rtr-a&var-metric=row-cpu/;
  await opensPopup(page, () => cpu.getByTestId('dmap-card-title').click(), cpuUrl);
  await opensPopup(page, () => cpu.getByTestId('dmap-card-value').click(), cpuUrl);
  await opensPopup(page, () => cpu.getByTestId('dmap-card-spark').click(), cpuUrl);
  // the chart of a linked row is not a Tab stop: Enter on the row opens the link
  await cpu.focus();
  await opensPopup(page, () => page.keyboard.press('Enter'), cpuUrl);
  await expect(dialog).toBeVisible();

  // a row without a url is not a link; the footer keeps its links
  const state = dialog.getByTestId('dmap-card-row').filter({ hasText: 'state' });
  await expect(state).toHaveCount(1);
  expect(await state.evaluate((el) => el.tagName)).toBe('DIV');
  await expect(dialog.getByRole('link', { name: 'CPU details', exact: true })).toBeVisible();

  // newTab: false opens the link in the current tab
  const load = dialog.getByRole('link', { name: /^Open load 1m/ });
  await expect(load).toHaveAttribute('href', /var-metric=row-load/);
  await expect(load).not.toHaveAttribute('target', /.+/);
  await load.getByTestId('dmap-card-title').click();
  await page.waitForURL(/\/d\/drawiomap-demo.*var-job=node-rtr-a&var-metric=row-load/);
});
