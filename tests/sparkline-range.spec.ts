import { hoverHalf, pointOnHalf } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

const RADIO = 'pg-link~radio:dhcp->rtr-a:wan2';
const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the card screenshots there
const ys = (points: string) => points.split(' ').map((p) => Number(p.split(',')[1]));

test('a flat series starts at the zero line: the line stays in a narrow band near the top of its half', async ({
  gotoDashboardPage,
}) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const half = panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${RADIO}"]`);
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await hoverHalf(half);
  // radio sends a flat 90 Mb/s on a 100 Mb/s link, the largest value of the row: the up line is at the top of its half
  const row = panel.locator.getByRole('tooltip').getByTestId('dmap-card-row').filter({ hasText: 'Traffic' });
  await expect(row).toContainText('90%');
  const spark = row.getByTestId('dmap-mirror-spark');
  const zero = Number(await spark.getByTestId('dmap-zero-line').getAttribute('y1'));
  const up = ys((await spark.locator('polyline[data-direction="up"]').first().getAttribute('points'))!);
  expect(Math.max(...up)).toBeLessThan(zero);
  expect(Math.min(...up)).toBeLessThan(0.15 * zero);
  // an automatic min-max range would stretch the small noise of the flat series over the full half
  expect(Math.max(...up) - Math.min(...up)).toBeLessThan(0.15 * zero);
});

test('a combined up/down row shows both values, a zero line and the down series mirrored below it', async ({
  gotoDashboardPage,
}) => {
  // Grafana loads panels below the fold only when they scroll into view. viewPanel shows this panel alone.
  const dashboardPage = await gotoDashboardPage({
    uid: 'drawiomap-demo',
    queryParams: new URLSearchParams({ viewPanel: 'panel-3' }),
  });
  const panel = await dashboardPage.getPanelByTitle('Sanitized authoring topology');
  const half = panel.locator.locator('polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="link-1"]');
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await hoverHalf(half);
  const row = panel.locator.getByRole('tooltip').getByTestId('dmap-card-row').filter({ hasText: 'Traffic' });
  // synthetic rtr-a wan1: transmit 10 Mb/s of 100 Mb/s, receive 41 Mb/s of 50 Mb/s (an asymmetric link)
  await expect(row.getByTestId('dmap-card-value')).toHaveText(
    /^↑ (9\.\d+|10(\.\d+)?) Mb\/s · 10% of 100 Mb\/s  ↓ (40\.\d+|41(\.\d+)?) Mb\/s · 8[0-2]% of 50 Mb\/s$/
  );
  const spark = row.getByTestId('dmap-mirror-spark');
  const zero = Number(await spark.getByTestId('dmap-zero-line').getAttribute('y1'));
  // the range is symmetric, so the zero line is in the middle of the chart
  const height = Number(await spark.getAttribute('height'));
  // the chart is twice as tall as a single sparkline (40 px): each half is as tall as one
  expect(height).toBe(80);
  expect(zero).toBe(height / 2);
  // the chart is really drawn at that height, not clipped by its box
  expect((await spark.boundingBox())!.height).toBe(height);
  const up = ys((await spark.locator('polyline[data-direction="up"]').first().getAttribute('points'))!);
  const down = spark.locator('polyline[data-direction="down"]').first();
  await expect(down).toHaveAttribute('data-mirrored', 'true');
  const downYs = ys((await down.getAttribute('points'))!);
  expect(Math.max(...up)).toBeLessThan(zero);
  expect(Math.min(...downYs)).toBeGreaterThan(zero);
  // down (41 Mb/s) is further from the zero line than up (10 Mb/s)
  expect(Math.max(...downYs) - zero).toBeGreaterThan(zero - Math.min(...up));
  // the range follows the data, not the capacity: the larger direction fills about 90% of its half
  expect((Math.max(...downYs) - zero) / zero).toBeGreaterThan(0.8);
  // 41 Mb/s fills a half of 40 px: the swing is tens of pixels, not a flat line
  expect(Math.max(...downYs) - zero).toBeGreaterThan(30);
  if (SHOTS) {
    await panel.locator.screenshot({ path: `${SHOTS}/card-combined-row.png` });
  }
});
