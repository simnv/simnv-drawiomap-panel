import { devices, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator) => (await locator.boundingBox())!;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.width <= b.x + b.width + 0.5 &&
  a.y + a.height <= b.y + b.height + 0.5;
// The screenshots show the timestamp in the browser time zone: a fixed zone keeps the zone of the test machine out.
test.use({ timezoneId: 'Europe/Berlin' });
const STAMP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d$/;

/** A copy of the demo dashboard with changed options of the portograph panel (id 1). Returns the uid. */
async function demoCopy(
  request: APIRequestContext,
  uid: string,
  options: Record<string, unknown>,
  gridPos?: { x: number; y: number; w: number; h: number }
) {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const dashboard = { ...demo.dashboard, id: null, uid, title: uid, refresh: '', panels: [] as unknown[] };
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  dashboard.panels = [{ ...panel, ...(gridPos ? { gridPos } : {}), options: { ...panel.options, ...options } }];
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  return uid;
}

/** The timestamp and the legend of the panel do not overlap, and both are inside the panel. */
async function apart(page: Page) {
  const panel = page.getByTestId('dmap-panel').first();
  const stamp = panel.getByTestId('dmap-last-data');
  const legend = panel.getByTestId('dmap-legend');
  await expect(stamp).toHaveText(STAMP);
  await expect(stamp).toBeVisible();
  await expect(legend).toBeVisible();
  // the stamp follows the legend size in the next frame
  await expect.poll(async () => overlaps(await box(stamp), await box(legend))).toBe(false);
  const p = await box(panel);
  expect(inside(await box(stamp), p), 'timestamp inside the panel').toBe(true);
  expect(inside(await box(legend), p), 'legend inside the panel').toBe(true);
  return { panel, stamp, legend };
}

