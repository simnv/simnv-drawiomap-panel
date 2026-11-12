import type { Locator } from '@playwright/test';
import { authoringFieldConfig, authoringTargets, expect, promTarget, test } from './authoring-fixtures';

const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there

/** A constant 3 % on a percent scale: its line lies in the bottom 3 % of a plot with the fixed domain 0–100. */
const LOW = (device: string) => `label_replace(vector(3), "device", "${device}", "", "")`;
const targets = () =>
  authoringTargets().map((t) =>
    t.refId === 'trend'
      ? promTarget('trend', LOW('trend'))
      : t.refId === 'detail'
        ? promTarget('detail', `${LOW('router-1')} or ${LOW('router-2')}`)
        : t
  );
const fieldConfig = () => {
  const config = authoringFieldConfig();
  config.defaults = { ...config.defaults, unit: 'percent' };
  return config;
};

/**
 * The plot of a stale chart box is inside the box, and its stroke (opaque pixels, not the 15 % fill) is in the bottom
 * band of the plot, inside the box: the line of a low value is not clipped.
 */
async function expectLowLineVisible(box: Locator) {
  const canvas = box.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const r = await box.evaluate((el) => {
    const outer = el.getBoundingClientRect();
    const canvas = el.querySelector('canvas')!;
    const plot = canvas.getBoundingClientRect();
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const rows: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] >= 200) {
          rows.push(y);
          break;
        }
      }
    }
    const scale = plot.height / height;
    return {
      clipped: el.scrollHeight - el.clientHeight,
      plotBottom: plot.bottom - outer.bottom,
      plotHeight: plot.height,
      // the CSS px of the first and the last stroke row, from the top of the plot
      first: rows.length ? rows[0] * scale : null,
      last: rows.length ? (rows[rows.length - 1] + 1) * scale : null,
    };
  });
  expect(r.clipped).toBeLessThanOrEqual(0);
  expect(r.plotBottom).toBeLessThanOrEqual(0.5);
  expect(r.first, 'stroke pixels').not.toBeNull();
  // the stroke is in the bottom band (the lower quarter) of the plot and inside the plot box
  expect(r.first!).toBeGreaterThan(r.plotHeight * 0.75);
  expect(r.last!).toBeLessThanOrEqual(r.plotHeight + 0.5);
}

for (const theme of ['light', 'dark'] as const) {
  test(`a stale chart with a low value keeps its line inside its box, in the card and in a region (${theme})`, async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }) => {
    // a freshness of 1 ms: the last sample is always older, so the rows and the regions are stale
    config.classes.routers.freshness = '1ms';
    config.classes['trend-region'].freshness = '1ms';
    const uid = await createDiagram(config, { targets: targets(), fieldConfig: fieldConfig() });
    await gotoDashboardPage({ uid, queryParams: new URLSearchParams({ theme }) });
    const panel = page.getByTestId('dmap-panel');
    await expect(panel).toHaveCSS('color-scheme', theme);

    // the chart region (a chart in the diagram)
    const region = panel.locator('[data-dmap-chart="chart-1"] [data-state="stale"]');
    await expect(region).toBeVisible();
    await expect(region.getByText('Stale data')).toHaveCount(1);
    await expectLowLineVisible(region);
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
    await expectLowLineVisible(spark);
    if (SHOTS) {
      await card.screenshot({ path: `${SHOTS}/stale-card-${theme}.png` });
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`a narrow stale region keeps its value and its hint visible, the label shrinks (${theme})`, async ({
    page,
    config,
    createDiagram,
    gotoDashboardPage,
  }) => {
    config.classes['trend-region'].freshness = '1ms';
    (config.classes['trend-region'].chart as { label?: string }).label =
      'A very long title of a standalone trend chart in a narrow region';
    const uid = await createDiagram(config, { targets: targets(), fieldConfig: fieldConfig(), width: 6 });
    await gotoDashboardPage({ uid, queryParams: new URLSearchParams({ theme }) });
    const panel = page.getByTestId('dmap-panel');
    const region = panel.locator('[data-dmap-chart="chart-1"] [data-state="stale"]');
    await expect(region).toBeVisible();
    const hint = region.getByText('Stale data');
    await expect(hint).toBeVisible();
    const value = region.getByText('3%');
    await expect(value).toBeVisible();
    const r = await region.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const inBox = (e: Element) => {
        const b = e.getBoundingClientRect();
        return (
          b.left >= box.left - 0.5 &&
          b.right <= box.right + 0.5 &&
          b.top >= box.top - 0.5 &&
          b.bottom <= box.bottom + 0.5
        );
      };
      const spans = [...el.querySelectorAll('span')];
      const label = spans.find((s) => s.textContent?.startsWith('A very long'))!;
      return {
        label: label.scrollWidth > label.clientWidth,
        value: inBox(spans.find((s) => s.textContent === '3%')!),
        hint: inBox(spans.find((s) => s.textContent === 'Stale data') ?? el.querySelector('[role="status"]')!),
      };
    });
    // the label ends with an ellipsis; the value and the hint are inside the box
    expect(r.label).toBe(true);
    expect(r.value).toBe(true);
    expect(r.hint).toBe(true);
    if (SHOTS) {
      await region.screenshot({ path: `${SHOTS}/stale-narrow-${theme}.png` });
    }
  });
}
