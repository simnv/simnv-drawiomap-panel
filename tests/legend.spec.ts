import { devices, type APIRequestContext, type Locator } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

/** A copy of the demo dashboard with changed options of the portograph panel (id 1). Returns the uid. */
async function demoCopy(request: APIRequestContext, uid: string, options: Record<string, unknown>) {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const dashboard = { ...demo.dashboard, id: null, uid, title: uid, panels: [] as unknown[] };
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  dashboard.panels = [{ ...panel, options: { ...panel.options, ...options } }];
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  return uid;
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

test('the demo shows the colour legend in the bottom-right corner', async ({ page, gotoDashboardPage }) => {
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = page.getByTestId('dmap-panel').first();
  const legend = panel.getByTestId('dmap-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toHaveAttribute('data-dmap-corner', 'bottom-right');
  await expect(legend.getByRole('group', { name: /^Link load %/ }).first()).toBeVisible();
  const p = await box(panel);
  const l = await box(legend);
  expect(p.x + p.width - (l.x + l.width)).toBeLessThan(12);
  expect(p.y + p.height - (l.y + l.height)).toBeLessThan(12);
});

test('hovering a legend entry highlights the cells in that band', async ({ page, gotoDashboardPage }) => {
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = page.getByTestId('dmap-panel').first();
  const block = panel.getByTestId('dmap-legend').getByRole('group', { name: 'Link load % (A)' });
  // the first threshold entry that has cells now
  const entries = block.getByTestId('dmap-legend-entry');
  await expect(entries.first()).toBeVisible();
  const labels = await entries.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!));
  const index = labels.findIndex((l) => !l.endsWith(': 0 elements'));
  expect(index).toBeGreaterThanOrEqual(0);
  const entry = entries.nth(index);
  const swatch = await entry.locator('[data-dmap-swatch]').evaluate((el) => getComputedStyle(el).backgroundColor);
  await entry.hover();
  await expect(panel.locator('svg.dmap-legend-active')).toHaveCount(1);
  const hits = panel.locator('g.dmap-legend-hit[data-cell-id^="pg-link~"]');
  const count = Number(/: (\d+) elements?$/.exec(labels[index])![1]);
  await expect(hits).toHaveCount(count);
  // each highlighted link has a half in the colour of the swatch
  const colours = await hits.evaluateAll((groups) =>
    groups.map((g) => Array.from(g.querySelectorAll('polyline.dmap-half'), (h) => getComputedStyle(h).stroke))
  );
  for (const halves of colours) {
    expect(halves).toContain(swatch);
  }
  // the other cells of the legend dim
  const other = panel.locator('g.dmap-legend-member:not(.dmap-legend-hit)').first();
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.2');
  await page.mouse.move(0, 0);
  await expect(panel.locator('svg.dmap-legend-active')).toHaveCount(0);
  await expect(panel.locator('.dmap-legend-hit')).toHaveCount(0);
});

test('the legend stays in its corner when the diagram zooms and the stage scrolls', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await demoCopy(request, `legend-fixed-${testInfo.workerIndex}-${Date.now()}`, {
    zoom: { mode: 'custom', percent: 250, wheel: true, pan: true },
  });
  try {
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel');
    const legend = panel.getByTestId('dmap-legend');
    await expect(legend).toBeVisible();
    const before = await box(legend);
    const stage = panel.getByTestId('dmap-stage');
    await stage.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    });
    await expect.poll(() => stage.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await box(legend)).toEqual(before);
    const s = await box(stage);
    await page.mouse.move(s.x + s.width / 3, s.y + s.height / 3);
    await page.mouse.wheel(0, -300);
    await expect(panel.getByTestId('dmap-reset-zoom')).toBeVisible();
    expect(await box(legend)).toEqual(before);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('legend.show false hides the legend', async ({ page, request, gotoDashboardPage }, testInfo) => {
  const uid = await demoCopy(request, `legend-off-${testInfo.workerIndex}-${Date.now()}`, {
    legend: { show: false },
  });
  try {
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel');
    await expect(panel.locator('polyline.dmap-half').first()).toBeAttached();
    await expect(panel.getByTestId('dmap-legend')).toHaveCount(0);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test.describe('legend on a phone', () => {
  test.use(iPhone);

  test('is a closed Legend chip that a tap opens', async ({ page, request, gotoDashboardPage }, testInfo) => {
    const uid = await demoCopy(request, `legend-phone-${testInfo.workerIndex}-${Date.now()}`, {});
    try {
      await gotoDashboardPage({ uid });
      const legend = page.getByTestId('dmap-panel').getByTestId('dmap-legend');
      const chip = legend.getByRole('button', { name: 'Legend' });
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
      await expect(legend.getByTestId('dmap-legend-block')).toHaveCount(0);
      await chip.tap();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await expect(legend.getByTestId('dmap-legend-block').first()).toBeVisible();
      // a tap on the legend opens no card
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await request.delete(`/api/dashboards/uid/${uid}`);
    }
  });
});
