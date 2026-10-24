import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { nativeQuery, binding } from '../src/fixtures/authoring-config';
import { expect, test } from './authoring-fixtures';

/**
 * The reset-zoom button sits in the top-left corner. Grafana puts the panel menu button in the top-right corner of a
 * panel (over the content when the panel has no title), so the button must not touch it. The top-left stack is the
 * reset button, the warning badge and the legend (corner top-left), under the status band.
 */

type Box = { x: number; y: number; width: number; height: number };
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const box = async (locator: Locator) => (await locator.boundingBox())!;

/**
 * A copy of the demo dashboard (its legend has colour blocks) with a status band (two nodes without data), a warning
 * (an override of a cell that the diagram does not have). It has one panel for each legend corner, one below the
 * other, so one page load checks all corners. A panel title is `<title> <corner>`, or empty when `title` is empty.
 * Returns the uid.
 */
async function cornerDashboard(request: APIRequestContext, uid: string, title: string, corners: readonly string[]) {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  const config = {
    version: 2,
    defaultDatasource: { uid: 'victoriametrics', type: 'prometheus' },
    queries: [nativeQuery('absent', 'absent(vector(1))')],
    patterns: [],
    widgets: [],
    overrides: [
      ...['pg-node~net-a', 'pg-node~net-b'].map((cellId) => ({
        cellId,
        display: {
          status: {
            kind: 'mapping',
            binding: binding('absent'),
            default: { state: 'normal', reason: 'Healthy' },
            mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
          },
        },
      })),
      { cellId: 'pg-node~gone', display: { enabled: false } },
    ],
  };
  const options = (corner: string) => ({
    ...panel.options,
    config,
    zoom: { mode: 'fit', percent: 100, wheel: false, pan: true, align: 'top' },
    legend: { show: true, corner, maxBlocks: 4 },
  });
  const dashboard = {
    ...demo.dashboard,
    id: null,
    uid,
    title: uid,
    refresh: '',
    panels: corners.map((corner, i) => ({
      ...panel,
      id: i + 1,
      title: title && `${title} ${corner}`,
      gridPos: { x: 0, y: i * 14, w: 24, h: 14 },
      options: options(corner),
    })),
  };
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  return uid;
}

async function zoomIn(page: Page, stage: Locator) {
  const b = await box(stage);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -20);
  }
  await page.keyboard.up('Control');
}

/** The reset button must not touch the panel menu, the band, the badge or the legend in the given corner. */
async function checkCorner(page: Page, index: number, corner: string, title: string) {
  const panel = page.getByTestId('dmap-panel').nth(index);
  const band = panel.getByTestId('dmap-status-band');
  const legend = panel.getByTestId('dmap-legend');
  const badge = panel.getByTestId('dmap-warning-badge');
  const reset = panel.getByRole('button', { name: 'Reset zoom' });
  await expect(band).toBeVisible();
  await expect(legend).toHaveAttribute('data-dmap-corner', corner);
  // the legend starts as a chip: open it, the largest case for the overlap checks
  await legend.getByRole('button', { name: 'Legend' }).click();
  await expect(legend.getByTestId('dmap-legend-block').first()).toBeVisible();
  await expect(badge).toBeVisible();
  const viewBox = () => panel.locator('svg').first().getAttribute('viewBox');
  const base = await viewBox();

  await zoomIn(page, panel.getByTestId('dmap-stage'));
  await expect(reset).toBeVisible();
  // the hover shows the panel menu button of Grafana; the other panels show theirs only on their own hover
  const menu = page.getByRole('button', { name: /^Menu for panel/ }).and(page.locator(':visible'));
  const p = await box(panel);
  await page.mouse.move(p.x + p.width - 60, p.y + 8);
  await expect(menu).toBeVisible();

  const r = await box(reset);
  const m = await box(menu);
  const at = `${corner}, ${title ? 'titled panel' : 'panel without title'}`;
  expect(intersects(r, m), `reset vs panel menu (${at})`).toBe(false);
  expect(intersects(await box(badge), m), `badge vs panel menu (${at})`).toBe(false);
  expect(intersects(await box(legend), m), `legend vs panel menu (${at})`).toBe(false);
  expect(intersects(r, await box(band)), `reset vs band (${at})`).toBe(false);
  expect(intersects(r, await box(badge)), `reset vs badge (${at})`).toBe(false);
  expect(intersects(r, await box(legend)), `reset vs legend (${at})`).toBe(false);
  expect(intersects(await box(badge), await box(legend)), `badge vs legend (${at})`).toBe(false);
  expect(intersects(await box(badge), await box(band)), `badge vs band (${at})`).toBe(false);
  expect(intersects(await box(legend), await box(band)), `legend vs band (${at})`).toBe(false);
  // the top-left corner: inside the panel, below the band, left of the menu
  expect(r.x, at).toBeGreaterThanOrEqual(p.x);
  expect(r.x + r.width, at).toBeLessThan(m.x);
  const b = await box(band);
  expect(r.y, at).toBeGreaterThanOrEqual(b.y + b.height);
  // the panel title area is above the panel: the button stays inside the panel
  expect(r.y, at).toBeGreaterThanOrEqual(p.y);
  if (title) {
    const heading = await box(page.getByRole('heading', { name: `${title} ${corner}` }));
    expect(r.y, at).toBeGreaterThanOrEqual(heading.y + heading.height);
  }
  // a touch target
  expect(r.width, at).toBeGreaterThanOrEqual(32);
  expect(r.height, at).toBeGreaterThanOrEqual(32);
  // the tooltip and the label
  await expect(reset).toHaveAttribute('aria-label', 'Reset zoom');
  await reset.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Reset zoom' })).toBeVisible();

  // it works: a click restores the default view
  await reset.click();
  await expect(reset).toHaveCount(0);
  expect(await viewBox()).toBe(base);
}

