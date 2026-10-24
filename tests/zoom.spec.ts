import { devices, type Locator, type Page } from '@playwright/test';
import { type DashboardPage } from '@grafana/plugin-e2e';
import { expect, test } from './authoring-fixtures';

const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there

/** The gaps in px between the diagram (the viewBox on the screen) and the edges of the svg box. */
const gaps = (panel: Locator) =>
  panel
    .locator('[data-testid="dmap-panel"] svg')
    .first()
    .evaluate((el) => {
      const svg = el as SVGSVGElement;
      const m = svg.getScreenCTM()!;
      const vb = svg.viewBox.baseVal;
      const r = svg.getBoundingClientRect();
      return {
        top: vb.y * m.d + m.f - r.top,
        bottom: r.bottom - ((vb.y + vb.height) * m.d + m.f),
        left: vb.x * m.a + m.e - r.left,
        right: r.right - ((vb.x + vb.width) * m.a + m.e),
      };
    });

const viewBox = (panel: Locator) => panel.locator('[data-testid="dmap-panel"] svg').first().getAttribute('viewBox');
const width = (vb: string | null) => Number((vb ?? '').split(' ')[2]);

async function openPanel(dashboardPage: DashboardPage) {
  const panel = (await dashboardPage.getPanelByTitle('demo-lab L3')).locator;
  await expect(panel.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '108');
  return panel;
}

test.describe('live zoom on the desktop', () => {
  test('explicit chart pixels follow nested affine geometry through resize, zoom, pan and reset', async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }, testInfo) => {
    const uid = await createDiagram(config);
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel');
    await expect(panel.locator('[data-dmap-widget] canvas')).toBeVisible();
    const read = () =>
      panel.evaluate((el) => {
        const shape = el.querySelector<SVGGraphicsElement>('[data-cell-id="chart-1"] rect')!;
        const portal = el.querySelector<SVGForeignObjectElement>('[data-dmap-widget="trend-region"]')!;
        const corners = (node: SVGGraphicsElement) => {
          const b = node.getBBox(),
            m = node.getScreenCTM()!;
          return [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x, b.y + b.height],
            [b.x + b.width, b.y + b.height],
          ].map(([x, y]) => {
            const point = new DOMPoint(x, y).matrixTransform(m);
            return [point.x, point.y];
          });
        };
        const expected = corners(shape),
          actual = corners(portal);
        const canvas = portal.querySelector('canvas');
        const pixels = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          error: Math.max(...actual.flatMap((p, i) => p.map((v, k) => Math.abs(v - expected[i][k])))),
          painted: pixels?.some((v, i) => i % 4 === 3 && v > 0),
          width: portal.width.baseVal.value,
          height: portal.height.baseVal.value,
          viewBox: el.querySelector('svg')!.getAttribute('viewBox'),
          screenWidth: shape.getBoundingClientRect().width,
          paintOrder: shape.nextElementSibling === portal,
          pointerEvents: getComputedStyle(portal).pointerEvents,
        };
      });
    const verify = async () => {
      let value = await read();
      await expect
        .poll(async () => {
          value = await read();
          return value.painted;
        })
        .toBe(true);
      expect(value.error).toBeLessThan(0.5);
      expect(value.painted).toBe(true);
      expect(value.width).toBe(180);
      expect(value.height).toBe(70);
      expect(value.paintOrder).toBe(true);
      expect(value.pointerEvents).toBe('none');
      return value;
    };
    const base = await verify();
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect.poll(async () => (await read()).screenWidth).not.toBe(base.screenWidth);
    const resized = await verify();
    const box = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await read()).viewBox).not.toBe(resized.viewBox);
    const zoomed = await verify();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await read()).viewBox).not.toBe(zoomed.viewBox);
    await verify();
    await panel.getByRole('button', { name: 'Reset zoom' }).click();
    await expect.poll(async () => (await read()).viewBox).toBe(resized.viewBox);
    await verify();
    await testInfo.attach('production-geometry', {
      body: JSON.stringify({ base, resized, final: await read() }),
      contentType: 'application/json',
    });
    await testInfo.attach('production-geometry-pixels', { body: await panel.screenshot(), contentType: 'image/png' });
  });
  test('Ctrl+wheel (a trackpad pinch) zooms; the reset button shows and restores the view', async ({
    gotoDashboardPage,
    page,
  }) => {
    if (SHOTS) {
      // a tall viewport: the sticky toolbar of the dashboard must not cover the top of the panel in the screenshot
      await page.setViewportSize({ width: 1280, height: 1000 });
    }
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    const reset = panel.getByRole('button', { name: 'Reset zoom' });
    const base = await viewBox(panel);
    await expect(reset).toHaveCount(0);

    // the plain wheel does not zoom: "Wheel zoom" is off in the demo
    const box = (await panel.getByTestId('dmap-panel').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    expect(await viewBox(panel)).toBe(base);

    await page.keyboard.down('Control');
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -20);
    }
    await page.keyboard.up('Control');
    await expect(reset).toBeVisible();
    expect(width(await viewBox(panel))).toBeLessThan(width(base));
    // a 32 px touch target
    const b = (await reset.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(32);
    expect(b.height).toBeGreaterThanOrEqual(32);
    if (SHOTS) {
      await page.mouse.move(1, 1);
      await panel.screenshot({ path: `${SHOTS}/zoomed-reset-button.png` });
    }

    await reset.click();
    await expect(reset).toHaveCount(0);
    expect(await viewBox(panel)).toBe(base);
  });

  test('a wide panel centres the fitted diagram horizontally, its top at the top', async ({ gotoDashboardPage }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    const g = await gaps(panel);
    expect(Math.abs(g.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1);
  });

  test('Fit keeps the whole diagram in the panel in view, panel view and panel edit mode, and after a resize', { tag: '@matrix' }, async ({
    page,
    gotoDashboardPage,
    gotoPanelEditPage,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fits = async (where: string) => {
      await expect.poll(async () => (await outside(page)).join(' '), { message: where }).toBe('');
    };
    await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    await fits('view');
    await page.setViewportSize({ width: 1000, height: 700 });
    await fits('view after a window resize');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDashboardPage({ uid: 'drawiomap-demo', queryParams: new URLSearchParams({ viewPanel: 'panel-1' }) });
    await expect(page.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '108');
    await fits('panel view');
    const edit = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '1' });
    await expect(page.getByTestId('dmap-edit-bindings')).toBeVisible();
    await expect(page.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '108');
    await fits('panel edit');
    await page.setViewportSize({ width: 1100, height: 760 });
    await fits('panel edit after a window resize');
    await page.setViewportSize({ width: 1440, height: 900 });
    await edit.backToDashboard();
    await expect(page.getByTestId('dmap-edit-bindings')).toHaveCount(0);
    await fits('view after panel edit');
  });
});

