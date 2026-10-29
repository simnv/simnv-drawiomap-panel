import { devices, type APIRequestContext, type Locator } from '@playwright/test';
import fs from 'node:fs';
import { expect, test } from './authoring-fixtures';

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];
/** The number of panels of the demo dashboard: all of them are drawiomap panels. */
const DEMO_PANELS: number = JSON.parse(fs.readFileSync('provisioning/dashboards/demo.json', 'utf8')).panels.length;

/** A copy of the demo dashboard with changed options of the portograph panel (id 1). Returns the uid. */
async function demoCopy(request: APIRequestContext, uid: string, options: Record<string, unknown>) {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const dashboard = { ...demo.dashboard, id: null, uid, title: uid, refresh: '', panels: [] as unknown[] };
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  dashboard.panels = [{ ...panel, options: { ...panel.options, ...options } }];
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  return uid;
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

const openLegend = async (legend: Locator) => {
  const handle = legend.getByRole('button', { name: 'Legend' });
  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  return handle;
};

test('the demo shows the colour legend in the bottom-right corner', async ({ page, gotoDashboardPage }) => {
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = page.getByTestId('dmap-panel').first();
  const legend = panel.getByTestId('dmap-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toHaveAttribute('data-dmap-corner', 'bottom-right');
  await openLegend(legend);
  await expect(legend.getByRole('group', { name: /^Link load %/ }).first()).toBeVisible();
  // the title is the query (refId), not the legend format of one series ("node-net-a")
  const status = legend.getByRole('group', { name: 'up', exact: true });
  for (const [text, color] of [
    ['< 1.0', 'rgb(242, 73, 92)'],
    ['≥ 1.0', 'rgb(115, 191, 105)'],
  ]) {
    const entry = status.getByTestId('dmap-legend-entry').filter({ hasText: text });
    await expect(entry).toHaveText(text);
    await expect(entry.locator('[data-dmap-swatch]')).toHaveCSS('background-color', color);
  }
  const p = await box(panel);
  const l = await box(legend);
  expect(p.x + p.width - (l.x + l.width)).toBeLessThan(12);
  expect(p.y + p.height - (l.y + l.height)).toBeLessThan(12);
});

test('blocks with the same content merge: one title for both queries, one highlight for their cells', async ({
  page,
  request,
  gotoDashboardPage,
}, testInfo) => {
  // The router nodes take their status from `up_b`, a copy of `up` with the same field config.
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const panel = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  const up = panel.targets.find((t: { refId: string }) => t.refId === 'up');
  type Override = { matcher: { id: string; options: string } };
  const upOverrides = panel.fieldConfig.overrides.filter((o: Override) => o.matcher.options === 'up');
  const config = panel.options.config;
  const uid = `legend-merge-${testInfo.workerIndex}-${Date.now()}`;
  const dashboard = {
    ...demo.dashboard,
    id: null,
    uid,
    title: uid,
    refresh: '',
    panels: [
      {
        ...panel,
        targets: [...panel.targets, { ...up, refId: 'up_b' }],
        fieldConfig: {
          ...panel.fieldConfig,
          overrides: [
            ...panel.fieldConfig.overrides,
            ...upOverrides.map((o: Override) => ({ ...o, matcher: { ...o.matcher, options: 'up_b' } })),
          ],
        },
        options: {
          ...panel.options,
          legend: { show: true, corner: 'bottom-right', collapsed: false },
          config: {
            ...config,
            classes: { ...config.classes, 'router-cpu': { ...config.classes['router-cpu'], status: 'up_b' } },
          },
        },
      },
    ],
  };
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDashboardPage({ uid });
    const view = page.getByTestId('dmap-panel');
    const legend = view.getByTestId('dmap-legend');
    const merged = legend.getByRole('group', { name: /^(up · up_b|up_b · up)$/ });
    await expect(merged).toBeVisible();
    await expect(legend.getByRole('group', { name: 'up', exact: true })).toHaveCount(0);
    await expect(legend.getByRole('group', { name: 'up_b', exact: true })).toHaveCount(0);
    await expect(legend).not.toContainText(/\+\d+ more/);
    // the entry of the up value holds the cells of both queries: routers (up_b) and the other nodes (up)
    const entry = merged.getByTestId('dmap-legend-entry').filter({ hasText: '≥ 1.0' });
    const count = Number(/: (\d+) elements?$/.exec((await entry.getAttribute('aria-label'))!)![1]);
    await entry.hover();
    const hits = view.locator('g.dmap-legend-hit[data-cell-id^="pg-node~"]');
    await expect(hits).toHaveCount(count);
    const ids = await hits.evaluateAll((els) => els.map((e) => e.getAttribute('data-cell-id')!));
    expect(ids.some((id) => id.startsWith('pg-node~rtr-'))).toBe(true);
    expect(ids.some((id) => !id.startsWith('pg-node~rtr-'))).toBe(true);
    if (process.env.DMAP_SCREENSHOTS) {
      await legend.screenshot({ path: 'local/legend-merged.png' });
    }
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('hovering a legend entry highlights the cells in that band', async ({ page, gotoDashboardPage }) => {
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = page.getByTestId('dmap-panel').first();
  await openLegend(panel.getByTestId('dmap-legend'));
  const block = panel.getByTestId('dmap-legend').getByRole('group', { name: /^Link load % \(lan_rx, lan_tx\)$/ });
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

test('hovering a legend row of the diagram highlights the nodes of that symbol', async ({
  page,
  gotoDashboardPage,
}, testInfo) => {
  await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = page.getByTestId('dmap-panel').first();
  const row = panel.locator('g[data-cell-id="pg-legendSwatch~symbol:proxy"]');
  await row.scrollIntoViewIfNeeded();
  await row.hover({ force: true });
  await expect(panel.locator('svg.dmap-legend-active')).toHaveCount(1);
  const hits = panel.locator('g.dmap-legend-hit[data-cell-id^="pg-node~"]');
  await expect(hits).toHaveCount(2);
  await expect(hits.first()).toHaveAttribute('data-meta-pg-symbol', 'proxy');
  const other = panel.locator('g.dmap-legend-member:not(.dmap-legend-hit)[data-cell-id^="pg-node~"]').first();
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.2');
  await page.screenshot({ path: testInfo.outputPath('legend-row-hover.png') });
  await page.mouse.move(0, 0);
  await expect(panel.locator('svg.dmap-legend-active')).toHaveCount(0);
  await expect(panel.locator('.dmap-legend-hit, .dmap-legend-member')).toHaveCount(0);
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

const inside = (inner: { x: number; y: number; width: number; height: number }, outer: typeof inner) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

// The demo panel is taller than the default viewport: the mouse needs the whole panel on the screen.
test.describe('legend drag', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('a drag moves the legend inside the panel and does not toggle it, pan or open a card', async ({
    page,
    gotoDashboardPage,
  }) => {
    await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = page.getByTestId('dmap-panel').first();
    const legend = panel.getByTestId('dmap-legend');
    const handle = legend.getByRole('button', { name: 'Legend' });
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => inside(await box(legend), await box(panel))).toBe(true);
    const viewBox = await panel.locator('svg').first().getAttribute('viewBox');
    const before = await box(legend);
    const h = await box(handle);
    const p = await box(panel);
    // to the middle of the diagram
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 8 });
    await page.mouse.up();
    const moved = await box(legend);
    expect(moved.x).toBeLessThan(before.x - 50);
    expect(moved.y).toBeLessThan(before.y - 50);
    expect(inside(moved, p)).toBe(true);
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await panel.locator('svg').first().getAttribute('viewBox')).toBe(viewBox);
    await expect(panel.getByTestId('dmap-reset-zoom')).toHaveCount(0);
    // far outside the panel: it stops at the edge
    const h2 = await box(handle);
    await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
    await page.mouse.down();
    // beyond the top-right corner of the panel, but still on the screen
    await page.mouse.move(1279, 1, { steps: 8 });
    await page.mouse.up();
    const edge = await box(legend);
    const q = await box(panel);
    expect(inside(edge, q)).toBe(true);
    expect(edge.x + edge.width).toBeGreaterThan(q.x + q.width - 1);
    expect(edge.y).toBeLessThan(q.y + 1);
    // arrow keys move it by 10 px, Shift by 50 px; a click still toggles
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    expect((await box(legend)).x).toBeCloseTo(edge.x - 10, 0);
    await page.keyboard.press('Shift+ArrowDown');
    expect((await box(legend)).y).toBeCloseTo(edge.y + 50, 0);
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    // an open legend that grows at the panel edge stays inside
    expect(inside(await box(legend), await box(panel))).toBe(true);
    await handle.dblclick();
    // the corner is bottom-right: the right edge is back (the two clicks of the double click toggle twice)
    await expect
      .poll(async () => {
        const l = await box(legend);
        return l.x + l.width;
      })
      .toBeCloseTo(before.x + before.width, 0);
  });
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
      // only the handle takes the touches: a finger on the rest of the page still scrolls
      await expect(chip).toHaveCSS('touch-action', 'none');
      await expect(legend).not.toHaveCSS('touch-action', 'none');
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

test.describe('legend taps across panels', () => {
  test.use(iPhone);

  // Legend.test.tsx covers the hand-over of one tapped highlight to the next legend; here two real panels share a page.
  test('a tap on an entry of panel B ends the highlight that a tap in panel A started', async ({
    page,
    gotoDashboardPage,
  }) => {
    // Grafana mounts a panel below the fold when it scrolls into view: a tall viewport shows all panels of the demo
    await page.setViewportSize({ width: 390, height: 2400 });
    await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const [a, b] = [page.getByTestId('dmap-panel').nth(0), page.getByTestId('dmap-panel').nth(1)];
    await expect(page.getByTestId('dmap-panel')).toHaveCount(DEMO_PANELS);
    const tapEntry = async (panel: Locator) => {
      await panel.getByTestId('dmap-legend').getByRole('button', { name: 'Legend' }).tap();
      const entries = panel.getByTestId('dmap-legend').getByTestId('dmap-legend-entry');
      await expect(entries.first()).toBeVisible();
      const labels = await entries.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!));
      const index = labels.findIndex((l) => !l.endsWith(': 0 elements'));
      expect(index).toBeGreaterThanOrEqual(0);
      await entries.nth(index).tap();
    };
    await tapEntry(a);
    await expect(a.locator('svg.dmap-legend-active')).toHaveCount(1);
    await tapEntry(b);
    await expect(b.locator('svg.dmap-legend-active')).toHaveCount(1);
    await expect(a.locator('svg.dmap-legend-active')).toHaveCount(0);
    await expect(a.locator('.dmap-legend-hit')).toHaveCount(0);
  });
});