// One dashboard with a panel for each legend corner (and one dashboard with titled panels): a page load for each
// corner and title would cost more than the checks.
for (const title of ['', 'Reset corner test']) {
  test(`the reset button clears the panel menu, the band, the badge and the legend in every corner (${title ? 'titled panels' : 'panels without title'})`, async ({
    page,
    request,
    gotoDashboardPage,
  }, testInfo) => {
    const uid = await cornerDashboard(request, `rc-${testInfo.workerIndex}-${Date.now()}`, title, CORNERS);
    try {
      // Grafana mounts a panel below the fold only when it scrolls into view. A tall viewport shows all four at once.
      await page.setViewportSize({ width: 1280, height: 2400 });
      await gotoDashboardPage({ uid });
      for (const [index, corner] of CORNERS.entries()) {
        await test.step(corner, () => checkCorner(page, index, corner, title));
      }
    } finally {
      await request.delete(`/api/dashboards/uid/${uid}`);
    }
  });
}

test('in panel edit the edit-bindings button joins the reset button and the badge in the corner without overlap', async ({
  page,
  request,
  gotoPanelEditPage,
}, testInfo) => {
  const uid = await cornerDashboard(request, `rce-${testInfo.workerIndex}-${Date.now()}`, '', ['bottom-right']);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const panel = page.getByTestId('dmap-panel');
    const badge = panel.getByTestId('dmap-warning-badge');
    const edit = panel.getByTestId('dmap-edit-bindings');
    const reset = panel.getByRole('button', { name: 'Reset zoom' });
    await zoomIn(page, panel.getByTestId('dmap-stage'));
    await expect(reset).toBeVisible();
    await expect(badge).toBeVisible();
    await expect(edit).toBeVisible();
    const [r, b, e] = [await box(reset), await box(badge), await box(edit)];
    expect(intersects(r, b), 'reset vs badge').toBe(false);
    expect(intersects(r, e), 'reset vs edit').toBe(false);
    expect(intersects(b, e), 'badge vs edit').toBe(false);
    // the order of the stack: reset, badge, edit
    expect(b.x).toBeGreaterThan(r.x);
    expect(e.x).toBeGreaterThan(b.x);
    expect(e.width).toBeGreaterThanOrEqual(32);
    expect(e.height).toBeGreaterThanOrEqual(32);
    await edit.hover();
    await expect(page.getByRole('tooltip').filter({ hasText: 'Edit bindings' })).toBeVisible();
    // the badge is a button here and opens the popup on the first problem
    await badge.click();
    await expect(page.getByTestId('dmap-bindings-popup')).toBeVisible();
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});
