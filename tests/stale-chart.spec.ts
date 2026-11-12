import type { Locator } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there

/** The box of a stale chart holds the "Stale data" hint and a plot that is inside the box and has drawn pixels. */
async function expectPlotInside(box: Locator) {
  await expect(box.getByText('Stale data')).toHaveCount(1);
  const canvas = box.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const result = await box.evaluate((el) => {
    const outer = el.getBoundingClientRect();
    const canvas = el.querySelector('canvas')!;
    const plot = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let first = -1;
    let last = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          first = first < 0 ? y : first;
          last = y;
          break;
        }
      }
    }
    // the drawn rows in CSS px, relative to the outer box
    const scale = plot.height / height;
    return {
      clipped: el.scrollHeight - el.clientHeight,
      plotBottom: plot.bottom - outer.bottom,
      firstDrawn: first < 0 ? null : plot.top + first * scale - outer.top,
      lastDrawn: last < 0 ? null : plot.top + (last + 1) * scale - outer.top,
      boxHeight: outer.height,
    };
  });
  expect(result.clipped).toBeLessThanOrEqual(0);
  expect(result.plotBottom).toBeLessThanOrEqual(0.5);
  expect(result.firstDrawn).not.toBeNull();
  expect(result.lastDrawn!).toBeLessThanOrEqual(result.boxHeight + 0.5);
}

for (const theme of ['light', 'dark'] as const) {
  test(`a stale chart row of a card and of a chart region keeps its line inside its box (${theme})`, async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }) => {
    // a freshness of 1 ms: the last sample is always older, so the rows and the regions are stale
    config.classes.routers.freshness = '1ms';
    config.classes['trend-region'].freshness = '1ms';
    const uid = await createDiagram(config);
    await gotoDashboardPage({ uid, queryParams: new URLSearchParams({ theme }) });
    const panel = page.getByTestId('dmap-panel');
    await expect(panel).toHaveCSS('color-scheme', theme);

    // the chart region (a chart in the diagram)
    const region = panel.locator('[data-dmap-chart="chart-1"] [data-state="stale"]');
    await expect(region).toBeVisible();
    await expectPlotInside(region);
    if (SHOTS) {
      await region.screenshot({ path: `${SHOTS}/stale-region-${theme}.png` });
    }

    // the hover card of a node: the history row
    const shape = panel.locator('[data-cell-id="device-1"] > rect, [data-cell-id="device-1"] > path').first();
    const at = (await shape.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2 - 2, at.y + at.height / 2);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 2 });
    const card = panel.getByTestId('dmap-card');
    await expect(card).toBeVisible();
    const spark = card.getByTestId('dmap-card-spark').locator('[data-state="stale"]');
    await expect(spark).toBeVisible();
    // the card shows the hint in the head of the row, not in the chart box
    await expect(spark.getByText('Stale data')).toHaveCount(0);
    const result = await spark.evaluate((el) => {
      const canvas = el.querySelector('canvas')!;
      return {
        clipped: el.scrollHeight - el.clientHeight,
        box: el.getBoundingClientRect().height,
        plot: canvas.getBoundingClientRect().height,
      };
    });
    expect(result.clipped).toBeLessThanOrEqual(0);
    expect(result.plot).toBeLessThanOrEqual(result.box);
    const canvas = spark.locator('canvas').first();
    const drawn = await canvas.evaluate((c: HTMLCanvasElement) => {
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
          return true;
        }
      }
      return false;
    });
    expect(drawn).toBe(true);

    if (SHOTS) {
      await card.screenshot({ path: `${SHOTS}/stale-card-${theme}.png` });
    }
  });
}