test('the last data timestamp stands left of the bottom-right legend; its tooltip says what it is', async ({
  page,
  gotoDashboardPage,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const { panel, stamp, legend } = await apart(page);
  // one row: the stamp ends left of the chip, and both stand on the bottom edge of the panel
  const s = await box(stamp);
  const l = await box(legend);
  expect(s.x + s.width).toBeLessThanOrEqual(l.x);
  expect(l.x - (s.x + s.width)).toBeLessThan(8);
  expect(Math.abs(s.y + s.height - (l.y + l.height))).toBeLessThan(1);
  // the stamp does not take the pointer from the diagram outside its own box
  expect(await stamp.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');

  await stamp.hover();
  const tooltip = page.getByTestId('dmap-last-data-tooltip');
  await expect(tooltip).toBeVisible();
  const text = (await stamp.textContent())!;
  await expect(tooltip).toHaveText(new RegExp(`^Last data timestamp: ${text.replace('+', '\\+')} \\(.+, .+ ago\\)$`));
  expect(overlaps(await box(tooltip), await box(stamp))).toBe(false);
  if (process.env.DMAP_SCREENSHOTS) {
    const p = await box(panel);
    const t = await box(tooltip);
    // the bottom-right part of the panel and the tooltip (below or above the timestamp)
    const top = Math.min(t.y, p.y + p.height - 200) - 8;
    const bottom = Math.max(t.y + t.height, p.y + p.height) + 8;
    const left = Math.min(t.x, p.x + p.width - 480) - 8;
    const clip = { x: left, y: top, width: p.x + p.width + 4 - left, height: bottom - top };
    await page.screenshot({ path: 'local/timestamp-legend.png', clip });
    await page.screenshot({ path: 'docs/images/last-data-timestamp.png', clip });
  }
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);

  // an open legend is wider: the stamp moves left with it
  await legend.getByRole('button', { name: 'Legend' }).click();
  await apart(page);
});

test('the timestamp takes the bottom-right corner when the legend is at a top corner', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await demoCopy(request, `last-data-top-${testInfo.workerIndex}-${Date.now()}`, {
    legend: { show: true, corner: 'top-right', collapsed: false },
  });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDashboardPage({ uid });
    const { panel, stamp } = await apart(page);
    const p = await box(panel);
    const s = await box(stamp);
    expect(p.x + p.width - (s.x + s.width)).toBeLessThan(8);
    expect(p.y + p.height - (s.y + s.height)).toBeLessThan(8);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('the timestamp and an open legend do not overlap in a narrow panel', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await demoCopy(request, `last-data-narrow-${testInfo.workerIndex}-${Date.now()}`, {
    legend: { show: true, corner: 'bottom-right', collapsed: false },
  });
  try {
    // below 769 px Grafana stacks the panels at the full width; the grid reflows live (see the next test)
    await gotoDashboardPage({ uid });
    for (const width of [1280, 700, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await apart(page);
    }
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('a hidden legend lets a narrow timestamp wrap, then hide when neither line fits', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await demoCopy(
    request,
    `last-data-wrap-${testInfo.workerIndex}-${Date.now()}`,
    {
      legend: { show: false },
    },
    { x: 0, y: 0, w: 4, h: 6 }
  );
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel').first();
    const stamp = panel.getByTestId('dmap-last-data');
    await expect(stamp).toBeVisible();
    await expect(stamp).toHaveText(STAMP);
    await expect.poll(async () => inside(await box(stamp), await box(panel))).toBe(true);
    expect((await box(stamp)).height).toBeGreaterThan(28);
    if (process.env.DMAP_SCREENSHOTS) {
      await stamp.screenshot({ path: 'local/ux-fixes-timestamp-wrap.png' });
    }
    // Two grid columns cannot hold the time and offset, even on separate lines.
    await demoCopy(request, uid, { legend: { show: false } }, { x: 0, y: 0, w: 2, h: 6 });
    await gotoDashboardPage({ uid });
    await expect(stamp).toBeHidden();
    // Grafana stacks the panel at this viewport width. The hidden timestamp must recover after the resize.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(stamp).toBeVisible();
    expect((await box(stamp)).height).toBe(28);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('a short panel keeps the expanded legend inside and hides a timestamp with no room', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await demoCopy(
    request,
    `last-data-short-${testInfo.workerIndex}-${Date.now()}`,
    {
      legend: { show: true, corner: 'bottom-right', collapsed: false },
    },
    { x: 0, y: 0, w: 8, h: 2 }
  );
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel').first();
    const legend = panel.getByTestId('dmap-legend');
    await expect(legend).toBeVisible();
    await expect.poll(async () => inside(await box(legend), await box(panel))).toBe(true);
    await expect(panel.getByTestId('dmap-last-data')).toBeHidden();
    if (process.env.DMAP_SCREENSHOTS) {
      await panel.screenshot({ path: 'local/ux-fixes-short-panel.png' });
    }
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('a short panel wraps the timestamp beside an expanded legend when two lines fit', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  const uid = await demoCopy(
    request,
    `last-data-side-wrap-${testInfo.workerIndex}-${Date.now()}`,
    { legend: { show: true, corner: 'bottom-right', collapsed: false } },
    { x: 0, y: 0, w: 10, h: 3 }
  );
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDashboardPage({ uid });
    const { stamp } = await apart(page);
    expect((await box(stamp)).height).toBeGreaterThan(28);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test.describe('the timestamp on a phone', () => {
  test.use(iPhone);

  test('does not overlap the open or closed legend; a tap shows its tooltip', async ({
    page,
    request,
    gotoDashboardPage,
  }, testInfo) => {
    const uid = await demoCopy(request, `last-data-phone-${testInfo.workerIndex}-${Date.now()}`, {
      legend: { show: true, corner: 'bottom-left', collapsed: true },
    });
    try {
      await gotoDashboardPage({ uid });
      const { stamp, legend } = await apart(page);
      await legend.getByRole('button', { name: 'Legend' }).tap();
      await expect(legend.getByRole('button', { name: 'Legend' })).toHaveAttribute('aria-expanded', 'true');
      await apart(page);
      await stamp.tap();
      await expect(page.getByTestId('dmap-last-data-tooltip')).toContainText('Last data timestamp: ');
      // the tap opens no card
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await request.delete(`/api/dashboards/uid/${uid}`);
    }
  });
});
