import { hoverHalf, pointOnHalf } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

// The demo dashboard: WAN query W has the Color scheme "Green-Yellow-Red" and Max 100 Mb/s by an override.
// LAN links use query A with "From thresholds" and a capacity from the port speed series S.
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

  // LAN: 480 Mb/s of 1 Gb/s = 48 %, green from the thresholds
  expect(css((await half(LAN).getAttribute('stroke'))!)).toBe(THRESHOLD_COLOURS[0]);
  await expect(half(LAN)).toHaveAttribute('data-dmap-step', '0');
});

test('the hover card shows the capacity of each source', async ({ gotoDashboardPage, page }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const card = panel.locator.getByRole('tooltip');
  const hover = async (cell: string) => {
    const half = panel.locator.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`);
    await expect(half).toHaveAttribute('data-dmap-status', 'ok');
    await hoverHalf(half);
  };
  // field Max of the WAN query
  await hover(ISP_A);
  await expect(card).toContainText('41% of 100 Mb/s');
  await page.mouse.move(1, 1);
  await expect(card).toHaveCount(0);
  // the port speed series: 125 MB/s = 1 Gb/s
  await hover(LAN);
  await expect(card).toContainText('48% of 1 Gb/s');
});

test('the hand-drawn panel reads the capacity from a cell attribute', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({
    uid: 'drawiomap-demo',
    queryParams: new URLSearchParams({ viewPanel: 'panel-2' }),
  });
  const panel = await dashboardPage.getPanelByTitle('hand-drawn');
  // edge-ab has capacity="100000000"; the a2b series is 41 Mb/s
  const half = panel.locator.locator('polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="edge-ab"]');
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  await hoverHalf(half);
  await expect(panel.locator.getByRole('tooltip')).toContainText('41% of 100 Mb/s');
});
