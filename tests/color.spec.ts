import { hoverHalf } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

// The WAN queries use "Green-Yellow-Red" with cap=100M on their cells.
// The LAN queries use "From thresholds" and the port speed series for capacity.
const ISP_A = 'pg-link~isp-a:pppoe->rtr-a:wan1';
const RADIO = 'pg-link~radio:dhcp->rtr-a:wan2';
const LAN = 'pg-link~net-a:lan->rtr-a:br-lan';
/** The named threshold colours of Grafana: green, yellow, red. */
const THRESHOLD_COLOURS = ['rgb(115, 191, 105)', 'rgb(250, 222, 42)', 'rgb(242, 73, 92)'];

const rgb = (c: string): number[] => {
  const hex = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return hex ? hex.slice(1).map((h) => parseInt(h, 16)) : (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
};
const css = (c: string) => `rgb(${rgb(c).join(', ')})`;

test('a WAN link has a colour from the continuous scheme of its field, a LAN link from the thresholds', async ({
  gotoDashboardPage,
}) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const half = (cell: string) =>
    panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`);
  await expect(half(ISP_A)).toHaveAttribute('data-dmap-status', 'ok');
  await expect(half(RADIO)).toHaveAttribute('data-dmap-status', 'ok');
  await expect(half(LAN)).toHaveAttribute('data-dmap-status', 'ok');

  const wan41 = (await half(ISP_A).getAttribute('stroke'))!;
  const wan90 = (await half(RADIO).getAttribute('stroke'))!;
  // 41 % and 90 % of 100 Mb/s: colours between the scheme stops, not a threshold colour
  expect(THRESHOLD_COLOURS).not.toContain(css(wan41));
  expect(THRESHOLD_COLOURS).not.toContain(css(wan90));
  // nearer to red at 90 %: less green
  expect(rgb(wan90)[1]).toBeLessThan(rgb(wan41)[1]);
  // the thresholds still give the step index in percent
  await expect(half(RADIO)).toHaveAttribute('data-dmap-step', '2');

  // The LAN a2b half uses rx at the target: 96 Mb/s of 1 Gb/s = 9.6 %, green from the thresholds
  expect(css((await half(LAN).getAttribute('stroke'))!)).toBe(THRESHOLD_COLOURS[0]);
  await expect(half(LAN)).toHaveAttribute('data-dmap-step', '0');
});

// TODO P1-11c: Restore link card percentages before this case runs.
test.fixme('the hover card shows the percent of the cell capacity; the port speed series colours the canvas', async ({
  gotoDashboardPage,
  page,
}) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const card = panel.locator.getByRole('tooltip');
  const hover = async (cell: string) => {
    const half = panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`);
    await expect(half).toHaveAttribute('data-dmap-status', 'ok');
    await hoverHalf(half);
  };
  // capacity of the WAN cell: 41 Mb/s of 100 Mb/s
  await hover(ISP_A);
  await expect(card).toContainText(/↑ 41(\.\d)? Mb\/s · 41%/);
  await page.mouse.move(1, 1);
  await expect(card).toHaveCount(0);
  // the port speed series (125 MB/s = 1 Gb/s) gives the canvas colour (the test above); the row shows the value
  await hover(LAN);
  await expect(card).toContainText(/↑ 480(\.\d)? Mb\/s/);
});

// TODO P1-11c: Restore link card percentages before this case runs.
test.fixme('the hand-drawn panel reads the capacity from a cell attribute', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({
    uid: 'drawiomap-demo',
    queryParams: new URLSearchParams({ viewPanel: 'panel-2' }),
  });
  const panel = await dashboardPage.getPanelByTitle('hand-drawn');
  // edge-ab has cap="100M"; the a2b series is 41 Mb/s
  const half = panel.locator.locator('polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="edge-ab"]');
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await hoverHalf(half);
  await expect(panel.locator.getByRole('tooltip')).toContainText(/↑ 41(\.\d)? Mb\/s · 41%/);
});
