import type { APIRequestContext, Locator } from '@playwright/test';
import type { ConfigV4 } from '../src/model/v4';
import { expect, test } from './authoring-fixtures';

/**
 * The legend, the last data timestamp and the warning badge stay in the part of the panel that the page shows. The
 * scroll container and the bars over it differ between Grafana versions (an inner scroll element below sticky
 * controls in 13, the page below a fixed header in 12), so this spec runs in the matrix: @matrix.
 */

/** The item shows: a hit test at its middle finds the item, not a bar of Grafana or nothing. */
async function shown(item: Locator) {
  await expect
    .poll(() =>
      item.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.height > 0 && r.bottom <= innerHeight && !!hit && el.contains(hit);
      })
    )
    .toBe(true);
}

test.use({ viewport: { width: 1280, height: 560 } });

test('@matrix the legend and the timestamp stay in view when the bottom of the panel is below the view', async ({
  gotoDashboardPage,
}) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = (await dashboardPage.getPanelByTitle('demo-lab L3')).locator;
  const wrapper = panel.getByTestId('dmap-panel');
  await expect(wrapper).toHaveAttribute('data-dmap-patched', /[1-9]/);
  // the panel is taller than the view: its bottom edge is out of view
  expect(await wrapper.evaluate((el) => el.getBoundingClientRect().bottom > innerHeight)).toBe(true);
  await shown(panel.getByTestId('dmap-legend'));
  await shown(panel.getByTestId('dmap-last-data'));
});

/** A copy of the demo dashboard with one tall map panel that has a warning (an override of a cell the diagram lacks). */
async function tallWarningDashboard(request: APIRequestContext, uid: string) {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  const config: ConfigV4 = panel.options.config;
  const dashboard = {
    ...demo.dashboard,
    id: null,
    uid,
    title: uid,
    refresh: '',
    panels: [
      {
        ...panel,
        title: 'tall',
        gridPos: { x: 0, y: 0, w: 24, h: 26 },
        options: { ...panel.options, config: { ...config, overrides: { ...config.overrides, 'pg-node~gone': {} } } },
      },
    ],
  };
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
}

test('@matrix the warning badge stays in view when the top of the panel is scrolled out of view', async ({
  gotoDashboardPage,
  page,
  request,
}, testInfo) => {
  const uid = `follow-${testInfo.workerIndex}-${Date.now()}`;
  await tallWarningDashboard(request, uid);
  try {
    await gotoDashboardPage({ uid });
    const wrapper = page.getByTestId('dmap-panel');
    const badge = wrapper.getByTestId('dmap-warning-badge');
    await expect(badge).toBeVisible();
    const top = () => wrapper.evaluate((el) => el.getBoundingClientRect().top);
    const start = await top();
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    // the top of the panel and its badge place are now above the visible area (below the Grafana bars)
    await expect.poll(top).toBeLessThan(start - 250);
    await shown(badge);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});