/**
 * The panels whose diagram is not inside the stage, or whose stage is not inside the panel. The diagram is the
 * screen box of all svg content (the bounding box of the root); the stage is the box below the status band.
 * The page must show at least one panel with a loaded svg.
 */
async function outside(page: Page) {
  const svgs = page.getByTestId('dmap-panel').locator('[data-testid="dmap-stage"] > svg');
  await expect(svgs.first()).toBeVisible();
  // Grafana rebuilds the panel when it leaves panel edit: the svg may be absent for a moment. The poll retries.
  if ((await svgs.count()) === 0) {
    return ['the svg is not loaded yet'];
  }
  return page.getByTestId('dmap-panel').evaluateAll((wrappers) =>
    wrappers.flatMap((wrapper) => {
      const stageEl = wrapper.querySelector('[data-testid="dmap-stage"]')!;
      const svg = stageEl.querySelector<SVGSVGElement>(':scope > svg');
      if (!svg) {
        return [`${wrapper.getAttribute('data-dmap-hash')}: no svg`];
      }
      const b = svg.getBBox();
      const m = svg.getScreenCTM()!;
      const corners = [
        [b.x, b.y],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const content = new DOMRect(corners[0].x, corners[0].y, corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const stage = stageEl.getBoundingClientRect();
      const box = wrapper.getBoundingClientRect();
      const panel = wrapper.parentElement!.getBoundingClientRect();
      const inside = (a: DOMRect, c: DOMRect) =>
        a.left >= c.left - 1 && a.top >= c.top - 1 && a.right <= c.right + 1 && a.bottom <= c.bottom + 1;
      return b.width > 0 && b.height > 0 && inside(content, stage) && inside(stage, box) && inside(box, panel)
        ? []
        : [
            `${wrapper.getAttribute('data-dmap-hash')}: diagram ${JSON.stringify(content)} stage ${JSON.stringify(stage)}`,
          ];
    })
  );
}

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

type TouchPoint = { x: number; y: number };

/** Real touch input through the browser input pipeline, so touch-action applies. */
async function touch(page: Page, from: TouchPoint[], to: TouchPoint[], steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => from.map((p, i) => ({ id: i, x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('live zoom on a phone', () => {
  test.use(iPhone);

  test('a one-finger swipe at the configured view does not zoom; a pinch zooms; the reset button restores', async ({
    gotoDashboardPage,
    page,
  }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    const stage = panel.getByTestId('dmap-panel');
    await stage.scrollIntoViewIfNeeded();
    const reset = panel.getByRole('button', { name: 'Reset zoom' });
    const base = await viewBox(panel);
    await expect(stage).toHaveCSS('touch-action', 'pan-x pan-y');

    let box = (await stage.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const scrollY = await page.evaluate(() => window.scrollY);
    await touch(page, [{ x: cx, y: cy + 40 }], [{ x: cx, y: cy - 40 }]);
    // the page scrolls
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollY);
    await expect(reset).toHaveCount(0);
    expect(await viewBox(panel)).toBe(base);

    box = (await stage.boundingBox())!;
    const my = box.y + box.height / 2;
    await touch(
      page,
      [
        { x: cx - 30, y: my },
        { x: cx + 30, y: my },
      ],
      [
        { x: cx - 120, y: my },
        { x: cx + 120, y: my },
      ]
    );
    await expect(reset).toBeVisible();
    // the panel zooms, the page does not
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    const zoomed = await viewBox(panel);
    expect(width(zoomed)).toBeLessThan(width(base) / 2);
    await expect(stage).toHaveCSS('touch-action', 'none');

    // one finger pans a zoomed view
    await touch(page, [{ x: cx + 40, y: my }], [{ x: cx - 40, y: my }]);
    await expect.poll(() => viewBox(panel)).not.toBe(zoomed);

    await reset.tap();
    await expect(reset).toHaveCount(0);
    expect(await viewBox(panel)).toBe(base);
  });

  test('the fitted diagram is at the top of a tall panel and centred horizontally', async ({ gotoDashboardPage }) => {
    const panel = await openPanel(await gotoDashboardPage({ uid: 'drawiomap-demo' }));
    await expect(panel.locator('[data-testid="dmap-panel"] svg').first()).toHaveAttribute(
      'preserveAspectRatio',
      'xMidYMin meet'
    );
    const g = await gaps(panel);
    expect(Math.abs(g.top)).toBeLessThanOrEqual(1);
    expect(g.bottom).toBeGreaterThan(50);
    expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1);
    expect(await outside(panel.page())).toEqual([]);
  });
});
