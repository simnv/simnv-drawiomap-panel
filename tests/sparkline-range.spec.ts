import { hoverHalf, pointOnHalf } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

const RADIO = 'pg-link~radio:dhcp->rtr-a:wan2';
const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the card screenshots there
const ys = (points: string) => points.split(' ').map((p) => Number(p.split(',')[1]));

test('a flat series sparkline starts at zero: the line stays in a narrow band near the top', async ({
  gotoDashboardPage,
}) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const half = panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${RADIO}"]`);
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await hoverHalf(half);
  // radio → rtr-a is a flat 90 Mb/s on a 100 Mb/s link: in the range 0 to 100 Mb/s the line is at 10% from the top
  const row = panel.locator.getByRole('tooltip').getByTestId('dmap-card-row').filter({ hasText: 'radio → rtr-a' });
  await expect(row).toContainText('90%');
  const canvas = row.getByTestId('dmap-card-spark').locator('canvas').first();
  // the rows of the canvas that have opaque line pixels (the fill under the line is translucent)
  const band = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let top = c.height;
      let bottom = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (data[(y * c.width + x) * 4 + 3] > 200) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      return { top: top / c.height, bottom: bottom / c.height };
    });
  await expect.poll(async () => (await band()).bottom).toBeGreaterThanOrEqual(0);
  const { top, bottom } = await band();
  expect(top).toBeLessThan(0.3);
  // an automatic min-max range would stretch the small noise of the flat series over the full height
  expect(bottom).toBeLessThan(0.3);
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
    /^↑ (9\.\d+|10(\.\d+)?) Mb\/s · 10%  ↓ (40\.\d+|41(\.\d+)?) Mb\/s · 8[0-2]%$/
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
